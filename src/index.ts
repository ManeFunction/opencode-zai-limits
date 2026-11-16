/**
 * OpenCode GLM Limits — server part (V2 plugin API)
 *
 * Query Z.ai GLM Coding Plan usage statistics including credit limits,
 * model usage, and MCP tool usage.
 *
 * V2 notes:
 * - The default export is the plain `{ id, setup(ctx) }` object.
 *   `Plugin.define()` in `@opencode/plugin` is an identity function (it
 *   returns its argument), so the SDK dependency is not needed at runtime
 *   and this plugin stays zero-dependency. V1-style plugin functions do
 *   not load in OpenCode V2 — keep this shape.
 * - The tool is registered through `ctx.tool.transform` under the name
 *   `glm_quota`, so agents can check the quota themselves. The `/glm-limits`
 *   slash command does not go through it: the TUI part (`tui.tsx`) calls
 *   `executeGlmQuota` directly and shows the report in a dialog, with no
 *   agent and no model call.
 * - `options: { codemode: true }` also exposes the tool to Code Mode.
 * - Credential discovery lives in `utils/credentials.ts` and reads the
 *   OpenCode v2 SQLite store (opencode.db) first, then auth.json, then env.
 */

import { getPlatformName } from './api/platforms.js';
import { getEndpoints } from './api/endpoints.js';
import { queryEndpoint } from './api/client.js';
import { getTimeWindow, getTimeWindowQueryParams } from './utils/time-window.js';
import { formatProgressLine } from './utils/progress-bar.js';
import {
  MAIN_TITLE_PREFIX,
  ROW_EMOJI,
  SECTION_HEADERS
} from './utils/markdown-constants.js';
import { createMarkdownError, GlmReportError, summarizeError } from './utils/error-formatter.js';
import { asNumber, parseQuota } from './quota.js';
import type { Quota, QuotaWindow } from './quota.js';
import type { Credentials } from './utils/credentials.js';
import { getCredentials } from './utils/credentials.js';

// ============================================================================
// OUTPUT FORMATTING
// ============================================================================

/**
 * Format number with thousand separators
 */
function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

function formatPlanLevel(level: string | null): string {
  if (!level) {
    return '';
  }
  return level.charAt(0).toUpperCase() + level.slice(1).toLowerCase();
}

function formatResetCell(resetAt: number | null): string {
  if (resetAt === null) {
    return '—';
  }
  const diffMs = resetAt - Date.now();
  if (diffMs <= 0) {
    return '—';
  }
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  // Format countdown portion
  let countdown: string;
  if (totalMinutes >= 24 * 60) {
    const totalHours = Math.floor(totalMinutes / 60);
    countdown = `${Math.floor(totalHours / 24)}d ${totalHours % 24}h`;
  } else {
    countdown = `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
  }
  // Format local reset time portion (Issue #34: show actual clock time)
  const resetDate = new Date(resetAt);
  const hh = String(resetDate.getHours()).padStart(2, '0');
  const mm = String(resetDate.getMinutes()).padStart(2, '0');
  if (totalMinutes >= 24 * 60) {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${countdown} (${dayNames[resetDate.getDay()]} ${hh}:${mm})`;
  }
  return `${countdown} (${hh}:${mm})`;
}

function formatMarkdownTable(headers: string[], separator: string[], rows: string[][]): string {
  const tableRows = rows.map((row) => `| ${row.join(' | ')} |`);
  return [`| ${headers.join(' | ')} |`, `|${separator.join('|')}|`, ...tableRows].join('\n');
}

function formatMarkdownHeader(
  platformName: string,
  startTime: string,
  endTime: string,
  level: string | null,
  credentials?: Credentials
): string {
  const title = level
    ? `${MAIN_TITLE_PREFIX}${formatPlanLevel(level)}`
    : '### 📊 Z.ai GLM Coding Plan';
  const lines = [
    title,
    '',
    `- **Platform**: ${platformName}`,
    `- **Period**: ${startTime} → ${endTime}`
  ];
  if (credentials) {
    lines.push(`- **Key**: ${credentials.label} (${credentials.source})`);
  }
  return lines.join('\n');
}

function formatUsed(window: QuotaWindow | null): string {
  if (window?.used == null || window.total == null) {
    return '—';
  }
  return `**${formatNumber(window.used)} / ${formatNumber(window.total)}**`;
}

function formatQuotaLimitsTable(quota: Quota): string {
  const windows: [string, QuotaWindow | null, boolean][] = [
    [`${ROW_EMOJI.TOKEN} 5h Credits`, quota.fiveHour, true],
    [`${ROW_EMOJI.WEEKLY} Weekly Credits`, quota.weekly, true],
    ...quota.other.map((w): [string, QuotaWindow, boolean] => [`Credits (unit ${w.unit ?? '?'} × ${w.number ?? '?'})`, w, true]),
    [`${ROW_EMOJI.MCP} MCP (1 Month)`, quota.mcp, false]
  ];
  const rows = windows
    .filter((entry): entry is [string, QuotaWindow, boolean] => entry[1] !== null)
    .map(([label, window, resets]) => {
      const percentage = window.percentage ?? 0;
      return [
        label,
        window.percentage === null ? '—' : `${percentage.toFixed(1)}%`,
        formatProgressLine('', percentage),
        resets ? formatResetCell(window.resetsAt) : '—'
      ];
    });
  return formatMarkdownTable(
    ['Window', 'Usage', 'Progress', 'Resets In'],
    ['--------', '------:', '----------', '-----------'],
    rows.length > 0 ? rows : [['No quota data available', '—', '—', '—']]
  );
}

function formatQuotaUsageTable(quota: Quota): string {
  const rows: string[][] = [['💰 **5h Credits Used**', formatUsed(quota.fiveHour)]];
  if (quota.weekly?.used != null && quota.weekly.total != null) {
    rows.push(['📅 **Weekly Credits Used**', formatUsed(quota.weekly)]);
  }
  rows.push(['🔌 **MCP Used**', quota.mcp?.used == null || quota.mcp.total == null ? '—' : `**${quota.mcp.used} / ${quota.mcp.total}**`]);
  return formatMarkdownTable(['Metric', 'Value'], ['--------', '------:'], rows);
}

function formatMcpToolLabel(modelCode: string): string {
  if (modelCode === 'search-prime') {
    return '🔍 Network Searches';
  }
  if (modelCode === 'web-reader') {
    return '🌐 Web Reads';
  }
  if (modelCode === 'zread') {
    return '📖 ZRead Calls';
  }
  return modelCode;
}

function formatMcpBreakdownTable(quota: Quota): string {
  const tools = quota.mcp?.tools ?? [];
  const rows = tools.length
    ? tools.map((tool) => [formatMcpToolLabel(tool.code), tool.usage === null ? '—' : formatNumber(tool.usage)])
    : [['No MCP data available', '—']];
  return formatMarkdownTable(['Tool', 'Count'], ['------', '------:'], rows);
}

function formatModelUsageTable(modelData: Record<string, unknown> | null, detailed: boolean): string {
  const totalUsage = modelData?.totalUsage as Record<string, unknown> | undefined;
  const models = (Array.isArray(totalUsage?.modelSummaryList) ? totalUsage.modelSummaryList : [])
    .filter((model): model is Record<string, unknown> => typeof model === 'object' && model !== null)
    .map((model) => ({
      name: typeof model.modelName === 'string' ? model.modelName : 'Unknown',
      tokens: asNumber(model.totalTokens)
    }));
  const modelTokenSum = models.reduce((sum, model) => sum + (model.tokens ?? 0), 0);
  const rows: string[][] = [];
  let calls = asNumber(totalUsage?.totalModelCallCount);
  let tokens = asNumber(totalUsage?.totalTokensUsage);
  // The API sometimes sends zero totals next to a non-empty per-model list.
  // Trust the list then, and drop the call count it cannot back up.
  if (!tokens && modelTokenSum > 0) {
    tokens = modelTokenSum;
    if (!calls) calls = null;
  }
  if (tokens !== null) {
    rows.push(['🔢 Total Tokens (24h)', formatNumber(tokens)]);
  }
  if (calls !== null) {
    rows.push(['📞 Total Calls', formatNumber(calls)]);
  }
  if (detailed) {
    for (const model of models) {
      rows.push([`🤖 ${model.name}`, model.tokens === null ? '—' : formatNumber(model.tokens)]);
    }
  }
  return formatMarkdownTable(['Metric', 'Value'], ['--------', '------:'], rows.length > 0 ? rows : [['No model usage data available', '—']]);
}

function formatToolUsageTable(toolData: Record<string, unknown> | null): string {
  const totalUsage = toolData?.totalUsage as Record<string, unknown> | undefined;
  const counts: [string, number | null][] = [
    ['🔍 Network Searches', asNumber(totalUsage?.totalNetworkSearchCount)],
    ['🌐 Web Reads', asNumber(totalUsage?.totalWebReadMcpCount)],
    ['🎭 ZRead Calls', asNumber(totalUsage?.totalZreadMcpCount)]
  ];
  const rows = counts
    .filter(([, count]) => count !== null)
    .map(([label, count]) => [label, formatNumber(count as number)]);
  return formatMarkdownTable(['Tool', 'Count'], ['------', '------:'], rows.length > 0 ? rows : [['No tool usage data available', '—']]);
}

function unavailable(reason: string): string {
  return `⚠️ Unavailable: ${reason}`;
}

function formatMarkdownOutput(
  credentials: Credentials,
  startTime: string,
  endTime: string,
  quota: Quota,
  modelData: Record<string, unknown> | null,
  toolData: Record<string, unknown> | null,
  detailed: boolean,
  failures: Record<string, string> = {}
): string {
  const platformName = getPlatformName(credentials.platform);
  return [
    formatMarkdownHeader(platformName, startTime, endTime, quota.level, credentials),
    `${SECTION_HEADERS.QUOTA_LIMITS}\n\n${formatQuotaLimitsTable(quota)}`,
    `${SECTION_HEADERS.QUOTA_USAGE}\n\n${formatQuotaUsageTable(quota)}`,
    `${SECTION_HEADERS.MCP_BREAKDOWN}\n\n${formatMcpBreakdownTable(quota)}`,
    `${SECTION_HEADERS.MODEL_USAGE}\n\n${failures.modelUsage ? unavailable(failures.modelUsage) : formatModelUsageTable(modelData, detailed)}`,
    `${SECTION_HEADERS.TOOL_USAGE}\n\n${failures.toolUsage ? unavailable(failures.toolUsage) : formatToolUsageTable(toolData)}`
  ].join('\n\n');
}

// ============================================================================
// CREDENTIAL ERROR
// ============================================================================

/**
 * Create error message for missing credentials
 * @returns Error message with Markdown formatting
 */
function createCredentialError(): string {
  return createMarkdownError('Credentials Not Found', {}, 'Please authenticate first.', [
    'Run `/connect` command in OpenCode TUI.',
    'Select "Z.AI Coding Plan", "Z.AI", or "Zhipu".',
    'OpenCode v2 keeps keys in `~/.local/share/opencode/opencode.db` (table `credential`) — check there is an active Z.AI row and that the `sqlite3` CLI is available.',
    'For development/testing, set `ZAI_API_KEY` or `ZHIPU_API_KEY`.'
  ]);
}

// ============================================================================
// MAIN QUERY FUNCTION
// ============================================================================

/**
 * Query all usage statistics
 * @param credentials - API credentials
 * @param detailed - Include per-model usage breakdown
 * @returns Formatted output string
 */
async function queryAllUsage(credentials: Credentials, detailed: boolean): Promise<string> {
  const endpoints = getEndpoints(credentials.platform);
  const { startTime, endTime } = getTimeWindow();
  const queryParams = getTimeWindowQueryParams();
  const [quotaResult, modelResult, toolResult] = await Promise.allSettled([
    queryEndpoint(endpoints, credentials.token, 'quotaLimit'),
    queryEndpoint(endpoints, credentials.token, 'modelUsage', queryParams),
    queryEndpoint(endpoints, credentials.token, 'toolUsage', queryParams)
  ]);
  // Without the quota response there is no report worth showing (and a bad
  // key fails all three calls the same way): surface that error instead of
  // an empty report.
  if (quotaResult.status === 'rejected') {
    throw quotaResult.reason;
  }
  const quota = parseQuota(quotaResult.value.data);
  const modelData = modelResult.status === 'fulfilled'
    ? ((modelResult.value.data || modelResult.value) as Record<string, unknown>)
    : null;
  const toolData = toolResult.status === 'fulfilled'
    ? ((toolResult.value.data || toolResult.value) as Record<string, unknown>)
    : null;
  const failures: Record<string, string> = {};
  if (modelResult.status === 'rejected') failures.modelUsage = summarizeError(modelResult.reason);
  if (toolResult.status === 'rejected') failures.toolUsage = summarizeError(toolResult.reason);
  return formatMarkdownOutput(credentials, startTime, endTime, quota, modelData, toolData, detailed, failures);
}

/**
 * Execute the GLM quota query and return the Markdown report.
 * Testable core shared by the plugin tool executor and the test suite.
 * @param input - Tool input (`detailed` adds per-model usage breakdown)
 * @returns Markdown report or Markdown error message
 */
export async function executeGlmQuota(input?: { detailed?: boolean }): Promise<string> {
  const detailed = input?.detailed === true;
  try {
    const credentials = await getCredentials();
    if (!credentials) {
      return createCredentialError();
    }
    return await queryAllUsage(credentials, detailed);
  } catch (error) {
    if (error instanceof GlmReportError) {
      return error.message;
    }
    return createMarkdownError('Error', {}, error instanceof Error ? error.message : String(error));
  }
}

// ============================================================================
// PLUGIN (V2)
// ============================================================================

interface ToolEditor {
  add(tool: Record<string, unknown>): void;
}

interface PluginContext {
  tool: {
    transform(fn: (editor: ToolEditor) => Promise<void> | void): Promise<void> | void;
  };
}

interface GlmLimitsPlugin {
  id: string;
  setup(ctx: PluginContext): Promise<void> | void;
}

// Plain object on purpose: `Plugin.define()` from `@opencode/plugin` is an
// identity function (returns its argument), so the SDK would only add
// TypeScript types at a cost of a ~180 MB dependency tree. Keep the shape.
export default {
  id: 'glm-quota',
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: 'glm_quota',
        description:
          'Query Z.ai GLM Coding Plan usage statistics including quota limits, model usage, and MCP tool usage',
        input: {
          type: 'object',
          properties: {
            detailed: {
              type: 'boolean',
              description: 'Show detailed usage breakdown (per-model token usage)'
            }
          },
          required: [],
          additionalProperties: false
        },
        options: { codemode: true },
        async execute(input: unknown) {
          const args = (input ?? {}) as { detailed?: boolean };
          return { content: await executeGlmQuota(args) };
        }
      });
    });
  }
} satisfies GlmLimitsPlugin;

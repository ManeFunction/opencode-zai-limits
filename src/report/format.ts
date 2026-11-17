/**
 * Markdown usage report
 *
 * Pure rendering: everything comes in through {@link ReportInput} (already
 * fetched and parsed), so the report can be built from fixtures without
 * credentials or network. `executeGlmQuota` in ../index.ts does the I/O.
 */

import { getPlatformName } from '../api/platforms.js';
import {
  MAIN_TITLE_PREFIX,
  MCP_TOOL_LABELS,
  ROW_BULLET,
  SECTION_HEADERS
} from '../utils/markdown-constants.js';
import { formatClock, formatDuration, timeUntil } from '../utils/duration.js';
import { asNumber } from '../quota.js';
import type { Quota, QuotaWindow } from '../quota.js';
import type { Credentials } from '../utils/credentials.js';
import type { TimeWindow } from '../utils/time-window.js';

/** The `data` object of a usage endpoint, or why the request failed. */
export type UsageSection = { data: Record<string, unknown> | null } | { failed: string };

export type ReportCredentials = Pick<Credentials, 'platform' | 'label' | 'source'>;

export interface ReportInput {
  credentials: ReportCredentials;
  /** The 24h window the usage endpoints were queried for. */
  window: TimeWindow;
  /** Clock used for reset countdowns (ms since epoch). */
  now: number;
  quota: Quota;
  modelUsage: UsageSection;
  toolUsage: UsageSection;
  /** Adds the per-model token rows. */
  detailed: boolean;
}

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

function formatResetCell(resetAt: number | null, now: number): string {
  const left = timeUntil(resetAt, now);
  if (resetAt === null || left === null) {
    return '—';
  }
  // Countdown plus the local clock time it lands on (Issue #34)
  const overADay = left >= 24 * 60 * 60 * 1000;
  return `${formatDuration(left)} (${formatClock(resetAt, overADay)})`;
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
  credentials: ReportCredentials
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
  lines.push(`- **Key**: ${credentials.label} (${credentials.source})`);
  return lines.join('\n');
}

function formatUsed(window: QuotaWindow | null): string {
  if (window?.used == null || window.total == null) {
    return '—';
  }
  return `**${formatNumber(window.used)} / ${formatNumber(window.total)}**`;
}

function formatQuotaUsageTable(quota: Quota, now: number): string {
  const windows: [string, QuotaWindow | null, boolean][] = [
    [`${ROW_BULLET} 5h Credits`, quota.fiveHour, true],
    [`${ROW_BULLET} Weekly Credits`, quota.weekly, true],
    ...quota.other.map((w): [string, QuotaWindow, boolean] => [`${ROW_BULLET} Credits (unit ${w.unit ?? '?'} × ${w.number ?? '?'})`, w, true]),
    [`${ROW_BULLET} MCP (1 Month)`, quota.mcp, false]
  ];
  const rows = windows
    .filter((entry): entry is [string, QuotaWindow, boolean] => entry[1] !== null)
    .map(([label, window, resets]) => [
      label,
      formatUsed(window),
      window.percentage === null ? '—' : `${window.percentage.toFixed(1)}%`,
      resets ? formatResetCell(window.resetsAt, now) : '—'
    ]);
  return formatMarkdownTable(
    ['Window', 'Value', 'Usage', 'Resets In'],
    ['--------', '------:', '------:', '-----------'],
    rows.length > 0 ? rows : [['No quota data available', '—', '—', '—']]
  );
}

function formatMcpToolLabel(modelCode: string): string {
  return Object.hasOwn(MCP_TOOL_LABELS, modelCode)
    ? MCP_TOOL_LABELS[modelCode as keyof typeof MCP_TOOL_LABELS]
    : modelCode;
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
    rows.push([`${ROW_BULLET} Total Tokens (24h)`, formatNumber(tokens)]);
  }
  if (calls !== null) {
    rows.push([`${ROW_BULLET} Total Calls`, formatNumber(calls)]);
  }
  if (detailed) {
    for (const model of models) {
      rows.push([`${ROW_BULLET} ${model.name}`, model.tokens === null ? '—' : formatNumber(model.tokens)]);
    }
  }
  return formatMarkdownTable(['Metric', 'Value'], ['--------', '------:'], rows.length > 0 ? rows : [['No model usage data available', '—']]);
}

function formatToolUsageTable(toolData: Record<string, unknown> | null): string {
  const totalUsage = toolData?.totalUsage as Record<string, unknown> | undefined;
  const counts: [string, number | null][] = [
    [MCP_TOOL_LABELS['search-prime'], asNumber(totalUsage?.totalNetworkSearchCount)],
    [MCP_TOOL_LABELS['web-reader'], asNumber(totalUsage?.totalWebReadMcpCount)],
    [MCP_TOOL_LABELS.zread, asNumber(totalUsage?.totalZreadMcpCount)]
  ];
  const rows = counts
    .filter(([, count]) => count !== null)
    .map(([label, count]) => [label, formatNumber(count as number)]);
  return formatMarkdownTable(['Tool', 'Count'], ['------', '------:'], rows.length > 0 ? rows : [['No tool usage data available', '—']]);
}

function formatSection(section: UsageSection, render: (data: Record<string, unknown> | null) => string): string {
  return 'failed' in section ? `${ROW_BULLET} Unavailable: ${section.failed}` : render(section.data);
}

/**
 * Build the full Markdown report.
 */
export function formatReport(input: ReportInput): string {
  const { credentials, window, now, quota, detailed } = input;
  return [
    formatMarkdownHeader(getPlatformName(credentials.platform), window.startTime, window.endTime, quota.level, credentials),
    `${SECTION_HEADERS.QUOTA_USAGE}\n\n${formatQuotaUsageTable(quota, now)}`,
    `${SECTION_HEADERS.MCP_BREAKDOWN}\n\n${formatMcpBreakdownTable(quota)}`,
    `${SECTION_HEADERS.MODEL_USAGE}\n\n${formatSection(input.modelUsage, (data) => formatModelUsageTable(data, detailed))}`,
    `${SECTION_HEADERS.TOOL_USAGE}\n\n${formatSection(input.toolUsage, formatToolUsageTable)}`
  ].join('\n\n');
}

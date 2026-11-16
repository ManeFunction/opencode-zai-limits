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

import { getEndpoints } from './api/endpoints.js';
import { queryEndpoint } from './api/client.js';
import type { ApiResponse } from './api/client.js';
import { getTimeWindow, getTimeWindowQueryParams } from './utils/time-window.js';
import { createMarkdownError, GlmReportError, summarizeError } from './utils/error-formatter.js';
import { parseQuota } from './quota.js';
import { formatReport } from './report/format.js';
import type { UsageSection } from './report/format.js';
import type { Credentials } from './utils/credentials.js';
import { getCredentials } from './utils/credentials.js';

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
  // One clock for the whole run, so the printed period, the query and the
  // countdowns cannot straddle an hour boundary.
  const now = new Date();
  const queryParams = getTimeWindowQueryParams(now);
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
  return formatReport({
    credentials,
    window: getTimeWindow(now),
    now: now.getTime(),
    quota: parseQuota(quotaResult.value.data),
    modelUsage: toSection(modelResult),
    toolUsage: toSection(toolResult),
    detailed
  });
}

function toSection(result: PromiseSettledResult<ApiResponse>): UsageSection {
  if (result.status === 'rejected') {
    return { failed: summarizeError(result.reason) };
  }
  return { data: (result.value.data || result.value) as Record<string, unknown> };
}

/**
 * Execute the GLM quota query and return the Markdown report.
 * Shared by the `glm_quota` tool and the TUI's `/glm-limits` dialog.
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

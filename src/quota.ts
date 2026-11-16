/**
 * Quota model
 *
 * The one place that knows how the monitor API's `quota/limit` response is
 * laid out. Both the Markdown report and the footer meter read the typed
 * snapshot returned here instead of matching on raw types or labels.
 *
 * Raw limits carry `type` "CREDIT_LIMIT" (legacy "TOKENS_LIMIT") with
 * unit 3 × number 5 = the 5-hour window and unit 6 × number 1 = the weekly
 * window; "TIME_LIMIT" is the monthly MCP allowance.
 */

/** One quota window. Fields the API leaves out are null, never guessed. */
export interface QuotaWindow {
  /** Percentage used, 0–100. */
  percentage: number | null;
  used: number | null;
  total: number | null;
  /** Unix time in milliseconds. */
  resetsAt: number | null;
}

/** A credit window the plugin has no name for (an unknown unit/number pair). */
export interface OtherQuotaWindow extends QuotaWindow {
  unit: number | null;
  number: number | null;
}

export interface McpToolUsage {
  code: string;
  usage: number | null;
}

export interface McpQuota extends QuotaWindow {
  tools: McpToolUsage[];
}

export interface Quota {
  /** Plan level as sent ("lite", "pro", …), or null. */
  level: string | null;
  fiveHour: QuotaWindow | null;
  weekly: QuotaWindow | null;
  mcp: McpQuota | null;
  other: OtherQuotaWindow[];
}

const CREDIT_TYPES = new Set(['CREDIT_LIMIT', 'TOKENS_LIMIT']);
const MCP_TYPE = 'TIME_LIMIT';

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toWindow(limit: Record<string, unknown>): QuotaWindow {
  return {
    percentage: asNumber(limit.percentage),
    used: asNumber(limit.currentValue),
    total: asNumber(limit.usage),
    resetsAt: asNumber(limit.nextResetTime)
  };
}

function toTools(details: unknown): McpToolUsage[] {
  if (!Array.isArray(details)) return [];
  return details.flatMap((detail) => {
    const record = asRecord(detail);
    if (!record || typeof record.modelCode !== 'string') return [];
    return [{ code: record.modelCode, usage: asNumber(record.usage) }];
  });
}

/**
 * Parse the `data` object of a `quota/limit` response. Total: any input,
 * including garbage, yields a snapshot (with nulls where data is missing).
 */
export function parseQuota(raw: unknown): Quota {
  const data = asRecord(raw);
  const quota: Quota = {
    level: typeof data?.level === 'string' && data.level ? data.level : null,
    fiveHour: null,
    weekly: null,
    mcp: null,
    other: []
  };
  const limits = Array.isArray(data?.limits) ? data.limits : [];
  for (const item of limits) {
    const limit = asRecord(item);
    if (!limit) continue;
    if (CREDIT_TYPES.has(limit.type as string)) {
      const unit = asNumber(limit.unit);
      const number = asNumber(limit.number);
      if (unit === 3 && number === 5) {
        quota.fiveHour ??= toWindow(limit);
      } else if (unit === 6 && number === 1) {
        quota.weekly ??= toWindow(limit);
      } else {
        quota.other.push({ ...toWindow(limit), unit, number });
      }
    } else if (limit.type === MCP_TYPE) {
      quota.mcp ??= { ...toWindow(limit), tools: toTools(limit.usageDetails) };
    }
  }
  return quota;
}

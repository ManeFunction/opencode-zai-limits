/**
 * Markdown output constants for OpenCode Glamour TUI.
 *
 * Glamour TUI renders: GFM tables, headers (h1-h6), bold, italic,
 * code spans, and lists.
 * Glamour TUI does NOT render: --- rules, > blockquotes, HTML.
 */

/** Main title prefix for usage report header */
export const MAIN_TITLE_PREFIX = '### 📊 Z.ai GLM Coding Plan — ' as const

/** Section headers for report sections */
export const SECTION_HEADERS = {
  QUOTA_USAGE: '##### 📊 Quota Usage',
  MCP_BREAKDOWN: '##### 🔧 MCP Tool Breakdown',
  MODEL_USAGE: '##### 🤖 Model Usage (24h)',
  TOOL_USAGE: '##### 🛠️ Tool Usage (24h)',
} as const

/**
 * Row label marker. Emojis are kept for the six titles only (the report
 * title and the five section headers); every row label starts with this.
 */
export const ROW_BULLET = '•' as const

/**
 * MCP tool labels, keyed by the API's `modelCode`. Shared by the MCP
 * breakdown and the 24h tool usage tables so the two cannot drift.
 */
export const MCP_TOOL_LABELS = {
  'search-prime': `${ROW_BULLET} Network Searches`,
  'web-reader': `${ROW_BULLET} Web Reads`,
  zread: `${ROW_BULLET} ZRead Calls`,
} as const satisfies Record<string, string>

/** Error format markers */
export const ERROR_FORMAT = {
  TITLE_PREFIX: '### ⚠️ ',
  FIX_HEADER: '**How to fix:**',
} as const

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
  QUOTA_LIMITS: '##### 🪙 Quota Limits',
  QUOTA_USAGE: '##### 📊 Quota Usage',
  MCP_BREAKDOWN: '##### 🔧 MCP Tool Breakdown',
  MODEL_USAGE: '##### 🤖 Model Usage (24h)',
  TOOL_USAGE: '##### 🛠️ Tool Usage (24h)',
} as const

/** Row label emojis for quota table */
export const ROW_EMOJI = {
  TOKEN: '⏱️',
  WEEKLY: '📅',
  MCP: '🔌',
} as const

/**
 * MCP tool labels, keyed by the API's `modelCode`. Shared by the MCP
 * breakdown and the 24h tool usage tables so the two cannot drift.
 */
export const MCP_TOOL_LABELS = {
  'search-prime': '🔍 Network Searches',
  'web-reader': '🌐 Web Reads',
  zread: '📖 ZRead Calls',
} as const satisfies Record<string, string>

/** Error format markers */
export const ERROR_FORMAT = {
  TITLE_PREFIX: '### ⚠️ ',
  FIX_HEADER: '**How to fix:**',
} as const

/** Progress bar characters and width for Markdown code spans */
export const PROGRESS_BAR = {
  WIDTH: 12,
  FILLED: '█',
  EMPTY: '░',
} as const

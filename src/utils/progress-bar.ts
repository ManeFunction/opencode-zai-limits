/**
 * Progress bar module
 * Creates Unicode progress bars (█░) for Markdown table cells
 * rendered in code spans by OpenCode's Glamour TUI.
 */

import { PROGRESS_BAR } from './markdown-constants.js'

/**
 * Create a fixed-width progress bar using █ and ░ characters
 * @param percentage - Percentage (0-100), clamped to range
 * @returns 12-character progress bar string
 */
export function createProgressBar(percentage: number): string {
  const clamped = Math.min(100, Math.max(0, percentage))
  const filled = Math.round((clamped / 100) * PROGRESS_BAR.WIDTH)
  const empty = PROGRESS_BAR.WIDTH - filled

  return PROGRESS_BAR.FILLED.repeat(filled) + PROGRESS_BAR.EMPTY.repeat(empty)
}

/**
 * Format progress bar as Markdown code span for table cell
 * @param percentage - Percentage value
 * @returns Code-spanned progress bar (e.g., '`█████░░░░░░░`')
 */
export function formatProgressLine(percentage: number): string {
  return '`' + createProgressBar(percentage) + '`'
}

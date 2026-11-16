import { ERROR_FORMAT } from './markdown-constants.js'

/**
 * Sanitizes error messages by replacing authentication tokens with ***
 * to prevent token exposure in logs and error outputs.
 *
 * @param message - The error message that may contain a token
 * @param token - Optional authentication token to sanitize from the message
 * @returns The sanitized message with tokens replaced by ***
 */
export function sanitizeToken(message: string, token?: string): string {
  if (!token || token === '') {
    return message
  }

  return message.replaceAll(token, '***')
}

/**
 * An error whose message is a ready-to-show, token-sanitized Markdown block
 * (built with {@link createMarkdownError}). Callers check it with
 * `instanceof` and show `message` as is; any other error is wrapped first.
 */
export class GlmReportError extends Error {
  /** HTTP status of the failed request, when there was one. */
  readonly status: number | undefined

  constructor(markdown: string, status?: number) {
    super(markdown)
    this.name = 'GlmReportError'
    this.status = status
  }
}

/**
 * One-line summary of a report error, e.g. "Authentication Failed (401)".
 */
export function summarizeError(error: unknown): string {
  if (error instanceof GlmReportError) {
    const title = error.message.split('\n')[0].replace(ERROR_FORMAT.TITLE_PREFIX, '').trim()
    return error.status ? `${title} (${error.status})` : title
  }
  return 'Request failed'
}

/**
 * Create a Markdown-formatted error message for Glamour TUI rendering.
 *
 * Format:
 * ```
 * ### ⚠️ {title}
 *
 * - **key**: value
 *
 * {description}
 *
 * **How to fix:**
 * 1. step
 * ```
 *
 * @param title - Error title (appended after ⚠️ emoji)
 * @param metadata - Key-value pairs shown as bold-labeled bullet items
 * @param description - Plain text description of the error
 * @param steps - Optional numbered fix steps
 * @returns Markdown-formatted error string
 */
export function createMarkdownError(
  title: string,
  metadata: Record<string, string>,
  description: string,
  steps?: string[]
): string {
  const parts: string[] = []

  // Title: ### ⚠️ {title}
  parts.push(`${ERROR_FORMAT.TITLE_PREFIX}${title}`)

  // Metadata bullets (if any)
  const metaEntries = Object.entries(metadata)
  if (metaEntries.length > 0) {
    parts.push('')
    for (const [key, value] of metaEntries) {
      parts.push(`- **${key}**: ${value}`)
    }
  }

  // Description
  parts.push('')
  parts.push(description)

  // Fix steps (if any)
  if (steps && steps.length > 0) {
    parts.push('')
    parts.push(ERROR_FORMAT.FIX_HEADER)
    for (let i = 0; i < steps.length; i++) {
      parts.push(`${i + 1}. ${steps[i]}`)
    }
  }

  return parts.join('\n')
}

/**
 * @deprecated Use createMarkdownError() instead. Will be removed in v2.0.
 */
export function createBoxedError(message: string): string {
  return createMarkdownError(
    'Error',
    {},
    message
  )
}

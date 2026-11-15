/**
 * TUI part of the glm-quota plugin (slim variant — no SDK imports).
 *
 * Renders a credit meter into the footer status row:
 * - prompt.footer.status = the line below the input field, visible only while
 *   a z.ai / Zhipu model is selected (reacts to model switches)
 * - home.footer.status = the home screen footer (always, when data is available)
 *
 * Format: `z.ai | 3h 33m : 55% | 2d : 80%`
 * - 1st segment (5h window): time to reset + remaining %; when full (100%),
 *   shows "5h : 100%"
 * - 2nd segment (weekly window): always time left + remaining %; days when
 *   >= 24h, hours+minutes under a day
 * Percentages are REMAINING, colored green > 50 / yellow > 20 / red otherwise.
 *
 * Notes:
 * - `Plugin.define()` is an identity function (returns its argument), so the
 *   default export is a plain object. JSX is compiled by OpenCode's own plugin
 *   loader (verified: local .tsx TUI parts are transformed with the Solid
 *   preset to @opentui/solid at load time).
 * - Reuses the audited server-part modules for credentials (opencode.db via
 *   readonly sqlite3 CLI) and the HTTPS client (fixed api.z.ai hosts only).
 * - Raw API responses carry type "CREDIT_LIMIT" (legacy "TOKENS_LIMIT") with
 *   unit 3 x number 5 = 5h window and unit 6 x number 1 = weekly window.
 */

import { createSignal } from 'solid-js'
import { getCredentials } from './dist/utils/credentials.js'
import { getEndpoints } from './dist/api/endpoints.js'
import { queryEndpoint } from './dist/api/client.js'

const REFRESH_MS = 2 * 60 * 1000

const GREEN = '#22c55e'
const YELLOW = '#eab308'
const RED = '#ef4444'
const DIM = '#808080'

function isZaiProvider(providerID) {
  const s = String(providerID ?? '').toLowerCase()
  return (
    s.includes('zai') ||
    s === 'z.ai' ||
    s === 'z-ai' ||
    s.includes('zhipu') ||
    s.includes('bigmodel')
  )
}

function isQuotaWindow(limit, unit, number) {
  const type = limit?.type
  return (
    (type === 'CREDIT_LIMIT' || type === 'TOKENS_LIMIT') &&
    limit?.unit === unit &&
    limit?.number === number
  )
}

function remainingPct(limit) {
  if (!limit || typeof limit.percentage !== 'number') return null
  return Math.max(0, Math.min(100, 100 - limit.percentage))
}

function fmtHm(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function fmtLong(ms) {
  // Weekly window: days when >= 24h, hours+minutes under a day
  const totalMin = Math.max(0, Math.floor(ms / 60000))
  if (totalMin >= 24 * 60) return `${Math.floor(totalMin / (24 * 60))}d`
  return fmtHm(ms)
}

function timeLeft(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
  const left = ms - Date.now()
  return left > 0 ? left : null
}

function colorFor(pct) {
  if (pct === null) return DIM
  if (pct > 50) return GREEN
  if (pct > 20) return YELLOW
  return RED
}

export default {
  id: 'glm-quota-tui',
  async setup(context) {
    // Solid signal so every refresh repaints the footer (stays live in long
    // sessions). 'solid-js' is mapped to OpenCode's own runtime for plugins.
    const [data, setData] = createSignal(null)

    const refresh = async () => {
      try {
        const creds = await getCredentials()
        if (!creds) return
        const endpoints = getEndpoints(creds.platform)
        const res = await queryEndpoint(endpoints, creds.token, 'quotaLimit')
        const limits = res?.data?.limits ?? []
        setData({
          fiveHour: limits.find((l) => isQuotaWindow(l, 3, 5)) ?? null,
          weekly: limits.find((l) => isQuotaWindow(l, 6, 1)) ?? null,
        })
      } catch {
        // keep last good data; meter just stays stale until next tick
      }
    }

    await refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    if (timer.unref) timer.unref()

    const statusText = (d) => {
      if (!d) return null
      const parts = []

      // 5h window: "3h 33m : 55%"; when full (100%), "5h : 100%"
      const r5 = remainingPct(d.fiveHour)
      if (r5 !== null) {
        if (r5 >= 100) {
          parts.push('5h : 100%')
        } else {
          const left = timeLeft(d.fiveHour?.nextResetTime)
          if (left !== null) {
            parts.push(`${fmtHm(left)} : ${Math.round(r5)}%`)
          } else {
            parts.push(`${Math.round(r5)}%`)
          }
        }
      }

      // Weekly window: always time left + %, days first under-a-day falls back to h/m
      const rw = remainingPct(d.weekly)
      if (rw !== null) {
        const left = timeLeft(d.weekly?.nextResetTime)
        const t = left === null ? null : fmtLong(left)
        parts.push(t ? `${t} : ${Math.round(rw)}%` : `${Math.round(rw)}%`)
      }

      if (parts.length === 0) return null
      return `z.ai | ${parts.join(' | ')}`
    }

    const renderFooter = (gateOnModel, sessionID) => {
      // Reading context.ui.model.current() and the data() signal inside render
      // makes this repaint on model switches AND every 2-min refresh.
      // The prompt footer is also mounted on the home screen, where the
      // home.footer slot already draws the meter — render it there only
      // inside a real session (sessionID present) to avoid a duplicate.
      const model = gateOnModel ? context.ui.model.current() : null
      const d = data()
      if (gateOnModel && (!sessionID || !isZaiProvider(model?.providerID))) {
        return <text> </text>
      }
      const txt = statusText(d)
      if (!txt) return <text> </text>
      const fg = colorFor(remainingPct(d.fiveHour))
      return <text fg={fg}>{txt}</text>
    }

    context.ui.slot({
      append: 'prompt.footer.status',
      render: (props) => renderFooter(true, props?.sessionID),
    })
    context.ui.slot({
      append: 'home.footer.status',
      render: () => renderFooter(false),
    })

    return () => clearInterval(timer)
  },
}

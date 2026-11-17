/**
 * TUI part of the opencode-zai-limits plugin (slim variant — no SDK imports).
 *
 * Renders a credit meter into the footer status row:
 * - prompt.footer.status = the line below the input field, visible only while
 *   a z.ai / Zhipu model is selected (reacts to model switches)
 * - home.footer.status = the home screen footer (always, when data is available)
 *
 * Format: `z.ai | 3h 33m : 45% | 2d : 20%`
 * - 1st segment (5h window): time to reset + used %; hidden while the window
 *   has not started (nothing used), e.g. `z.ai | 2d : 20%`
 * - 2nd segment (weekly window): always time left + used %; days when
 *   >= 24h, hours+minutes under a day
 * - Both windows unused: `z.ai | full`
 * Percentages are USED, the same figure as the /zai-limits "Usage" column.
 * The color follows the remaining 5h credits: green > 50 / yellow > 20 / red.
 *
 * Also registers the `/zai-limits` slash command (and a command-palette
 * entry). It runs right here in the TUI: it builds the same Markdown report as
 * the `opencode-zai-limits` tool and shows it in a dialog. No agent, no model call, so
 * it spends no credits or tokens. The pattern (a keymap layer registered from
 * an `app` slot, `ui.dialog.show`) matches OpenCode's built-in `/stats` and
 * `/plugins` commands.
 *
 * The report is drawn with plain boxes and text, not OpenTUI's `<markdown>`
 * element: that element needs the host's syntax style, which plugins can't
 * reach.
 *
 * Notes:
 * - `Plugin.define()` is an identity function (returns its argument), so the
 *   default export is a plain object. JSX is compiled by OpenCode's own plugin
 *   loader (verified: local .tsx TUI parts are transformed with the Solid
 *   preset to @opentui/solid at load time).
 * - Reuses the audited server-part modules for credentials (opencode.db via
 *   readonly sqlite3 CLI) and the HTTPS client (fixed api.z.ai hosts only).
 * - The raw quota response is read through `parseQuota` (src/quota.ts), the
 *   same model the report uses, so the two cannot disagree on the windows.
 */

import { createSignal, For, Show } from 'solid-js'
// Namespace import on purpose: a missing named export would fail the whole
// module (and take the meter down with it); here it is just undefined.
import * as opentui from '@opentui/solid'
import {
  detectPlatform,
  executeGlmQuota,
  formatDuration,
  getCredentials,
  getEndpoints,
  parseQuota,
  queryEndpoint,
  timeUntil,
} from '../dist/tui-support.js'
import type { Quota, QuotaWindow } from '../dist/tui-support.js'

// ============================================================================
// HOST API SHAPES
// ============================================================================
// The TUI plugin API is not in the published plugin types yet; these are the
// parts this file uses, as OpenCode 2.3's built-in plugins call them. Types
// only — erased at load time.

interface Theme {
  text: { base?: string; muted?: string; accent?: string }
  primary?: string
}

interface SlotProps {
  sessionID?: string
}

interface TuiContext {
  theme: Theme
  renderer?: { height?: number }
  ui: {
    dialog: {
      show(render: () => JSX.Element): void
      set(options: { size: 'large' | 'medium' | 'small' }): void
    }
    model: { current(): { providerID?: string } | null | undefined }
    slot(options: { append: string; render: (props?: SlotProps) => JSX.Element }): void
  }
  keymap: { layer(build: () => unknown): void }
}

interface ScrollBox {
  scrollBy(delta: number): void
  scrollTo(position: number): void
  scrollHeight: number
}

/** What the footer shows: a quota snapshot, or a rejected key. */
type MeterState = { authFailed: false; quota: Quota } | { authFailed: true }

interface TableColumn {
  title: string
  right: boolean
  cells: string[]
}

type Block =
  | { type: 'blank' }
  | { type: 'heading'; level: number; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'table'; columns: TableColumn[] }

const REFRESH_MS = 2 * 60 * 1000

const GREEN = '#22c55e'
const YELLOW = '#eab308'
const RED = '#ef4444'
const DIM = '#808080'

function usedPct(window: QuotaWindow | null | undefined): number | null {
  if (!window || window.percentage === null) return null
  return Math.max(0, Math.min(100, window.percentage))
}

function remainingPct(window: QuotaWindow | null | undefined): number | null {
  const used = usedPct(window)
  return used === null ? null : 100 - used
}

function colorFor(pct: number | null): string {
  if (pct === null) return DIM
  if (pct > 50) return GREEN
  if (pct > 20) return YELLOW
  return RED
}

// ============================================================================
// /zai-limits REPORT DIALOG
// ============================================================================

// Reads a theme token defensively: the plugin theme shape is not a published
// API, so fall back to a fixed color when a path is missing.
function themeColor(context: TuiContext, pick: (theme: Theme) => string | undefined, fallback: string): string {
  try {
    return pick(context.theme) ?? fallback
  } catch {
    return fallback
  }
}

// Splits the small Markdown subset the report uses into blocks:
// headings, tables, bullets, paragraphs and blank lines.
function parseReport(markdown: string | null): Block[] {
  const lines = String(markdown ?? '').split('\n')
  const blocks: Block[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim().startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(
          lines[i]
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((cell) => cell.trim()),
        )
        i++
      }
      i--
      const [header = [], separator = [], ...body] = rows
      const isSeparator = separator.every((cell) => /^:?-+:?$/.test(cell))
      const dataRows = isSeparator ? body : rows.slice(1)
      blocks.push({
        type: 'table',
        columns: header.map((title, c) => ({
          title,
          right: isSeparator && /-:$/.test(separator[c] ?? ''),
          cells: dataRows.map((row) => row[c] ?? ''),
        })),
      })
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] })
    } else if (/^\s*-\s+/.test(line)) {
      blocks.push({ type: 'bullet', text: line.replace(/^\s*-\s+/, '') })
    } else if (line.trim() === '') {
      blocks.push({ type: 'blank' })
    } else {
      blocks.push({ type: 'paragraph', text: line })
    }
  }
  return blocks
}

// Inline Markdown: **bold** becomes <b>, `code` loses its backticks.
function inline(text: string) {
  return String(text)
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter((part) => part !== '')
    .map((part) => {
      if (part.startsWith('**') && part.endsWith('**')) return <b>{part.slice(2, -2)}</b>
      if (part.startsWith('`') && part.endsWith('`')) return part.slice(1, -1)
      return part
    })
}

function ReportBlock(props: { context: TuiContext; block: Block }) {
  const ctx = props.context
  const base = () => themeColor(ctx, (t) => t.text.base, '#d4d4d4')
  const muted = () => themeColor(ctx, (t) => t.text.muted, DIM)
  const accent = () => themeColor(ctx, (t) => t.text.accent ?? t.primary, '#60a5fa')
  const block = props.block

  if (block.type === 'blank') return <box height={1} />
  if (block.type === 'heading') {
    return (
      <text fg={block.level <= 3 ? accent() : base()} wrapMode="none">
        <b>{inline(block.text)}</b>
      </text>
    )
  }
  if (block.type === 'bullet') {
    return <text fg={base()}>{['• ', ...inline(block.text)]}</text>
  }
  if (block.type === 'paragraph') {
    return <text fg={base()}>{inline(block.text)}</text>
  }
  // table: one flex column per Markdown column, so OpenTUI does the alignment
  return (
    <box flexDirection="row" gap={3} paddingLeft={1}>
      <For each={block.columns}>
        {(column) => (
          <box
            flexDirection="column"
            flexShrink={0}
            alignItems={column.right ? 'flex-end' : 'flex-start'}
          >
            <text fg={muted()} wrapMode="none">
              <b>{column.title}</b>
            </text>
            <For each={column.cells}>
              {(cell) => (
                <text fg={base()} wrapMode="none">
                  {inline(cell)}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}

function ReportDialog(props: { context: TuiContext; report: () => string | null; reload: () => void }) {
  const ctx = props.context
  const muted = () => themeColor(ctx, (t) => t.text.muted, DIM)
  const base = () => themeColor(ctx, (t) => t.text.base, '#d4d4d4')
  const rows = Math.max(8, Math.floor((ctx.renderer?.height ?? 30) * 0.6))
  // The scrollbox fills whatever height it is given, so give it the measured
  // height of the report (capped at `rows`). Until the first measurement it
  // keeps the old fixed height, so a missing callback only costs empty space.
  const [contentHeight, setContentHeight] = createSignal<number | null>(null)
  const visibleHeight = () => {
    const measured = contentHeight()
    return measured === null ? rows : Math.min(Math.max(1, measured), rows)
  }
  let scroll: ScrollBox | undefined

  // Same keys as OpenCode's own scrollable dialogs; Esc is handled by the
  // dialog stack. useKeyboard registers per mount and cleans up on close.
  const onKey = (key: { name?: string }) => {
    if (key?.name === 'r') return props.reload()
    if (!scroll) return
    if (key?.name === 'up' || key?.name === 'k') return scroll.scrollBy(-1)
    if (key?.name === 'down' || key?.name === 'j') return scroll.scrollBy(1)
    if (key?.name === 'pageup') return scroll.scrollBy(-rows)
    if (key?.name === 'pagedown') return scroll.scrollBy(rows)
    if (key?.name === 'home') return scroll.scrollTo(0)
    if (key?.name === 'end') return scroll.scrollTo(scroll.scrollHeight)
  }
  if (typeof opentui.useKeyboard === 'function') opentui.useKeyboard(onKey)

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
        <text fg={base()} wrapMode="none">
          <b>/zai-limits</b>
        </text>
        <text fg={muted()} wrapMode="none">
          {'↑↓ scroll · r refresh · esc close'}
        </text>
      </box>
      <scrollbox ref={(r: ScrollBox) => (scroll = r)} height={visibleHeight()} scrollbarOptions={{ visible: false }}>
        <box
          flexDirection="column"
          flexShrink={0}
          onSizeChange={function (this: { height: number }) {
            setContentHeight(this.height)
          }}
        >
          <Show
            when={props.report()}
            fallback={<text fg={muted()}>Loading usage from the monitoring API…</text>}
          >
            <box flexDirection="column">
              <For each={parseReport(props.report())}>
                {(block) => <ReportBlock context={ctx} block={block} />}
              </For>
            </box>
          </Show>
        </box>
      </scrollbox>
    </box>
  )
}

function openReport(context: TuiContext) {
  const [report, setReport] = createSignal<string | null>(null)
  const load = async () => {
    setReport(null)
    try {
      // Same report as the opencode-zai-limits tool (detailed: per-model rows included).
      setReport(await executeGlmQuota({ detailed: true }))
    } catch (error) {
      setReport(`### ⚠️ Error\n\n${error instanceof Error ? error.message : String(error)}`)
    }
  }
  context.ui.dialog.show(() => <ReportDialog context={context} report={report} reload={load} />)
  context.ui.dialog.set({ size: 'large' })
  load()
}

export default {
  id: 'opencode-zai-limits-tui',
  async setup(context: TuiContext) {
    // Solid signal so every refresh repaints the footer (stays live in long
    // sessions). 'solid-js' is mapped to OpenCode's own runtime for plugins.
    const [data, setData] = createSignal<MeterState | null>(null)

    const refresh = async () => {
      try {
        const creds = await getCredentials()
        if (!creds) return
        const endpoints = getEndpoints(creds.platform)
        const res = await queryEndpoint(endpoints, creds.token, 'quotaLimit')
        setData({ authFailed: false, quota: parseQuota(res.data) })
      } catch (error) {
        // A rejected key will not fix itself: say so instead of showing the
        // last numbers forever. Anything else (timeout, 5xx) is transient —
        // keep the last good data until the next tick.
        const status = (error as { status?: unknown } | null)?.status
        if (status === 401 || status === 403) setData({ authFailed: true })
      }
    }

    await refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    if (timer.unref) timer.unref()

    const statusText = (d: MeterState | null): string | null => {
      if (!d) return null
      if (d.authFailed) return 'z.ai | key rejected — run /connect'
      const { fiveHour, weekly } = d.quota
      const u5 = usedPct(fiveHour)
      const uw = usedPct(weekly)
      if (u5 === null && uw === null) return null
      // Nothing used in any known window: no countdowns to show.
      if ((u5 ?? 0) <= 0 && (uw ?? 0) <= 0) return 'z.ai | full'
      const parts: string[] = []

      // 5h window: "3h 33m : 45%" (used); hidden while the window has not
      // started (nothing used yet)
      if (u5 !== null && u5 > 0) {
        const left = timeUntil(fiveHour?.resetsAt)
        if (left !== null) {
          parts.push(`${formatDuration(left)} : ${Math.round(u5)}%`)
        } else {
          parts.push(`${Math.round(u5)}%`)
        }
      }

      // Weekly window: always time left + used %, days first under-a-day falls back to h/m
      if (uw !== null) {
        const left = timeUntil(weekly?.resetsAt)
        const t = left === null ? null : formatDuration(left, 'short')
        parts.push(t ? `${t} : ${Math.round(uw)}%` : `${Math.round(uw)}%`)
      }

      if (parts.length === 0) return null
      return `z.ai | ${parts.join(' | ')}`
    }

    const renderFooter = (gateOnModel: boolean, sessionID?: string) => {
      // Reading context.ui.model.current() and the data() signal inside render
      // makes this repaint on model switches AND every 2-min refresh.
      // The prompt footer is also mounted on the home screen, where the
      // home.footer slot already draws the meter — render it there only
      // inside a real session (sessionID present) to avoid a duplicate.
      const model = gateOnModel ? context.ui.model.current() : null
      const d = data()
      if (gateOnModel && (!sessionID || detectPlatform(String(model?.providerID ?? '')) === null)) {
        return <text> </text>
      }
      const txt = statusText(d)
      if (!d || !txt) return <text> </text>
      const fg = d.authFailed ? RED : colorFor(remainingPct(d.quota.fiveHour))
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

    // `/zai-limits`: a TUI command, not a Markdown command, so no agent runs
    // and nothing is sent to a model. The keymap layer is registered from an
    // `app` slot (it needs a reactive owner), like OpenCode's built-in /stats.
    context.ui.slot({
      append: 'app',
      render: () => {
        context.keymap.layer(() => ({
          mode: 'global',
          commands: [
            {
              id: 'glm.limits',
              title: 'GLM credit limits',
              description: 'Z.ai GLM Coding Plan usage report (no model call, no credits)',
              group: 'System',
              palette: true,
              slash: { name: 'zai-limits' },
              run() {
                openReport(context)
              },
            },
          ],
        }))
        return null
      },
    })

    return () => clearInterval(timer)
  },
}

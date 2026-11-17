# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Conventional Commits](https://www.conventionalcommits.org/)
for commit messages.

## [Unreleased]

## [0.9.0] - 2026-11-17
Initial release. Derived from [guyinwonder168/opencode-glm-quota](https://github.com/guyinwonder168/opencode-glm-quota)
(as of [PR #52](https://github.com/guyinwonder168/opencode-glm-quota/pull/52) by @itelyatnikov80,
commit `dafcf639`), security-reviewed and then reworked into its own zero-dependency project.
Not a fork and not intended to be merged back — the credit-based UI and the footer meter live here.

Neither the footer meter nor `/zai-limits` spends credits or tokens: both only make plain
monitoring GETs, with no agent and no model call.

### Added
- Footer credit meter (TUI part, `src/tui.tsx`): remaining 5-hour and weekly credits in the
  `prompt.footer.status` slot while a Z.AI/Zhipu model is selected (inside a session), and in
  `home.footer.status` on the home screen bottom line — one meter per screen, no duplicates.
  Format `z.ai | 3h 33m : 55% | 2d : 80%`, green/yellow/red on remaining 5h credits, `5h : 100%`
  when the window is fully recovered, `key rejected — run /connect` when the key is rejected.
  **Spends no credits or tokens.**
- Live updates in long sessions: the meter keeps its snapshot in a Solid signal and repaints on
  every 2-minute refresh, not only on model switches.
- `/zai-limits` TUI command (slash menu and command palette), registered by the TUI part. It
  builds the report directly and opens it in a scrollable dialog (`↑`/`↓`, `j`/`k`, PgUp/PgDn,
  `r` to refresh, `Esc` to close). No agent starts, so it **spends no credits or tokens**.
- Credit-native report: quota limits table, credits used per window, MCP tool breakdown (with
  thousands separators), 24h model usage (per model) and tool calls. Labels and totals come from
  the CREDIT_LIMIT entries of the monitoring API instead of the legacy TOKENS_LIMIT format.
- API errors (bad key, rate limit, timeout, server error) are shown in the report instead of an
  empty "No quota data available" one; the monitor API's HTTP 200 `{"code":401,"success":false}`
  replies count as errors too.
- `opencode-zai-limits` tool for agents and Code Mode that want to check the quota themselves.
- Credential discovery from OpenCode v2's SQLite store (`opencode.db`, scoped to the `zai`/`zhipu` provider rows),
  opened read-only with Bun's built-in `bun:sqlite` inside OpenCode's own runtime, so no `sqlite3` tool is needed.
  The `sqlite3` 3.33+ CLI is the fallback outside Bun, and `auth.json` and `ZAI_API_KEY`/`ZHIPU_API_KEY` come after
  that (inherited from the PR and kept).
- OpenCode v2 plugin package `opencode-zai-limits`: auto-discovered from
  `~/.config/opencode/plugins/opencode-zai-limits/` via `exports` (`.` server part and `./tui` TUI
  part). Remove an old `opencode-glm-quota` plugin folder when switching, or you get two meters.

### Changed
- Zero dependencies: the SDK import (`@opencode/plugin`) is dropped — its `Plugin.define()` is an
  identity function, so the plain plugin object needs no runtime dependency and no ~180 MB
  transitive tree. The TUI part's JSX is compiled by OpenCode's own loader.
- The installer's postinstall automation was removed. Installing is copying the plugin folder;
  there are no command or agent files to copy, and nothing runs at install time.
- Token-flavoured output reworked to credits: "Token Used" placeholders, hardcoded 40M fallback
  totals and "% of 5h limit" token math replaced by API-provided credit values.
- The quota response is parsed once (`src/quota.ts`) and both the report and the meter read the
  result; the report renderer lives in `src/report/` as a pure function.
- The TUI part is type-checked (`npm run typecheck`) and imports the server part through one
  module, `dist/tui-support.js`. `prepublishOnly` rebuilds and type-checks before publishing.

### Fixed
- The weekly window is never labelled "5h Window" when the 5-hour window is missing.
- 24h model usage no longer reads zero when the API's totals are zero but its per-model list is not.
- ZRead uses the same icon in every table.
- Response bodies are decoded as a UTF-8 stream, so non-ASCII text split across chunks is intact.

### Removed
- The Markdown quota command and its executor subagent. They sent every report request through a
  model; `/zai-limits` replaces both.
- The `glm-quota` skill file (redundant with `/zai-limits`).
- Dead code from the upstream project: unused formatters, constants, the `ZHIPU_DEV` endpoints
  and `reset-timer.ts`.

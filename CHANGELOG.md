# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Conventional Commits](https://www.conventionalcommits.org/)
for commit messages.

## [Unreleased]

### Fixed
- `/zai-limits` and the `opencode-zai-limits` tool show API errors (bad key, rate limit, timeout, server
  error) instead of an empty "No quota data available" report. The monitor API's HTTP 200
  `{"code":401,"success":false}` replies are now treated as errors too.
- The footer meter shows `key rejected — run /connect` when the key is rejected, instead of keeping
  the last numbers forever.
- The weekly window could be shown as "5h Window" when the 5-hour window was missing; that row and
  the leftover 40M token fallback behind it are gone.
- 24h model usage no longer reads zero when the API's totals are zero but its per-model list is not.
- ZRead had two different icons in two tables; MCP usage numbers get thousands separators.
- Response bodies are decoded as a UTF-8 stream, so non-ASCII text split across chunks is intact.

### Changed
- Renamed the `/glm-limits` command to `/zai-limits` and the `glm_quota` tool to `opencode-zai-limits`.
- The quota response is parsed once (`src/quota.ts`) and both the report and the meter read the
  result; the report renderer lives in `src/report/` as a pure function.
- The TUI part is type-checked (`npm run typecheck`) and imports the server part through one
  module, `dist/tui-support.js`. `prepublishOnly` rebuilds and type-checks before publishing.
- README: the home screen footer always shows the meter; `sqlite3` 3.33+ is required; remove an
  old `opencode-glm-quota` plugin folder when switching.

### Removed
- Dead code from the fork: unused formatters, constants, the `ZHIPU_DEV` endpoints and
  `reset-timer.ts`.

## [0.1.0] - 2026-11-16
Initial release. Derived from [guyinwonder168/opencode-glm-quota](https://github.com/guyinwonder168/opencode-glm-quota)
(as of [PR #52](https://github.com/guyinwonder168/opencode-glm-quota/pull/52) by @itelyatnikov80,
commit `dafcf639`), security-reviewed and then reworked into its own zero-dependency project.
Not a fork and not intended to be merged back — the credit-based UI and the footer meter live here.

Neither the footer meter nor `/glm-limits` spends credits or tokens: both only make plain
monitoring GETs, with no agent and no model call.

### Added
- Footer credit meter (TUI part, `src/tui.tsx`): remaining 5-hour and weekly credits in the
  `prompt.footer.status` slot while a Z.AI/Zhipu model is selected (inside a session), and in
  `home.footer.status` on the home screen bottom line — one meter per screen, no duplicates.
  Format `z.ai | 3h 33m : 55% | 2d : 80%`, green/yellow/red on remaining 5h credits, `5h : 100%`
  when the window is fully recovered. **Spends no credits or tokens.**
- Live updates in long sessions: the meter keeps its snapshot in a Solid signal and repaints on
  every 2-minute refresh, not only on model switches.
- `/glm-limits` TUI command (slash menu and command palette, *GLM credit limits*), registered by
  the TUI part. It builds the report directly and opens it in a scrollable dialog (`↑`/`↓`,
  `j`/`k`, PgUp/PgDn, `r` to refresh, `Esc` to close). No agent starts, so it **spends no credits
  or tokens**.
- Credit-native report: quota limits table, credits used per window, MCP tool breakdown, 24h model
  usage (per model) and tool calls. Labels and totals come from the CREDIT_LIMIT entries of the
  monitoring API instead of the legacy TOKENS_LIMIT format.
- `glm_quota` tool for agents and Code Mode that want to check the quota themselves.
- Credential discovery from OpenCode v2's SQLite store (`opencode.db`, read-only `sqlite3` probe,
  scoped to the `zai`/`zhipu` provider rows), with `auth.json` and `ZAI_API_KEY`/`ZHIPU_API_KEY`
  as fallbacks (inherited from the PR and kept).
- OpenCode v2 plugin package: auto-discovered from `~/.config/opencode/plugins/` via `exports`
  (`.` server part and `./tui` TUI part).

### Changed
- Zero dependencies: the SDK import (`@opencode/plugin`) is dropped — its `Plugin.define()` is an
  identity function, so the plain plugin object needs no runtime dependency and no ~180 MB
  transitive tree. The TUI part's JSX is compiled by OpenCode's own loader.
- The installer's postinstall automation was removed. Installing is copying the plugin folder;
  there are no command or agent files to copy, and nothing runs at install time.
- Token-flavoured output reworked to credits: "Token Used" placeholders, hardcoded 40M fallback
  totals and "% of 5h limit" token math replaced by API-provided credit values.

### Removed
- The Markdown quota command and its executor subagent. They sent every report request through a
  model; `/glm-limits` replaces both.
- The `glm-quota` skill file (redundant with `/glm-limits`).

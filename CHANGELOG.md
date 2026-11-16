# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Conventional Commits](https://www.conventionalcommits.org/)
for commit messages.

## [Unreleased]

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

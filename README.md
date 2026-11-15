# opencode-glm-limits

A credit meter and usage reporter for the [Z.ai GLM Coding Plan](https://z.ai/subscribe), living inside
[OpenCode v2](https://opencode.ai). It draws your remaining credits into the status line right below the
input field and gives you a `/glm-limits` command for the full report. Zero dependencies, zero tokens —
the meter talks to a plain monitoring endpoint, so it never burns the credits it shows.

```
 z.ai | 3h 33m : 55% | 2d : 80%
```

> **💰 Watching the meter costs no credits.** The footer monitor is a plain monitoring GET — it makes
> no model calls, so it never spends the credits it displays. Credits are only spent where a model
> actually runs: a *command* call — this plugin's `/glm-limits` and the original repo's `/glm_quota`
> command, both of which drive the `glm-quota-exec` subagent. The bare `glm_quota` tool call itself
> is free — it is just the same HTTP request.

The first number pair is the 5-hour rolling window (time to reset, remaining), the second is the weekly
window. The whole line turns from green to yellow to red as the 5h credits drain, and flips to
`5h : 100%` when the window is fully recovered. It appears only while a Z.AI/Zhipu model is selected,
so it stays out of the way when you switch providers.

## Features

- **Footer status line** — remaining 5h and weekly credits with reset countdown, refreshed every
  2 minutes through a Solid signal, so it stays live in long sessions. Gated to Z.AI/Zhipu models.
- **Free to watch** — the footer monitor does not use any credits: it only issues a monitoring GET,
  with no model in the loop. A *command* call does use credits, though — this plugin's `/glm-limits`
  and the original repo's `/glm_quota`, since both run the `glm-quota-exec` subagent.
- **`/glm-limits` command** — the full report: credit limits per window with progress bars, credits
  used, MCP tool breakdown, 24h model usage and tool calls.
- **Credit-native** — speaks the CREDIT_LIMIT format (5h and weekly windows), not the legacy token
  quotas; no fake fallback numbers.
- **Zero dependencies** — the server part is compiled plain TypeScript, the TUI part is JSX compiled
  by OpenCode itself. Nothing to install, nothing to audit.
- **Reads your existing login** — takes the API key from OpenCode v2's credential store (`opencode.db`,
  opened read-only through the `sqlite3` CLI), with `auth.json` and `ZAI_API_KEY` / `ZHIPU_API_KEY`
  as fallbacks. Works with both the Global (`api.z.ai`) and China (`open.bigmodel.cn`) platforms.
- **Coded conservatively** — the meter calls the same three fixed monitor endpoints with the same
  auth header as Z.ai's own tooling; token values are scrubbed from error messages; the reporting
  subagent runs with `bash` and `edit` denied.

## Requirements

- [OpenCode](https://opencode.ai) v2 (the one with `opencode.db`).
- A [GLM Coding Plan](https://z.ai/subscribe) subscription with its API key connected in OpenCode
  (`/connect` → Z.AI Coding Plan / Z.AI / Zhipu).
- The `sqlite3` command-line tool (ships with macOS and most Linux distros).

## Installation

Not published to npm yet — install it from a clone of this repository.

1) **Build and copy (manual, reviewed)**

    - Clone this repository and `cd` into it.
    - Run `npm install --ignore-scripts` (nothing needs scripts; this only fetches the TypeScript
      compiler) and `npm run build` to produce `dist/`.
    - Copy the plugin into OpenCode's global plugins folder, so the layout is
      `~/.config/opencode/plugins/opencode-glm-limits/` containing `package.json`, `dist/` and `src/`.
    - Copy `integration/command/glm-limits.md` into `~/.config/opencode/commands/` and
      `integration/agents/glm-quota-exec.md` into `~/.config/opencode/agents/`.
    - Restart OpenCode. `opencode plugin list` should show the local plugin, and the meter appears in
      the status line whenever a Z.AI model is selected.

2) **What gets installed where**

    | Piece | Location | What it is |
    |---|---|---|
    | Plugin (server part) | `~/.config/opencode/plugins/opencode-glm-limits/` | registers the `glm_quota` tool |
    | TUI part | `src/tui.tsx` inside the plugin folder | the footer meter (compiled by OpenCode at load) |
    | `/glm-limits` | `~/.config/opencode/commands/glm-limits.md` | the slash command |
    | `glm-quota-exec` | `~/.config/opencode/agents/glm-quota-exec.md` | hidden subagent with `bash`/`edit` denied |

**Removing it**: delete the plugin folder and the two integration files. Nothing was written into
`opencode.json(c)` — OpenCode discovers plugin folders on its own.

## Usage

- The **meter** is automatic. Format: `z.ai | 3h 33m : 55% | 2d : 80%` — first segment is the 5-hour
  window (time to reset, remaining), second is the weekly one (days when ≥ 24h, hours and minutes
  under a day; always shown, even when full). The 5-hour segment becomes `5h : 100%` when the window
  is fully recovered.
- **`/glm-limits`** prints the detailed report:

```
### 📊 Z.ai GLM Coding Plan — Lite

##### 🪙 Quota Limits

| Window | Usage | Progress | Resets In |
|--------|------:|----------|-----------|
| ⏱️ 5h Credits | 38.0% | `█████░░░░░░░` | 2h 28m (23:29) |
| 📅 Weekly Credits | 7.0% | `█░░░░░░░░░░░` | 6d 20h (Thu 17:02) |

##### 📊 Quota Usage

| Metric | Value |
|--------|------:|
| 💰 **5h Credits Used** | **767 / 2,000** |
| 📅 **Weekly Credits Used** | **767 / 10,000** |
```

- The `glm_quota` tool is also exposed to Code Mode, so agents can check the quota themselves.

**Things to know**

- The 5-hour window on the Coding Plan is *rolling*: credits come back 5 hours after each consumption,
  so right after the nominal reset the meter may still show 99% until the last old usage ages out.
- The meter polls a monitoring endpoint every 2 minutes per OpenCode TUI process. It is a plain GET —
  no model involvement, so it does not consume credits.
- The monitor endpoints are undocumented on purpose by Z.ai; they are the same ones the official
  console and plugins use, but they may change without notice.

## How it works

The server part registers the `glm_quota` tool. Its credential module finds your GLM Coding Plan key
(the `zai` / `zhipu` entries only — it never touches credentials of other providers) in OpenCode's
SQLite store, opened `--readonly` through the `sqlite3` CLI with a 5-second timeout, falling back to
the v1 `auth.json` and then environment variables. Requests go to `https://api.z.ai` or
`https://open.bigmodel.cn` over HTTPS with the key in the `Authorization` header; the key is scrubbed
from every error message before it reaches the chat.

The TUI part (`src/tui.tsx`) is a second plugin part compiled by OpenCode's own Solid/OpenTUI loader.
It keeps the last quota snapshot in a Solid signal, refreshed every 2 minutes, and renders one
`<text>` into the `prompt.footer.status` slot (the line below the input field) and `home.footer.status`.
`Plugin.define()` in `@opencode/plugin` is an identity function — it returns its argument — so the
plugin ships without the SDK and its ~180 MB dependency tree.

## Development

```bash
npm install --ignore-scripts
npm run build        # dist/ (server part; tui.tsx ships as source, OpenCode compiles it)
npm run clean
```

| Path | What it is |
|---|---|
| `src/index.ts` | server part: tool, credentials wiring, Markdown report |
| `src/tui.tsx` | TUI part: the footer meter (Solid JSX, compiled by OpenCode) |
| `src/api/` | HTTPS client, endpoints, platform detection |
| `src/utils/` | credentials, auth paths, formatting, time windows |
| `integration/` | the command and agent Markdown files copied into OpenCode's config |

## Credits

Started as a security-reviewed installation of [guyinwonder168/opencode-glm-quota](https://github.com/guyinwonder168/opencode-glm-quota)
(added to OpenCode from [PR #52](https://github.com/guyinwonder168/opencode-glm-quota/pull/52) by
@itelyatnikov80, which ported the plugin to the V2 API and `opencode.db` credentials — thank you!).
The projects diverged far enough that this became its own thing instead of a fork: the credit-based
UI, the footer meter and the zero-dependency build all happened here. Thanks to @guyinwonder168 for
the original plugin and to Z.ai for the Coding Plan.

## Repository info

This repo follows the [Conventional Commits](https://www.conventionalcommits.org/) specification.

## Author

opencode-glm-limits is made by Ilia Petrov-Komotskii ([Mane Function](https://github.com/ManeFunction)). If it saves
you time, you can [support it on GitHub Sponsors](https://github.com/sponsors/ManeFunction).

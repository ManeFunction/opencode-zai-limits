# opencode-zai-limits

A credit meter and usage report for the [Z.ai GLM Coding Plan](https://z.ai/subscribe), living inside
[OpenCode v2](https://opencode.ai). It draws your remaining credits into the status line right below the input field
and gives you a `/zai-limits` command for the full report. Zero dependencies, zero tokens: both the meter and the
command talk to a plain monitoring endpoint, so they never burn the credits they show.

```
 z.ai | 3h 33m : 55% | 2d : 80%
```

> **💰 Neither the footer meter nor `/zai-limits` spends credits or tokens.** Both are plain monitoring GETs made by
> the plugin itself, with no agent and no model call. The meter polls in the background; `/zai-limits` is a TUI
> command that fetches the report and opens it in a dialog, so nothing is sent to a model. The `opencode-zai-limits`
> tool is still registered for agents that want to check the quota on their own; only that path involves a model,
> because an agent is already running.

---

## Features

- **Footer status line**: remaining 5h and weekly credits with a reset countdown, refreshed every 2 minutes through a
  Solid signal, so it stays live in long sessions. Inside a session it appears only while a Z.AI/Zhipu model is
  selected; the home screen footer always shows it. The line turns from green to yellow to red as the 5h credits
  drain, and says `z.ai | key rejected — run /connect` instead of showing old numbers when the API rejects your key.
- **`/zai-limits` command**: the full report in a dialog: credit limits per window with progress bars, credits used,
  MCP tool breakdown, 24h model usage per model and tool calls. It is a TUI command (also in the command palette as
  *GLM credit limits*), so it runs instantly and never starts an agent.
- **Credit-native**: speaks the CREDIT_LIMIT format (5h and weekly windows), not the legacy token quotas; no fake
  fallback numbers.
- **Zero dependencies**: the server part is compiled plain TypeScript, the TUI part is JSX compiled by OpenCode
  itself. Nothing to install, nothing to audit.
- **Reads your existing login**: takes the API key from OpenCode v2's credential store (`opencode.db`, opened
  read-only through the `sqlite3` CLI), with `auth.json` and `ZAI_API_KEY` / `ZHIPU_API_KEY` as fallbacks. Works with
  both the Global (`api.z.ai`) and China (`open.bigmodel.cn`) platforms.
- **Coded conservatively**: the plugin calls the same three fixed monitor endpoints with the same auth header as
  Z.ai's own tooling; API failures (a bad key, rate limits, timeouts) are shown as such, with the key scrubbed from
  the message.

---

## Installation

**opencode-zai-limits** is not published to npm or brew yet, so for now it is installed from a clone of this
repository.

You will need:
- [OpenCode](https://opencode.ai) v2 (the one with `opencode.db`).
- A [GLM Coding Plan](https://z.ai/subscribe) subscription with its API key connected in OpenCode
  (`/connect` → Z.AI Coding Plan / Z.AI / Zhipu).
- The `sqlite3` command-line tool, version 3.33 or newer (it needs `-json`; ships with macOS and most Linux distros).
  With an older `sqlite3` the key lookup in `opencode.db` fails silently and only `auth.json` and the environment
  variables are tried.

1) **Build and copy (manual installation)**
    - Clone the repository or download the source code from GitHub.
    - Go to the folder with the code in your Terminal.
    - Run `npm install --ignore-scripts` (nothing needs scripts; this only fetches the TypeScript compiler) and
      `npm run build` to produce `dist/`.
    - Copy the plugin into OpenCode's global plugins folder, so the layout is
      `~/.config/opencode/plugins/opencode-zai-limits/` containing `package.json`, `dist/` and `src/`.
    - Restart OpenCode. `opencode plugin list` should show the local plugin, the meter appears in the status line
      whenever a Z.AI model is selected, and `/zai-limits` shows up in the slash menu.
    - You are perfect, the meter is in your footer and `/zai-limits` is in every session.

**Upgrading from an earlier setup?**
- Installed it as `~/.config/opencode/plugins/opencode-glm-limits/`? Delete that folder and install into
  `opencode-zai-limits/` instead, otherwise you get two meters.
- Delete `~/.config/opencode/commands/glm-limits.md` and `~/.config/opencode/agents/glm-quota-exec.md` if you have
  them. The old Markdown command ran a subagent (a model call per run) and would clash with the built-in
  `/zai-limits`.
- Coming from `opencode-glm-quota`? Delete `~/.config/opencode/plugins/opencode-glm-quota/`. Keeping both would give
  you two footer meters and two quota tools side by side.

**What gets installed where**

| Piece | Location | What it is |
|---|---|---|
| Plugin (server part) | `~/.config/opencode/plugins/opencode-zai-limits/` | registers the `opencode-zai-limits` tool for agents |
| TUI part | `src/tui.tsx` inside the plugin folder | the footer meter and the `/zai-limits` command (compiled by OpenCode at load) |

That's all: no command or agent files to copy. **To remove it**, delete the plugin folder. Nothing is written into
`opencode.json(c)`; OpenCode discovers plugin folders on its own.

---

## Usage

- The **meter** is automatic. Format: `z.ai | 3h 33m : 55% | 2d : 80%`. The first segment is the 5-hour window (time
  to reset, remaining), the second is the weekly one (days when ≥ 24h, hours and minutes under a day; always shown,
  even when full). The 5-hour segment becomes `5h : 100%` when the window is fully recovered.
- **`/zai-limits`** (or *GLM credit limits* in the command palette) opens the detailed report in a dialog, free, no
  model call. Scroll with `↑`/`↓` (`j`/`k`, PgUp/PgDn), `r` refreshes, `Esc` closes. The report looks like this
  (shown here as the Markdown it is built from):

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

- The `opencode-zai-limits` tool is also exposed to agents and Code Mode, so a running agent can check the quota
  itself. That is the only path where a model is involved: the HTTP request is still free, but the report lands in
  the agent's context like any tool result, so it counts toward that agent's tokens.

**Things to know**

- The 5-hour window on the Coding Plan is *rolling*: credits come back 5 hours after each consumption, so right after
  the nominal reset the meter may still show 99% until the last old usage ages out.
- The meter polls a monitoring endpoint every 2 minutes per OpenCode TUI process, and `/zai-limits` makes three
  requests when you open or refresh it. All of them are plain GETs, so neither consumes credits or tokens.
- The monitor endpoints are not documented by Z.ai. They are the same ones the official console and plugins use, but
  they may change without notice.

---

## How it works

The server part registers the `opencode-zai-limits` tool for agents. Its credential module finds your GLM Coding Plan
key (the `zai` / `zhipu` entries only; it never touches credentials of other providers) in OpenCode's SQLite store,
opened `--readonly` through the `sqlite3` CLI with a 5-second timeout, falling back to the v1 `auth.json` and then
environment variables. Requests go to `https://api.z.ai` or `https://open.bigmodel.cn` over HTTPS with the key in the
`Authorization` header. The quota response is parsed once into a typed snapshot (`src/quota.ts`) that both the report
and the meter read. When a request fails, the report shows the error (the key scrubbed from it) instead of empty
tables.

The TUI part (`src/tui.tsx`) is a second plugin part compiled by OpenCode's own Solid/OpenTUI loader. It keeps the
last quota snapshot in a Solid signal, refreshed every 2 minutes, and renders one `<text>` into the
`prompt.footer.status` slot (the line below the input field) and `home.footer.status`.

It also registers `/zai-limits` as a TUI command: a keymap layer with a `slash` name, the same mechanism OpenCode's
built-in `/stats` and `/plugins` use. Running it calls the server part's report builder (`executeGlmQuota`) directly
and draws the result in a dialog. A Markdown command would instead be a prompt sent to an agent, which is why the
earlier version cost a model call per run and this one costs nothing. The TUI command API is not in the published
plugin types yet; it is taken from OpenCode 2.3's own built-in plugins, so a future release could change it.
`Plugin.define()` in `@opencode/plugin` is an identity function (it returns its argument), so the plugin ships
without the SDK and its ~180 MB dependency tree.

---

## Development

```bash
npm install --ignore-scripts
npm run build        # dist/ (server part; tui.tsx ships as source, OpenCode compiles it)
npm run typecheck    # build, then type-check tui.tsx against dist/ declarations
npm run clean
```

There is no test suite yet; `npm run typecheck` is the check.

| Path | What it is |
|---|---|
| `src/index.ts` | server part: the `opencode-zai-limits` tool and `executeGlmQuota` (fetch + report) |
| `src/quota.ts` | `parseQuota`: the quota response as a typed snapshot (5h, weekly, MCP) |
| `src/report/` | the Markdown report, a pure function of already-fetched data |
| `src/tui.tsx` | TUI part: the footer meter and the `/zai-limits` dialog (Solid JSX, compiled by OpenCode) |
| `src/tui-support.ts` | the one module `tui.tsx` imports from `dist/` |
| `src/api/` | HTTPS client, endpoints, platform detection |
| `src/utils/` | credentials, auth paths, durations, formatting, time windows |
| `types/`, `tsconfig.tui.json` | type-checking setup for `tui.tsx` (no runtime role) |

---

## Credits

Started as a security-reviewed installation of
[guyinwonder168/opencode-glm-quota](https://github.com/guyinwonder168/opencode-glm-quota) (added to OpenCode from
[PR #52](https://github.com/guyinwonder168/opencode-glm-quota/pull/52) by @itelyatnikov80, which ported the plugin to
the V2 API and `opencode.db` credentials, thank you!). The projects diverged far enough that this became its own thing
instead of a fork: the credit-based UI, the footer meter, the free `/zai-limits` command (the original `/glm_quota` is
a Markdown command that drives a subagent, so every run costs a model call) and the zero-dependency build all happened
here. Thanks to @guyinwonder168 for the original plugin and to Z.ai for the Coding Plan.

This is an unofficial project and is not affiliated with Z.ai, Zhipu or OpenCode.


## Repository info

This repo follows the [Conventional Commits](https://www.conventionalcommits.org/) specification.

[![GitHub Sponsors](https://img.shields.io/github/sponsors/ManeFunction?label=Sponsor&logo=GitHubSponsors&style=flat)](https://github.com/sponsors/ManeFunction)

# Northstar ✦

A local-first macOS desktop app that tracks **work accomplishment** — not deadlines.
You work; progress accrues; at any moment you can see what you got done. The emotional
payload is *achievement, not obligation*: **no due dates**, and the "Today" bar only ever
fills with completed work — it can never read as "you're behind."

The twist: **Claude Code keeps it up to date as a side effect of real coding**, via a local
MCP server. And it can two-way **mirror your team's Jira sprint** if you want.

> Design spec: [`docs/superpowers/specs/2026-06-21-northstar-design.md`](docs/superpowers/specs/2026-06-21-northstar-design.md)

---

## Features

- **Today** — a videogame-style bar that fills with completed work (weighted: subtask +1, task +3, hotfix +2), with an overflow glow when you beat your plan. No countdown, ever.
- **Board** — Jira-style `To Do / In Progress / In Review / Done`, drag to change status (In Progress auto-pins to Today).
- **Daily report + End Day** — a clean end-of-day recap ritual (points, tasks, steps, hotfixes, streak) that's recorded and cancelable.
- **Productivity** — 30-day trends, streaks, and a you-vs-Claude split.
- **Spaces** — fully isolated work groups (Work / Labs / Personal); each repo and task belongs to one Space.
- **Hotfix capture** — a global `⌥⌘N` shortcut logs an interruption as an instant accomplishment, even with the window closed.
- **Claude integration** — a project-scoped skill + MCP config lets Claude log tasks/subtasks/status while it codes (fails silently if the app is closed).
- **Jira sync (optional, per-Space)** — mirrors your active sprint (incl. team-managed boards), shows assignees, echoes status changes, and creates Jira issues for tasks you make here.

---

## Install (macOS)

1. Download the latest **`NORTHSTAR-x.y.z-arm64.dmg`** from the [Releases page](https://github.com/TooSalty0000/northstar/releases).
2. Open the dmg and **drag NORTHSTAR to your Applications folder** (don't run it from the dmg).
3. The build is **unsigned**, so macOS quarantines it and may say **"NORTHSTAR is damaged and can't be opened."** That's the quarantine flag, not actual damage. Clear it once in Terminal:
   ```bash
   xattr -dr com.apple.quarantine /Applications/NORTHSTAR.app
   ```
   Then open NORTHSTAR normally. *(Right-click → Open does **not** reliably clear the "damaged" state — use the command above.)*

Northstar lives in your **menu bar** (✦). Closing the window doesn't quit it — use **Quit** from the menu-bar icon.

### Updates

Northstar checks GitHub Releases on launch. When a newer version exists, an in-app banner
appears (**"vX.Y.Z available — Download"**) linking to the release. Download the new dmg and
replace the app. *(Silent background auto-update requires Apple code-signing, which this
build doesn't use.)*

---

## Develop

```bash
npm install
npm run dev        # builds+watches the server, launches the Electron app
npm test           # server unit tests (Vitest)
npm run build      # build shared + server + app bundles
npm run dist       # build a distributable .dmg into release/
```

The macOS menu bar shows ✦ when the local server is running. In dev, the server hot-reloads
when its bundle rebuilds.

## Architecture

```
Electron tray app ──spawn+supervise──▶ northstar-server (plain Node)
 • menu-bar status ●                     • owns SQLite (better-sqlite3, WAL)
 • hotfix capture (⌥⌘N)                  • MCP over http://127.0.0.1:7777/mcp
 • React renderer  ◀──HTTP poll────────  • REST /api/* for the UI
                                                  ▲ http /mcp
   Claude in your work repos ──────────────────────┘  (.mcp.json + skill)
```

- **`packages/shared`** — types + constants (port, weights, enums).
- **`packages/server`** — plain-Node server: SQLite + migrations + activity log + REST API + the 6-tool MCP endpoint (stateless Streamable HTTP) + the Jira adapter. Never runs inside Electron.
- **`packages/app`** — Electron tray app (main/preload) + React renderer (Today, Board, Daily report, Productivity, Connections).
- **`templates/`** — the `.mcp.json` + `northstar-logging` skill dropped into work repos.

## Connect Claude to a repo

From the **Connections** tab (or the tray) → **Add repo** → pick a repo. It writes a
project-scoped `.mcp.json` + `.claude/skills/northstar-logging/SKILL.md`. Open Claude Code
there, approve the `northstar` MCP server, and Claude logs work automatically while Northstar
is running. If the app is closed, Claude silently skips logging — your real work is never blocked.

## Connect Jira (optional)

In a Space's **Connections** tab → **Connect to Jira** → paste your site URL + email + an
[Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens). The Space
then mirrors that project's active sprint. New tasks you create are pushed to Jira; status
changes echo back. Credentials are encrypted in your macOS Keychain (never in the database).

## License

[MIT](LICENSE) © 2026 TooSalty0000

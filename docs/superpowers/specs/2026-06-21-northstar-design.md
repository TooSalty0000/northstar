# Northstar — Design Spec

> **Status:** approved-for-planning · **Date:** 2026-06-21 · **Owner:** taehyun (2-person dev team)
>
> A local-first macOS desktop app that tracks **work accomplishment**, not deadlines. SQLite is the source of truth. Claude Code logs and updates work **as a side effect of real coding**, so the board stays current without anyone tending it. The emotional payload is *achievement, never obligation*.

---

## 1. Problem & Product Identity

### 1.1 The pain
- No "plan" to return to: every work session starts with "where were we, what's next?" burned on memory.
- A 2-person team with **no manager** — maintaining a task tool is *itself* overhead that competes with the actual work.
- Hotfixes and interruptions derail focus and silently get forgotten.
- Want visible **productivity / accomplishment** ("what did I get done today?").
- Claude does most of the work — so Claude should *be the one keeping the record current*.

### 1.2 What Northstar is (and is not)
- **Is:** a "what I did" accomplishment tracker / job-completion log. You work on jobs; progress accrues; you can always see what got done.
- **Is not:** a deadline-driven to-do list. **No due dates by default.** Nothing ever screams "DO THIS TODAY." A half-empty progress bar can **never** read as "you're behind."

### 1.3 Core decisions (locked during brainstorming)
| # | Decision |
|---|---|
| 1 | Source of truth = **local SQLite**. Jira sync is a **later, optional adapter** (schema reserves columns now). |
| 2 | A standalone **plain-Node `northstar-server`** owns SQLite and hosts MCP — **never inside Electron's process** (that was the historical nightmare). |
| 3 | An **Electron tray (menu-bar) app** spawns/supervises the server; closing the window ≠ stopping it; the menu-bar icon always shows status; Quit from the tray = full stop. |
| 4 | Claude in the team's **other work repos** connects to a fixed `localhost` MCP endpoint via a **project-scoped skill + `.mcp.json`**, and logs work as a side effect. |
| 5 | Progress model: `Task → Subtasks`. **% = subtasks done ÷ total**, checked off by Claude as it works. |
| 6 | Task also carries a **Jira-compatible status**: `To Do / In Progress / In Review / Done`. |
| 7 | An **append-only activity log** is the backbone — "what I did today," the daily report, and productivity stats are all queries over it. |
| 8 | No due dates by default (deadline is an optional nullable field). Stale In-Progress work gets a **neutral "last touched N days ago"** memory-aid — never a red nag. |
| 9 | **Today bar fills with COMPLETED work** (achievement framing) with **no failable ceiling**. |
| 10 | **SQLite engine = better-sqlite3** (proven/fastest; codesigning + ABI-pinning accepted as planned work). |
| 11 | **Today bar weighting = weighted**: subtask `+1`, task complete `+3`, hotfix `+2`. |
| 12 | **Productivity trends view (last 7/30 days + streaks) is IN v1.** |

---

## 2. System Overview

Three cooperating processes. **Hard rule: MCP and SQLite live in a plain-Node process, never inside Electron.**

```
  macOS user session
   ┌──────────────────────┐   spawn(bundled node) + supervise (death pipe)
   │  Electron TRAY app    │────────────────────────────┐
   │  (LSUIElement agent)  │                             ▼
   │  • tray status icon ● │            ┌──────────────────────────────┐
   │  • child supervision  │            │   northstar-server            │
   │  • hotfix quick-capture│   HTTP    │   (PLAIN NODE process)        │
   │  • renderer window    │◀──poll───▶│   Express @ 127.0.0.1:7777    │
   │       │ IPC (shell only)          │   ├─ POST /mcp  (MCP HTTP)    │
   └───────┼───────────────┘            │   └─ /api/*     (UI REST)     │
           ▼                            │            │                  │
   ┌──────────────────┐                 │   ┌────────▼─────────┐        │
   │  Renderer (React) │                 │   │  better-sqlite3   │        │
   │  • Today bar      │                 │   │  northstar.db     │        │
   │  • Board / tasks  │                 │   │  (WAL, 1 writer)  │        │
   │  • Daily report   │                 │   └──────────────────┘        │
   │  • Productivity   │                 └────────────▲──────────────────┘
   └──────────────────┘                              │ HTTP POST /mcp
            ┌─────────────────────┬──────────────────┼──────────────────┐
   ┌────────▼───────┐    ┌─────────▼───────┐  ┌───────▼────────┐
   │ Claude / repo-A │    │ Claude / repo-B │  │ Claude / repo-C│  (.mcp.json + skill)
   └────────────────┘    └─────────────────┘  └────────────────┘
```

**Key invariant:** `northstar-server` is a **shared singleton** owned by the tray app. Many Claude sessions in arbitrary directories dial the same fixed port. This is why the transport is **stateless Streamable HTTP, not stdio** — stdio would spawn one server subprocess per session, each fighting for the DB file (the original nightmare).

---

## 3. northstar-server

### 3.1 Runtime & libraries (pinned)
- **Runtime:** a **bundled standalone Node binary** shipped in `extraResources` — **not** the user's PATH node, **not** Electron's Node. Keeps better-sqlite3 on the standard Node ABI. **Pin an exact Node LTS** (target **Node 22.x LTS**) as the single source of truth for the native rebuild.
- `@modelcontextprotocol/sdk` — **stable v1.x, pinned to an exact patch** (verify latest stable at build time, e.g. `1.29.x`). Subpath imports `…/server/mcp.js` and `…/server/streamableHttp.js`. **Do NOT** use any v2-alpha split packages.
- `express@^4`, `zod@^3`, `better-sqlite3` (pinned to a release with a prebuilt matching the bundled Node ABI).
- **No `ws` in v1** — live updates are polling-based.

### 3.2 MCP transport — stateless Streamable HTTP (+ the 406 fix)
- **Stateless mode:** `sessionIdGenerator: undefined` + `enableJsonResponse: true`. A fresh `McpServer` + transport per request, torn down on termination. Collision-safe across many concurrent Claude sessions.
- **CRITICAL — SDK #1944 (open as of 2026):** the transport returns `406 Not Acceptable` if a client's `Accept` is `application/json` alone. Combined with the skill's fail-silent rule, this would make logging a **100% silent no-op**. **Mitigation:** Express middleware on `/mcp` that normalizes the header *before* the transport sees it:
  ```js
  app.use('/mcp', (req, _res, next) => {
    req.headers['accept'] = 'application/json, text/event-stream';
    next();
  });
  ```
  **Required CI test:** POST `/mcp` with `Accept: application/json` only → assert `200`, so a future SDK bump that changes this fails CI instead of silently breaking logging.
- **Teardown on ALL paths (leak fix):** wire transport/server cleanup to `res.on('close')` **and** `req.on('aborted')` **and** transport `onerror`. **Required load test:** 50 concurrent `/mcp` tool calls; assert listener count + memory return to baseline.
- **Consequence:** no server→Claude push (not needed — the UI polls REST).

### 3.3 Port, binding, identity nonce
- Fixed `127.0.0.1:7777`. Bind to `127.0.0.1` (not `0.0.0.0`) — never on the LAN.
- **Per-launch identity nonce:** server generates a UUID at startup, returned by `/api/health`. On `EADDRINUSE`, probe `/api/health`: adopt only if it's a live, current-generation Northstar; otherwise surface "port busy / stale server" to the tray.
- **DNS-rebinding guard:** reject `/api` and `/mcp` requests whose `Host` header isn't `127.0.0.1:7777` or `localhost:7777`.

### 3.4 Auth — none in v1 (honest framing)
- **No token.** The loopback bind + Host-header check raise the bar but are **not** a security boundary against local malware (out of scope for a 2-person local tool; worst case is junk tasks).
- A bearer token is **explicitly cut** from v1: Claude Code treats a token mismatch as a hard connection failure with no fallback (all-or-nothing footgun). One-line note in code: "add auth only if ever exposed beyond loopback."

### 3.5 MCP tools (final set — 6 tools)
Registered via `server.registerTool(name, {title, description, inputSchema: zodSchema, annotations}, handler)`. Names prefixed `northstar_` so the skill whitelists `mcp__northstar__*`. Responses are **compact** (ids + summary, never full log dumps) to stay under the 10k-token tool-output warning. `actor` for MCP-originated events = `'claude'`; UI-originated = `'user'`.

| Tool | Input (Zod) | Effect | Emits event |
|---|---|---|---|
| `northstar_create_task` | `{title, description?, repo?, subtasks?: string[], focusToday?: boolean}` | Create task (status `todo`); optional checklist; optional pin to today | `task_created` (+ `task_focused`) |
| `northstar_add_subtask` | `{taskId, title, position?}` | Append checklist item | `subtask_added` |
| `northstar_check_subtask` | `{taskId, subtaskId}` | Flip `done` 0→1, set `done_at`, bump `last_touched_at` | `subtask_done` |
| `northstar_set_status` | `{taskId, status}` | Update status, bump `last_touched_at`; auto-focus today on →`in_progress` | `status_changed` (+ `task_completed` if →done) |
| `northstar_log_hotfix` | `{title, description?, repo?, relatedTaskId?}` | Create an already-completed standalone accomplishment | `hotfix` |
| `northstar_list_tasks` | `{status?, repo?, query?}` | Read-only compact list/lookup (dedupe) | none |

- **Cut/merged:** `uncheck_subtask` (rare; fix in UI), `find_task` (merged into `list_tasks` via optional `query`).
- `annotations`: reads → `readOnlyHint: true`; check/set → `idempotentHint: true`.

### 3.6 UI REST API (v1)
Same Express app/port, consumed by the renderer **directly** (no IPC for data). One DB layer shared by UI handlers and MCP tool handlers.

- `GET  /api/health` → `{status, version, uptime, nonce}`
- `GET  /api/today` → today's focus set + completed events + **derived Today-bar numbers** (server computes day bounds, §5)
- `GET  /api/tasks?status=&repo=` → tasks with derived `pct`
- `GET  /api/tasks/:id` → task + subtasks + recent activity
- `POST /api/tasks` · `PATCH /api/tasks/:id` · `DELETE /api/tasks/:id` (archive)
- `POST /api/tasks/:id/subtasks` · `PATCH …/subtasks/:sid` · `DELETE …/subtasks/:sid`
- `POST /api/tasks/:id/focus` · `DELETE /api/tasks/:id/focus`
- `POST /api/hotfix`
- `GET  /api/report?date=` → daily report aggregates (recomputed from the log; any past date)
- `GET  /api/stats?from=&to=` → **productivity-over-time aggregates + streaks (v1, §8)**
- `GET  /api/connections` → repos seen recently (from `activity_log.repo` + last-seen ts) — onboarding/connection proof
- `GET  /api/activity?since=:id` → events with id > cursor (poll catch-up / recovery)

**Deferred:** `WS /ws`.

### 3.7 Write+emit pattern (single writer)
One transaction does `{mutate rows; INSERT activity_log}`. The committed `activity_log.id` (monotonic AUTOINCREMENT) is the **authoritative cursor** the renderer polls against (`/api/activity?since=`). The log is the source of truth; polling is the transport.

---

## 4. The Today / Focus Model

(No due dates means we must define explicitly how work reaches "Today" and what the bar fills toward.)

### 4.1 How a task gets onto Today
A task is "on Today" if it is **focused for today**. Focus is set:
- **manually** (morning organize: drag Board → Today, or a "Plan today" picker) → `POST /api/tasks/:id/focus`;
- **automatically** when a task moves to **In Progress** (Claude or user) — `set_status → in_progress` auto-focuses;
- **optionally at creation** (`focusToday: true`).

**Today view = focused tasks ∪ any task with a completion event today.** Surprise work Claude finishes mid-day still appears and counts. Focus is **per-day**, stored as `focus_date` (local `YYYY-MM-DD`); a new day rolls it off. Emits `task_focused` / `task_unfocused`.

### 4.2 Today bar — NO FAILABLE CEILING + weighting
- The bar represents **completed-work volume with no failable target.** Every completion adds; a half-empty bar at 5pm can never mean "behind."
- **Weighting (locked):** `subtask_done = +1`, `task_completed = +3`, `hotfix = +2` accomplishment units (tunable constants in one place).
- **Fill math:**
  - **Numerator** = weighted sum of work completed today.
  - **Denominator (soft target)** = `max(completedToday, plannedRemaining + completedToday)`, where `plannedRemaining` = weighted open work across today's focused tasks.
  - Because the denominator uses `max(...)`, the bar **fills toward 100% as planned work completes**, and **overflows with a celebratory glow** if you exceed plan — never exceeding a quota, never showing a deficit. With nothing planned, the bar simply grows with raw completed volume.
- Computed server-side in `/api/today` so all clients agree.

---

## 5. Time, "Today" Boundaries, Day Rollover (server-centralized)
- **Timestamps:** stored as ISO-8601 **UTC TEXT**.
- **Server owns all day-boundary math** from a configured TZ (defaults to the machine's local TZ). Callers never pass midnight values. Removes mis-bucketing from Claude-in-another-TZ and from `substr()`-ing UTC strings.
- **Configurable day-start offset**, default **04:00 local** — late-night sessions count toward the day they started (honors the no-pressure ethos).
- **End-of-day report trigger:** primarily a manual **"End day"** button (matches the evening loop), plus optional auto-rollover at the configured day-start.
- Reports are **always recomputed from the log**; `/api/report?date=` handles any past date; UI gets prev/next-day navigation.

---

## 6. Concurrent Edits & Reconciliation
- **Status/field conflicts: documented last-write-wins.** Later commit wins; each write bumps `updated_at`. Acceptable + explicit for a 2-person team (no version-rejection machinery in v1).
- **Renderer reconciliation: server is authoritative.** Optimistic UI is allowed, but polled REST state (+ `/api/activity?since=`) overrides it (TanStack Query rollback-on-settle). List items keyed by stable task IDs to avoid animation jank.
- **Dedupe (find→create TOCTOU): accept duplicates in v1.** Self-correcting, low-cost for 2 people; the skill reuses a task id within a session; cleanup happens in the UI.
- **Live updates:** TanStack Query polls every **15–30s + refetch-on-window-focus**, plus `/api/activity?since=:lastId` for cheap catch-up. WS push is deferred until lag is actually felt.

---

## 7. Electron Tray App

### 7.1 Lifecycle (menu-bar agent)
- **`LSUIElement: 1`** via electron-builder `mac.extendInfo` **plus** `app.dock.hide()` at runtime (defensive).
- Create `Tray` in `app.whenReady()`; hold a **module-level reference** (else GC removes the icon).
- **Closing the window ≠ quit:** intercept `'close'` → `if (!app.isQuitting) { e.preventDefault(); win.hide() }`.
- **`window-all-closed`:** on darwin do **nothing** (never `app.quit()` here — it would kill the server).
- **True quit only from tray:** `app.isQuitting = true` → graceful child shutdown in `before-quit` → `app.quit()`.

### 7.2 Tray status & hotfix quick-capture
- Tooltip + context menu reflect `starting` / `running` / `paused` / `crashed`. Menu: *Status: \<state\>* (disabled), *Open Northstar*, ***Log hotfix… (⌥⌘N)***, *Test Claude connection*, separator, *Quit Northstar*.
- **Hotfix quick-capture:** a **global shortcut (⌥⌘N)** + tray item open a **tiny frameless input** that POSTs to `/api/hotfix` **without raising the full app** (interruptions happen when the window is closed). Optional `relatedTaskId`. Immediate achievement feedback (toast/small confetti); increments Today.
- **Test Claude connection:** issues a real `/mcp` `initialize` and shows green/red — makes a broken config visible to the human even though it's invisible to Claude (fail-silent).

### 7.3 Child-process supervision — death detection without PID-reuse race
Spawn with **`child_process.spawn(<bundled node binary>, [serverEntry])`** — a genuine plain-Node process.
- **Not `utilityProcess.fork`** (Electron V8/ABI → better-sqlite3 rebuild) · **Not `child_process.fork`** (forces `ELECTRON_RUN_AS_NODE`, still Electron's ABI) · **Not PATH `node`** (GUI-launched apps get a stripped PATH).
- On non-zero `exit` && `!isQuitting`: restart with backoff (~1.5s); reflect `crashed`→`running`.
- Clean shutdown: `before-quit` → `e.preventDefault()` → `SIGTERM`, escalate to `SIGKILL` after ~3s → `app.quit()`.
- **Death detection (PID-reuse-safe):** pass an **inherited pipe/fd** from tray to child at spawn. If Electron dies (even via SIGKILL), the OS closes the fd → child gets EOF/EPIPE and exits immediately. **Secondary belt:** PID poll that re-verifies the parent **start time** (so a recycled PID isn't read as "alive"). Kills the "orphan server holding 7777" failure.

### 7.4 Packaging, ABI pinning, codesigning (highest-risk area — accepted)
- **extraResources (outside `app.asar`):** server tree + its `node_modules` (incl. `better_sqlite3.node`) + the standalone Node binary. asar breaks native `.node` loading + `__dirname` resolution. Resolve via `process.resourcesPath` in prod, dev path in dev. Scope `extraResources.from`/`filter` tightly.
- **ABI single-source-of-truth:** bundled Node version is canonical. In CI: download the exact bundled Node tarball **first**, then rebuild better-sqlite3 against **that** Node (`prebuild-install --runtime=node --target=<version>`). **Assert at build time** that `better_sqlite3.node`'s required ABI == bundled binary `process.versions.modules`. **Smoke-test the PACKAGED server** (in extraResources, not source) can `require('better-sqlite3')` and open a db.
- **Codesigning manifest (inside-out):** hardened-runtime notarization requires signing every nested Mach-O individually, inside-out:
  1. Sign `better_sqlite3.node` + any linked dylibs.
  2. Sign the bundled `node` binary with `hardenedRuntime: true` + a **dedicated child entitlements plist**: `com.apple.security.cs.allow-jit`, `com.apple.security.cs.allow-unsigned-executable-memory`, `com.apple.security.cs.disable-library-validation` (entitlements do **not** inherit parent→child).
  3. Sign the outer app; then notarize (electron-builder `afterSign`/notarize must cover the nested binaries).
  - **Verify:** `codesign --verify --deep --strict` + `spctl --assess --type execute`.
  - **Non-negotiable:** test launch on a **clean macOS machine/VM with no Xcode, no dev profile**. Budget real time; this is the single highest-risk item.

### 7.5 Renderer ↔ server
- **Direct localhost** for all data: `fetch` / TanStack Query → `http://127.0.0.1:7777/api/*`. Polling for liveness in v1.
- **IPC only for shell concerns** the server can't answer: tray status, child health, app quit, hotfix-window. Minimal `contextBridge` preload (one function per message), `contextIsolation` ON.
- **CSP (bake in day one):** `connect-src 'self' http://127.0.0.1:7777`. `webSecurity` stays on. (Forgetting this silently blocks fetch.)

---

## 8. UI / "Videogame Feel" + Productivity

### 8.1 Stack
- **React 18 + TypeScript + Vite** SPA.
- **`motion`** (Framer Motion, `motion/react` v12) for fill/spring/check-off juice.
- **`canvas-confetti`** for milestone bursts.
- **State:** TanStack Query (server cache) + **Zustand** (UI/ephemeral). No Redux.
- **Recharts** — **included in v1** for the productivity view.

### 8.2 Views
1. **Today** — videogame bar that **fills with completed work** (weighted, no-failable-ceiling, §4.2); spring-animated; per-task % bars beneath. Morning organize: pick/drag focus tasks. A **"pick up where you left off"** shelf surfaces stale in-progress tasks (§9). Inline hotfix capture (in addition to the tray global capture).
2. **Board** — Jira-compatible columns To Do / In Progress / In Review / Done. In-progress cards show neutral **"last touched N days ago"** (never red). Drag → `set_status` (auto-focuses on →In Progress). Archive/drop affordance.
3. **Daily report** — end-of-day "what I did today": events grouped, totals, % gains per task, hotfixes, **split by actor (you vs Claude) and by repo**; prev/next-day navigation; end-of-day confetti moment. Triggered by manual **End day** (+ optional auto-rollover).
4. **Productivity (v1)** — over-time trends from `/api/stats`: last 7/30-day bar/line of accomplishment units, **streak counter**, totals (subtasks / tasks / hotfixes), you-vs-Claude split. Recharts.

### 8.3 Animation
- Today bar: `motion.div animate={{ width }}` spring (`stiffness 120, damping 18`).
- Subtask check: scale pop `[1, 1.3, 1]`.
- **Confetti reserved for genuine milestones** (task complete, end-of-day, hotfix) and **debounced**. Respect `prefers-reduced-motion` (skip confetti, soften springs).
- **Live updates:** on poll/catch-up, invalidate/patch the matching TanStack Query key (server authoritative). Stable task-id keys for `layout` animations.

---

## 9. Stale-Work Memory Aid (neutral)
- **`last_touched_at` is bumped by any *mutating* event** on the task (subtask add/check, status change, focus change). **NOT** by reads/`list_tasks`.
- **Threshold:** show after **≥3 local days untouched** (configurable). Copy neutral ("last touched N days ago"), never red/overdue.
- **Surfacing:** on Board in-progress cards AND in the morning Today/organize flow as a gentle "pick up where you left off" list. Backed by partial index `idx_tasks_inprogress_touched`.

---

## 10. Backup, Portability, Integrity
- **DB location:** `~/Library/Application Support/Northstar/northstar.db`.
- **Integrity on startup:** `PRAGMA quick_check`; on failure surface to tray (don't serve a corrupt DB). (`kill -9` is a tested path and can leave WAL in a bad state.)
- **Automatic backup:** nightly + on clean shutdown via **`VACUUM INTO`** a timestamped file in `…/Northstar/Backups/`; keep last **7**.
- **Export / restore:** WAL-checkpoint-then-copy for `.db` export; open/restore from a `.db`. Plus a human-readable **NDJSON export of `activity_log`** for portable archival.

---

## 11. SQLite Schema (final)

better-sqlite3, WAL. Per-connection pragmas (server only): `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`. One-time `application_id=0x4E535452` ('NSTR'). Hand-rolled numbered migrations gated by `PRAGMA user_version`, each in its own transaction.

```sql
-- ===== migration 1: core =====
CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,             -- uuid; stable key for future Jira sync
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'todo'
                  CHECK (status IN ('todo','in_progress','in_review','done')),
  repo            TEXT,                          -- originating work repo
  deadline        TEXT,                          -- optional, OFF by default (NULL)
  focus_date      TEXT,                          -- local YYYY-MM-DD pinned to "Today"; NULL = not focused
  archived        INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),  -- "drop" without losing history
  created_at      TEXT NOT NULL,                 -- ISO-8601 UTC
  updated_at      TEXT NOT NULL,                 -- bumped every write (last-write-wins marker)
  last_touched_at TEXT NOT NULL,                 -- mutating events only; drives neutral "N days ago"
  completed_at    TEXT,                          -- set when status -> done
  -- ---- reserved future-Jira columns (nullable, near-zero cost; cheap insurance) ----
  external_provider   TEXT,                      -- 'jira'; NULL = local-only
  external_id         TEXT,                      -- Jira issue key e.g. 'PROJ-123'
  external_numeric_id TEXT,                      -- Jira numeric id (key can change)
  external_url        TEXT,
  last_synced_at      INTEGER,                   -- epoch ms
  sync_dirty          INTEGER NOT NULL DEFAULT 0,-- no v1 writer (only set once sync ships)
  sync_state          TEXT                       -- 'synced'|'pending'|'error'|'conflict'
);

CREATE TABLE subtasks (
  id        TEXT PRIMARY KEY,
  task_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  done      INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
  done_at   TEXT,                                -- set when done flips 0->1
  position  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT, -- monotonic cursor for /api/activity?since=
  ts          TEXT NOT NULL,                     -- ISO-8601 UTC
  type        TEXT NOT NULL,                     -- see §12 event types
  task_id     TEXT REFERENCES tasks(id)    ON DELETE SET NULL,
  subtask_id  TEXT REFERENCES subtasks(id) ON DELETE SET NULL,
  actor       TEXT NOT NULL DEFAULT 'user' CHECK (actor IN ('user','claude')),
  repo        TEXT,                              -- denormalized for fast per-repo stats + /api/connections
  origin_user TEXT,                              -- reserved: which human (NULL in v1, one human per DB)
  payload     TEXT                               -- JSON (json1/->> queryable)
);

-- ===== indexes =====
CREATE INDEX idx_subtasks_task    ON subtasks(task_id);
CREATE INDEX idx_log_ts           ON activity_log(ts);              -- "events today" range scan
CREATE INDEX idx_log_task_ts      ON activity_log(task_id, ts);
CREATE INDEX idx_log_actor_ts     ON activity_log(actor, ts);       -- "what Claude did today"
CREATE INDEX idx_log_repo_ts      ON activity_log(repo, ts);        -- /api/connections last-seen
CREATE INDEX idx_tasks_focus      ON tasks(focus_date) WHERE focus_date IS NOT NULL AND archived = 0;
CREATE INDEX idx_tasks_inprogress_touched
  ON tasks(last_touched_at) WHERE status = 'in_progress' AND archived = 0;
```

**% complete is derived, never stored:**
```sql
SELECT t.id, COUNT(s.id) total, COALESCE(SUM(s.done),0) done,
       CAST(COALESCE(SUM(s.done),0) AS REAL)/NULLIF(COUNT(s.id),0) pct
FROM tasks t LEFT JOIN subtasks s ON s.task_id=t.id GROUP BY t.id;
```

---

## 12. Activity Log & Reporting
- **Event types:** `task_created`, `subtask_added`, `subtask_done`, `status_changed`, `task_completed`, `task_focused`, `task_unfocused`, `hotfix`, `task_archived`. Each carries `actor`, optional `repo`, JSON `payload` (e.g. `{from:'in_progress', to:'done'}`).
- **"What I did today":** server computes local-day bounds (§5), range-scans `idx_log_ts`; "what Claude did" adds `actor='claude'`.
- **Daily report** (`/api/report?date=`): tasks completed, subtasks checked, hotfixes, status transitions, % gained per task; split by actor + repo. Always recomputed; any past date.
- **Productivity stats** (`/api/stats?from=&to=`): daily accomplishment-unit series (weighted §4.2), streak length, totals, actor split. Powers the §8.2 Productivity view.
- **Catch-up/recovery:** `/api/activity?since=:id` returns events after a cursor — the renderer's authoritative refresh path.

---

## 13. Claude Integration

Two committed files at the root of each **opted-in** work repo. Opting in = placing these files (the consent mechanism). A tray/CLI **"Add repo to Northstar" generator** writes both files into a chosen directory (avoids manual copy errors; keeps skill/tool names in sync with the whitelist).

### 13.1 `.mcp.json` (project scope) — hardcoded literal URL
```json
{
  "mcpServers": {
    "northstar": {
      "type": "http",
      "url": "http://127.0.0.1:7777/mcp"
    }
  }
}
```
- **No `${VAR}` expansion** — Claude Code's substitution in http-transport `.mcp.json` is broken/unconfirmed; the port is fixed by decision anyway. Per-machine override (if ever needed) = template the file at install time from the tray app, not runtime expansion.
- **`127.0.0.1`, not `localhost`** — avoids IPv6 `::1` mismatch (server binds 127.0.0.1).
- Project scope loads only in repos with this file, behind a one-time per-repo approval (`claude mcp list` shows "Pending approval"; reset via `claude mcp reset-project-choices`). This *is* the "only activates when wanted" feature.

### 13.2 `.claude/skills/northstar-logging/SKILL.md`
- **Model-invocable** (do NOT set `disable-model-invocation`).
- `description` third-person, specific, slightly assertive ("Logs and updates work in Northstar. Use whenever you start a multi-step coding task, complete a step, open/merge a PR, or handle a hotfix…") — Claude under-triggers, so be pushy.
- `allowed-tools` whitelists exactly `mcp__northstar__*`. Keep names stable or the whitelist silently mismatches.

### 13.3 Behavior policy (skill body)
- **Golden rule — FAIL SILENT (first & strongest):** if any `mcp__northstar__*` call errors/times out/is unreachable, treat as **no-op** — do not report, retry-loop, or ask the user. Real coding is never blocked by whether the menu-bar app is running.
- **Create a task** once at the start of a ~3+ step unit of work; immediately `add_subtask` per planned step. Use `list_tasks` (with `query`) to dedupe and **reuse the task id within a session**. Skip trivial one-shot edits/reads.
- **While working:** `check_subtask` per completed step; `set_status → in_review` on PR/handoff; `set_status → done` on merge/verify.
- **Hotfixes:** unplanned urgent work → `log_hotfix` (counts as completed accomplishment), then return to the real task.
- **Tone:** invisible; at most one brief "(logged to Northstar)". Never describe internals or announce the server's absence.
- **Validation milestone:** during the v1 "one opted-in repo" test, **temporarily DISABLE fail-silent** so transport/config errors surface (the 406 bug and `.mcp.json` resolution must be empirically confirmed against the real Claude Code client before fail-silent masks them).

---

## 14. Onboarding / First Run
- **First launch:** create DB + run migrations; welcome/empty state with "Create your first task" + "Connect a repo" CTAs.
- **"Add repo to Northstar":** tray action / CLI that writes `.mcp.json` + the skill into a chosen directory.
- **Connection proof:** a *Connections* view / tray item (backed by `/api/connections`) showing which repos pinged `/mcp` recently — plus the tray **"Test Claude connection"** self-test (§7.2). This is the make-or-break adoption moment; it must be visible to the human despite fail-silent.

---

## 15. v1 MVP — Ship List
- **northstar-server:** plain-Node, **better-sqlite3 (WAL)**, Express `/mcp` (stateless Streamable HTTP **+ Accept-header normalization**) + `/api/*`, on `127.0.0.1:7777`, **no auth**, Host-header guard, identity nonce, integrity check, automatic backups.
- **MCP tools (6):** create_task, add_subtask, check_subtask, set_status, log_hotfix, list_tasks.
- **Schema** incl. reserved Jira columns.
- **Activity log** + `/api/today` + `/api/report` + **`/api/stats`** + `/api/activity?since=` + `/api/connections`.
- **Today/focus model** (§4) with weighted no-failable-ceiling bar; server-centralized day boundaries (configurable day-start, default 04:00); manual "End day".
- **Electron tray app:** LSUIElement agent, `spawn(bundled node)` supervision w/ backoff, **death-pipe** parent-death detection (+ start-time-verified PID poll), window-close-hides, tray Quit, **tray hotfix quick-capture (⌥⌘N)**, **Test Claude connection**, extraResources packaging, **inside-out codesigning with child entitlements**, ABI pinned to bundled Node.
- **Renderer:** Today bar, per-task % bars, Board (4 cols + neutral "N days ago" + archive), Daily report (prev/next nav, actor/repo split), **Productivity trends + streaks (Recharts)**, hotfix capture, **polling liveness (15–30s + focus refetch + since-cursor)**, milestone confetti, `prefers-reduced-motion`.
- **Concurrency:** documented last-write-wins; server-authoritative reconciliation; accept dupes.
- **Backup/restore** + NDJSON export; DB at `~/Library/Application Support/Northstar/`.
- **Onboarding:** first-run empty state, "Add repo" generator, Connections view.
- **One opted-in work repo** wired with hardcoded-URL `.mcp.json` + `northstar-logging` skill (fail-silent, validated with fail-silent temporarily off).

## 16. Explicitly Deferred (later / never)
- **Jira sync** (entire adapter) — reserve columns only; built LAST, in plain-Node.
- **`WS /ws` push** — polling serves the loop; add only if lag is felt.
- **Auth / bearer token** — never for loopback; note only.
- **Stateful MCP sessions / server→Claude push** — not needed.
- **`uncheck_subtask`, `find_task` tools** — cut/merged.
- **Deadlines UI** beyond the nullable column.
- **Auto-launch at login**, multi-machine/shared board, real Jira sub-tasks, multi-human-per-DB (`origin_user` stays reserved/NULL).

---

## 17. Risks & Open Questions

### 17.1 Top risks (priority order)
1. **Codesigning the spawned node binary + `.node` under hardened runtime** — highest-risk; **must** be tested on a clean machine. *(Accepted by choosing better-sqlite3.)*
2. **better-sqlite3 ABI vs bundled Node** — mitigated by build-time ABI assertion + packaged-server smoke test.
3. **MCP SDK 406 bug (#1944)** — mitigated by Accept-header middleware + CI test; verify against the real Claude Code client with fail-silent OFF.
4. **`.mcp.json` URL resolution** — mitigated by hardcoded `127.0.0.1` literal; verify the real client connects.
5. **Skill under-triggering vs fail-silent** — prompt-engineering risk; validate empirically in the opted-in repo.
6. **Orphan server / stale port** — mitigated by death-pipe + start-time-verified PID poll + identity nonce; test `kill -9` on the tray.

### 17.2 Resolved defaults (change on request)
- Day-start offset = **04:00 local**; stale threshold = **≥3 days**; backup retention = **7**; confetti = task-complete + end-of-day + hotfix; auto-focus on →In Progress = **on**; one human per DB (`origin_user` reserved).

### 17.3 Still open (nice-to-confirm, not blocking)
- Exact accomplishment-unit weights are tunable (`subtask +1 / task +3 / hotfix +2`) — adjust after living with it.
```

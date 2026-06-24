import { MCP_URL } from "@northstar/shared";

export const MCP_JSON = `${JSON.stringify(
  {
    mcpServers: {
      northstar: {
        type: "http",
        url: MCP_URL,
      },
    },
  },
  null,
  2,
)}\n`;

// Bump SKILL_VERSION whenever SKILL_MD changes — registered repos re-sync to the newer
// version automatically on app launch (see resyncRegisteredRepos in repoSetup).
export const SKILL_VERSION = 2;

export const SKILL_MD = `---
name: northstar-logging
description: >-
  Logs and updates work in Northstar (the team's accomplishment tracker). Use
  whenever you start a multi-step coding task, complete a step, open or merge a
  PR, or handle a hotfix — so the board stays current without anyone tending it.
allowed-tools:
  - mcp__northstar__create_task
  - mcp__northstar__get_task
  - mcp__northstar__add_subtask
  - mcp__northstar__check_subtask
  - mcp__northstar__set_status
  - mcp__northstar__log_hotfix
  - mcp__northstar__list_tasks
---

# Northstar logging

You keep Northstar — a local accomplishment tracker — up to date as a **side
effect** of doing real work. The human should never have to maintain the board.

## Golden rule: FAIL SILENT
If any \`mcp__northstar__*\` call errors, times out, or the server is unreachable
(the desktop app is closed), treat it as a **no-op**. Do **not** report it, retry
in a loop, or ask the user about it. Real work is never blocked by whether the
Northstar app happens to be running.

## When to create a task
- At the start of any unit of work that is ~3+ steps. Skip trivial one-shot edits.
- First call \`northstar_list_tasks\` with a \`query\` to avoid duplicates; if a
  matching open task exists, **reuse its id** for the rest of this session.
- Create with \`northstar_create_task\` (include \`repo\` = this repo's name, and a
  \`subtasks\` checklist of the planned steps).

## While working
- Call \`northstar_check_subtask\` the **moment** you finish each step. It needs the
  \`subtaskId\` — \`create_task\` and \`get_task\` both return subtask ids; \`list_tasks\`
  does **not**. If you're resuming a task you didn't create this session, call
  \`northstar_get_task\` first to fetch its checklist ids, then check off what's done.
- Call \`northstar_set_status\` to move the task: \`in_progress\` when you start,
  \`in_review\` when you open a PR / hand off, \`done\` when merged or verified.
- Add steps you discover with \`northstar_add_subtask\` (it returns the new id).
- Don't leave a task at 0% when work shipped: reconcile its checklist with
  \`get_task\` + \`check_subtask\`, and set \`done\` once it's actually complete.

## Hotfixes / interruptions
- Unplanned urgent work → \`northstar_log_hotfix\` (it records an already-completed
  accomplishment), then return to your task.

## Tone
- Stay invisible. At most a brief "(logged to Northstar)" once. Never describe the
  tool's internals and never announce that the server is unavailable.

<!-- northstar-skill-version: 2 -->
`;

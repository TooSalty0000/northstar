import { randomUUID } from "node:crypto";
import type { Actor, Subtask, Task, TaskStatus } from "@northstar/shared";
import { STALE_DAYS_DEFAULT } from "@northstar/shared";
import { getDb } from "../db";
import { logicalLocalDate, nowIso } from "../time";
import { emit, rowToSubtask, rowToTask, touch } from "./mappers";
import { defaultSpaceId } from "./spaces";
import { repoSpaceId } from "./repos";
import { createInJira, echoStatusToJira } from "../jira/echo";

/** Resolve which space a new task belongs to: explicit > repo's space > default. */
function resolveSpaceId(explicit?: string | null, repo?: string | null): string {
  if (explicit) return explicit;
  if (repo) {
    const fromRepo = repoSpaceId(repo);
    if (fromRepo) return fromRepo;
  }
  return defaultSpaceId();
}

const TASK_COLS = `
  t.*,
  (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS total,
  (SELECT COALESCE(SUM(s.done),0) FROM subtasks s WHERE s.task_id = t.id) AS done_count
`;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function getTask(id: string): Task | null {
  const db = getDb();
  const row = db.prepare(`SELECT ${TASK_COLS} FROM tasks t WHERE t.id = ?`).get(id);
  if (!row) return null;
  const task = rowToTask(row);
  task.subtasks = getSubtasks(id);
  return task;
}

export function getSubtasks(taskId: string): Subtask[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM subtasks WHERE task_id = ? ORDER BY position, rowid`)
    .all(taskId)
    .map(rowToSubtask);
}

export interface ListFilter {
  status?: TaskStatus;
  repo?: string;
  query?: string;
  spaceId?: string;
  includeArchived?: boolean;
}

export function listTasks(f: ListFilter = {}): Task[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (!f.includeArchived) where.push("t.archived = 0");
  if (f.status) {
    where.push("t.status = ?");
    params.push(f.status);
  }
  if (f.spaceId) {
    where.push("t.space_id = ?");
    params.push(f.spaceId);
  }
  if (f.repo) {
    where.push("t.repo = ?");
    params.push(f.repo);
  }
  if (f.query) {
    where.push("(t.title LIKE ? OR t.description LIKE ?)");
    params.push(`%${f.query}%`, `%${f.query}%`);
  }
  const sql = `SELECT ${TASK_COLS} FROM tasks t
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY t.last_touched_at DESC`;
  return db.prepare(sql).all(...params).map(rowToTask);
}

/** In-progress, not archived, untouched ≥ staleDays, and not focused today. */
export function staleTasks(staleDays = STALE_DAYS_DEFAULT, spaceId?: string): Task[] {
  const db = getDb();
  const today = logicalLocalDate();
  const cutoff = new Date(Date.now() - staleDays * 86_400_000).toISOString();
  const sql = `SELECT ${TASK_COLS} FROM tasks t
     WHERE t.status = 'in_progress' AND t.archived = 0
       AND t.last_touched_at < ?
       AND (t.focus_date IS NULL OR t.focus_date != ?)
       ${spaceId ? "AND t.space_id = ?" : ""}
     ORDER BY t.last_touched_at ASC`;
  const params = spaceId ? [cutoff, today, spaceId] : [cutoff, today];
  return db.prepare(sql).all(...params).map(rowToTask);
}

// ---------------------------------------------------------------------------
// Mutations (each wrapped in a transaction that also emits an event)
// ---------------------------------------------------------------------------

export interface CreateTaskInput {
  title: string;
  description?: string;
  repo?: string;
  spaceId?: string;
  subtasks?: string[];
  focusToday?: boolean;
  actor?: Actor;
}

export function createTask(input: CreateTaskInput): Task {
  const db = getDb();
  const actor = input.actor ?? "user";
  const id = randomUUID();
  const ts = nowIso();
  const focusDate = input.focusToday ? logicalLocalDate() : null;
  const spaceId = resolveSpaceId(input.spaceId, input.repo);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, repo, space_id, focus_date, created_at, updated_at, last_touched_at)
       VALUES (@id, @title, @description, 'todo', @repo, @spaceId, @focusDate, @ts, @ts, @ts)`,
    ).run({ id, title: input.title, description: input.description ?? null, repo: input.repo ?? null, spaceId, focusDate, ts });
    emit(db, { type: "task_created", taskId: id, actor, repo: input.repo, payload: { title: input.title } });
    (input.subtasks ?? []).forEach((title, i) => {
      const sid = randomUUID();
      db.prepare(
        `INSERT INTO subtasks (id, task_id, title, position) VALUES (?, ?, ?, ?)`,
      ).run(sid, id, title, i);
      emit(db, { type: "subtask_added", taskId: id, subtaskId: sid, actor, repo: input.repo, payload: { title } });
    });
    if (focusDate) emit(db, { type: "task_focused", taskId: id, actor, repo: input.repo });
  })();
  createInJira(id); // connected Space ⇒ also create a Jira issue (no-op if disconnected)
  return getTask(id)!;
}

export function addSubtask(taskId: string, title: string, actor: Actor = "user", position?: number): Subtask {
  const db = getDb();
  const sid = randomUUID();
  const repo = taskRepo(taskId);
  db.transaction(() => {
    const pos =
      position ??
      ((db.prepare(`SELECT COALESCE(MAX(position),-1)+1 AS p FROM subtasks WHERE task_id = ?`).get(taskId) as any)?.p ?? 0);
    db.prepare(`INSERT INTO subtasks (id, task_id, title, position) VALUES (?, ?, ?, ?)`).run(sid, taskId, title, pos);
    emit(db, { type: "subtask_added", taskId, subtaskId: sid, actor, repo, payload: { title } });
    touch(db, taskId);
  })();
  return rowToSubtask(db.prepare(`SELECT * FROM subtasks WHERE id = ?`).get(sid));
}

/** Flip a subtask to done (idempotent — no event if already done). */
export function checkSubtask(taskId: string, subtaskId: string, actor: Actor = "user"): Task | null {
  const db = getDb();
  const repo = taskRepo(taskId);
  db.transaction(() => {
    const cur = db.prepare(`SELECT done FROM subtasks WHERE id = ? AND task_id = ?`).get(subtaskId, taskId) as any;
    if (!cur || cur.done) return;
    db.prepare(`UPDATE subtasks SET done = 1, done_at = ? WHERE id = ?`).run(nowIso(), subtaskId);
    emit(db, { type: "subtask_done", taskId, subtaskId, actor, repo });
    touch(db, taskId);
  })();
  return getTask(taskId);
}

export function uncheckSubtask(taskId: string, subtaskId: string, actor: Actor = "user"): Task | null {
  const db = getDb();
  db.transaction(() => {
    const cur = db.prepare(`SELECT done FROM subtasks WHERE id = ? AND task_id = ?`).get(subtaskId, taskId) as any;
    if (!cur || !cur.done) return;
    db.prepare(`UPDATE subtasks SET done = 0, done_at = NULL WHERE id = ?`).run(subtaskId);
    touch(db, taskId);
  })();
  return getTask(taskId);
}

export function deleteSubtask(taskId: string, subtaskId: string): Task | null {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM subtasks WHERE id = ? AND task_id = ?`).run(subtaskId, taskId);
    touch(db, taskId);
  })();
  return getTask(taskId);
}

export function setStatus(taskId: string, status: TaskStatus, actor: Actor = "user"): Task | null {
  const db = getDb();
  const repo = taskRepo(taskId);
  db.transaction(() => {
    const cur = db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(taskId) as any;
    if (!cur || cur.status === status) return;
    const completedAt = status === "done" ? nowIso() : null;
    // auto-focus today when work starts
    const focusDate = status === "in_progress" ? logicalLocalDate() : undefined;
    if (focusDate !== undefined) {
      db.prepare(`UPDATE tasks SET status = ?, completed_at = ?, focus_date = ? WHERE id = ?`).run(
        status, completedAt, focusDate, taskId,
      );
    } else {
      db.prepare(`UPDATE tasks SET status = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?`).run(
        status, completedAt, taskId,
      );
      if (status !== "done") db.prepare(`UPDATE tasks SET completed_at = NULL WHERE id = ?`).run(taskId);
    }
    emit(db, { type: "status_changed", taskId, actor, repo, payload: { from: cur.status, to: status } });
    if (status === "in_progress" && focusDate) emit(db, { type: "task_focused", taskId, actor, repo });
    if (status === "done") emit(db, { type: "task_completed", taskId, actor, repo });
    touch(db, taskId);
  })();
  echoStatusToJira(taskId); // status-echo to Jira (no-op for non-linked tasks)
  return getTask(taskId);
}

export interface HotfixInput {
  title: string;
  description?: string;
  repo?: string;
  spaceId?: string;
  relatedTaskId?: string;
  actor?: Actor;
}

/** A hotfix is an already-completed standalone accomplishment. */
export function logHotfix(input: HotfixInput): Task {
  const db = getDb();
  const actor = input.actor ?? "user";
  const id = randomUUID();
  const ts = nowIso();
  const spaceId = resolveSpaceId(input.spaceId, input.repo);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, repo, space_id, created_at, updated_at, last_touched_at, completed_at)
       VALUES (@id, @title, @description, 'done', @repo, @spaceId, @ts, @ts, @ts, @ts)`,
    ).run({ id, title: input.title, description: input.description ?? null, repo: input.repo ?? null, spaceId, ts });
    emit(db, {
      type: "hotfix",
      taskId: id,
      actor,
      repo: input.repo,
      payload: { title: input.title, relatedTaskId: input.relatedTaskId ?? null },
    });
  })();
  return getTask(id)!;
}

export function focusTask(taskId: string, on: boolean, actor: Actor = "user"): Task | null {
  const db = getDb();
  const repo = taskRepo(taskId);
  db.transaction(() => {
    db.prepare(`UPDATE tasks SET focus_date = ? WHERE id = ?`).run(on ? logicalLocalDate() : null, taskId);
    emit(db, { type: on ? "task_focused" : "task_unfocused", taskId, actor, repo });
  })();
  return getTask(taskId);
}

export function archiveTask(taskId: string, actor: Actor = "user"): void {
  const db = getDb();
  const repo = taskRepo(taskId);
  db.transaction(() => {
    db.prepare(`UPDATE tasks SET archived = 1, focus_date = NULL WHERE id = ?`).run(taskId);
    emit(db, { type: "task_archived", taskId, actor, repo });
  })();
}

export interface PatchTaskInput {
  title?: string;
  description?: string | null;
  deadline?: string | null;
}

export function updateTask(taskId: string, patch: PatchTaskInput): Task | null {
  const db = getDb();
  const sets: string[] = [];
  const params: any[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    params.push(patch.title);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    params.push(patch.description);
  }
  if (patch.deadline !== undefined) {
    sets.push("deadline = ?");
    params.push(patch.deadline);
  }
  if (!sets.length) return getTask(taskId);
  db.transaction(() => {
    db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params, taskId);
    touch(db, taskId);
  })();
  return getTask(taskId);
}

function taskRepo(taskId: string): string | null {
  const db = getDb();
  const r = db.prepare(`SELECT repo FROM tasks WHERE id = ?`).get(taskId) as any;
  return r?.repo ?? null;
}

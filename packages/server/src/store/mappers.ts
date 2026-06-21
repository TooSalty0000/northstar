import type { ActivityEvent, Actor, ActivityType, Subtask, Task, TaskStatus } from "@northstar/shared";
import type { DB } from "../db";
import { nowIso } from "../time";

export function rowToTask(r: any): Task {
  const total = r.total ?? undefined;
  const doneCount = r.done_count ?? undefined;
  const pct =
    total != null
      ? total > 0
        ? doneCount / total
        : r.status === "done"
          ? 1
          : 0
      : undefined;
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    status: r.status as TaskStatus,
    repo: r.repo ?? null,
    spaceId: r.space_id ?? null,
    deadline: r.deadline ?? null,
    focusDate: r.focus_date ?? null,
    archived: !!r.archived,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastTouchedAt: r.last_touched_at,
    completedAt: r.completed_at ?? null,
    externalProvider: r.external_provider ?? null,
    externalId: r.external_id ?? null,
    externalUrl: r.external_url ?? null,
    syncState: r.sync_state ?? null,
    sprintName: r.sprint_name ?? null,
    assigneeName: r.assignee_name ?? null,
    total,
    doneCount,
    pct,
  };
}

export function rowToSubtask(r: any): Subtask {
  return {
    id: r.id,
    taskId: r.task_id,
    title: r.title,
    done: !!r.done,
    doneAt: r.done_at ?? null,
    position: r.position,
  };
}

export function rowToEvent(r: any): ActivityEvent {
  return {
    id: r.id,
    ts: r.ts,
    type: r.type as ActivityType,
    taskId: r.task_id ?? null,
    subtaskId: r.subtask_id ?? null,
    actor: r.actor as Actor,
    repo: r.repo ?? null,
    payload: r.payload ? JSON.parse(r.payload) : null,
    taskTitle: r.task_title ?? null,
  };
}

export interface EmitInput {
  type: ActivityType;
  taskId?: string | null;
  subtaskId?: string | null;
  actor: Actor;
  repo?: string | null;
  payload?: Record<string, unknown> | null;
}

/** Insert an activity_log row. Call inside the same transaction as the mutation. */
export function emit(db: DB, e: EmitInput): number {
  const info = db
    .prepare(
      `INSERT INTO activity_log (ts, type, task_id, subtask_id, actor, repo, payload)
       VALUES (@ts, @type, @taskId, @subtaskId, @actor, @repo, @payload)`,
    )
    .run({
      ts: nowIso(),
      type: e.type,
      taskId: e.taskId ?? null,
      subtaskId: e.subtaskId ?? null,
      actor: e.actor,
      repo: e.repo ?? null,
      payload: e.payload ? JSON.stringify(e.payload) : null,
    });
  return Number(info.lastInsertRowid);
}

/** Bump updated_at + last_touched_at on a task (mutating events only). */
export function touch(db: DB, taskId: string) {
  const ts = nowIso();
  db.prepare(`UPDATE tasks SET updated_at = ?, last_touched_at = ? WHERE id = ?`).run(ts, ts, taskId);
}

import { getDb } from "../db";
import { getSession } from "./links";
import { createIssueForTask, pushStatus } from "./sync";

/**
 * Called after a local task is created: if its Space is connected to Jira, create a
 * matching Jira issue and link it back (fire-and-forget). No-op when disconnected.
 */
export function createInJira(taskId: string) {
  const db = getDb();
  const row = db
    .prepare(`SELECT space_id FROM tasks WHERE id=? AND external_id IS NULL`)
    .get(taskId) as any;
  if (!row) return;
  if (getSession(row.space_id)) createIssueForTask(taskId).catch(() => {});
}

/**
 * Called after a linked task's status changes locally: mark it dirty/pending and
 * fire-and-forget the status-echo push to Jira (if connected). Never throws.
 */
export function echoStatusToJira(taskId: string) {
  const db = getDb();
  const row = db
    .prepare(`SELECT space_id FROM tasks WHERE id=? AND external_provider='jira' AND external_id IS NOT NULL`)
    .get(taskId) as any;
  if (!row) return;
  db.prepare(`UPDATE tasks SET sync_dirty=1, sync_state='pending' WHERE id=?`).run(taskId);
  if (getSession(row.space_id)) {
    pushStatus(taskId).catch(() => {});
  }
}

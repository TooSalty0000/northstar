import { randomUUID } from "node:crypto";
import type { JiraBoard, JiraProject, JiraStatusOption } from "@northstar/shared";
import { getDb } from "../db";
import { nowIso } from "../time";
import { emit } from "../store/mappers";
import { JiraClient, type JiraCreds, JiraError } from "./client";
import {
  adfToText,
  buildPullJql,
  composeJiraDescription,
  jiraStatusToNorthstar,
  northstarStatusTarget,
  stripChecklist,
  textToADF,
  transitionMatches,
} from "./mapping";
import * as links from "./links";

function clientFor(spaceId: string): JiraClient {
  const creds = links.getSession(spaceId);
  if (!creds) throw new JiraError("auth", 0, "not connected");
  return new JiraClient(creds);
}

/** Validate credentials and return the connected user's identity. */
export async function validate(creds: JiraCreds): Promise<{ accountId: string; displayName: string }> {
  const me = await new JiraClient(creds).get("v3", "/myself");
  return { accountId: me.accountId, displayName: me.displayName };
}

export async function listProjects(spaceId: string): Promise<JiraProject[]> {
  const data = await clientFor(spaceId).get("v3", "/project/search?maxResults=100");
  return (data.values ?? []).map((p: any) => ({ id: p.id, key: p.key, name: p.name }));
}

export async function listStatuses(spaceId: string, projectKey: string): Promise<JiraStatusOption[]> {
  const data = await clientFor(spaceId).get("v3", `/project/${encodeURIComponent(projectKey)}/statuses`);
  const map = new Map<string, JiraStatusOption>();
  for (const it of data ?? [])
    for (const s of it.statuses ?? [])
      map.set(s.id, { id: s.id, name: s.name, category: s.statusCategory?.key ?? "new" });
  return [...map.values()];
}

export async function listBoards(spaceId: string, projectKeyOrId: string): Promise<JiraBoard[]> {
  const data = await clientFor(spaceId).get(
    "agile",
    `/board?projectKeyOrId=${encodeURIComponent(projectKeyOrId)}&maxResults=50`,
  );
  return (data.values ?? []).map((b: any) => ({ id: b.id, name: b.name, type: b.type }));
}

async function activeSprint(c: JiraClient, boardId: number): Promise<{ id: number; name: string } | null> {
  try {
    const data = await c.get("agile", `/board/${boardId}/sprint?state=active`);
    const s = data.values?.[0];
    return s ? { id: s.id, name: s.name } : null;
  } catch {
    return null; // kanban board (no sprints) or no active sprint — neutral
  }
}

/**
 * Self-heal a link: auto-detect a Scrum board if none was chosen, resolve the
 * in-review status id (English or Korean), and the default issue type. This makes
 * sprint-mirroring work even for links created without picking a board.
 */
async function ensureLinkConfig(spaceId: string): Promise<void> {
  const link = links.getLink(spaceId);
  if (!link || !links.getSession(spaceId)) return;
  let boardId = link.boardId;
  let reviewStatusId = link.reviewStatusId;
  if (boardId == null) {
    // Board type is unreliable: team-managed (next-gen) boards report "simple",
    // not "scrum". So pick the board that actually HAS an active sprint; else the first.
    const boards = await listBoards(spaceId, link.projectKey).catch(() => [] as any[]);
    if (boards.length) {
      const c = clientFor(spaceId);
      let chosen = boards[0];
      for (const b of boards) {
        const sp = await activeSprint(c, b.id);
        if (sp) {
          chosen = b;
          break;
        }
      }
      boardId = chosen.id;
    }
  }
  if (!reviewStatusId) {
    const statuses = await listStatuses(spaceId, link.projectKey).catch(() => [] as any[]);
    const review = statuses.find((s) => s.category === "indeterminate" && /review|검토|리뷰/i.test(s.name));
    if (review) reviewStatusId = review.id;
  }
  if (boardId !== link.boardId || reviewStatusId !== link.reviewStatusId) {
    links.upsertLink({
      spaceId,
      siteUrl: link.siteUrl,
      email: link.email,
      accountId: link.accountId,
      projectKey: link.projectKey,
      projectId: link.projectId,
      boardId,
      reviewStatusId,
    });
  }
  if (!link.issueTypeId) await resolveIssueType(spaceId);
}

/**
 * Pull = a live mirror of "my work" for this Space.
 *  - Scrum board linked → the ACTIVE SPRINT (done-in-sprint still shows; closed-sprint
 *    issues fall out and get archived).
 *  - No board / Kanban → open work only (done issues fall out and get archived).
 * Always reconciles: any linked task no longer returned is archived (un-archived if it returns).
 */
export async function pull(spaceId: string, _sprintOnly?: boolean): Promise<{ imported: number; updated: number; archived: number }> {
  await ensureLinkConfig(spaceId);
  const link = links.getLink(spaceId);
  if (!link) throw new JiraError("notfound", 0, "no link");
  const c = clientFor(spaceId);
  // Mode is decided by whether the linked board has an ACTIVE SPRINT — not by board
  // "type" (team-managed boards are "simple"). Sprint mode uses openSprints(), which
  // includes DONE issues in the current sprint, so completed-this-sprint stays visible
  // until the sprint is completed (then it leaves openSprints and gets archived).
  const sprint = link.boardId ? await activeSprint(c, link.boardId) : null;
  const mode: "sprint" | "open" = sprint ? "sprint" : "open";
  const jql = buildPullJql(link.projectKey, mode);
  const sprintName = sprint?.name ?? null;

  // Paginate via nextPageToken (the new /search/jql returns no total).
  const issues: any[] = [];
  let nextPageToken: string | undefined;
  let guard = 0;
  do {
    const body: any = { jql, maxResults: 100, fields: ["summary", "description", "status", "updated", "assignee"] };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const page = await c.post("v3", "/search/jql", body);
    issues.push(...(page.issues ?? []));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken && ++guard < 50);

  const db = getDb();
  const base = link.siteUrl.replace(/\/+$/, "");
  let imported = 0;
  let updated = 0;
  const pulledIds = new Set<string>();

  for (const iss of issues) {
    const numericId = String(iss.id);
    pulledIds.add(numericId);
    const key = iss.key;
    const summary = iss.fields?.summary ?? key;
    const desc = stripChecklist(adfToText(iss.fields?.description)); // drop our mirrored checklist
    const st = iss.fields?.status;
    const status = jiraStatusToNorthstar(String(st?.id), st?.statusCategory?.key ?? "new", link.reviewStatusId);
    const assignee = iss.fields?.assignee?.displayName ?? null;
    const url = `${base}/browse/${key}`;
    const existing = db
      .prepare(`SELECT id, sync_dirty FROM tasks WHERE external_provider='jira' AND external_numeric_id=?`)
      .get(numericId) as any;
    const ts = nowIso();

    if (existing) {
      // read title/desc/sprint as truth; only overwrite status if no local push is pending.
      // archived=0 so an issue returning to the sprint is un-archived.
      if (existing.sync_dirty) {
        db.prepare(
          `UPDATE tasks SET title=?, description=?, external_id=?, external_url=?, sprint_name=?, assignee_name=?, archived=0, last_synced_at=? WHERE id=?`,
        ).run(summary, desc, key, url, sprintName, assignee, Date.now(), existing.id);
      } else {
        db.prepare(
          `UPDATE tasks SET title=?, description=?, status=?, external_id=?, external_url=?, sprint_name=?, assignee_name=?, archived=0, sync_state='synced', last_synced_at=?,
             completed_at = CASE WHEN ?='done' THEN COALESCE(completed_at, ?) ELSE NULL END WHERE id=?`,
        ).run(summary, desc, status, key, url, sprintName, assignee, Date.now(), status, ts, existing.id);
      }
      updated++;
    } else {
      const id = randomUUID();
      db.transaction(() => {
        db.prepare(
          `INSERT INTO tasks (id,title,description,status,space_id,created_at,updated_at,last_touched_at,completed_at,
             external_provider,external_id,external_numeric_id,external_url,sprint_name,assignee_name,sync_state,last_synced_at)
           VALUES (?,?,?,?,?,?,?,?,?, 'jira', ?, ?, ?, ?, ?, 'synced', ?)`,
        ).run(id, summary, desc, status, spaceId, ts, ts, ts, status === "done" ? ts : null, key, numericId, url, sprintName, assignee, Date.now());
        emit(db, { type: "task_created", taskId: id, actor: "user", payload: { jira: key, imported: true } });
      })();
      imported++;
    }
  }

  // Reconcile: archive linked tasks no longer returned (done / closed sprint / unassigned /
  // deleted). Skip pending pushes and very-recently-synced rows (Jira search indexing lag,
  // so a just-pushed new issue isn't wrongly archived before it's searchable).
  let archived = 0;
  const recentCutoff = Date.now() - 120_000;
  const rows = db
    .prepare(
      `SELECT id, external_numeric_id FROM tasks
       WHERE space_id=? AND external_provider='jira' AND archived=0 AND sync_dirty=0
         AND (last_synced_at IS NULL OR last_synced_at < ?)`,
    )
    .all(spaceId, recentCutoff) as any[];
  for (const r of rows) {
    if (!pulledIds.has(String(r.external_numeric_id))) {
      db.prepare(`UPDATE tasks SET archived=1, focus_date=NULL, sync_state='unassigned' WHERE id=?`).run(r.id);
      archived++;
    }
  }

  links.setLastPull(spaceId);
  links.setAuthState(spaceId, "ok");
  return { imported, updated, archived };
}

/** Push a linked task's status to Jira via the matching transition (status-echo). */
export async function pushStatus(taskId: string): Promise<void> {
  const db = getDb();
  const t = db
    .prepare(`SELECT id, space_id, status, external_id, external_provider FROM tasks WHERE id=?`)
    .get(taskId) as any;
  if (!t || t.external_provider !== "jira" || !t.external_id) return;
  const link = links.getLink(t.space_id);
  if (!link || !links.getSession(t.space_id)) {
    db.prepare(`UPDATE tasks SET sync_state='pending' WHERE id=?`).run(taskId);
    return;
  }
  const target = northstarStatusTarget(t.status, link.reviewStatusId);
  try {
    const c = clientFor(t.space_id);
    const tr = await c.get("v3", `/issue/${t.external_id}/transitions`);
    const match = (tr.transitions ?? []).find((x: any) =>
      transitionMatches({ id: String(x.to?.id), categoryKey: x.to?.statusCategory?.key ?? "" }, target),
    );
    if (!match) {
      db.prepare(`UPDATE tasks SET sync_state='error' WHERE id=?`).run(taskId);
      return;
    }
    await c.post("v3", `/issue/${t.external_id}/transitions`, { transition: { id: match.id } });
    db.prepare(`UPDATE tasks SET sync_dirty=0, sync_state='synced', last_synced_at=? WHERE id=?`).run(Date.now(), taskId);
  } catch (e: any) {
    if (e instanceof JiraError && e.kind === "auth") links.setAuthState(t.space_id, "revoked");
    db.prepare(`UPDATE tasks SET sync_state='error' WHERE id=?`).run(taskId);
  }
}

/** Resolve + store the project's default (non-subtask) issue type for push-create. */
export async function resolveIssueType(spaceId: string): Promise<string | null> {
  const link = links.getLink(spaceId);
  if (!link) return null;
  try {
    const proj = await clientFor(spaceId).get("v3", `/project/${encodeURIComponent(link.projectKey)}`);
    const types: any[] = (proj.issueTypes ?? []).filter((t: any) => !t.subtask);
    const pick =
      types.find((t) => /^task$/i.test(t.name)) ?? types.find((t) => /^story$/i.test(t.name)) ?? types[0];
    if (pick) {
      links.setIssueType(spaceId, String(pick.id));
      return String(pick.id);
    }
  } catch {
    /* best effort */
  }
  return null;
}

/** Push a locally-created task to Jira as a new issue and link it back. */
export async function createIssueForTask(taskId: string): Promise<void> {
  const db = getDb();
  const t = db
    .prepare(`SELECT id, space_id, title, description, external_id FROM tasks WHERE id=?`)
    .get(taskId) as any;
  if (!t || t.external_id) return; // gone or already linked
  const link = links.getLink(t.space_id);
  if (!link || !links.getSession(t.space_id)) return; // not connected → stays local
  const issueTypeId = link.issueTypeId ?? (await resolveIssueType(t.space_id));
  const subs = db
    .prepare(`SELECT title, done FROM subtasks WHERE task_id=? ORDER BY position, rowid`)
    .all(taskId) as any[];
  try {
    const c = clientFor(t.space_id);
    const fields: any = {
      project: { key: link.projectKey },
      summary: t.title,
      description: textToADF(composeJiraDescription(t.description || "", subs)),
      issuetype: issueTypeId ? { id: issueTypeId } : { name: "Task" },
    };
    if (link.accountId) fields.assignee = { accountId: link.accountId };
    const created = await c.post("v3", "/issue", { fields });
    const key = created.key;
    const numericId = String(created.id);
    const url = `${link.siteUrl.replace(/\/+$/, "")}/browse/${key}`;
    db.prepare(
      `UPDATE tasks SET external_provider='jira', external_id=?, external_numeric_id=?, external_url=?, sync_state='synced', last_synced_at=? WHERE id=?`,
    ).run(key, numericId, url, Date.now(), taskId);
    // add to the active sprint so it lands on the board (not just the backlog)
    if (link.boardId) {
      const sp = await activeSprint(c, link.boardId);
      if (sp) {
        try {
          await c.post("agile", `/sprint/${sp.id}/issue`, { issues: [key] });
          db.prepare(`UPDATE tasks SET sprint_name=? WHERE id=?`).run(sp.name, taskId);
        } catch {
          /* sprint add is best-effort */
        }
      }
    }
  } catch (e: any) {
    if (e instanceof JiraError && e.kind === "auth") links.setAuthState(t.space_id, "revoked");
    db.prepare(`UPDATE tasks SET sync_state='error' WHERE id=?`).run(taskId);
  }
}

/**
 * Push a linked task's subtask checklist into its Jira issue description (the mirror).
 * Idempotent — recomputes the whole description from local prose + current subtasks.
 */
export async function pushDescription(taskId: string): Promise<void> {
  const db = getDb();
  const t = db
    .prepare(`SELECT id, space_id, description, external_id, external_provider FROM tasks WHERE id=?`)
    .get(taskId) as any;
  if (!t || t.external_provider !== "jira" || !t.external_id) return;
  if (!links.getLink(t.space_id) || !links.getSession(t.space_id)) {
    db.prepare(`UPDATE tasks SET desc_dirty=1 WHERE id=?`).run(taskId);
    return;
  }
  const subs = db
    .prepare(`SELECT title, done FROM subtasks WHERE task_id=? ORDER BY position, rowid`)
    .all(taskId) as any[];
  try {
    const body = composeJiraDescription(t.description || "", subs);
    await clientFor(t.space_id).put("v3", `/issue/${t.external_id}`, {
      fields: { description: textToADF(body) },
    });
    db.prepare(`UPDATE tasks SET desc_dirty=0 WHERE id=?`).run(taskId);
  } catch (e: any) {
    if (e instanceof JiraError && e.kind === "auth") links.setAuthState(t.space_id, "revoked");
    db.prepare(`UPDATE tasks SET desc_dirty=1 WHERE id=?`).run(taskId); // retried by pushPending
  }
}

/** Push every un-linked local task in a connected Space to Jira (on demand). */
export async function pushLocalTasks(spaceId: string): Promise<{ pushed: number }> {
  if (!links.getSession(spaceId)) return { pushed: 0 };
  const db = getDb();
  const rows = db
    .prepare(`SELECT id FROM tasks WHERE space_id=? AND archived=0 AND external_id IS NULL`)
    .all(spaceId) as any[];
  let pushed = 0;
  for (const r of rows) {
    await createIssueForTask(r.id);
    const linked = db.prepare(`SELECT external_id FROM tasks WHERE id=?`).get(r.id) as any;
    if (linked?.external_id) pushed++;
  }
  return { pushed };
}

/**
 * Push everything pending for a connected space: create Jira issues for any unlinked
 * tasks, and push status for any linked tasks marked dirty. This is the safety net that
 * makes pushes automatic even if the instant create/echo missed (e.g. session not yet
 * loaded at the moment of creation) — no manual "Push local tasks" needed.
 */
export async function pushPending(spaceId: string): Promise<void> {
  if (!links.getSession(spaceId)) return;
  const db = getDb();
  const unlinked = db
    .prepare(`SELECT id FROM tasks WHERE space_id=? AND archived=0 AND external_id IS NULL`)
    .all(spaceId) as any[];
  for (const r of unlinked) await createIssueForTask(r.id);
  const dirty = db
    .prepare(
      `SELECT id FROM tasks WHERE space_id=? AND external_provider='jira' AND external_id IS NOT NULL AND sync_dirty=1`,
    )
    .all(spaceId) as any[];
  for (const r of dirty) await pushStatus(r.id);
  const descDirty = db
    .prepare(
      `SELECT id FROM tasks WHERE space_id=? AND external_provider='jira' AND external_id IS NOT NULL AND desc_dirty=1`,
    )
    .all(spaceId) as any[];
  for (const r of descDirty) await pushDescription(r.id);
}

/** Auto-sync every connected space (called by the timer): push pending, then pull. */
export async function pullAllConnected(): Promise<void> {
  for (const spaceId of links.connectedSpaceIds()) {
    if (!links.getLink(spaceId)) continue;
    try {
      await pushPending(spaceId); // push local creations/status first
      await pull(spaceId); // then mirror the sprint back
    } catch {
      /* surfaced via auth_state/sync_state; timer keeps going */
    }
  }
}

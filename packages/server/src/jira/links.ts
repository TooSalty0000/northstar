import type { JiraAuthState, JiraLink } from "@northstar/shared";
import { getDb } from "../db";
import { nowIso } from "../time";
import type { JiraCreds } from "./client";

// In-memory credentials per space. The server NEVER persists the token — Electron
// main owns it (safeStorage) and pushes it here on connect / on server start.
const sessions = new Map<string, JiraCreds>();

export const setSession = (spaceId: string, creds: JiraCreds) => sessions.set(spaceId, creds);
export const clearSession = (spaceId: string) => sessions.delete(spaceId);
export const getSession = (spaceId: string): JiraCreds | undefined => sessions.get(spaceId);
export const connectedSpaceIds = () => [...sessions.keys()];

function rowToLink(r: any): JiraLink {
  return {
    spaceId: r.space_id,
    siteUrl: r.site_url,
    email: r.email,
    accountId: r.account_id ?? null,
    projectKey: r.project_key,
    projectId: r.project_id ?? null,
    boardId: r.board_id ?? null,
    reviewStatusId: r.review_status_id ?? null,
    issueTypeId: r.issue_type_id ?? null,
    authState: r.auth_state,
    lastPullAt: r.last_pull_at ?? null,
    connected: sessions.has(r.space_id),
  };
}

export function getLink(spaceId: string): JiraLink | null {
  const r = getDb().prepare(`SELECT * FROM space_jira_links WHERE space_id = ?`).get(spaceId);
  return r ? rowToLink(r) : null;
}

export function listLinks(): JiraLink[] {
  return getDb().prepare(`SELECT * FROM space_jira_links`).all().map(rowToLink);
}

export interface UpsertLink {
  spaceId: string;
  siteUrl: string;
  email: string;
  accountId?: string | null;
  projectKey: string;
  projectId?: string | null;
  boardId?: number | null;
  reviewStatusId?: string | null;
}

export function upsertLink(l: UpsertLink): JiraLink {
  const db = getDb();
  const exists = db.prepare(`SELECT space_id FROM space_jira_links WHERE space_id = ?`).get(l.spaceId);
  if (exists) {
    db.prepare(
      `UPDATE space_jira_links SET site_url=?, email=?, account_id=?, project_key=?, project_id=?, board_id=?, review_status_id=?, auth_state='ok' WHERE space_id=?`,
    ).run(l.siteUrl, l.email, l.accountId ?? null, l.projectKey, l.projectId ?? null, l.boardId ?? null, l.reviewStatusId ?? null, l.spaceId);
  } else {
    db.prepare(
      `INSERT INTO space_jira_links (space_id, site_url, email, account_id, project_key, project_id, board_id, review_status_id, auth_state, created_at)
       VALUES (?,?,?,?,?,?,?,?, 'ok', ?)`,
    ).run(l.spaceId, l.siteUrl, l.email, l.accountId ?? null, l.projectKey, l.projectId ?? null, l.boardId ?? null, l.reviewStatusId ?? null, nowIso());
  }
  return getLink(l.spaceId)!;
}

export function setAuthState(spaceId: string, s: JiraAuthState) {
  getDb().prepare(`UPDATE space_jira_links SET auth_state=? WHERE space_id=?`).run(s, spaceId);
}
export function setIssueType(spaceId: string, issueTypeId: string) {
  getDb().prepare(`UPDATE space_jira_links SET issue_type_id=? WHERE space_id=?`).run(issueTypeId, spaceId);
}
export function setLastPull(spaceId: string) {
  getDb().prepare(`UPDATE space_jira_links SET last_pull_at=? WHERE space_id=?`).run(nowIso(), spaceId);
}
export function deleteLink(spaceId: string) {
  getDb().prepare(`DELETE FROM space_jira_links WHERE space_id=?`).run(spaceId);
  clearSession(spaceId);
}

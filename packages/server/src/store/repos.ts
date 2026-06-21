import { randomUUID } from "node:crypto";
import nodePath from "node:path";
import type { Repo } from "@northstar/shared";
import { getDb } from "../db";
import { nowIso } from "../time";
import { defaultSpaceId } from "./spaces";

function rowToRepo(r: any): Repo {
  return {
    id: r.id,
    path: r.path,
    name: r.name,
    spaceId: r.space_id ?? null,
    addedAt: r.added_at,
    lastSeen: r.last_seen ?? null,
    eventCount: r.event_count ?? 0,
  };
}

export function listRepos(spaceId?: string): Repo[] {
  const db = getDb();
  const where = spaceId ? `WHERE r.space_id = ?` : ``;
  const rows = db
    .prepare(
      `SELECT r.*,
        (SELECT MAX(ts) FROM activity_log a WHERE a.repo = r.name) AS last_seen,
        (SELECT COUNT(*) FROM activity_log a WHERE a.repo = r.name) AS event_count
       FROM repos r ${where} ORDER BY r.added_at DESC`,
    )
    .all(...(spaceId ? [spaceId] : []));
  return rows.map(rowToRepo);
}

export function getRepo(id: string): Repo | null {
  const r = getDb().prepare(`SELECT * FROM repos WHERE id = ?`).get(id);
  return r ? rowToRepo(r) : null;
}

export function addRepo(input: { path: string; name?: string; spaceId?: string | null }): Repo {
  const db = getDb();
  const name = (input.name || nodePath.basename(input.path)).trim();
  const spaceId = input.spaceId || defaultSpaceId();
  const existing = db.prepare(`SELECT id FROM repos WHERE path = ?`).get(input.path) as any;
  if (existing) {
    db.prepare(`UPDATE repos SET name = ?, space_id = ? WHERE id = ?`).run(name, spaceId, existing.id);
    return getRepo(existing.id)!;
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO repos (id, path, name, space_id, added_at) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    input.path,
    name,
    spaceId,
    nowIso(),
  );
  return getRepo(id)!;
}

export function removeRepo(id: string): { ok: boolean } {
  getDb().prepare(`DELETE FROM repos WHERE id = ?`).run(id);
  return { ok: true };
}

/** Which Space does work from this repo belong to? (null if the repo isn't registered) */
export function repoSpaceId(repoName: string): string | null {
  const r = getDb()
    .prepare(`SELECT space_id FROM repos WHERE name = ? ORDER BY added_at DESC LIMIT 1`)
    .get(repoName) as any;
  return r?.space_id ?? null;
}

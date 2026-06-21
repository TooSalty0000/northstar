import { randomUUID } from "node:crypto";
import type { Space } from "@northstar/shared";
import { getDb } from "../db";
import { nowIso } from "../time";

function rowToSpace(r: any): Space {
  return {
    id: r.id,
    name: r.name,
    emoji: r.emoji ?? null,
    color: r.color ?? null,
    position: r.position,
    isDefault: !!r.is_default,
    createdAt: r.created_at,
  };
}

export function listSpaces(): Space[] {
  return getDb().prepare(`SELECT * FROM spaces ORDER BY position, created_at`).all().map(rowToSpace);
}

export function getSpace(id: string): Space | null {
  const r = getDb().prepare(`SELECT * FROM spaces WHERE id = ?`).get(id);
  return r ? rowToSpace(r) : null;
}

export function defaultSpaceId(): string {
  const db = getDb();
  const r =
    (db.prepare(`SELECT id FROM spaces WHERE is_default = 1 LIMIT 1`).get() as any) ??
    (db.prepare(`SELECT id FROM spaces ORDER BY position LIMIT 1`).get() as any);
  return r?.id;
}

export function createSpace(input: { name: string; emoji?: string; color?: string }): Space {
  const db = getDb();
  const id = randomUUID();
  const pos = (db.prepare(`SELECT COALESCE(MAX(position),-1)+1 AS p FROM spaces`).get() as any).p;
  db.prepare(
    `INSERT INTO spaces (id, name, emoji, color, position, is_default, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
  ).run(id, input.name.trim(), input.emoji ?? null, input.color ?? null, pos, nowIso());
  return getSpace(id)!;
}

export function updateSpace(
  id: string,
  patch: { name?: string; emoji?: string | null; color?: string | null },
): Space | null {
  const db = getDb();
  const sets: string[] = [];
  const params: any[] = [];
  if (patch.name !== undefined) (sets.push("name = ?"), params.push(patch.name));
  if (patch.emoji !== undefined) (sets.push("emoji = ?"), params.push(patch.emoji));
  if (patch.color !== undefined) (sets.push("color = ?"), params.push(patch.color));
  if (sets.length) db.prepare(`UPDATE spaces SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
  return getSpace(id);
}

/** Delete a space (not the default). Tasks/repos in it are reassigned to the default space. */
export function deleteSpace(id: string): { ok: boolean; error?: string } {
  const db = getDb();
  const sp = db.prepare(`SELECT is_default FROM spaces WHERE id = ?`).get(id) as any;
  if (!sp) return { ok: false, error: "not found" };
  if (sp.is_default) return { ok: false, error: "cannot delete the default space" };
  const def = defaultSpaceId();
  db.transaction(() => {
    db.prepare(`UPDATE tasks SET space_id = ? WHERE space_id = ?`).run(def, id);
    db.prepare(`UPDATE repos SET space_id = ? WHERE space_id = ?`).run(def, id);
    db.prepare(`DELETE FROM spaces WHERE id = ?`).run(id);
  })();
  return { ok: true };
}

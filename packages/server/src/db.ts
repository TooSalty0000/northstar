import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dbPath, backupDir, BACKUP_RETENTION, ensureDirs } from "./config";

export type DB = Database.Database;

let _db: DB | null = null;

// 0x4E535452 = 'NSTR'
const APPLICATION_ID = 0x4e535452;

const MIGRATIONS: Array<(db: DB) => void> = [
  // migration 1 — core schema
  (db) => {
    db.exec(`
      CREATE TABLE tasks (
        id              TEXT PRIMARY KEY,
        title           TEXT NOT NULL,
        description     TEXT,
        status          TEXT NOT NULL DEFAULT 'todo'
                        CHECK (status IN ('todo','in_progress','in_review','done')),
        repo            TEXT,
        deadline        TEXT,
        focus_date      TEXT,
        archived        INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        last_touched_at TEXT NOT NULL,
        completed_at    TEXT,
        -- reserved future-Jira columns (nullable, cheap insurance)
        external_provider   TEXT,
        external_id         TEXT,
        external_numeric_id TEXT,
        external_url        TEXT,
        last_synced_at      INTEGER,
        sync_dirty          INTEGER NOT NULL DEFAULT 0,
        sync_state          TEXT
      );

      CREATE TABLE subtasks (
        id        TEXT PRIMARY KEY,
        task_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        title     TEXT NOT NULL,
        done      INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
        done_at   TEXT,
        position  INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE activity_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        ts          TEXT NOT NULL,
        type        TEXT NOT NULL,
        task_id     TEXT REFERENCES tasks(id)    ON DELETE SET NULL,
        subtask_id  TEXT REFERENCES subtasks(id) ON DELETE SET NULL,
        actor       TEXT NOT NULL DEFAULT 'user' CHECK (actor IN ('user','claude')),
        repo        TEXT,
        origin_user TEXT,
        payload     TEXT
      );

      CREATE INDEX idx_subtasks_task ON subtasks(task_id);
      CREATE INDEX idx_log_ts        ON activity_log(ts);
      CREATE INDEX idx_log_task_ts   ON activity_log(task_id, ts);
      CREATE INDEX idx_log_actor_ts  ON activity_log(actor, ts);
      CREATE INDEX idx_log_repo_ts   ON activity_log(repo, ts);
      CREATE INDEX idx_tasks_focus
        ON tasks(focus_date) WHERE focus_date IS NOT NULL AND archived = 0;
      CREATE INDEX idx_tasks_inprogress_touched
        ON tasks(last_touched_at) WHERE status = 'in_progress' AND archived = 0;
    `);
  },
  // migration 2 — Spaces (isolated work groups) + repo registry
  (db) => {
    db.exec(`
      CREATE TABLE spaces (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        emoji      TEXT,
        color      TEXT,
        position   INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
        created_at TEXT NOT NULL
      );

      CREATE TABLE repos (
        id        TEXT PRIMARY KEY,
        path      TEXT NOT NULL UNIQUE,
        name      TEXT NOT NULL,
        space_id  TEXT REFERENCES spaces(id) ON DELETE SET NULL,
        added_at  TEXT NOT NULL
      );

      ALTER TABLE tasks ADD COLUMN space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL;

      CREATE INDEX idx_tasks_space ON tasks(space_id);
      CREATE INDEX idx_repos_space ON repos(space_id);
      CREATE INDEX idx_repos_name  ON repos(name);
    `);
    // seed a default Space and migrate all existing tasks into it
    const id = randomUUID();
    const ts = new Date().toISOString();
    db.prepare(
      `INSERT INTO spaces (id, name, emoji, color, position, is_default, created_at)
       VALUES (?, 'Work', '✦', '#f5b942', 0, 1, ?)`,
    ).run(id, ts);
    db.prepare(`UPDATE tasks SET space_id = ? WHERE space_id IS NULL`).run(id);
  },
  // migration 3 — Jira link per Space (API-token auth; token NOT stored here) + sprint tag
  (db) => {
    db.exec(`
      CREATE TABLE space_jira_links (
        space_id         TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
        site_url         TEXT NOT NULL,
        email            TEXT NOT NULL,
        account_id       TEXT,
        project_key      TEXT NOT NULL,
        project_id       TEXT,
        board_id         INTEGER,
        review_status_id TEXT,
        auth_state       TEXT NOT NULL DEFAULT 'ok' CHECK (auth_state IN ('ok','revoked','error')),
        last_pull_at     TEXT,
        created_at       TEXT NOT NULL
      );

      ALTER TABLE tasks ADD COLUMN sprint_name TEXT;
      CREATE INDEX idx_tasks_external ON tasks(external_provider, external_numeric_id);
    `);
  },
  // migration 4 — store the project's default issue type for push-create
  (db) => {
    db.exec(`ALTER TABLE space_jira_links ADD COLUMN issue_type_id TEXT;`);
  },
  // migration 5 — show the assignee on shared/sprint boards
  (db) => {
    db.exec(`ALTER TABLE tasks ADD COLUMN assignee_name TEXT;`);
  },
  // migration 6 — retry flag for pushing the subtask checklist into the Jira description
  (db) => {
    db.exec(`ALTER TABLE tasks ADD COLUMN desc_dirty INTEGER NOT NULL DEFAULT 0;`);
  },
  // migration 7 — clear cached issue types so the corrected resolver (which never picks
  // an Epic) re-resolves to a standard Task/Story on the next sync.
  (db) => {
    db.exec(`UPDATE space_jira_links SET issue_type_id = NULL;`);
  },
  // migration 8 — a user's manual archive must stick: the Jira pull must not un-archive it
  // just because the issue is still in the active sprint.
  (db) => {
    db.exec(`ALTER TABLE tasks ADD COLUMN archived_sticky INTEGER NOT NULL DEFAULT 0;`);
  },
];

function applyPragmas(db: DB) {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
}

function migrate(db: DB) {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current === 0) db.pragma(`application_id = ${APPLICATION_ID}`);
  for (let v = current; v < MIGRATIONS.length; v++) {
    const run = db.transaction(() => {
      MIGRATIONS[v](db);
      db.pragma(`user_version = ${v + 1}`);
    });
    run();
  }
}

export function openDb(file: string): DB {
  const db = new Database(file);
  applyPragmas(db);
  if (file !== ":memory:") {
    const check = db.pragma("quick_check", { simple: true });
    if (check !== "ok") {
      throw new Error(`Database integrity check failed: ${String(check)}`);
    }
  }
  migrate(db);
  return db;
}

export function getDb(): DB {
  if (_db) return _db;
  ensureDirs();
  _db = openDb(dbPath());
  return _db;
}

export function closeDb() {
  if (_db) {
    try {
      _db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      /* best effort */
    }
    _db.close();
    _db = null;
  }
}

/** Test helper: swap in a fresh in-memory database. */
export function _setTestDb(): DB {
  if (_db) _db.close();
  _db = openDb(":memory:");
  return _db;
}

export function backup(): string {
  ensureDirs();
  const db = getDb();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(backupDir(), `northstar-${stamp}.db`);
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  const files = fs
    .readdirSync(backupDir())
    .filter((f) => f.startsWith("northstar-") && f.endsWith(".db"))
    .sort();
  while (files.length > BACKUP_RETENTION) {
    const old = files.shift()!;
    try {
      fs.unlinkSync(path.join(backupDir(), old));
    } catch {
      /* ignore */
    }
  }
  return dest;
}

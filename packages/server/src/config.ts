import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { DEFAULT_DAY_START_HOUR } from "@northstar/shared";

// Injected by tsup at build time from packages/server/package.json (falls back in tests).
declare const __NORTHSTAR_VERSION__: string;
export const VERSION = typeof __NORTHSTAR_VERSION__ !== "undefined" ? __NORTHSTAR_VERSION__ : "0.0.0";
/** Per-launch identity nonce, returned by /api/health (zombie/stale-server detection). */
export const NONCE = randomUUID();
export const STARTED_AT = Date.now();

const defaultDataDir = path.join(os.homedir(), "Library", "Application Support", "Northstar");

export function dataDir(): string {
  return process.env.NORTHSTAR_DATA_DIR || defaultDataDir;
}
export function dbPath(): string {
  return process.env.NORTHSTAR_DB_PATH || path.join(dataDir(), "northstar.db");
}
export function backupDir(): string {
  return path.join(dataDir(), "Backups");
}

export const DAY_START_HOUR = Number(
  process.env.NORTHSTAR_DAY_START_HOUR ?? DEFAULT_DAY_START_HOUR,
);
export const BACKUP_RETENTION = 7;

export function ensureDirs() {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.mkdirSync(backupDir(), { recursive: true });
}

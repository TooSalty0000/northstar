import { safeStorage } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { API_BASE } from "@northstar/shared";

interface Creds {
  siteUrl: string;
  email: string;
  token: string;
}

function dataDir() {
  return process.env.NORTHSTAR_DATA_DIR || path.join(os.homedir(), "Library", "Application Support", "Northstar");
}
function credFile() {
  return path.join(dataDir(), "jira-credentials.enc");
}

function loadAll(): Record<string, Creds> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return {};
    const buf = fs.readFileSync(credFile());
    return JSON.parse(safeStorage.decryptString(buf));
  } catch {
    return {};
  }
}
function persist(map: Record<string, Creds>) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(credFile(), safeStorage.encryptString(JSON.stringify(map)));
}

async function postSession(spaceId: string, creds: Creds) {
  const res = await fetch(`${API_BASE}/api/jira/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spaceId, ...creds }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}) as any);
    throw new Error(e.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** Validate creds against the server, then persist them encrypted (Keychain-backed). */
export async function connectJira(spaceId: string, creds: Creds) {
  const me = await postSession(spaceId, creds); // throws if invalid → not stored
  const map = loadAll();
  map[spaceId] = creds;
  persist(map);
  return { ok: true, accountId: me.accountId, displayName: me.displayName };
}

export async function disconnectJira(spaceId: string) {
  const map = loadAll();
  delete map[spaceId];
  persist(map);
  await fetch(`${API_BASE}/api/jira/links/${spaceId}`, { method: "DELETE" }).catch(() => {});
  return { ok: true };
}

/** Re-push all stored credentials into the (possibly restarted) server's memory. */
export async function restoreJiraSessions() {
  for (const [spaceId, creds] of Object.entries(loadAll())) {
    try {
      await postSession(spaceId, creds);
    } catch {
      /* server will reflect revoked/error; best effort */
    }
  }
}

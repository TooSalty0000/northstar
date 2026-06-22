import { app, shell, ipcMain, type BrowserWindow } from "electron";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";

const REPO = "TooSalty0000/northstar";
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const FIRST_CHECK_DELAY_MS = 8_000;

export interface UpdateInfo {
  version: string;
  tag: string;
  name: string;
  notes: string;
  url: string;
  zipUrl: string | null; // self-update artifact (null → fall back to Download link)
  publishedAt: string;
}

const normalize = (v: string) => v.trim().replace(/^v/i, "");

function semverCompare(a: string, b: string): number {
  const core = (s: string) => normalize(s).split(/[-+]/)[0];
  const pa = core(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = core(b).split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

let latest: UpdateInfo | null = null; // most recent available update (for download)
let stagedAppPath: string | null = null; // extracted, de-quarantined .app ready to swap

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(LATEST_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "northstar-app",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const rel = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      name?: string;
      body?: string;
      published_at?: string;
      draft?: boolean;
      prerelease?: boolean;
      assets?: Array<{ name: string; browser_download_url: string }>;
    };
    if (!rel.tag_name || rel.draft || rel.prerelease) return null;
    const v = normalize(rel.tag_name);
    if (semverCompare(v, app.getVersion()) <= 0) return null;
    const zip = (rel.assets ?? []).find((a) => /\.zip$/i.test(a.name) && !/blockmap/i.test(a.name));
    latest = {
      version: v,
      tag: rel.tag_name,
      name: rel.name || rel.tag_name,
      notes: rel.body || "",
      url: rel.html_url || `https://github.com/${REPO}/releases/latest`,
      zipUrl: zip?.browser_download_url ?? null,
      publishedAt: rel.published_at || "",
    };
    return latest;
  } catch {
    return null;
  }
}

/** The installed .app bundle (…/NORTHSTAR.app) derived from the running executable. */
function appBundlePath(): string {
  // process.execPath = …/NORTHSTAR.app/Contents/MacOS/NORTHSTAR
  return path.resolve(process.execPath, "..", "..", "..");
}

/** Download the update .zip, extract it, strip quarantine, stage the new .app. */
async function downloadUpdate(getWindow: () => BrowserWindow | null): Promise<{ ok: boolean; error?: string }> {
  if (!latest?.zipUrl) return { ok: false, error: "No downloadable build for this release." };
  const win = () => getWindow();
  const dir = path.join(app.getPath("temp"), "northstar-update");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const zipPath = path.join(dir, "update.zip");

  try {
    const res = await fetch(latest.zipUrl, { headers: { "User-Agent": "northstar-app" } });
    if (!res.ok || !res.body) return { ok: false, error: `Download failed (${res.status}).` };
    const total = Number(res.headers.get("content-length")) || 0;
    let received = 0;
    const out = createWriteStream(zipPath);
    for await (const chunk of Readable.fromWeb(res.body as any)) {
      out.write(chunk);
      received += (chunk as Buffer).length;
      if (total) win()?.webContents.send("update:progress", { percent: Math.round((received / total) * 100) });
    }
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));

    // extract with ditto (correct for .app zips); strip quarantine on the result
    const extractDir = path.join(dir, "extracted");
    execFileSync("ditto", ["-x", "-k", zipPath, extractDir]);
    const appName = readdirSync(extractDir).find((n) => n.endsWith(".app"));
    if (!appName) return { ok: false, error: "Update archive had no .app." };
    const staged = path.join(extractDir, appName);
    execFileSync("xattr", ["-dr", "com.apple.quarantine", staged]);
    stagedAppPath = staged;
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Download failed." };
  }
}

/** Replace the running app with the staged build and relaunch (via a detached script). */
function installUpdate(): { ok: boolean; error?: string } {
  if (!app.isPackaged) return { ok: false, error: "Updates only apply to the installed app." };
  if (!stagedAppPath || !existsSync(stagedAppPath)) return { ok: false, error: "No staged update — download first." };
  const target = appBundlePath();
  if (!target.endsWith(".app")) return { ok: false, error: "Could not locate the app bundle." };
  if (target.startsWith("/Volumes/")) {
    return { ok: false, error: "Move NORTHSTAR to /Applications before updating (it's running from a disk image)." };
  }
  try {
    // need to be able to replace the bundle in its parent dir
    execFileSync("test", ["-w", path.dirname(target)]);
  } catch {
    return { ok: false, error: `No write access to ${path.dirname(target)} — move the app to /Applications.` };
  }

  const script = path.join(app.getPath("temp"), "northstar-update", "swap.sh");
  writeFileSync(
    script,
    `#!/bin/bash
PID="$1"; TARGET="$2"; STAGED="$3"
for i in $(seq 1 150); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
sleep 0.6
rm -rf "$TARGET"
/usr/bin/ditto "$STAGED" "$TARGET" || cp -R "$STAGED" "$TARGET"
/usr/bin/xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
/usr/bin/open "$TARGET"
`,
  );
  chmodSync(script, 0o755);
  const child = spawn("/bin/bash", [script, String(process.pid), target, stagedAppPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  setTimeout(() => app.quit(), 200); // before-quit stops the sidecar, then we exit; script swaps + relaunches
  return { ok: true };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function initUpdater(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle("update:open", (_e, url: string) => {
    if (typeof url === "string" && url.startsWith(`https://github.com/${REPO}`)) {
      void shell.openExternal(url);
      return { ok: true };
    }
    return { ok: false };
  });
  ipcMain.handle("update:check", () => checkForUpdate());
  ipcMain.handle("update:download", () => downloadUpdate(getWindow));
  ipcMain.handle("update:install", () => installUpdate());

  const run = async () => {
    if (!app.isPackaged) return; // no banner in dev
    const info = await checkForUpdate();
    const win = getWindow();
    if (info && win && !win.isDestroyed()) win.webContents.send("update:available", info);
  };
  setTimeout(run, FIRST_CHECK_DELAY_MS);
  timer = setInterval(run, CHECK_INTERVAL_MS);
  app.on("before-quit", () => {
    if (timer) clearInterval(timer);
    timer = null;
  });
}

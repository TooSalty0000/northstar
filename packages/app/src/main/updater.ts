import { app, shell, ipcMain, type BrowserWindow } from "electron";

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

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(LATEST_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "northstar-app", // GitHub returns 403 without a UA
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
    };
    if (!rel.tag_name || rel.draft || rel.prerelease) return null;
    const latest = normalize(rel.tag_name);
    if (semverCompare(latest, app.getVersion()) <= 0) return null;
    return {
      version: latest,
      tag: rel.tag_name,
      name: rel.name || rel.tag_name,
      notes: rel.body || "",
      url: rel.html_url || `https://github.com/${REPO}/releases/latest`,
      publishedAt: rel.published_at || "",
    };
  } catch {
    return null; // offline / timeout / parse -> silent
  }
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

  const run = async () => {
    if (!app.isPackaged) return; // suppress banner in dev
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

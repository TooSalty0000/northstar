import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { MCP_URL } from "@northstar/shared";
import { ServerSupervisor } from "./supervisor";
import { createMainWindow, createHotfixWindow } from "./windows";
import { createTray, refreshTray } from "./tray";
import { addRepo, removeRepo } from "./repoSetup";
import { connectJira, disconnectJira, restoreJiraSessions } from "./jiraCredentials";
import { initUpdater } from "./updater";

const supervisor = new ServerSupervisor();
let mainWindow: BrowserWindow | null = null;
let hotfixWindow: BrowserWindow | null = null;
let isQuitting = false;

function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    wireMainWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function wireMainWindow() {
  mainWindow!.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow!.hide();
    }
  });
}

function openHotfix() {
  if (hotfixWindow && !hotfixWindow.isDestroyed()) {
    hotfixWindow.show();
    hotfixWindow.focus();
    return;
  }
  hotfixWindow = createHotfixWindow();
  hotfixWindow.on("closed", () => (hotfixWindow = null));
}

async function testConnection(): Promise<{ ok: boolean; status: number; detail?: string }> {
  try {
    // Intentionally send Accept: application/json only — exercises the 406 fix path
    // exactly as a real Claude Code client would.
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "northstar-selftest", version: "1" } },
      }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err: any) {
    return { ok: false, status: 0, detail: err?.message ?? "unreachable" };
  }
}

let restoreTimer: NodeJS.Timeout | null = null;
function scheduleJiraRestore() {
  // server just (re)started — give it a moment to bind, then re-push Jira sessions
  if (restoreTimer) clearTimeout(restoreTimer);
  restoreTimer = setTimeout(() => restoreJiraSessions().catch(() => {}), 2000);
}

function broadcastStatus(status: string) {
  refreshTray();
  if (status === "running") scheduleJiraRestore();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("server:status", status);
  }
}

app.whenReady().then(() => {
  app.dock?.hide(); // LSUIElement-style menu-bar agent

  supervisor.on("status", broadcastStatus);
  supervisor.on("fatal", async (err: Error) => {
    const { dialog } = await import("electron");
    dialog.showErrorBox("Northstar server failed", String(err?.message ?? err));
  });
  supervisor.start();

  mainWindow = createMainWindow();
  wireMainWindow();
  initUpdater(() => mainWindow); // in-app "update available" notifier (packaged only)

  createTray({
    onOpen: showMain,
    onHotfix: openHotfix,
    onTestConnection: async () => {
      const r = await testConnection();
      const { dialog } = await import("electron");
      await dialog.showMessageBox({
        type: r.ok ? "info" : "warning",
        title: "Claude connection test",
        message: r.ok ? "Northstar is reachable by Claude ✓" : "Northstar is NOT reachable ✗",
        detail: r.ok
          ? `MCP endpoint responded 200 at ${MCP_URL}`
          : `Could not reach ${MCP_URL} (status ${r.status}${r.detail ? `: ${r.detail}` : ""}). Is the server running?`,
      });
    },
    onAddRepo: () => void addRepo(),
    onQuit: () => app.quit(),
    getStatus: () => supervisor.status,
  });

  globalShortcut.register("Alt+Command+N", openHotfix);

  // ---- IPC ----
  ipcMain.handle("server:status", () => supervisor.status);
  ipcMain.handle("server:test-connection", () => testConnection());
  ipcMain.handle("repo:add", (_e, spaceId?: string) => addRepo(spaceId));
  ipcMain.handle("repo:remove", (_e, repo: { id: string; path: string; name: string }) => removeRepo(repo));
  ipcMain.handle("jira:connect", (_e, spaceId: string, creds: { siteUrl: string; email: string; token: string }) =>
    connectJira(spaceId, creds).catch((err) => ({ ok: false, error: err?.message ?? "connect failed" })),
  );
  ipcMain.handle("jira:disconnect", (_e, spaceId: string) => disconnectJira(spaceId));
  ipcMain.on("hotfix:close", () => {
    if (hotfixWindow && !hotfixWindow.isDestroyed()) hotfixWindow.close();
  });

  app.on("activate", () => showMain());
});

// On macOS, closing the window must NOT quit (the server keeps running).
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (e) => {
  if (isQuitting) return;
  e.preventDefault();
  isQuitting = true;
  globalShortcut.unregisterAll();
  supervisor.stop().finally(() => app.quit());
});

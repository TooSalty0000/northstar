import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { resolveMcpUrl } from "@northstar/shared";
const MCP_URL = resolveMcpUrl();
import { ServerSupervisor } from "./supervisor";
import { createMainWindow, createHotfixWindow } from "./windows";
import { createTray, refreshTray } from "./tray";
import { addRepo, removeRepo } from "./repoSetup";
import { connectJira, disconnectJira, restoreJiraSessions } from "./jiraCredentials";
import { initUpdater } from "./updater";
import { getCloseAction, setCloseAction } from "./prefs";

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
    if (isQuitting) return; // a real quit is already underway — let it close
    e.preventDefault();
    void handleWindowClose();
  });
}

/**
 * On window close, ask whether to keep the background server running (hide to the menu
 * bar) or quit entirely. Honors a remembered choice; quitting tears down the server.
 */
async function handleWindowClose() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const pref = getCloseAction();
  if (pref === "hide") return mainWindow.hide();
  if (pref === "quit") return app.quit();

  const { dialog } = await import("electron");
  const { response, checkboxChecked } = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["Hide to menu bar", "Quit Northstar", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    title: "Close Northstar",
    message: "Hide the window, or quit completely?",
    detail:
      "Hide to menu bar keeps the background server running so Claude can keep logging your work. " +
      "Quit Northstar stops the server too — Claude won't be able to reach it until you reopen the app.",
    checkboxLabel: "Remember my choice",
    checkboxChecked: false,
  });

  if (response === 2) return; // Cancel — stay open
  const action = response === 1 ? "quit" : "hide";
  if (checkboxChecked) setCloseAction(action);
  if (action === "quit") app.quit();
  else mainWindow.hide();
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

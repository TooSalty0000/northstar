import { BrowserWindow } from "electron";
import path from "node:path";

const preload = () => path.join(__dirname, "../preload/index.js");

function loadRoute(win: BrowserWindow, hash = "") {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    win.loadURL(devUrl + (hash ? `#${hash}` : ""));
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"), hash ? { hash } : undefined);
  }
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 920,
    minHeight: 620,
    title: "Northstar",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0d1117",
    show: false,
    webPreferences: {
      preload: preload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  loadRoute(win);
  return win;
}

export function createHotfixWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 460,
    height: 250,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    title: "Log hotfix",
    backgroundColor: "#0d1117",
    show: false,
    webPreferences: {
      preload: preload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.on("blur", () => win.close());
  loadRoute(win, "hotfix");
  return win;
}

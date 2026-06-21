import { Tray, Menu, nativeImage, type MenuItemConstructorOptions } from "electron";
import type { ServerStatus } from "@northstar/shared";

// Menu-bar glyphs by status (avoids shipping icon assets; macOS renders the title).
const GLYPH: Record<ServerStatus, string> = {
  starting: "✧",
  running: "✦",
  paused: "✧",
  crashed: "⚠",
};

const STATUS_LABEL: Record<ServerStatus, string> = {
  starting: "Starting…",
  running: "Running",
  paused: "Paused",
  crashed: "Crashed — restarting…",
};

export interface TrayHandlers {
  onOpen: () => void;
  onHotfix: () => void;
  onTestConnection: () => void;
  onAddRepo: () => void;
  onQuit: () => void;
  getStatus: () => ServerStatus;
}

let tray: Tray | null = null;
let handlers: TrayHandlers | null = null;

export function createTray(h: TrayHandlers) {
  handlers = h;
  tray = new Tray(nativeImage.createEmpty());
  refreshTray();
}

export function refreshTray() {
  if (!tray || !handlers) return;
  const status = handlers.getStatus();
  tray.setTitle(` ${GLYPH[status]}`);
  tray.setToolTip(`Northstar — server ${STATUS_LABEL[status]}`);
  const template: MenuItemConstructorOptions[] = [
    { label: `Server: ${STATUS_LABEL[status]}`, enabled: false },
    { type: "separator" },
    { label: "Open Northstar", click: () => handlers!.onOpen() },
    { label: "Log hotfix…", accelerator: "Alt+Command+N", click: () => handlers!.onHotfix() },
    { type: "separator" },
    { label: "Test Claude connection", click: () => handlers!.onTestConnection() },
    { label: "Add repo to Northstar…", click: () => handlers!.onAddRepo() },
    { type: "separator" },
    { label: "Quit Northstar", click: () => handlers!.onQuit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

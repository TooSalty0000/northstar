import { contextBridge, ipcRenderer } from "electron";
import { resolveApiBase } from "@northstar/shared";
import type { ServerStatus } from "@northstar/shared";

const api = {
  apiBase: resolveApiBase(),
  /** Is this window the compact hotfix capture window? */
  isHotfixWindow: () => location.hash.includes("hotfix"),
  getServerStatus: (): Promise<ServerStatus> => ipcRenderer.invoke("server:status"),
  onServerStatus: (cb: (s: ServerStatus) => void) => {
    const handler = (_e: unknown, s: ServerStatus) => cb(s);
    ipcRenderer.on("server:status", handler);
    return () => ipcRenderer.removeListener("server:status", handler);
  },
  testConnection: (): Promise<{ ok: boolean; status: number; detail?: string }> =>
    ipcRenderer.invoke("server:test-connection"),
  addRepo: (spaceId?: string): Promise<{ ok: boolean; dir?: string; error?: string }> =>
    ipcRenderer.invoke("repo:add", spaceId),
  removeRepo: (repo: { id: string; path: string; name: string }): Promise<{ ok: boolean; deletedFiles?: boolean }> =>
    ipcRenderer.invoke("repo:remove", repo),
  jiraConnect: (
    spaceId: string,
    creds: { siteUrl: string; email: string; token: string },
  ): Promise<{ ok: boolean; accountId?: string; displayName?: string; error?: string }> =>
    ipcRenderer.invoke("jira:connect", spaceId, creds),
  jiraDisconnect: (spaceId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("jira:disconnect", spaceId),
  checkForUpdate: (): Promise<{ current: string; update: unknown | null }> =>
    ipcRenderer.invoke("update:check"),
  onUpdateAvailable: (cb: (info: unknown) => void) => {
    const handler = (_e: unknown, info: unknown) => cb(info);
    ipcRenderer.on("update:available", handler);
    return () => ipcRenderer.removeListener("update:available", handler);
  },
  openUpdateUrl: (url: string) => ipcRenderer.invoke("update:open", url),
  downloadUpdate: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("update:download"),
  installUpdate: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("update:install"),
  onUpdateProgress: (cb: (p: { percent: number; received?: number; total?: number }) => void) => {
    const handler = (_e: unknown, p: { percent: number; received?: number; total?: number }) => cb(p);
    ipcRenderer.on("update:progress", handler);
    return () => ipcRenderer.removeListener("update:progress", handler);
  },
  closeHotfix: () => ipcRenderer.send("hotfix:close"),
  navigate: (cb: (route: string) => void) => {
    const handler = (_e: unknown, route: string) => cb(route);
    ipcRenderer.on("navigate", handler);
    return () => ipcRenderer.removeListener("navigate", handler);
  },
};

contextBridge.exposeInMainWorld("northstar", api);

export type NorthstarBridge = typeof api;

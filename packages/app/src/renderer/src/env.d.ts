/// <reference types="vite/client" />
import type { ServerStatus } from "@northstar/shared";

declare global {
  interface Window {
    northstar?: {
      apiBase: string;
      isHotfixWindow: () => boolean;
      getServerStatus: () => Promise<ServerStatus>;
      onServerStatus: (cb: (s: ServerStatus) => void) => () => void;
      testConnection: () => Promise<{ ok: boolean; status: number; detail?: string }>;
      addRepo: (spaceId?: string) => Promise<{ ok: boolean; dir?: string; error?: string }>;
      removeRepo: (repo: { id: string; path: string; name: string }) => Promise<{ ok: boolean; deletedFiles?: boolean }>;
      jiraConnect: (
        spaceId: string,
        creds: { siteUrl: string; email: string; token: string },
      ) => Promise<{ ok: boolean; accountId?: string; displayName?: string; error?: string }>;
      jiraDisconnect: (spaceId: string) => Promise<{ ok: boolean }>;
      closeHotfix: () => void;
      navigate: (cb: (route: string) => void) => () => void;
    };
  }
}

export {};

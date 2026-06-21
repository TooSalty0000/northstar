import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { ServerStatus } from "@northstar/shared";

/**
 * Spawns and supervises the plain-Node northstar-server as a child process.
 *
 * Design rules (spec §7.3):
 *  - Real `node` binary, never Electron's runtime (better-sqlite3 ABI safety).
 *  - Anti-orphan: the server polls its parent pid; if Electron dies — even via
 *    SIGKILL — the server is reparented (ppid → 1) and shuts itself down. No orphans.
 *  - Graceful quit: before-quit SIGTERMs the child (escalates to SIGKILL after 3s).
 *  - Crash → restart with backoff.
 */
export class ServerSupervisor extends EventEmitter {
  private child: ChildProcess | null = null;
  private restarts = 0;
  private stopping = false;
  private stableTimer: NodeJS.Timeout | null = null;
  private devReload = false;
  private devDebounce: NodeJS.Timeout | null = null;
  private watching = false;
  status: ServerStatus = "starting";

  start() {
    this.stopping = false;
    this.spawnChild();
    this.watchDevBundle();
  }

  /** Dev only: restart the server child when its bundle is rebuilt (tsup --watch). */
  private watchDevBundle() {
    if (app.isPackaged || this.watching) return;
    const dir = path.dirname(this.serverEntry());
    try {
      fs.watch(dir, (_e, fname) => {
        if (fname !== "index.mjs") return;
        if (this.devDebounce) clearTimeout(this.devDebounce);
        this.devDebounce = setTimeout(() => {
          if (this.child) {
            this.devReload = true;
            this.child.kill("SIGTERM");
          }
        }, 300);
      });
      this.watching = true;
    } catch {
      /* watching is best-effort */
    }
  }

  private serverEntry(): string {
    if (app.isPackaged) return path.join(process.resourcesPath, "server", "index.mjs");
    if (process.env.NORTHSTAR_SERVER_ENTRY) return process.env.NORTHSTAR_SERVER_ENTRY;
    // dev: app root is packages/app → server bundle is packages/server/dist/index.mjs
    return path.resolve(app.getAppPath(), "..", "server", "dist", "index.mjs");
  }

  private nodeBin(): string {
    if (app.isPackaged) return path.join(process.resourcesPath, "node", "bin", "node");
    return process.env.NORTHSTAR_NODE || "node";
  }

  private spawnChild() {
    const entry = this.serverEntry();
    const node = this.nodeBin();
    this.setStatus("starting");

    const child = spawn(node, [entry], {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env },
      // detached: false → child stays in our process group; combined with the
      // server's own parent-pid poll, this guarantees no orphan survives us.
      detached: false,
    });
    this.child = child;

    child.on("spawn", () => {
      // consider the process "stable" after 3s, then reset the backoff counter
      this.stableTimer = setTimeout(() => (this.restarts = 0), 3000);
      this.setStatus("running");
    });

    child.on("exit", (code, signal) => {
      this.child = null;
      if (this.stableTimer) clearTimeout(this.stableTimer);
      if (this.stopping) {
        this.setStatus("paused");
        return;
      }
      if (this.devReload) {
        this.devReload = false;
        this.setStatus("starting");
        setTimeout(() => {
          if (!this.stopping) this.spawnChild();
        }, 250);
        return;
      }
      this.setStatus("crashed");
      const delay = Math.min(1500 * (this.restarts + 1), 8000);
      this.restarts++;
      console.warn(`[supervisor] server exited (code=${code} signal=${signal}); restarting in ${delay}ms`);
      setTimeout(() => {
        if (!this.stopping) this.spawnChild();
      }, delay);
    });

    child.on("error", (err) => {
      console.error("[supervisor] failed to spawn server:", err);
      this.setStatus("crashed");
    });
  }

  /** Graceful stop: SIGTERM, escalate to SIGKILL after 3s. */
  stop(): Promise<void> {
    this.stopping = true;
    return new Promise((resolve) => {
      const c = this.child;
      if (!c) {
        this.setStatus("paused");
        resolve();
        return;
      }
      const kill = setTimeout(() => {
        try {
          c.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        resolve();
      }, 3000);
      c.once("exit", () => {
        clearTimeout(kill);
        this.setStatus("paused");
        resolve();
      });
      try {
        c.kill("SIGTERM");
      } catch {
        clearTimeout(kill);
        resolve();
      }
    });
  }

  private setStatus(s: ServerStatus) {
    if (this.status === s) return;
    this.status = s;
    this.emit("status", s);
  }
}

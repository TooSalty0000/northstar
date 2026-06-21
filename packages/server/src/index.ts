import http from "node:http";
import { NORTHSTAR_HOST, NORTHSTAR_PORT } from "@northstar/shared";
import { NONCE, VERSION } from "./config";
import { createApp } from "./api";
import { backup, closeDb, getDb } from "./db";
import { pullAllConnected } from "./jira/sync";

let server: http.Server | null = null;
let backupTimer: NodeJS.Timeout | null = null;
let jiraTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (backupTimer) clearInterval(backupTimer);
  if (jiraTimer) clearInterval(jiraTimer);
  try {
    backup();
  } catch {
    /* best effort */
  }
  const done = () => {
    closeDb();
    process.exit(code);
  };
  if (server) server.close(done);
  else done();
  // hard stop if close hangs
  setTimeout(done, 2000).unref();
}

/**
 * If the parent (Electron tray) dies, we must not become an orphan holding the port.
 * Primary mechanism: poll our parent pid. When the parent dies the OS reparents us
 * (ppid → 1 on macOS/Linux), so a changed ppid means "parent gone → shut down".
 * This is robust against the fd-inheritance quirks that broke the earlier death-pipe.
 */
function watchParentDeath() {
  const initialPpid = process.ppid;
  if (!initialPpid || initialPpid <= 1) return; // launched standalone (e.g. tests/dev server)
  const timer = setInterval(() => {
    if (process.ppid !== initialPpid || process.ppid <= 1) shutdown(0);
  }, 1000);
  timer.unref();
}

async function probeExisting(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: NORTHSTAR_HOST, port: NORTHSTAR_PORT, path: "/api/health", timeout: 1000 },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body).status === "ok");
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function main() {
  getDb(); // open + migrate + integrity check (throws on corruption)
  const app = createApp();
  server = http.createServer(app);

  server.on("error", async (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      const alive = await probeExisting();
      console.error(
        alive
          ? `[northstar-server] port ${NORTHSTAR_PORT} already serves a live Northstar — exiting.`
          : `[northstar-server] port ${NORTHSTAR_PORT} busy by a non-Northstar/stale process — exiting.`,
      );
      process.exit(alive ? 0 : 1);
    } else {
      console.error("[northstar-server] fatal:", err);
      process.exit(1);
    }
  });

  server.listen(NORTHSTAR_PORT, NORTHSTAR_HOST, () => {
    console.log(`[northstar-server] v${VERSION} listening on http://${NORTHSTAR_HOST}:${NORTHSTAR_PORT} (nonce ${NONCE.slice(0, 8)})`);
  });

  // nightly-ish backup (every 6h) + on shutdown
  backupTimer = setInterval(() => {
    try {
      backup();
    } catch {
      /* ignore */
    }
  }, 6 * 60 * 60 * 1000);
  backupTimer.unref();

  // auto-pull connected Jira spaces (manual "Pull now" also exists)
  jiraTimer = setInterval(() => {
    pullAllConnected().catch(() => {});
  }, 5 * 60 * 1000);
  jiraTimer.unref();

  watchParentDeath();
  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));
}

main();

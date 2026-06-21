import express, { type NextFunction, type Request, type Response } from "express";
import { NORTHSTAR_HOST, resolvePort } from "@northstar/shared";

const PORT = resolvePort();
import { NONCE, STARTED_AT, VERSION } from "./config";
import { handleMcp } from "./mcp";
import * as store from "./store/tasks";
import * as reports from "./store/reports";
import * as spaces from "./store/spaces";
import * as repos from "./store/repos";
import * as jiraSync from "./jira/sync";
import * as jiraLinks from "./jira/links";
import { logicalLocalDate } from "./time";

/** Read the ?space= filter; treat missing or "all" as no filter. */
function spaceParam(req: Request): string | undefined {
  const s = req.query.space as string | undefined;
  return s && s !== "all" ? s : undefined;
}

const ALLOWED_HOSTS = new Set([
  `${NORTHSTAR_HOST}:${PORT}`,
  `localhost:${PORT}`,
]);

// DNS-rebinding guard: only accept requests whose Host targets our loopback endpoint.
function hostGuard(req: Request, res: Response, next: NextFunction) {
  const host = req.headers.host ?? "";
  if (!ALLOWED_HOSTS.has(host)) {
    res.status(403).json({ error: "forbidden host" });
    return;
  }
  next();
}

// Permissive CORS for the loopback UI (renderer runs on a different origin in dev).
function cors(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}

// SDK #1944 workaround: the Streamable HTTP transport rejects (406) clients that
// send `Accept: application/json` alone. The node transport rebuilds the request
// from `req.rawHeaders` (via Hono's getRequestListener), so mutating req.headers
// is NOT enough — we must rewrite rawHeaders as well.
const WANT_ACCEPT = "application/json, text/event-stream";
function normalizeAccept(req: Request, _res: Response, next: NextFunction) {
  req.headers["accept"] = WANT_ACCEPT;
  const raw = req.rawHeaders;
  let found = false;
  for (let i = 0; i < raw.length; i += 2) {
    if (raw[i]?.toLowerCase() === "accept") {
      raw[i + 1] = WANT_ACCEPT;
      found = true;
    }
  }
  if (!found) raw.push("Accept", WANT_ACCEPT);
  next();
}

const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response) => {
  try {
    const out = fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (err: any) {
    if (!res.headersSent) res.status(400).json({ error: err?.message ?? "error" });
  }
};

const wrapAsync =
  (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (err: any) {
      const status = typeof err?.status === "number" && err.status >= 400 ? err.status : 400;
      if (!res.headersSent) res.status(status).json({ error: err?.message ?? "error", kind: err?.kind });
    }
  };

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(hostGuard);

  // ---- MCP (for Claude) ----
  app.post("/mcp", normalizeAccept, handleMcp);
  app.get("/mcp", normalizeAccept, handleMcp);
  app.delete("/mcp", normalizeAccept, handleMcp);

  // ---- UI REST ----
  const api = express.Router();
  api.use(cors);

  api.get("/health", (_req, res) => {
    res.json({ status: "ok", version: VERSION, uptimeMs: Date.now() - STARTED_AT, nonce: NONCE });
  });

  api.get("/today", wrap((req) => reports.getToday(spaceParam(req))));

  api.get(
    "/tasks",
    wrap((req) =>
      store.listTasks({
        status: req.query.status as any,
        repo: req.query.repo as string | undefined,
        query: req.query.query as string | undefined,
        spaceId: spaceParam(req),
        includeArchived: req.query.includeArchived === "true",
      }),
    ),
  );
  api.get("/tasks/:id", wrap((req) => store.getTask(req.params.id) ?? { error: "not found" }));
  api.post("/tasks", wrap((req) => store.createTask({ ...req.body, actor: "user" })));
  api.patch("/tasks/:id", wrap((req) => store.updateTask(req.params.id, req.body)));
  api.delete("/tasks/:id", wrap((req) => {
    store.archiveTask(req.params.id, "user");
    return { ok: true };
  }));

  api.post("/tasks/:id/status", wrap((req) => store.setStatus(req.params.id, req.body.status, "user")));
  api.post("/tasks/:id/focus", wrap((req) => store.focusTask(req.params.id, true, "user")));
  api.delete("/tasks/:id/focus", wrap((req) => store.focusTask(req.params.id, false, "user")));

  api.post("/tasks/:id/subtasks", wrap((req) => store.addSubtask(req.params.id, req.body.title, "user")));
  api.patch(
    "/tasks/:id/subtasks/:sid",
    wrap((req) => {
      if (req.body.done === true) return store.checkSubtask(req.params.id, req.params.sid, "user");
      if (req.body.done === false) return store.uncheckSubtask(req.params.id, req.params.sid, "user");
      return store.getTask(req.params.id);
    }),
  );
  api.delete("/tasks/:id/subtasks/:sid", wrap((req) => store.deleteSubtask(req.params.id, req.params.sid)));

  api.post("/hotfix", wrap((req) => store.logHotfix({ ...req.body, actor: "user" })));

  api.get("/report", wrap((req) => reports.getReport((req.query.date as string) || logicalLocalDate(), spaceParam(req))));

  api.get("/stats", wrap((req) => {
    const to = (req.query.to as string) || logicalLocalDate();
    const from = (req.query.from as string) || defaultFrom(to, 29);
    return reports.getStats(from, to, spaceParam(req));
  }));

  api.get("/connections", wrap(() => reports.getConnections()));
  api.get("/activity", wrap((req) => reports.activitySince(Number(req.query.since ?? 0))));

  // ---- End Day ritual ----
  api.post("/day/end", wrap((req) => reports.endDay((req.body?.date as string) || undefined)));
  api.post("/day/cancel", wrap((req) => reports.cancelDay((req.body?.date as string) || undefined)));

  // ---- Spaces ----
  api.get("/spaces", wrap(() => spaces.listSpaces()));
  api.post("/spaces", wrap((req) => spaces.createSpace(req.body)));
  api.patch("/spaces/:id", wrap((req) => spaces.updateSpace(req.params.id, req.body)));
  api.delete("/spaces/:id", wrap((req) => spaces.deleteSpace(req.params.id)));

  // ---- Repo registry ----
  api.get("/repos", wrap((req) => repos.listRepos(spaceParam(req))));
  api.post("/repos", wrap((req) => repos.addRepo(req.body)));
  api.delete("/repos/:id", wrap((req) => repos.removeRepo(req.params.id)));

  // ---- Jira ----
  // Credentials arrive here (loopback-only) from Electron main, held in memory only.
  api.post(
    "/jira/session",
    wrapAsync(async (req) => {
      const { spaceId, siteUrl, email, token } = req.body ?? {};
      const creds = { siteUrl, email, token };
      const me = await jiraSync.validate(creds);
      jiraLinks.setSession(spaceId, creds);
      return { accountId: me.accountId, displayName: me.displayName };
    }),
  );
  api.get("/jira/links", wrap(() => jiraLinks.listLinks()));
  api.get("/jira/link", wrap((req) => jiraLinks.getLink(req.query.space as string) ?? { error: "no link" }));
  api.post(
    "/jira/links",
    wrapAsync(async (req) => {
      const link = jiraLinks.upsertLink(req.body);
      void jiraSync.resolveIssueType(req.body.spaceId); // best-effort, for push-create
      return link;
    }),
  );
  api.delete("/jira/links/:spaceId", wrap((req) => {
    jiraLinks.deleteLink(req.params.spaceId);
    return { ok: true };
  }));
  api.get("/jira/projects", wrapAsync((req) => jiraSync.listProjects(req.query.space as string)));
  api.get("/jira/statuses", wrapAsync((req) => jiraSync.listStatuses(req.query.space as string, req.query.projectKey as string)));
  api.get("/jira/boards", wrapAsync((req) => jiraSync.listBoards(req.query.space as string, req.query.projectKeyOrId as string)));
  api.post("/jira/pull", wrapAsync((req) => jiraSync.pull(req.body.spaceId, req.body.sprintOnly)));
  api.post("/jira/push-local", wrapAsync((req) => jiraSync.pushLocalTasks(req.body.spaceId)));

  app.use("/api", api);
  return app;
}

function defaultFrom(toLocal: string, daysBack: number): string {
  const [y, m, d] = toLocal.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - daysBack);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

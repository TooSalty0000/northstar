import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { TASK_STATUSES } from "@northstar/shared";
import { VERSION } from "./config";
import * as store from "./store/tasks";

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });

function buildServer(): McpServer {
  const server = new McpServer({ name: "northstar", version: VERSION });

  server.registerTool(
    "northstar_create_task",
    {
      title: "Create task",
      description:
        "Create a Northstar task at the start of a multi-step unit of work. Optionally seed the checklist and pin it to today. Use list_tasks first to avoid duplicates.",
      inputSchema: {
        title: z.string().describe("Short imperative title of the work"),
        description: z.string().optional(),
        repo: z.string().optional().describe("Originating work repo name"),
        subtasks: z.array(z.string()).optional().describe("Initial checklist steps"),
        focusToday: z.boolean().optional().describe("Pin to today's focus"),
      },
    },
    async (args) => {
      const t = store.createTask({ ...args, actor: "claude", dedupe: true });
      // Return subtask IDs (not just a count) so they can be checked off without a re-fetch.
      return ok({
        id: t.id,
        title: t.title,
        status: t.status,
        subtasks: (t.subtasks ?? []).map((s) => ({ id: s.id, title: s.title, done: s.done })),
      });
    },
  );

  server.registerTool(
    "northstar_get_task",
    {
      title: "Get task",
      description:
        "Fetch one task with its full subtask checklist INCLUDING subtask ids. Call this to get the ids needed for check_subtask when resuming work you didn't create this session (list_tasks omits them).",
      inputSchema: { taskId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const t = store.getTask(args.taskId);
      if (!t) return ok({ error: "not found" });
      return ok({
        id: t.id,
        title: t.title,
        status: t.status,
        pct: t.pct,
        done: t.doneCount,
        total: t.total,
        subtasks: (t.subtasks ?? []).map((s) => ({ id: s.id, title: s.title, done: s.done })),
      });
    },
  );

  server.registerTool(
    "northstar_add_subtask",
    {
      title: "Add subtask",
      description: "Append a checklist step to an existing task.",
      inputSchema: {
        taskId: z.string(),
        title: z.string(),
        position: z.number().int().optional(),
      },
    },
    async (args) => {
      const s = store.addSubtask(args.taskId, args.title, "claude", args.position);
      return ok({ id: s.id, taskId: s.taskId, title: s.title });
    },
  );

  server.registerTool(
    "northstar_check_subtask",
    {
      title: "Check subtask",
      description: "Mark a checklist step done the moment you complete it. Idempotent.",
      inputSchema: { taskId: z.string(), subtaskId: z.string() },
      annotations: { idempotentHint: true },
    },
    async (args) => {
      const t = store.checkSubtask(args.taskId, args.subtaskId, "claude");
      if (!t) return ok({ error: "not found" });
      return ok({ id: t.id, pct: t.pct, done: t.doneCount, total: t.total });
    },
  );

  server.registerTool(
    "northstar_set_status",
    {
      title: "Set status",
      description:
        "Move a task across the workflow: todo → in_progress → in_review → done. Moving to in_progress auto-focuses it for today.",
      inputSchema: { taskId: z.string(), status: z.enum(TASK_STATUSES as [string, ...string[]]) },
      annotations: { idempotentHint: true },
    },
    async (args) => {
      const t = store.setStatus(args.taskId, args.status as any, "claude");
      if (!t) return ok({ error: "not found" });
      return ok({ id: t.id, status: t.status });
    },
  );

  server.registerTool(
    "northstar_log_hotfix",
    {
      title: "Log hotfix",
      description:
        "Record unplanned urgent work as an already-completed accomplishment, then return to your task.",
      inputSchema: {
        title: z.string(),
        description: z.string().optional(),
        repo: z.string().optional(),
        relatedTaskId: z.string().optional(),
      },
    },
    async (args) => {
      const t = store.logHotfix({ ...args, actor: "claude" });
      return ok({ id: t.id, title: t.title });
    },
  );

  server.registerTool(
    "northstar_list_tasks",
    {
      title: "List tasks",
      description:
        "Read-only list/lookup of tasks (id, title, status, pct). Pass query to dedupe before creating a new task. Subtask ids are NOT included here — call get_task for a task's checklist ids.",
      inputSchema: {
        status: z.enum(TASK_STATUSES as [string, ...string[]]).optional(),
        repo: z.string().optional(),
        query: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const tasks = store.listTasks({ status: args.status as any, repo: args.repo, query: args.query });
      return ok(
        tasks.slice(0, 50).map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          pct: t.pct,
          repo: t.repo,
        })),
      );
    },
  );

  return server;
}

/** Stateless Streamable HTTP: a fresh server + transport per request, torn down on close. */
export async function handleMcp(req: Request, res: Response) {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  const cleanup = () => {
    try {
      transport.close();
    } catch {
      /* ignore */
    }
    try {
      server.close();
    } catch {
      /* ignore */
    }
  };
  res.on("close", cleanup);
  req.on("aborted", cleanup);
  transport.onerror = cleanup;

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    cleanup();
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  }
}

import http from "node:http";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _setTestDb, getDb } from "../src/db";
import { defaultSpaceId } from "../src/store/spaces";
import { createTask, listTasks } from "../src/store/tasks";
import * as jiraLinks from "../src/jira/links";
import * as jiraSync from "../src/jira/sync";
import { nowIso } from "../src/time";

let server: http.Server;
let port = 0;
const transitionsPosted: any[] = [];
const issuesPosted: any[] = [];
const sprintAdds: any[] = [];

const adf = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

beforeEach(async () => {
  _setTestDb();
  transitionsPosted.length = 0;
  issuesPosted.length = 0;
  sprintAdds.length = 0;
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (obj: any, code = 200) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      const url = req.url || "";
      const m = req.method;
      if (url.endsWith("/rest/api/3/myself")) return send({ accountId: "acc1", displayName: "Me" });
      if (url.includes("/rest/api/3/project/SANC/statuses"))
        return send([
          {
            statuses: [
              { id: "1", name: "To Do", statusCategory: { key: "new" } },
              { id: "3", name: "In Progress", statusCategory: { key: "indeterminate" } },
              { id: "100", name: "In Review", statusCategory: { key: "indeterminate" } },
              { id: "5", name: "Done", statusCategory: { key: "done" } },
            ],
          },
        ]);
      if (/\/rest\/api\/3\/project\/SANC(\?|$)/.test(url) && m === "GET")
        return send({ issueTypes: [{ id: "10001", name: "Task", subtask: false }, { id: "10002", name: "Sub-task", subtask: true }] });
      if (url.includes("/rest/api/3/search/jql") && m === "POST")
        return send({
          issues: [
            { id: "5001", key: "SANC-1", fields: { summary: "Do the thing", description: adf("a description"), status: { id: "3", statusCategory: { key: "indeterminate" } } } },
          ],
        });
      if (url.endsWith("/rest/api/3/issue") && m === "POST") {
        issuesPosted.push(JSON.parse(body || "{}"));
        return send({ id: "9001", key: "SANC-NEW" }, 201);
      }
      if (url.includes("/rest/api/3/issue/SANC-1/transitions") && m === "GET")
        return send({ transitions: [{ id: "21", to: { id: "5", statusCategory: { key: "done" } } }] });
      if (url.includes("/rest/api/3/issue/SANC-1/transitions") && m === "POST") {
        transitionsPosted.push(JSON.parse(body || "{}"));
        return send(null, 204);
      }
      if (url.includes("/rest/agile/1.0/board/") && url.includes("/sprint") && m === "GET")
        return send({ values: [{ id: 99, name: "Sprint 7" }] });
      if (url.includes("/rest/agile/1.0/board") && m === "GET")
        return send({ values: [{ id: 7, name: "Team Board", type: "simple" }] }); // team-managed → "simple"
      if (url.includes("/rest/agile/1.0/sprint/99/issue") && m === "POST") {
        sprintAdds.push(JSON.parse(body || "{}"));
        return send(null, 204);
      }
      send({ error: "not mocked: " + m + " " + url }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as any).port;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

/** Link with NO board/review — relying on self-heal — and open a session. */
function connect() {
  const spaceId = defaultSpaceId();
  const siteUrl = `http://127.0.0.1:${port}`;
  jiraLinks.upsertLink({ spaceId, siteUrl, email: "me@x.com", accountId: "acc1", projectKey: "SANC", projectId: "1" });
  jiraLinks.setSession(spaceId, { siteUrl, email: "me@x.com", token: "tok" });
  return spaceId;
}

describe("jira self-heal + pull", () => {
  it("auto-links the scrum board and resolves the review status on pull", async () => {
    const spaceId = connect();
    await jiraSync.pull(spaceId);
    const link = jiraLinks.getLink(spaceId)!;
    expect(link.boardId).toBe(7);
    expect(link.reviewStatusId).toBe("100");
    expect(link.issueTypeId).toBe("10001");
  });

  it("imports an assigned issue with ADF→text + status mapping", async () => {
    const spaceId = connect();
    const r = await jiraSync.pull(spaceId);
    expect(r.imported).toBe(1);
    const t = listTasks({ spaceId }).find((x) => x.externalId === "SANC-1")!;
    expect(t.title).toBe("Do the thing");
    expect(t.description).toBe("a description");
    expect(t.status).toBe("in_progress");
  });

  it("reconcile archives linked tasks that are no longer returned (done/closed sprint/gone)", async () => {
    const spaceId = connect();
    await jiraSync.pull(spaceId); // auto-links board → sprint mode
    const stale = randomUUID();
    const ts = nowIso();
    getDb()
      .prepare(
        `INSERT INTO tasks (id,title,status,space_id,created_at,updated_at,last_touched_at,external_provider,external_numeric_id,sync_state)
         VALUES (?,?,'done',?,?,?,?, 'jira', '88888', 'synced')`,
      )
      .run(stale, "old done task", spaceId, ts, ts, ts);
    const r = await jiraSync.pull(spaceId);
    expect(r.archived).toBe(1);
    expect((getDb().prepare(`SELECT archived FROM tasks WHERE id=?`).get(stale) as any).archived).toBe(1);
    expect(listTasks({ spaceId }).find((t) => t.externalId === "SANC-1")?.archived).toBe(false);
  });
});

describe("jira push-create + status echo", () => {
  it("creates a Jira issue for a task and links it (+ adds to active sprint)", async () => {
    const spaceId = defaultSpaceId();
    const siteUrl = `http://127.0.0.1:${port}`;
    jiraLinks.upsertLink({ spaceId, siteUrl, email: "me@x.com", accountId: "acc1", projectKey: "SANC", projectId: "1" });
    const task = createTask({ title: "New local task", description: "details", spaceId }); // disconnected → local
    expect((getDb().prepare(`SELECT external_id FROM tasks WHERE id=?`).get(task.id) as any).external_id).toBeNull();

    jiraLinks.setSession(spaceId, { siteUrl, email: "me@x.com", token: "tok" });
    await jiraSync.pull(spaceId); // self-heal: board 7 + issuetype
    await jiraSync.createIssueForTask(task.id);

    expect(issuesPosted.length).toBe(1);
    expect(issuesPosted[0].fields.summary).toBe("New local task");
    expect(issuesPosted[0].fields.issuetype).toEqual({ id: "10001" });
    expect(issuesPosted[0].fields.assignee).toEqual({ accountId: "acc1" });
    expect(sprintAdds[0]).toEqual({ issues: ["SANC-NEW"] });
    expect((getDb().prepare(`SELECT external_id FROM tasks WHERE id=?`).get(task.id) as any).external_id).toBe("SANC-NEW");
  });

  it("createTask auto-pushes when the Space is connected", async () => {
    const spaceId = connect();
    await jiraSync.pull(spaceId); // self-heal first
    createTask({ title: "auto push", spaceId });
    for (let i = 0; i < 100 && issuesPosted.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(issuesPosted.length).toBe(1);
    expect(issuesPosted[0].fields.summary).toBe("auto push");
  });

  it("stays local when not connected", async () => {
    const spaceId = defaultSpaceId();
    const task = createTask({ title: "offline", spaceId });
    await jiraSync.createIssueForTask(task.id);
    expect(issuesPosted.length).toBe(0);
  });

  it("pushStatus transitions a linked task on completion", async () => {
    const spaceId = connect();
    await jiraSync.pull(spaceId);
    const id = listTasks({ spaceId }).find((t) => t.externalId === "SANC-1")!.id;
    getDb().prepare(`UPDATE tasks SET status='done' WHERE id=?`).run(id);
    await jiraSync.pushStatus(id);
    expect(transitionsPosted[0]).toEqual({ transition: { id: "21" } });
  });
});

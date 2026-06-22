import { describe, it, expect, beforeEach } from "vitest";
import { _setTestDb } from "../src/db";
import * as store from "../src/store/tasks";
import * as spaces from "../src/store/spaces";
import * as repos from "../src/store/repos";
import { getToday } from "../src/store/reports";

beforeEach(() => {
  _setTestDb();
});

describe("spaces", () => {
  it("seeds exactly one default space on migration", () => {
    const all = spaces.listSpaces();
    expect(all.length).toBe(1);
    expect(all[0].isDefault).toBe(true);
    expect(all[0].name).toBe("Work");
  });

  it("isolates tasks and the Today view by space", () => {
    const work = spaces.defaultSpaceId();
    const labs = spaces.createSpace({ name: "Labs" }).id;
    store.createTask({ title: "work task", spaceId: work, focusToday: true });
    store.createTask({ title: "labs task", spaceId: labs, focusToday: true });

    expect(store.listTasks({ spaceId: work }).length).toBe(1);
    expect(store.listTasks({ spaceId: labs }).length).toBe(1);
    expect(store.listTasks().length).toBe(2); // unscoped = all

    expect(getToday(work).focusTasks.length).toBe(1);
    expect(getToday(labs).focusTasks.length).toBe(1);
    expect(getToday().focusTasks.length).toBe(2);
  });

  it("auto-files Claude's work into its repo's space", () => {
    const labs = spaces.createSpace({ name: "Labs" }).id;
    repos.addRepo({ path: "/x/research-x", name: "research-x", spaceId: labs });
    const t = store.createTask({ title: "from claude", repo: "research-x", actor: "claude" });
    expect(t.spaceId).toBe(labs);
  });

  it("falls back to the default space for unregistered repos", () => {
    const t = store.createTask({ title: "unknown repo", repo: "mystery", actor: "claude" });
    expect(t.spaceId).toBe(spaces.defaultSpaceId());
  });

  it("reassigns tasks to the default space when a space is deleted", () => {
    const labs = spaces.createSpace({ name: "Labs" }).id;
    const t = store.createTask({ title: "x", spaceId: labs });
    const res = spaces.deleteSpace(labs);
    expect(res.ok).toBe(true);
    expect(store.getTask(t.id)!.spaceId).toBe(spaces.defaultSpaceId());
  });

  it("refuses to delete the default space", () => {
    expect(spaces.deleteSpace(spaces.defaultSpaceId()).ok).toBe(false);
  });

  it("dedupe reuses an existing open task with an overlapping title", () => {
    const a = store.createTask({ title: "wikidata implementation" });
    const b = store.createTask({ title: "wikidata", dedupe: true }); // Claude/MCP path
    expect(b.id).toBe(a.id); // reused, not duplicated
    const c = store.createTask({ title: "wikidata" }); // UI path (no dedupe) still creates
    expect(c.id).not.toBe(a.id);
  });

  it("dedupe also reuses a recently-completed task (no duplicate todo)", () => {
    const a = store.createTask({ title: "web_search reads full page content" });
    store.setStatus(a.id, "done");
    const b = store.createTask({ title: "web_search reads full page content", dedupe: true });
    expect(b.id).toBe(a.id); // reused the just-done task instead of spawning a fresh todo
  });
});

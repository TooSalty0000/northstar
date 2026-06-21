import { describe, it, expect } from "vitest";
import {
  adfToText,
  buildPullJql,
  jiraStatusToNorthstar,
  northstarStatusTarget,
  transitionMatches,
} from "../src/jira/mapping";
import type { TaskStatus } from "@northstar/shared";

describe("jira ADF → text", () => {
  it("flattens a paragraph doc", () => {
    const adf = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
    };
    expect(adfToText(adf)).toBe("Hello world");
  });
  it("handles empty / string", () => {
    expect(adfToText(null)).toBe("");
    expect(adfToText("plain")).toBe("plain");
  });
});

describe("jira status mapping", () => {
  it("review status id wins over category", () => {
    expect(jiraStatusToNorthstar("100", "indeterminate", "100")).toBe("in_review");
  });
  it("maps by category otherwise", () => {
    expect(jiraStatusToNorthstar("1", "new", "100")).toBe("todo");
    expect(jiraStatusToNorthstar("3", "indeterminate", "100")).toBe("in_progress");
    expect(jiraStatusToNorthstar("5", "done", "100")).toBe("done");
  });
});

describe("round-trip stability (no status-flip loop)", () => {
  // Simulate a Jira workflow: ids per category + a dedicated review status.
  const reviewId = "100";
  const byCat: Record<string, { id: string; categoryKey: string }> = {
    new: { id: "1", categoryKey: "new" },
    indeterminate: { id: "3", categoryKey: "indeterminate" },
    done: { id: "5", categoryKey: "done" },
  };
  const statuses: TaskStatus[] = ["todo", "in_progress", "in_review", "done"];

  it("push then pull yields the same Northstar status", () => {
    for (const s of statuses) {
      const target = northstarStatusTarget(s, reviewId);
      // resolve the Jira status the transition lands on
      const dest = target.byId ? { id: target.byId, categoryKey: "indeterminate" } : byCat[target.byCategory!];
      expect(transitionMatches(dest, target)).toBe(true);
      const back = jiraStatusToNorthstar(dest.id, dest.categoryKey, reviewId);
      expect(back).toBe(s);
    }
  });

  it("without a configured review status, in_review degrades to in_progress (stable)", () => {
    const target = northstarStatusTarget("in_review", null);
    expect(target).toEqual({ byCategory: "indeterminate" });
    const back = jiraStatusToNorthstar("3", "indeterminate", null);
    expect(back).toBe("in_progress");
  });
});

describe("pull JQL", () => {
  it("sprint mode = whole active sprint (all assignees)", () => {
    expect(buildPullJql("SANC", "sprint")).toBe('project = "SANC" AND sprint in openSprints() ORDER BY updated DESC');
  });
  it("open mode scopes to not-done work", () => {
    expect(buildPullJql("SANC", "open")).toContain("statusCategory != Done");
  });
  it("does not filter by assignee (mirrors the team board)", () => {
    expect(buildPullJql("SANC", "sprint")).not.toContain("currentUser");
  });
});

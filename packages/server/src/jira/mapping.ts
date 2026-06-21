import type { TaskStatus } from "@northstar/shared";

/** Flatten an Atlassian Document Format (ADF) body to plain text (read path only). */
export function adfToText(adf: unknown): string {
  if (!adf) return "";
  if (typeof adf === "string") return adf;
  const out: string[] = [];
  const walk = (n: any) => {
    if (!n) return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.type === "text" && typeof n.text === "string") out.push(n.text);
    if (n.type === "hardBreak") out.push("\n");
    if (n.content) walk(n.content);
    if (n.type === "paragraph") out.push("\n");
  };
  walk((adf as any).content ?? adf);
  return out.join("").replace(/\n{3,}/g, "\n\n").trim();
}

/** Wrap plain text into a minimal ADF document (for push-create). */
export function textToADF(text: string): unknown {
  const content = (text || "")
    .split("\n")
    .map((line) =>
      line.length
        ? { type: "paragraph", content: [{ type: "text", text: line }] }
        : { type: "paragraph" },
    );
  return { type: "doc", version: 1, content: content.length ? content : [{ type: "paragraph" }] };
}

/**
 * Jira status → Northstar status. Jira only guarantees 3 category keys
 * (new / indeterminate / done); the in_review status is resolved once at connect
 * time to a concrete id, so we key off that id (never a name regex).
 */
export function jiraStatusToNorthstar(
  statusId: string,
  categoryKey: string,
  reviewStatusId: string | null,
): TaskStatus {
  if (reviewStatusId && statusId === reviewStatusId) return "in_review";
  switch (categoryKey) {
    case "new":
      return "todo";
    case "indeterminate":
      return "in_progress";
    case "done":
      return "done";
    default:
      return "todo";
  }
}

export type PushTarget = { byId?: string; byCategory?: "new" | "indeterminate" | "done" };

/** Which Jira status should a Northstar status transition to (for status-echo push). */
export function northstarStatusTarget(status: TaskStatus, reviewStatusId: string | null): PushTarget {
  if (status === "in_review") return reviewStatusId ? { byId: reviewStatusId } : { byCategory: "indeterminate" };
  if (status === "todo") return { byCategory: "new" };
  if (status === "in_progress") return { byCategory: "indeterminate" };
  return { byCategory: "done" };
}

/** Does a transition's destination status satisfy the desired target? */
export function transitionMatches(
  dest: { id: string; categoryKey: string },
  target: PushTarget,
): boolean {
  if (target.byId) return dest.id === target.byId;
  return dest.categoryKey === target.byCategory;
}

/**
 * Build the pull JQL — mirrors the WHOLE sprint/project (all assignees), not just mine,
 * so Northstar's board matches the team's Jira board.
 *  - sprint mode (board has an active sprint): the active sprint → done-in-sprint still shows.
 *  - open mode (no active sprint / Kanban): open work only → done issues fall out + get archived.
 */
export function buildPullJql(projectKey: string, mode: "sprint" | "open"): string {
  const safe = projectKey.replace(/"/g, '\\"');
  let jql = `project = "${safe}"`;
  jql += mode === "sprint" ? ` AND sprint in openSprints()` : ` AND statusCategory != Done`;
  return jql + ` ORDER BY updated DESC`;
}

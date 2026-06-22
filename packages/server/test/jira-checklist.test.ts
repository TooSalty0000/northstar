import { describe, expect, it } from "vitest";
import { CHECKLIST_MARKER, composeJiraDescription, stripChecklist, adfToText, textToADF } from "../src/jira/mapping";

describe("jira checklist mirror", () => {
  it("appends a checkbox list after the user's prose", () => {
    const out = composeJiraDescription("Build the thing", [
      { title: "design", done: 1 },
      { title: "ship", done: 0 },
    ]);
    expect(out).toContain("Build the thing");
    expect(out).toContain(CHECKLIST_MARKER);
    expect(out).toContain("☑ design");
    expect(out).toContain("☐ ship");
  });

  it("omits the section entirely when there are no subtasks", () => {
    expect(composeJiraDescription("just prose", [])).toBe("just prose");
  });

  it("round-trips: compose → ADF → text → strip recovers the original prose", () => {
    const prose = "line one\nline two";
    const composed = composeJiraDescription(prose, [{ title: "a", done: 0 }]);
    const backToText = adfToText(textToADF(composed)); // simulate Jira store + pull
    expect(stripChecklist(backToText)).toBe(prose);
  });

  it("does not double-append the checklist on re-compose", () => {
    const once = composeJiraDescription("p", [{ title: "a", done: 1 }]);
    const twice = composeJiraDescription(once, [{ title: "a", done: 1 }]);
    expect(twice).toBe(once);
    expect(twice.split(CHECKLIST_MARKER).length - 1).toBe(1); // marker appears exactly once
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { _setTestDb } from "../src/db";
import * as store from "../src/store/tasks";
import { cancelDay, endDay, getReport, getStats, getToday } from "../src/store/reports";
import { logicalLocalDate } from "../src/time";

beforeEach(() => {
  _setTestDb();
});

describe("today bar — no failable ceiling", () => {
  it("empty day reads 0, never negative", () => {
    const t = getToday();
    expect(t.bar.completedUnits).toBe(0);
    expect(t.bar.fillPct).toBe(0);
    expect(t.bar.overflow).toBe(false);
  });

  it("fill reflects what's done (momentum), not a remaining deficit", () => {
    const task = store.createTask({ title: "X", subtasks: ["a", "b"], focusToday: true });
    let today = getToday();
    expect(today.bar.fillPct).toBe(0); // nothing done yet

    store.checkSubtask(task.id, task.subtasks![0].id);
    today = getToday();
    expect(today.bar.completedUnits).toBe(1);
    // soft curve depends only on completed units: 1 / (1 + 12)
    expect(today.bar.fillPct).toBeCloseTo(1 / 13, 5);
  });

  it("more done = fuller bar, and never recedes when work remains", () => {
    const a = store.createTask({ title: "A", focusToday: true });
    const b = store.createTask({ title: "B", subtasks: ["s"], focusToday: true });
    store.setStatus(a.id, "done"); // +3
    const before = getToday().bar.fillPct;
    store.checkSubtask(b.id, b.subtasks![0].id); // +1 more, with an open task still remaining
    const after = getToday().bar.fillPct;
    expect(after).toBeGreaterThan(before); // grows with accomplishment, regardless of remaining work
  });

  it("flags a strong day once enough is accomplished (no ceiling)", () => {
    for (let i = 0; i < 6; i++) {
      const t = store.createTask({ title: `t${i}`, focusToday: true });
      store.setStatus(t.id, "done"); // 6 × 3 = 18 units
    }
    const today = getToday();
    expect(today.bar.completedUnits).toBe(18);
    expect(today.bar.overflow).toBe(true);
  });

  it("counts a hotfix as +2 accomplishment", () => {
    store.logHotfix({ title: "prod fix" });
    const today = getToday();
    expect(today.bar.breakdown.hotfixes).toBe(1);
    expect(today.bar.completedUnits).toBe(2);
  });
});

describe("stats / streak", () => {
  it("aggregates today's units and a 1-day streak", () => {
    const t = store.createTask({ title: "z", subtasks: ["a"] });
    store.checkSubtask(t.id, t.subtasks![0].id);
    const d = logicalLocalDate();
    const s = getStats(d, d);
    expect(s.totals.units).toBeGreaterThanOrEqual(1);
    expect(s.streak).toBe(1);
    expect(s.days.at(-1)?.localDate).toBe(d);
  });
});

describe("end day ritual", () => {
  it("marks the day ended, is idempotent, and cancelable", () => {
    const d = logicalLocalDate();
    expect(getReport(d).ended).toBe(false);
    endDay(d);
    endDay(d); // idempotent — no duplicate marker
    const r = getReport(d);
    expect(r.ended).toBe(true);
    expect(r.endedAt).toBeTruthy();
    cancelDay(d);
    expect(getReport(d).ended).toBe(false);
  });
});

describe("stale-work memory aid", () => {
  it("does not flag freshly-touched in-progress work", () => {
    const t = store.createTask({ title: "fresh" });
    store.setStatus(t.id, "in_progress");
    expect(getToday().staleTasks.find((x) => x.id === t.id)).toBeUndefined();
  });
});

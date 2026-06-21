import { describe, it, expect } from "vitest";
import { dateRange, dayBoundsUtc, logicalLocalDate } from "../src/time";

describe("time / day boundaries", () => {
  it("respects the 04:00 day-start offset", () => {
    expect(logicalLocalDate(new Date(2026, 5, 21, 2, 0), 4)).toBe("2026-06-20"); // 2am → prev day
    expect(logicalLocalDate(new Date(2026, 5, 21, 4, 0), 4)).toBe("2026-06-21"); // 4am → boundary
    expect(logicalLocalDate(new Date(2026, 5, 21, 9, 0), 4)).toBe("2026-06-21");
  });

  it("dayBoundsUtc spans exactly 24h", () => {
    const { startUtc, endUtc } = dayBoundsUtc("2026-06-21", 4);
    expect(new Date(endUtc).getTime() - new Date(startUtc).getTime()).toBe(24 * 3600 * 1000);
  });

  it("dateRange is inclusive", () => {
    expect(dateRange("2026-06-19", "2026-06-21")).toEqual(["2026-06-19", "2026-06-20", "2026-06-21"]);
  });
});

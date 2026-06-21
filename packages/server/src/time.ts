import { DAY_START_HOUR } from "./config";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The logical local date (YYYY-MM-DD) for a moment, honoring the day-start offset.
 * With a 04:00 offset, work done at 01:00 still counts toward the previous day.
 */
export function logicalLocalDate(now: Date = new Date(), dayStartHour = DAY_START_HOUR): string {
  const d = new Date(now.getTime());
  if (d.getHours() < dayStartHour) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** UTC ISO bounds [startUtc, endUtc) for a given logical local date. */
export function dayBoundsUtc(
  localDate: string,
  dayStartHour = DAY_START_HOUR,
): { startUtc: string; endUtc: string } {
  const [y, m, d] = localDate.split("-").map(Number);
  // Constructed in the machine's local timezone, then serialized to UTC.
  const start = new Date(y, m - 1, d, dayStartHour, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Whole days elapsed since an ISO instant (drives the neutral "last touched N days ago"). */
export function daysSince(iso: string, now: Date = new Date()): number {
  const then = new Date(iso).getTime();
  return Math.floor((now.getTime() - then) / (24 * 60 * 60 * 1000));
}

/** Inclusive list of logical local dates from `from` to `to` (YYYY-MM-DD strings). */
export function dateRange(fromLocal: string, toLocal: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = fromLocal.split("-").map(Number);
  const [ty, tm, td] = toLocal.split("-").map(Number);
  const cur = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  while (cur.getTime() <= end.getTime()) {
    out.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

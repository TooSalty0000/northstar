import type {
  ActivityEvent,
  ConnectionInfo,
  DailyReport,
  StatsResponse,
  StatsDay,
  TodayResponse,
  Task,
} from "@northstar/shared";
import { STALE_DAYS_DEFAULT, WEIGHTS } from "@northstar/shared";
import { getDb } from "../db";
import { dateRange, dayBoundsUtc, logicalLocalDate, nowIso } from "../time";
import { rowToEvent, rowToTask } from "./mappers";
import { staleTasks } from "./tasks";

const EVENT_COLS = `a.*, t.title AS task_title`;
const EVENT_JOIN = `FROM activity_log a LEFT JOIN tasks t ON t.id = a.task_id`;

function eventsBetween(startUtc: string, endUtc: string, spaceId?: string): ActivityEvent[] {
  const db = getDb();
  const where = spaceId ? `AND t.space_id = ?` : ``;
  const params = spaceId ? [startUtc, endUtc, spaceId] : [startUtc, endUtc];
  return db
    .prepare(`SELECT ${EVENT_COLS} ${EVENT_JOIN} WHERE a.ts >= ? AND a.ts < ? ${where} ORDER BY a.id ASC`)
    .all(...params)
    .map(rowToEvent);
}

function units(events: ActivityEvent[]): { units: number; subtasks: number; tasks: number; hotfixes: number } {
  let subtasks = 0, tasks = 0, hotfixes = 0;
  for (const e of events) {
    if (e.type === "subtask_done") subtasks++;
    else if (e.type === "task_completed") tasks++;
    else if (e.type === "hotfix") hotfixes++;
  }
  return {
    subtasks,
    tasks,
    hotfixes,
    units: subtasks * WEIGHTS.subtask_done + tasks * WEIGHTS.task_completed + hotfixes * WEIGHTS.hotfix,
  };
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

export function getToday(spaceId?: string): TodayResponse {
  const db = getDb();
  const localDate = logicalLocalDate();
  const { startUtc, endUtc } = dayBoundsUtc(localDate);

  const focusTasks = db
    .prepare(
      `SELECT t.*,
        (SELECT COUNT(*) FROM subtasks s WHERE s.task_id=t.id) AS total,
        (SELECT COALESCE(SUM(s.done),0) FROM subtasks s WHERE s.task_id=t.id) AS done_count
       FROM tasks t WHERE t.focus_date = ? AND t.archived = 0
       ${spaceId ? "AND t.space_id = ?" : ""}
       ORDER BY t.last_touched_at DESC`,
    )
    .all(...(spaceId ? [localDate, spaceId] : [localDate]))
    .map(rowToTask);

  const completedEvents = eventsBetween(startUtc, endUtc, spaceId).filter(
    (e) => e.type === "subtask_done" || e.type === "task_completed" || e.type === "hotfix",
  );

  const u = units(completedEvents);

  // planned remaining = weighted open work across today's focus tasks
  let plannedRemaining = 0;
  for (const ft of focusTasks) {
    const open = (ft.total ?? 0) - (ft.doneCount ?? 0);
    plannedRemaining += open * WEIGHTS.subtask_done;
    if (ft.status !== "done") plannedRemaining += WEIGHTS.task_completed;
  }

  const completedUnits = u.units;
  const denominator = Math.max(completedUnits, plannedRemaining + completedUnits);
  const fillPct = denominator > 0 ? Math.min(1, completedUnits / denominator) : 0;
  const overflow = completedUnits > 0 && plannedRemaining === 0;

  return {
    localDate,
    bar: {
      completedUnits,
      plannedRemainingUnits: plannedRemaining,
      denominator,
      fillPct,
      overflow,
      breakdown: { subtasks: u.subtasks, tasks: u.tasks, hotfixes: u.hotfixes },
    },
    focusTasks,
    staleTasks: staleTasks(STALE_DAYS_DEFAULT, spaceId),
    completedEvents,
  };
}

// ---------------------------------------------------------------------------
// Daily report
// ---------------------------------------------------------------------------

export function getReport(localDate = logicalLocalDate(), spaceId?: string): DailyReport {
  const db = getDb();
  const { startUtc, endUtc } = dayBoundsUtc(localDate);
  const events = eventsBetween(startUtc, endUtc, spaceId);
  const u = units(events);

  const completedTaskIds = events.filter((e) => e.type === "task_completed" && e.taskId).map((e) => e.taskId!);
  const tasksCompleted: Task[] = completedTaskIds
    .map((id) =>
      db
        .prepare(
          `SELECT t.*,
            (SELECT COUNT(*) FROM subtasks s WHERE s.task_id=t.id) AS total,
            (SELECT COALESCE(SUM(s.done),0) FROM subtasks s WHERE s.task_id=t.id) AS done_count
           FROM tasks t WHERE t.id = ?`,
        )
        .get(id),
    )
    .filter(Boolean)
    .map(rowToTask);

  const byActor: Record<string, number> = { user: 0, claude: 0 };
  const byRepo: Record<string, number> = {};
  for (const e of events) {
    const w =
      e.type === "subtask_done"
        ? WEIGHTS.subtask_done
        : e.type === "task_completed"
          ? WEIGHTS.task_completed
          : e.type === "hotfix"
            ? WEIGHTS.hotfix
            : 0;
    if (w === 0) continue;
    byActor[e.actor] = (byActor[e.actor] ?? 0) + w;
    const repo = e.repo ?? "—";
    byRepo[repo] = (byRepo[repo] ?? 0) + w;
  }

  const endedEv = db
    .prepare(`SELECT ts FROM activity_log WHERE type='day_ended' AND ts>=? AND ts<? ORDER BY id DESC LIMIT 1`)
    .get(startUtc, endUtc) as any;

  return {
    localDate,
    tasksCompleted,
    subtasksChecked: u.subtasks,
    hotfixes: events.filter((e) => e.type === "hotfix"),
    statusChanges: events.filter((e) => e.type === "status_changed"),
    units: u.units,
    byActor: byActor as DailyReport["byActor"],
    byRepo,
    events,
    ended: !!endedEv,
    endedAt: endedEv?.ts ?? null,
  };
}

/** The End Day ritual — records a (cancelable) day_ended marker for the local day. */
export function endDay(localDate = logicalLocalDate()): { ended: boolean; endedAt: string } {
  const db = getDb();
  const { startUtc, endUtc } = dayBoundsUtc(localDate);
  let row = db
    .prepare(`SELECT ts FROM activity_log WHERE type='day_ended' AND ts>=? AND ts<? ORDER BY id DESC LIMIT 1`)
    .get(startUtc, endUtc) as any;
  if (!row) {
    const ts = nowIso();
    db.prepare(`INSERT INTO activity_log (ts, type, actor, payload) VALUES (?, 'day_ended', 'user', ?)`).run(
      ts,
      JSON.stringify({ localDate }),
    );
    row = { ts };
  }
  return { ended: true, endedAt: row.ts };
}

export function cancelDay(localDate = logicalLocalDate()): { ended: boolean } {
  const db = getDb();
  const { startUtc, endUtc } = dayBoundsUtc(localDate);
  db.prepare(`DELETE FROM activity_log WHERE type='day_ended' AND ts>=? AND ts<?`).run(startUtc, endUtc);
  return { ended: false };
}

// ---------------------------------------------------------------------------
// Productivity stats over time
// ---------------------------------------------------------------------------

export function getStats(fromLocal: string, toLocal: string, spaceId?: string): StatsResponse {
  const start = dayBoundsUtc(fromLocal).startUtc;
  const end = dayBoundsUtc(toLocal).endUtc;
  const events = eventsBetween(start, end, spaceId);

  // bucket events by their logical local date
  const buckets = new Map<string, ActivityEvent[]>();
  for (const e of events) {
    const d = logicalLocalDate(new Date(e.ts));
    if (!buckets.has(d)) buckets.set(d, []);
    buckets.get(d)!.push(e);
  }

  const days: StatsDay[] = dateRange(fromLocal, toLocal).map((d) => {
    const u = units(buckets.get(d) ?? []);
    return { localDate: d, units: u.units, subtasks: u.subtasks, tasks: u.tasks, hotfixes: u.hotfixes };
  });

  // streak: consecutive days with units > 0, counting back from the most recent day
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].units > 0) streak++;
    else break;
  }

  const totals = days.reduce(
    (acc, d) => ({
      subtasks: acc.subtasks + d.subtasks,
      tasks: acc.tasks + d.tasks,
      hotfixes: acc.hotfixes + d.hotfixes,
      units: acc.units + d.units,
    }),
    { subtasks: 0, tasks: 0, hotfixes: 0, units: 0 },
  );

  const byActor: Record<string, number> = { user: 0, claude: 0 };
  for (const e of events) {
    const w =
      e.type === "subtask_done"
        ? WEIGHTS.subtask_done
        : e.type === "task_completed"
          ? WEIGHTS.task_completed
          : e.type === "hotfix"
            ? WEIGHTS.hotfix
            : 0;
    if (w) byActor[e.actor] = (byActor[e.actor] ?? 0) + w;
  }

  return { days, streak, totals, byActor: byActor as StatsResponse["byActor"] };
}

// ---------------------------------------------------------------------------
// Activity feed + connections
// ---------------------------------------------------------------------------

export function activitySince(sinceId: number, limit = 200): ActivityEvent[] {
  const db = getDb();
  return db
    .prepare(`SELECT ${EVENT_COLS} ${EVENT_JOIN} WHERE a.id > ? ORDER BY a.id ASC LIMIT ?`)
    .all(sinceId, limit)
    .map(rowToEvent);
}

export function latestActivityId(): number {
  const db = getDb();
  const r = db.prepare(`SELECT COALESCE(MAX(id),0) AS m FROM activity_log`).get() as any;
  return r.m as number;
}

export function getConnections(): ConnectionInfo[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT repo, MAX(ts) AS last_seen, COUNT(*) AS n
       FROM activity_log WHERE repo IS NOT NULL AND repo != ''
       GROUP BY repo ORDER BY last_seen DESC`,
    )
    .all()
    .map((r: any) => ({ repo: r.repo, lastSeen: r.last_seen, eventCount: r.n }));
}

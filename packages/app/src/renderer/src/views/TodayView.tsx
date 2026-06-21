import { motion } from "motion/react";
import type { TodayBar as TodayBarT } from "@northstar/shared";
import { useToday } from "../api";
import { TaskCard } from "../components/TaskCard";
import { NewTaskButton } from "../components/NewTask";
import { Empty } from "../components/ui";

function prettyDate(d?: string) {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function TodayBar({ bar }: { bar: TodayBarT }) {
  return (
    <div className="xp-wrap">
      <div className="xp-top">
        <span className="xp-label">Today's progress</span>
        <span className="xp-count">
          <b>{bar.completedUnits}</b> {bar.overflow ? "✦ overflowing" : `/ ${bar.denominator}`} pts
        </span>
      </div>
      <div className="xp-track">
        <motion.div
          className={`xp-fill ${bar.overflow ? "overflow" : ""}`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(bar.completedUnits > 0 ? 3 : 0, bar.fillPct * 100)}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 18 }}
        />
      </div>
      <div className="xp-break">
        <span className="chip s">☑ <b>{bar.breakdown.subtasks}</b> steps</span>
        <span className="chip t">✦ <b>{bar.breakdown.tasks}</b> tasks</span>
        <span className="chip h">⚡ <b>{bar.breakdown.hotfixes}</b> hotfixes</span>
      </div>
    </div>
  );
}

export function TodayView() {
  const { data, isLoading } = useToday();
  const focus = data?.focusTasks ?? [];
  const stale = data?.staleTasks ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Today</h1>
          <div className="page-sub">{prettyDate(data?.localDate)}</div>
        </div>
        <NewTaskButton focusToday />
      </div>

      {data?.bar && <TodayBar bar={data.bar} />}

      <div className="section-title">Focused</div>
      {focus.length > 0 ? (
        <div className="grid">
          {focus.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </div>
      ) : (
        !isLoading && (
          <Empty
            icon="🎯"
            title="Nothing pinned to today yet"
            hint="Create a task, or pin one from the Board. Work Claude completes will show up here too."
          />
        )
      )}

      {stale.length > 0 && (
        <>
          <div className="section-title">Pick up where you left off</div>
          <div className="grid">
            {stale.map((t) => (
              <TaskCard key={t.id} task={t} showStale />
            ))}
          </div>
        </>
      )}
    </>
  );
}

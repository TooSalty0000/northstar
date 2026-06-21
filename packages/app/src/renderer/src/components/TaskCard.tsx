import { motion } from "motion/react";
import type { Task } from "@northstar/shared";
import { useUI } from "../store";
import { MiniProgress, Pct, StatusBadge, relativeDays } from "./ui";

export function TaskCard({
  task,
  showStale = false,
  hideStatus = false,
}: {
  task: Task;
  showStale?: boolean;
  hideStatus?: boolean;
}) {
  const selectTask = useUI((s) => s.selectTask);
  const pct = task.pct ?? 0;
  const hasSubs = (task.total ?? 0) > 0;
  const stale = showStale && task.status === "in_progress";

  return (
    <motion.div
      layout
      className="task-card"
      onClick={() => selectTask(task.id)}
      whileHover={{ y: -1 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      <div className="title" title={task.title}>
        {task.title}
      </div>

      {hasSubs && (
        <div className="row" style={{ marginTop: 10 }}>
          <div style={{ flex: 1 }}>
            <MiniProgress pct={pct} />
          </div>
          <Pct value={pct} />
        </div>
      )}

      <div className="task-meta">
        {!hideStatus && <StatusBadge status={task.status} />}
        {task.repo && <span className="repo-tag">{task.repo}</span>}
        {task.externalId && (
          <a
            className="jira-tag"
            href={task.externalUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={task.syncState ?? undefined}
          >
            <span className={`sync-dot ${task.syncState ?? ""}`} />
            {task.externalId}
          </a>
        )}
        {task.sprintName && <span className="sprint-tag">⟳ {task.sprintName}</span>}
        {task.assigneeName && (
          <span className="assignee-tag" title={task.assigneeName}>
            <span className="assignee-dot">{task.assigneeName.trim().charAt(0).toUpperCase()}</span>
            {task.assigneeName.split(/[ @]/)[0]}
          </span>
        )}
        {hasSubs && (
          <span>
            {task.doneCount}/{task.total}
          </span>
        )}
        <span className={stale ? "stale-tag" : undefined}>· {relativeDays(task.lastTouchedAt)}</span>
      </div>
    </motion.div>
  );
}

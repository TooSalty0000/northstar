import { useMutation } from "@tanstack/react-query";
import type { TaskStatus } from "@northstar/shared";
import { TASK_STATUSES, STATUS_LABELS } from "@northstar/shared";
import { api, useInvalidate, useTask } from "../api";
import { useUI } from "../store";
import { SubtaskList } from "./SubtaskList";
import { celebrate } from "../lib/confetti";
import { relativeDays } from "./ui";

export function TaskDrawer() {
  const { selectedTaskId, selectTask } = useUI();
  const { data: task } = useTask(selectedTaskId);
  const invalidate = useInvalidate();

  const close = () => selectTask(null);

  const status = useMutation({
    mutationFn: api.setStatus,
    onSuccess: (t) => {
      invalidate();
      if (t?.status === "done") celebrate(true);
    },
  });
  const focus = useMutation({ mutationFn: api.focus, onSuccess: invalidate });
  const archive = useMutation({
    mutationFn: api.archiveTask,
    onSuccess: () => {
      invalidate();
      close();
    },
  });

  if (!task) return null;
  const today = task.focusDate && new Date(task.focusDate + "T00:00:00").toDateString() === new Date().toDateString();

  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <div className="drawer">
        <div className="toolbar" style={{ justifyContent: "space-between" }}>
          {task.repo ? <span className="repo-tag">{task.repo}</span> : <span />}
          <button className="icon-btn" onClick={close}>
            ×
          </button>
        </div>
        <h2 style={{ margin: "12px 0 6px", fontSize: 21 }}>{task.title}</h2>
        {task.description && <p style={{ color: "var(--muted)", marginTop: 0 }}>{task.description}</p>}
        <div style={{ color: "var(--faint)", fontSize: 12, marginBottom: 18 }}>
          last touched {relativeDays(task.lastTouchedAt)}
        </div>
        {task.externalId && (
          <div className="task-meta" style={{ marginTop: -8, marginBottom: 16 }}>
            <a className="jira-tag" href={task.externalUrl ?? "#"} target="_blank" rel="noreferrer" title={task.syncState ?? undefined}>
              <span className={`sync-dot ${task.syncState ?? ""}`} />
              {task.externalId}
            </a>
            {task.sprintName && <span className="sprint-tag">⟳ {task.sprintName}</span>}
          </div>
        )}

        <div className="section-title">Status</div>
        <div className="toolbar" style={{ flexWrap: "wrap", gap: 7 }}>
          {TASK_STATUSES.map((s) => (
            <button
              key={s}
              className={`btn small ${task.status === s ? "primary" : "ghost"}`}
              onClick={() => status.mutate({ id: task.id, status: s as TaskStatus })}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        <div className="section-title">Checklist</div>
        <SubtaskList task={task} />

        <div className="toolbar" style={{ marginTop: 28 }}>
          <button className="btn small" onClick={() => focus.mutate({ id: task.id, on: !today })}>
            {today ? "★ Unpin from Today" : "☆ Pin to Today"}
          </button>
          <button className="btn small ghost" style={{ marginLeft: "auto", color: "var(--rose)" }} onClick={() => archive.mutate({ id: task.id })}>
            Archive
          </button>
        </div>
      </div>
    </>
  );
}

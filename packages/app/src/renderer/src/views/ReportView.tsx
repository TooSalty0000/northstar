import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Actor } from "@northstar/shared";
import { api, useInvalidate, useReport } from "../api";
import { EndDayModal } from "../components/EndDayModal";

function shiftDate(d: string, delta: number) {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(y, m - 1, day);
  dt.setDate(dt.getDate() + delta);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export function ReportView() {
  const [date, setDate] = useState<string | undefined>(undefined);
  const [showEnd, setShowEnd] = useState(false);
  const { data } = useReport(date);
  const invalidate = useInvalidate();
  const cancelDay = useMutation({ mutationFn: () => api.cancelDay(data?.localDate), onSuccess: invalidate });
  const anchor = date ?? data?.localDate;
  const you = data?.byActor?.user ?? 0;
  const claude = data?.byActor?.claude ?? 0;
  const split = you + claude;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Daily report</h1>
          <div className="page-sub">{data?.localDate ?? "—"}</div>
        </div>
        <div className="toolbar">
          <button className="btn small" onClick={() => anchor && setDate(shiftDate(anchor, -1))}>
            ← Prev
          </button>
          <button className="btn small" onClick={() => setDate(undefined)}>
            Today
          </button>
          <button className="btn small" onClick={() => anchor && setDate(shiftDate(anchor, 1))}>
            Next →
          </button>
          {data?.ended ? (
            <button className="btn small" onClick={() => cancelDay.mutate()} title="Reopen this day">
              ↩ Cancel end day
            </button>
          ) : (
            <button className="btn primary small" onClick={() => setShowEnd(true)}>
              End day ✦
            </button>
          )}
        </div>
      </div>

      {data?.ended && (
        <div className="endday-banner">
          ✦ Day ended{data.endedAt ? ` at ${new Date(data.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""} — nice work.
        </div>
      )}

      {showEnd && data && <EndDayModal report={data} onClose={() => setShowEnd(false)} />}

      <div className="stat-row">
        <div className="stat">
          <div className="n">{data?.units ?? 0}</div>
          <div className="l">points earned</div>
        </div>
        <div className="stat">
          <div className="n">{data?.tasksCompleted.length ?? 0}</div>
          <div className="l">tasks completed</div>
        </div>
        <div className="stat">
          <div className="n">{data?.subtasksChecked ?? 0}</div>
          <div className="l">steps checked</div>
        </div>
        <div className="stat">
          <div className="n">{data?.hotfixes.length ?? 0}</div>
          <div className="l">hotfixes</div>
        </div>
      </div>

      {split > 0 && (
        <div className="chart-card" style={{ marginBottom: 20 }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            You vs Claude
          </div>
          <div className="xp-track" style={{ height: 22 }}>
            <div
              style={{
                width: `${(you / split) * 100}%`,
                height: "100%",
                background: "linear-gradient(90deg,#3a7bd5,#4493f8)",
                display: "inline-block",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 13, color: "var(--muted)" }}>
            <span style={{ color: "var(--blue)" }}>You — {you} pts</span>
            <span style={{ color: "var(--violet)" }}>Claude — {claude} pts</span>
          </div>
        </div>
      )}

      <div className="section-title">What happened</div>
      {data && data.events.length > 0 ? (
        <div className="grid">
          {data.events
            .slice()
            .reverse()
            .map((e) => (
              <div className="task-card" key={e.id} style={{ cursor: "default" }}>
                <div className="row">
                  <span>
                    {iconFor(e.type)} <b>{labelFor(e.type)}</b>{" "}
                    {e.taskTitle && <span style={{ color: "var(--muted)" }}>· {e.taskTitle}</span>}
                  </span>
                  <span className="task-meta" style={{ margin: 0 }}>
                    <ActorTag actor={e.actor} />
                    {e.repo && <span className="repo-tag">{e.repo}</span>}
                  </span>
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div className="empty">No recorded work for this day.</div>
      )}
    </>
  );
}

function ActorTag({ actor }: { actor: Actor }) {
  return (
    <span style={{ color: actor === "claude" ? "var(--violet)" : "var(--blue)", fontSize: 12 }}>
      {actor === "claude" ? "Claude" : "You"}
    </span>
  );
}

function iconFor(t: string) {
  return (
    {
      task_created: "📝",
      subtask_added: "➕",
      subtask_done: "☑",
      status_changed: "↪",
      task_completed: "✦",
      task_focused: "★",
      task_unfocused: "☆",
      hotfix: "⚡",
      task_archived: "🗄",
    } as Record<string, string>
  )[t] ?? "•";
}
function labelFor(t: string) {
  return (
    {
      task_created: "Created task",
      subtask_added: "Added step",
      subtask_done: "Checked step",
      status_changed: "Moved status",
      task_completed: "Completed task",
      task_focused: "Pinned to today",
      task_unfocused: "Unpinned",
      hotfix: "Logged hotfix",
      task_archived: "Archived",
    } as Record<string, string>
  )[t] ?? t;
}

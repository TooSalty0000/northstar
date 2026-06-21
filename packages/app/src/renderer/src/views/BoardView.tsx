import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Task, TaskStatus } from "@northstar/shared";
import { TASK_STATUSES, STATUS_LABELS } from "@northstar/shared";
import { api, useInvalidate, useTasks } from "../api";
import { TaskCard } from "../components/TaskCard";
import { NewTaskButton } from "../components/NewTask";

export function BoardView() {
  const { data: tasks } = useTasks();
  const invalidate = useInvalidate();
  const [over, setOver] = useState<TaskStatus | null>(null);
  const move = useMutation({ mutationFn: api.setStatus, onSuccess: invalidate });

  const byStatus = (s: TaskStatus): Task[] => (tasks ?? []).filter((t) => t.status === s);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Board</h1>
          <div className="page-sub">Drag cards across the workflow — In&nbsp;Progress auto-pins to Today.</div>
        </div>
        <NewTaskButton />
      </div>

      <div className="board">
        {TASK_STATUSES.map((s) => {
          const col = byStatus(s);
          return (
            <div
              key={s}
              className={`col ${over === s ? "dragover" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(s);
              }}
              onDragLeave={() => setOver((cur) => (cur === s ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/task-id");
                const cur = e.dataTransfer.getData("text/task-status");
                if (id && cur !== s) move.mutate({ id, status: s });
              }}
            >
              <h3>
                {STATUS_LABELS[s]}
                <span className="count">{col.length}</span>
              </h3>
              <div className="col-cards">
                {col.map((t) => (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/task-id", t.id);
                      e.dataTransfer.setData("text/task-status", t.status);
                    }}
                  >
                    <TaskCard task={t} showStale hideStatus />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

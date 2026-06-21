import { useState } from "react";
import { motion } from "motion/react";
import { useMutation } from "@tanstack/react-query";
import type { Task } from "@northstar/shared";
import { api, useInvalidate } from "../api";
import { celebrate } from "../lib/confetti";

export function SubtaskList({ task }: { task: Task }) {
  const invalidate = useInvalidate();
  const [draft, setDraft] = useState("");
  const subs = task.subtasks ?? [];

  const toggle = useMutation({
    mutationFn: api.checkSubtask,
    onSuccess: (updated) => {
      invalidate();
      if (updated && (updated.pct ?? 0) >= 1 && (updated.total ?? 0) > 0) celebrate(true);
      else celebrate(false);
    },
  });
  const add = useMutation({ mutationFn: api.addSubtask, onSuccess: invalidate });
  const remove = useMutation({ mutationFn: api.deleteSubtask, onSuccess: invalidate });

  return (
    <div>
      {subs.map((s) => (
        <div className="subtask" key={s.id}>
          <motion.button
            className={`check ${s.done ? "done" : ""}`}
            onClick={() => toggle.mutate({ id: task.id, sid: s.id, done: !s.done })}
            whileTap={{ scale: 0.85 }}
            animate={s.done ? { scale: [1, 1.3, 1] } : { scale: 1 }}
            transition={{ duration: 0.25 }}
            aria-label={s.done ? "Uncheck" : "Check"}
          >
            ✓
          </motion.button>
          <span className={`stitle ${s.done ? "done" : ""}`}>{s.title}</span>
          <button className="icon-btn" onClick={() => remove.mutate({ id: task.id, sid: s.id })} title="Remove step">
            ×
          </button>
        </div>
      ))}
      <div className="subtask">
        <span className="check" style={{ borderStyle: "dashed", opacity: 0.5 }} />
        <input
          className="inp"
          style={{ border: "none", background: "transparent", padding: "2px 0" }}
          value={draft}
          placeholder="Add a step…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              add.mutate({ id: task.id, title: draft.trim() });
              setDraft("");
            }
          }}
        />
      </div>
    </div>
  );
}

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, useInvalidate } from "../api";
import { useUI } from "../store";

export function NewTaskButton({ focusToday = false }: { focusToday?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn primary" onClick={() => setOpen(true)}>
        + New task
      </button>
      {open && <NewTaskModal focusToday={focusToday} onClose={() => setOpen(false)} />}
    </>
  );
}

function NewTaskModal({ focusToday, onClose }: { focusToday: boolean; onClose: () => void }) {
  const invalidate = useInvalidate();
  const activeSpaceId = useUI((s) => s.activeSpaceId);
  const [title, setTitle] = useState("");
  const [repo, setRepo] = useState("");
  const [steps, setSteps] = useState("");
  const [focus, setFocus] = useState(focusToday);

  const create = useMutation({
    mutationFn: api.createTask,
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const submit = () => {
    if (!title.trim()) return;
    create.mutate({
      title: title.trim(),
      repo: repo.trim() || undefined,
      focusToday: focus,
      spaceId: activeSpaceId && activeSpaceId !== "all" ? activeSpaceId : undefined,
      subtasks: steps
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer" style={{ width: 440 }}>
        <h2 style={{ marginTop: 0 }}>New task</h2>
        <label className="page-sub">Title</label>
        <input
          className="inp"
          autoFocus
          value={title}
          placeholder="What are you working on?"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.metaKey && submit()}
          style={{ margin: "6px 0 16px" }}
        />
        <label className="page-sub">Repo (optional)</label>
        <input
          className="inp"
          value={repo}
          placeholder="backend"
          onChange={(e) => setRepo(e.target.value)}
          style={{ margin: "6px 0 16px" }}
        />
        <label className="page-sub">Steps — one per line (optional)</label>
        <textarea
          className="inp"
          rows={5}
          value={steps}
          placeholder={"design schema\nbuild endpoint\nwrite tests"}
          onChange={(e) => setSteps(e.target.value)}
          style={{ margin: "6px 0 16px", resize: "vertical" }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 20, color: "var(--muted)", fontSize: 14 }}>
          <input type="checkbox" checked={focus} onChange={(e) => setFocus(e.target.checked)} />
          Pin to Today
        </label>
        <div className="toolbar">
          <button className="btn primary" onClick={submit} disabled={!title.trim() || create.isPending}>
            {create.isPending ? "Creating…" : "Create task"}
          </button>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <span style={{ marginLeft: "auto", color: "var(--faint)", fontSize: 12 }}>
            <span className="kbd">⌘↵</span> to save
          </span>
        </div>
      </div>
    </>
  );
}

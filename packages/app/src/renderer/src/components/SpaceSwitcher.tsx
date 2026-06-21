import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, useInvalidate, useSpaces } from "../api";
import { useUI } from "../store";

export function SpaceSwitcher() {
  const { data: spaces } = useSpaces();
  const { activeSpaceId, setSpace } = useUI();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const invalidate = useInvalidate();

  const create = useMutation({
    mutationFn: api.createSpace,
    onSuccess: (s) => {
      invalidate();
      setSpace(s.id);
      setCreating(false);
      setName("");
      setOpen(false);
    },
  });
  const del = useMutation({ mutationFn: api.deleteSpace, onSuccess: invalidate });

  const current =
    activeSpaceId === "all"
      ? { emoji: "✦", name: "All Spaces" }
      : (spaces?.find((s) => s.id === activeSpaceId) ?? { emoji: "✦", name: "Loading…" });

  return (
    <div className="space-switcher">
      <button className="space-current" onClick={() => setOpen((o) => !o)}>
        <span className="space-emoji">{current.emoji || "✦"}</span>
        <span className="space-name">{current.name}</span>
        <span className="chev">▾</span>
      </button>
      {open && (
        <div className="space-menu">
          {spaces?.map((s) => (
            <div className="space-opt" key={s.id}>
              <button
                className={`space-opt-main ${s.id === activeSpaceId ? "active" : ""}`}
                onClick={() => {
                  setSpace(s.id);
                  setOpen(false);
                }}
              >
                <span>{s.emoji || "✦"}</span> {s.name}
              </button>
              {!s.isDefault && (
                <button
                  className="icon-btn"
                  title="Delete space"
                  onClick={() => {
                    if (window.confirm(`Delete space “${s.name}”? Its tasks and repos move to the default space.`))
                      del.mutate({ id: s.id });
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            className={`space-opt-main ${activeSpaceId === "all" ? "active" : ""}`}
            onClick={() => {
              setSpace("all");
              setOpen(false);
            }}
          >
            ✦ All Spaces
          </button>
          <div className="space-sep" />
          {creating ? (
            <input
              className="inp"
              autoFocus
              placeholder="New space name…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) create.mutate({ name: name.trim() });
                if (e.key === "Escape") setCreating(false);
              }}
            />
          ) : (
            <button className="space-opt-main add" onClick={() => setCreating(true)}>
              ＋ New Space
            </button>
          )}
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { useRepos, useInvalidate } from "../api";
import { useUI } from "../store";
import { relativeDays, Empty } from "../components/ui";
import { JiraPanel } from "../components/JiraPanel";

export function ConnectionsView() {
  const { data: repos } = useRepos();
  const invalidate = useInvalidate();
  const { activeSpaceId } = useUI();
  const [msg, setMsg] = useState<string | null>(null);

  const runTest = async () => {
    setMsg("Testing…");
    const r = (await window.northstar?.testConnection()) ?? { ok: false, status: 0 };
    setMsg(r.ok ? "✓ Reachable by Claude (MCP responded 200)" : `✗ Not reachable (status ${r.status})`);
  };

  const addRepo = async () => {
    const spaceId = activeSpaceId && activeSpaceId !== "all" ? activeSpaceId : undefined;
    const r = await window.northstar?.addRepo(spaceId);
    if (r?.ok) {
      setMsg(`✓ Connected ${r.dir}`);
      invalidate();
    }
  };

  const removeRepo = async (repo: { id: string; path: string; name: string }) => {
    const r = await window.northstar?.removeRepo(repo);
    if (r?.ok) {
      setMsg(r.deletedFiles ? `✓ Removed ${repo.name} (files deleted)` : `✓ Removed ${repo.name} (files kept)`);
      invalidate();
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Connections</h1>
          <div className="page-sub">
            Repos wired to Claude {activeSpaceId === "all" || !activeSpaceId ? "across all Spaces" : "in this Space"}
          </div>
        </div>
        <div className="toolbar">
          <button className="btn small" onClick={runTest}>
            Test Claude connection
          </button>
          <button className="btn primary small" onClick={addRepo}>
            + Add repo
          </button>
        </div>
      </div>

      <JiraPanel />

      {msg && (
        <div className="chart-card" style={{ marginBottom: 18, color: msg.startsWith("✓") ? "var(--green)" : "var(--muted)" }}>
          {msg}
        </div>
      )}

      <div className="section-title" style={{ marginTop: 0 }}>Repos (Claude logging)</div>

      {repos && repos.length > 0 ? (
        <div className="grid">
          {repos.map((c) => (
            <div className="task-card" key={c.id} style={{ cursor: "default" }}>
              <div className="row">
                <span className="title">📦 {c.name}</span>
                <button className="btn small ghost" style={{ color: "var(--rose)" }} onClick={() => removeRepo(c)}>
                  Remove
                </button>
              </div>
              <div className="task-meta">
                <span className="repo-tag" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.path}
                </span>
                <span>
                  · {c.eventCount ? `${c.eventCount} events · last ${relativeDays(c.lastSeen!)}` : "no activity yet"}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon="🔌"
          title="No repos connected in this Space"
          hint="Click “Add repo”, pick a work repo, then open Claude Code there and approve the northstar MCP server. Its work will file into this Space."
        />
      )}
    </>
  );
}

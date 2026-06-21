import { useState } from "react";
import type { JiraBoard, JiraProject, JiraStatusOption } from "@northstar/shared";
import { jiraApi, useInvalidate, useJiraLink } from "../api";
import { useUI } from "../store";
import { relativeDays } from "./ui";

export function JiraPanel() {
  const { activeSpaceId } = useUI();
  const { data: link } = useJiraLink();
  const invalidate = useInvalidate();
  const [wizard, setWizard] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (!activeSpaceId || activeSpaceId === "all") {
    return (
      <div className="chart-card" style={{ marginBottom: 18 }}>
        <b>Jira</b> <span style={{ color: "var(--muted)" }}>— pick a single Space to connect it to a Jira project.</span>
      </div>
    );
  }

  const pull = async () => {
    setBusy("pull");
    try {
      const r = await jiraApi.pull(activeSpaceId); // sprint-scoped when a board is linked
      invalidate();
      const extra = r.archived ? `, ${r.archived} left sprint` : "";
      setBusy(`✓ ${r.imported} new, ${r.updated} updated${extra}`);
      setTimeout(() => setBusy(null), 2800);
    } catch (e: any) {
      setBusy(`✗ ${e.message}`);
      setTimeout(() => setBusy(null), 3000);
    }
  };

  const pushLocal = async () => {
    setBusy("push");
    try {
      const r = await jiraApi.pushLocal(activeSpaceId);
      invalidate();
      setBusy(`✓ pushed ${r.pushed} local task(s) to Jira`);
      setTimeout(() => setBusy(null), 2800);
    } catch (e: any) {
      setBusy(`✗ ${e.message}`);
      setTimeout(() => setBusy(null), 3000);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect this Space from Jira? Imported tasks stay; syncing stops.")) return;
    await window.northstar?.jiraDisconnect(activeSpaceId);
    invalidate();
  };

  return (
    <div className="chart-card" style={{ marginBottom: 18 }}>
      <div className="row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b>Jira</b>
        {!link && (
          <button className="btn primary small" onClick={() => setWizard(true)}>
            Connect to Jira
          </button>
        )}
      </div>

      {link && (
        <>
          {link.authState === "revoked" && (
            <div style={{ color: "var(--rose)", margin: "8px 0" }}>
              ⚠ Token rejected — reconnect.{" "}
              <button className="btn small" onClick={() => setWizard(true)}>
                Reconnect
              </button>
            </div>
          )}
          <div className="task-meta" style={{ marginTop: 8 }}>
            <span className="repo-tag">{link.projectKey}</span>
            <span>· {link.siteUrl.replace(/^https?:\/\//, "")}</span>
            {link.boardId && <span>· board #{link.boardId}</span>}
            <span>· {link.lastPullAt ? `pulled ${relativeDays(link.lastPullAt)}` : "never pulled"}</span>
            <span>· {link.connected ? "🟢 connected" : "⚪ offline"}</span>
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="btn primary small" disabled={!!busy} onClick={pull}>
              {busy === "pull" ? "Syncing…" : link.boardId ? "Sync current sprint" : "Sync from Jira"}
            </button>
            <button className="btn small" disabled={!!busy} onClick={pushLocal} title="Create Jira issues for local tasks not yet linked">
              {busy === "push" ? "Pushing…" : "Push local tasks"}
            </button>
            <button className="btn small ghost" style={{ marginLeft: "auto", color: "var(--rose)" }} onClick={disconnect}>
              Disconnect
            </button>
          </div>
          {link.boardId && (
            <div className="page-sub" style={{ marginTop: 8 }}>
              Mirrors your active sprint (issues assigned to you). New tasks here are created in Jira.
            </div>
          )}
          {busy && busy.startsWith("✓") && <div style={{ color: "var(--green)", marginTop: 8 }}>{busy}</div>}
          {busy && busy.startsWith("✗") && <div style={{ color: "var(--rose)", marginTop: 8 }}>{busy}</div>}
        </>
      )}

      {wizard && <JiraWizard spaceId={activeSpaceId} onClose={() => setWizard(false)} onDone={() => { setWizard(false); invalidate(); }} />}
    </div>
  );
}

function JiraWizard({ spaceId, onClose, onDone }: { spaceId: string; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [siteUrl, setSiteUrl] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [project, setProject] = useState<JiraProject | null>(null);
  const [statuses, setStatuses] = useState<JiraStatusOption[]>([]);
  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [boardId, setBoardId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const normSite = (s: string) => {
    const t = s.trim().replace(/\/+$/, "");
    return /^https?:\/\//.test(t) ? t : `https://${t}`;
  };

  const connect = async () => {
    setErr(null);
    setBusy(true);
    const r = await window.northstar!.jiraConnect(spaceId, { siteUrl: normSite(siteUrl), email: email.trim(), token: token.trim() });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error || "Connection failed");
      return;
    }
    setAccountId(r.accountId ?? null);
    try {
      setProjects(await jiraApi.projects(spaceId));
      setStep(2);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const pickProject = async (p: JiraProject) => {
    setProject(p);
    setBusy(true);
    try {
      const [sts, bds] = await Promise.all([jiraApi.statuses(spaceId, p.key), jiraApi.boards(spaceId, p.key)]);
      setStatuses(sts);
      setBoards(bds.filter((b) => b.type === "scrum"));
      setStep(3);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    // auto-resolve the "in review" status: an in-progress-category status named like review
    const review =
      statuses.find((s) => s.category === "indeterminate" && /review/i.test(s.name)) ?? null;
    try {
      await jiraApi.saveLink({
        spaceId,
        siteUrl: normSite(siteUrl),
        email: email.trim(),
        accountId,
        projectKey: project!.key,
        projectId: project!.id,
        boardId,
        reviewStatusId: review?.id ?? null,
      });
      await jiraApi.pull(spaceId, false).catch(() => {});
      onDone();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer" style={{ width: 460 }}>
        <h2 style={{ marginTop: 0 }}>Connect to Jira</h2>
        {err && <div style={{ color: "var(--rose)", marginBottom: 12 }}>{err}</div>}

        {step === 1 && (
          <>
            <p className="page-sub" style={{ marginTop: 0 }}>
              Use an Atlassian API token (id.atlassian.com → Security → API tokens). Stored encrypted in your Keychain.
            </p>
            <label className="page-sub">Site URL</label>
            <input className="inp" placeholder="your-site.atlassian.net" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} style={{ margin: "6px 0 14px" }} />
            <label className="page-sub">Email</label>
            <input className="inp" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ margin: "6px 0 14px" }} />
            <label className="page-sub">API token</label>
            <input className="inp" type="password" placeholder="paste token" value={token} onChange={(e) => setToken(e.target.value)} style={{ margin: "6px 0 18px" }} />
            <div className="toolbar">
              <button className="btn primary" disabled={busy || !siteUrl || !email || !token} onClick={connect}>
                {busy ? "Connecting…" : "Connect"}
              </button>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="section-title" style={{ marginTop: 0 }}>Pick a project</div>
            <div className="grid">
              {projects.map((p) => (
                <button key={p.id} className="btn" style={{ textAlign: "left" }} disabled={busy} onClick={() => pickProject(p)}>
                  <b>{p.key}</b> — {p.name}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 3 && project && (
          <>
            <div className="section-title" style={{ marginTop: 0 }}>Optional: link a Scrum board (for sprints)</div>
            <div className="grid" style={{ marginBottom: 14 }}>
              <button className={`btn ${boardId === null ? "primary" : ""}`} onClick={() => setBoardId(null)}>
                No board (no sprint tag)
              </button>
              {boards.map((b) => (
                <button key={b.id} className={`btn ${boardId === b.id ? "primary" : ""}`} onClick={() => setBoardId(b.id)}>
                  {b.name}
                </button>
              ))}
              {boards.length === 0 && <span className="page-sub">No Scrum boards on this project (Kanban has no sprints).</span>}
            </div>
            <div className="toolbar">
              <button className="btn primary" disabled={busy} onClick={finish}>
                {busy ? "Linking…" : `Link ${project.key} & pull`}
              </button>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

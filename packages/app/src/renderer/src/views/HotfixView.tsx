import { useState } from "react";
import { api } from "../api";
import { celebrate } from "../lib/confetti";

export function HotfixView() {
  const [title, setTitle] = useState("");
  const [repo, setRepo] = useState("");
  const [saved, setSaved] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    try {
      await api.hotfix({ title: title.trim(), repo: repo.trim() || undefined });
    } catch {
      /* fail silent — still acknowledge */
    }
    celebrate();
    setSaved(true);
    setTimeout(() => window.northstar?.closeHotfix(), 750);
  };

  return (
    <div className="hotfix">
      <div className="h">
        <span style={{ color: "var(--rose)" }}>⚡</span> Log a hotfix
      </div>
      {saved ? (
        <div style={{ color: "var(--green)", fontSize: 15, marginTop: 8 }}>Logged ✓ nice work</div>
      ) : (
        <>
          <input
            className="inp"
            autoFocus
            placeholder="What did you just fix?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") window.northstar?.closeHotfix();
            }}
          />
          <input
            className="inp"
            placeholder="repo (optional)"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <div className="row" style={{ marginTop: "auto" }}>
            <button className="btn primary" onClick={submit} disabled={!title.trim()}>
              Log it
            </button>
            <button className="btn ghost" onClick={() => window.northstar?.closeHotfix()}>
              Cancel
            </button>
            <span style={{ marginLeft: "auto", color: "var(--faint)", fontSize: 12 }}>
              <span className="kbd">↵</span> log · <span className="kbd">esc</span> close
            </span>
          </div>
        </>
      )}
    </div>
  );
}

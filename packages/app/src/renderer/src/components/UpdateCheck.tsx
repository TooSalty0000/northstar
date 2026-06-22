import { useState } from "react";

type State = "idle" | "checking" | "uptodate" | "found" | "error";

/** Manual "check for updates" control. On a hit, the UpdateBanner (top of main) takes over. */
export function UpdateCheck() {
  const [state, setState] = useState<State>("idle");
  const [version, setVersion] = useState("");

  const check = async () => {
    if (!window.northstar) return;
    setState("checking");
    try {
      const r = await window.northstar.checkForUpdate();
      setVersion(r.current);
      setState(r.update ? "found" : "uptodate");
    } catch {
      setState("error");
    }
  };

  const label =
    state === "checking"
      ? "Checking…"
      : state === "uptodate"
        ? `Up to date · v${version}`
        : state === "found"
          ? "Update available ↑"
          : state === "error"
            ? "Check failed — retry"
            : "Check for updates";

  return (
    <button
      className={`nav-item update-check ${state}`}
      onClick={check}
      disabled={state === "checking"}
      title="Check GitHub for a newer release"
    >
      <span className="ico">⟳</span>
      {label}
    </button>
  );
}

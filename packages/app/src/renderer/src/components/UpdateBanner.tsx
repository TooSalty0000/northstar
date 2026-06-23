import { useEffect, useState } from "react";

type Phase = "idle" | "downloading" | "ready" | "error";

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [percent, setPercent] = useState(0);
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const off = window.northstar?.onUpdateAvailable((u) => {
      setInfo(u);
      setDismissed(false);
      setPhase("idle");
    });
    const offP = window.northstar?.onUpdateProgress((p) => {
      setPercent(p.percent);
      setReceived(p.received ?? 0);
      setTotal(p.total ?? 0);
    });
    return () => {
      off?.();
      offP?.();
    };
  }, []);

  if (!info || dismissed) return null;

  const download = async () => {
    // No self-update artifact → fall back to opening the release page.
    if (!info.zipUrl) {
      window.northstar?.openUpdateUrl(info.url);
      return;
    }
    setError(null);
    setPercent(0);
    setReceived(0);
    setTotal(0);
    setPhase("downloading");
    try {
      const r = await window.northstar!.downloadUpdate();
      if (r.ok) setPhase("ready");
      else {
        setError(r.error ?? "Download failed");
        setPhase("error");
      }
    } catch (e: any) {
      // A rejected IPC must never leave the banner frozen at "starting".
      setError(e?.message ?? "Update failed unexpectedly");
      setPhase("error");
    }
  };

  const install = async () => {
    const r = await window.northstar!.installUpdate();
    if (!r.ok) {
      setError(r.error ?? "Install failed");
      setPhase("error");
    }
    // on success the app quits + relaunches; nothing more to do
  };

  return (
    <div className="update-banner" role="status">
      {phase === "idle" && (
        <>
          <span style={{ flex: 1 }}>
            <strong>Update available:</strong> {info.name} (v{info.version})
          </span>
          <button className="btn small" onClick={download}>
            {info.zipUrl ? "Download & install" : "Download"}
          </button>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => setDismissed(true)}>
            ×
          </button>
        </>
      )}

      {phase === "downloading" && (
        <>
          <span style={{ flex: 1 }}>
            Downloading v{info.version}…{" "}
            {total ? `${percent}%` : received ? `${(received / 1e6).toFixed(1)} MB` : "starting…"}
          </span>
          <div className="update-progress">
            <div
              className={total ? "" : "indeterminate"}
              style={total ? { width: `${percent}%` } : undefined}
            />
          </div>
        </>
      )}

      {phase === "ready" && (
        <>
          <span style={{ flex: 1 }}>
            <strong>v{info.version} ready.</strong> Restart to finish.
          </span>
          <button className="btn small" onClick={install}>
            Restart &amp; update
          </button>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => setDismissed(true)}>
            ×
          </button>
        </>
      )}

      {phase === "error" && (
        <>
          <span style={{ flex: 1 }}>⚠ {error}</span>
          <button className="btn small" onClick={() => window.northstar?.openUpdateUrl(info.url)}>
            Open release
          </button>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => setDismissed(true)}>
            ×
          </button>
        </>
      )}
    </div>
  );
}

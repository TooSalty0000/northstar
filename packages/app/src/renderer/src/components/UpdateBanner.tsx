import { useEffect, useState } from "react";

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const off = window.northstar?.onUpdateAvailable((u) => {
      setInfo(u);
      setDismissed(false);
    });
    return () => off?.();
  }, []);

  if (!info || dismissed) return null;
  return (
    <div className="update-banner" role="status">
      <span style={{ flex: 1 }}>
        <strong>Update available:</strong> {info.name} (v{info.version})
      </span>
      <button className="btn small" onClick={() => window.northstar?.openUpdateUrl(info.url)}>
        Download
      </button>
      <button className="icon-btn" aria-label="Dismiss" onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}

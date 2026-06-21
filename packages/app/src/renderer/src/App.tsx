import { useEffect, useState } from "react";
import type { ServerStatus } from "@northstar/shared";
import { useUI, type View } from "./store";
import { useSpaces } from "./api";
import { TodayView } from "./views/TodayView";
import { BoardView } from "./views/BoardView";
import { ReportView } from "./views/ReportView";
import { ProductivityView } from "./views/ProductivityView";
import { ConnectionsView } from "./views/ConnectionsView";
import { TaskDrawer } from "./components/TaskDrawer";
import { SpaceSwitcher } from "./components/SpaceSwitcher";

const NAV: { id: View; label: string; ico: string }[] = [
  { id: "today", label: "Today", ico: "✦" },
  { id: "board", label: "Board", ico: "▦" },
  { id: "report", label: "Daily report", ico: "✓" },
  { id: "productivity", label: "Productivity", ico: "📈" },
  { id: "connections", label: "Connections", ico: "🔌" },
];

const STATUS_TEXT: Record<ServerStatus, string> = {
  starting: "Starting…",
  running: "Connected",
  paused: "Paused",
  crashed: "Reconnecting…",
};

export function App() {
  const { view, setView, selectedTaskId, activeSpaceId, setSpace } = useUI();
  const [status, setStatus] = useState<ServerStatus>("starting");
  const { data: spaces } = useSpaces();

  useEffect(() => {
    window.northstar?.getServerStatus().then(setStatus).catch(() => {});
    const off = window.northstar?.onServerStatus((s) => setStatus(s));
    return () => off?.();
  }, []);

  // Land in a real Space (not "All") on first load — isolation-first.
  useEffect(() => {
    if (activeSpaceId === null && spaces && spaces.length) {
      setSpace((spaces.find((s) => s.isDefault) ?? spaces[0]).id);
    }
  }, [spaces, activeSpaceId, setSpace]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="star">✦</span> Northstar
        </div>
        <SpaceSwitcher />
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`nav-item ${view === n.id ? "active" : ""}`}
            onClick={() => setView(n.id)}
          >
            <span className="ico">{n.ico}</span>
            {n.label}
          </button>
        ))}
        <div className="spacer" />
        <div className="status-pill">
          <span className={`dot ${status}`} />
          {STATUS_TEXT[status]}
        </div>
      </aside>

      <main className="main">
        {view === "today" && <TodayView />}
        {view === "board" && <BoardView />}
        {view === "report" && <ReportView />}
        {view === "productivity" && <ProductivityView />}
        {view === "connections" && <ConnectionsView />}
      </main>

      {selectedTaskId && <TaskDrawer />}
    </div>
  );
}

import type { TaskStatus } from "@northstar/shared";
import { STATUS_LABELS } from "@northstar/shared";

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`badge ${status}`}>{STATUS_LABELS[status]}</span>;
}

export function MiniProgress({ pct }: { pct: number }) {
  return (
    <div className="mini" aria-label={`${Math.round(pct * 100)} percent`}>
      <div style={{ width: `${Math.round(pct * 100)}%` }} />
    </div>
  );
}

export function Pct({ value }: { value: number }) {
  return <span className="pct">{Math.round(value * 100)}%</span>;
}

export function Empty({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <div style={{ fontSize: 16, color: "var(--text)", marginBottom: 6 }}>{title}</div>
      {hint && <div>{hint}</div>}
    </div>
  );
}

export function relativeDays(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

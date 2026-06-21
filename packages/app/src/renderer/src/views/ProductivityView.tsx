import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStats } from "../api";

export function ProductivityView() {
  const { data } = useStats();
  const days = (data?.days ?? []).map((d) => ({
    label: d.localDate.slice(5), // MM-DD
    units: d.units,
  }));
  const you = data?.byActor?.user ?? 0;
  const claude = data?.byActor?.claude ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Productivity</h1>
          <div className="page-sub">Last 30 days of accomplishment</div>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat streak">
          <div className="n">🔥 {data?.streak ?? 0}</div>
          <div className="l">day streak</div>
        </div>
        <div className="stat">
          <div className="n">{data?.totals.units ?? 0}</div>
          <div className="l">total points</div>
        </div>
        <div className="stat">
          <div className="n">{data?.totals.tasks ?? 0}</div>
          <div className="l">tasks completed</div>
        </div>
        <div className="stat">
          <div className="n">{data?.totals.subtasks ?? 0}</div>
          <div className="l">steps checked</div>
        </div>
      </div>

      <div className="chart-card">
        <div className="section-title" style={{ marginTop: 0 }}>
          Points per day
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={days} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#222c3d" vertical={false} />
            <XAxis dataKey="label" stroke="#5c6675" fontSize={11} tickLine={false} interval="preserveStartEnd" />
            <YAxis stroke="#5c6675" fontSize={11} tickLine={false} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              contentStyle={{ background: "#141a24", border: "1px solid #2a3446", borderRadius: 10, color: "#e8eef6" }}
            />
            <Bar dataKey="units" fill="#45c46a" radius={[5, 5, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {you + claude > 0 && (
        <div className="chart-card" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            Who did the work
          </div>
          <div className="xp-track" style={{ height: 22 }}>
            <div
              style={{
                width: `${(you / (you + claude)) * 100}%`,
                height: "100%",
                background: "linear-gradient(90deg,#3a7bd5,#4493f8)",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 13 }}>
            <span style={{ color: "var(--blue)" }}>You — {you} pts</span>
            <span style={{ color: "var(--violet)" }}>Claude — {claude} pts</span>
          </div>
        </div>
      )}
    </>
  );
}

import { useMutation } from "@tanstack/react-query";
import { motion } from "motion/react";
import type { DailyReport } from "@northstar/shared";
import { api, useInvalidate, useStats } from "../api";
import { celebrate } from "../lib/confetti";

export function EndDayModal({ report, onClose }: { report: DailyReport; onClose: () => void }) {
  const invalidate = useInvalidate();
  const { data: stats } = useStats();
  const end = useMutation({
    mutationFn: () => api.endDay(report.localDate),
    onSuccess: () => {
      celebrate(true);
      invalidate();
      onClose();
    },
  });

  const msg =
    report.units === 0
      ? "A quiet day — rest counts too."
      : report.units < 5
        ? "Steady progress today."
        : report.units < 12
          ? "Solid day of work. ✦"
          : "Big day. Well done. ✦";

  return (
    <div className="endday-overlay" onClick={onClose}>
      <motion.div
        className="endday-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 22 }}
      >
        <div className="endday-star">✦</div>
        <h2 className="endday-title">Wrap up the day</h2>
        <div className="endday-sub">{report.localDate}</div>

        <div className="endday-stats">
          <div>
            <div className="n">{report.units}</div>
            <div className="l">points</div>
          </div>
          <div>
            <div className="n">{report.tasksCompleted.length}</div>
            <div className="l">tasks done</div>
          </div>
          <div>
            <div className="n">{report.subtasksChecked}</div>
            <div className="l">steps</div>
          </div>
          <div>
            <div className="n">{report.hotfixes.length}</div>
            <div className="l">hotfixes</div>
          </div>
        </div>

        {!!stats?.streak && <div className="endday-streak">🔥 {stats.streak}-day streak</div>}
        <div className="endday-msg">{msg}</div>

        <div className="endday-actions">
          <button className="btn primary" disabled={end.isPending} onClick={() => end.mutate()}>
            {end.isPending ? "Ending…" : "End my day"}
          </button>
          <button className="btn ghost" onClick={onClose}>
            Not yet
          </button>
        </div>
      </motion.div>
    </div>
  );
}

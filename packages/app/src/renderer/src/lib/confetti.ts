import confetti from "canvas-confetti";

let last = 0;

/** Debounced celebratory burst. Respects prefers-reduced-motion. */
export function celebrate(big = false) {
  const now = Date.now();
  if (now - last < 700) return;
  last = now;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  confetti({
    particleCount: big ? 150 : 55,
    spread: big ? 95 : 55,
    startVelocity: big ? 45 : 32,
    origin: { y: 0.75 },
    colors: ["#f5b942", "#45c46a", "#4493f8", "#a371f7", "#ffd874"],
  });
}

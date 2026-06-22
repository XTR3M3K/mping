export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 10) return `${ms.toFixed(2)}ms`;
  if (ms < 100) return `${ms.toFixed(1)}ms`;
  return `${ms.toFixed(0)}ms`;
}

export function fmtLoss(pct: number | null | undefined): string {
  if (pct == null) return "—";
  if (pct === 0) return "0%";
  if (pct < 1) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(0)}%`;
}

export function fmtRelTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function fmtClock(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Colour token for a loss percentage. */
export function lossColor(pct: number | null | undefined): string {
  if (pct == null) return "text-faint";
  if (pct === 0) return "text-good";
  if (pct < 5) return "text-warn";
  return "text-bad";
}

/** Deterministic accent colour per collector id, for overlay charts. */
const PALETTE = ["#7c5cff", "#22c55e", "#f59e0b", "#06b6d4", "#ec4899", "#a3e635", "#fb7185", "#38bdf8"];
export function collectorColor(id: number): string {
  return PALETTE[id % PALETTE.length]!;
}

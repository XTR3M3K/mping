import { useEffect, useRef, useState } from "react";
import type { SeriesPoint } from "@mping/shared";
import { useElementSize } from "../lib/useElementSize.js";
import { fmtMs, fmtLoss, fmtClock } from "../lib/format.js";

interface Props {
  points: SeriesPoint[];
  height?: number;
  /** Optional fixed x domain [from, to] in epoch ms for aligned charts. */
  domainX?: [number, number];
  thresholdMs?: number | null;
  /** Hide axes/labels for compact mini-charts. */
  compact?: boolean;
  /** Base hue for the smoke (accent by default). */
  baseColor?: string;
}

const ACCENT = { r: 124, g: 92, b: 255 };

/** Interpolate green→amber→red for a loss percentage. */
function lossRGB(pct: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [34, 197, 94]],
    [5, [245, 158, 11]],
    [40, [239, 68, 68]],
  ];
  if (pct <= 0) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i - 1]!;
    const [p2, c2] = stops[i]!;
    if (pct <= p2) {
      const f = (pct - p1) / (p2 - p1);
      return [
        Math.round(c1[0] + (c2[0] - c1[0]) * f),
        Math.round(c1[1] + (c2[1] - c1[1]) * f),
        Math.round(c1[2] + (c2[2] - c1[2]) * f),
      ];
    }
  }
  return stops[stops.length - 1]![1];
}

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow * 1.05;
}

export function SmokeChart({ points, height = 220, domainX, thresholdMs, compact, baseColor }: Props) {
  const [ref, { width }] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ x: number; idx: number } | null>(null);

  const padL = compact ? 4 : 48;
  const padR = compact ? 4 : 12;
  const padT = 8;
  const padB = compact ? 4 : 24;

  const accent = parseColor(baseColor) ?? ACCENT;

  // Compute domains
  const xs = points.map((p) => p.t);
  const x0 = domainX?.[0] ?? xs[0] ?? 0;
  const x1 = domainX?.[1] ?? xs[xs.length - 1] ?? 1;
  let yMaxRaw = 0;
  for (const p of points) {
    const top = p.bands[5] ?? p.bands[6] ?? p.median_ms ?? 0;
    if (top != null && top > yMaxRaw) yMaxRaw = top;
  }
  if (thresholdMs != null) yMaxRaw = Math.max(yMaxRaw, thresholdMs);
  const yMax = niceMax(yMaxRaw || 10);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const sx = (t: number) => padL + ((t - x0) / (x1 - x0 || 1)) * plotW;
    const sy = (v: number) => padT + (1 - v / yMax) * plotH;

    // Grid + y labels
    if (!compact) {
      ctx.font = "11px Inter, sans-serif";
      ctx.textBaseline = "middle";
      const ticks = 4;
      for (let i = 0; i <= ticks; i++) {
        const v = (yMax / ticks) * i;
        const y = sy(v);
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(width - padR, y);
        ctx.stroke();
        ctx.fillStyle = "#5a5f72";
        ctx.textAlign = "right";
        ctx.fillText(fmtMs(v), padL - 8, y);
      }
    }

    if (points.length === 0) return;

    // Smoke bands: nested fills (min..max, p10..p90, p25..p75)
    const bandPairs: [number, number, number][] = [
      [0, 6, 0.1],
      [1, 5, 0.16],
      [2, 4, 0.26],
    ];
    for (const [lo, hi, alpha] of bandPairs) {
      ctx.beginPath();
      let started = false;
      // upper edge L→R
      for (const p of points) {
        const top = p.bands[hi];
        if (top == null) {
          started = false;
          continue;
        }
        const X = sx(p.t);
        const Y = sy(top);
        if (!started) {
          ctx.moveTo(X, Y);
          started = true;
        } else ctx.lineTo(X, Y);
      }
      // lower edge R→L
      for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i]!;
        const bot = p.bands[lo];
        if (bot == null) continue;
        ctx.lineTo(sx(p.t), sy(bot));
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},${alpha})`;
      ctx.fill();
    }

    // Threshold line
    if (thresholdMs != null && !compact) {
      const y = sy(thresholdMs);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "rgba(239,68,68,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Median line, segment-colored by packet loss
    ctx.lineWidth = compact ? 1.25 : 1.75;
    ctx.lineJoin = "round";
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      if (a.median_ms == null || b.median_ms == null) continue;
      const [r, g, bl] = lossRGB(Math.max(a.loss_pct, b.loss_pct));
      ctx.strokeStyle = `rgb(${r},${g},${bl})`;
      ctx.beginPath();
      ctx.moveTo(sx(a.t), sy(a.median_ms));
      ctx.lineTo(sx(b.t), sy(b.median_ms));
      ctx.stroke();
    }

    // Loss markers along the bottom
    if (!compact) {
      for (const p of points) {
        if (p.loss_pct > 0) {
          const [r, g, bl] = lossRGB(p.loss_pct);
          ctx.fillStyle = `rgba(${r},${g},${bl},${Math.min(1, 0.3 + p.loss_pct / 100)})`;
          ctx.fillRect(sx(p.t) - 1, height - padB, 2, 4);
        }
      }
    }

    // Hover crosshair
    if (hover && points[hover.idx]) {
      const p = points[hover.idx]!;
      const X = sx(p.t);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(X, padT);
      ctx.lineTo(X, height - padB);
      ctx.stroke();
      if (p.median_ms != null) {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(X, sy(p.median_ms), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [points, width, height, x0, x1, yMax, thresholdMs, compact, hover, accent.r, accent.g, accent.b]);

  function onMove(e: React.MouseEvent) {
    if (points.length === 0) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const plotW = width - padL - padR;
    const frac = (x - padL) / (plotW || 1);
    const t = x0 + frac * (x1 - x0);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i]!.t - t);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setHover({ x, idx: best });
  }

  const hp = hover ? points[hover.idx] : null;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      />
      {hp && (
        <div
          className="pointer-events-none absolute z-10 card px-3 py-2 text-xs shadow-card"
          style={{
            left: Math.min(Math.max(hover!.x + 12, 8), width - 160),
            top: 8,
          }}
        >
          <div className="text-faint mb-1">{fmtClock(new Date(hp.t).toISOString())}</div>
          <Row label="Median" value={fmtMs(hp.median_ms)} />
          <Row label="Min / Max" value={`${fmtMs(hp.min_ms)} / ${fmtMs(hp.max_ms)}`} />
          <Row label="Loss" value={fmtLoss(hp.loss_pct)} />
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-gray-100">{value}</span>
    </div>
  );
}

function parseColor(hex?: string): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

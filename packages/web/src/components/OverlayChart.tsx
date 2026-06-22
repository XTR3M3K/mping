import { useEffect, useRef } from "react";
import type { CollectorSeries } from "@mping/shared";
import { useElementSize } from "../lib/useElementSize.js";
import { fmtMs } from "../lib/format.js";
import { collectorColor } from "../lib/format.js";

interface Props {
  series: CollectorSeries[];
  height?: number;
  domainX: [number, number];
  thresholdMs?: number | null;
}

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow * 1.05;
}

/** Overlays each collector's median latency line on shared axes. */
export function OverlayChart({ series, height = 280, domainX, thresholdMs }: Props) {
  const [ref, { width }] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padL = 48;
  const padR = 12;
  const padT = 10;
  const padB = 26;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    let yMaxRaw = thresholdMs ?? 0;
    for (const s of series) for (const p of s.points) if (p.median_ms != null && p.median_ms > yMaxRaw) yMaxRaw = p.median_ms;
    const yMax = niceMax(yMaxRaw || 10);

    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const sx = (t: number) => padL + ((t - domainX[0]) / (domainX[1] - domainX[0] || 1)) * plotW;
    const sy = (v: number) => padT + (1 - v / yMax) * plotH;

    ctx.font = "11px Inter, sans-serif";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const v = (yMax / 4) * i;
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

    if (thresholdMs != null) {
      const y = sy(thresholdMs);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "rgba(239,68,68,0.6)";
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const s of series) {
      ctx.strokeStyle = collectorColor(s.collector_id);
      ctx.lineWidth = 1.75;
      ctx.lineJoin = "round";
      ctx.beginPath();
      let started = false;
      for (const p of s.points) {
        if (p.median_ms == null) {
          started = false;
          continue;
        }
        const X = sx(p.t);
        const Y = sy(p.median_ms);
        if (!started) {
          ctx.moveTo(X, Y);
          started = true;
        } else ctx.lineTo(X, Y);
      }
      ctx.stroke();
    }
  }, [series, width, height, domainX, thresholdMs]);

  return (
    <div ref={ref} className="w-full" style={{ height }}>
      <canvas ref={canvasRef} style={{ width: "100%", height }} />
    </div>
  );
}

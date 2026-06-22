import { BAND_PERCENTILES } from "./sample.js";
import type { Route } from "./traceroute.js";

/** Linear-interpolated percentile of a sorted ascending array. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

/** Summary stats from a list of RTTs (ms). Empty list => all-loss. */
export function summarize(rtts: number[]): {
  min: number | null;
  max: number | null;
  avg: number | null;
  median: number | null;
  stddev: number | null;
} {
  if (rtts.length === 0) {
    return { min: null, max: null, avg: null, median: null, stddev: null };
  }
  const sorted = [...rtts].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sorted.length;
  const variance =
    sorted.reduce((a, b) => a + (b - avg) ** 2, 0) / sorted.length;
  return {
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    avg,
    median: percentile(sorted, 0.5),
    stddev: Math.sqrt(variance),
  };
}

/** Build the percentile-band ladder used by the smoke chart. */
export function computeBands(sortedRtts: number[]): (number | null)[] {
  return BAND_PERCENTILES.map((p) => percentile(sortedRtts, p));
}

/**
 * Stable identity hash of a route's hop IPs for change detection.
 * Uses FNV-1a (pure JS) so it runs in the browser, agent, and server alike.
 */
export function routeHash(hops: Route): string {
  const sig = hops.map((h) => `${h.ttl}:${h.ip ?? "*"}`).join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < sig.length; i++) {
    h ^= sig.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Compute added / removed / changed hops between two routes, keyed by ttl. */
export function diffRoutes(prev: Route, next: Route) {
  const prevByTtl = new Map(prev.map((h) => [h.ttl, h]));
  const nextByTtl = new Map(next.map((h) => [h.ttl, h]));
  const added: Route = [];
  const removed: Route = [];
  const changed: { ttl: number; from: Route[number] | null; to: Route[number] | null }[] = [];
  const ttls = new Set([...prevByTtl.keys(), ...nextByTtl.keys()]);
  for (const ttl of [...ttls].sort((a, b) => a - b)) {
    const p = prevByTtl.get(ttl) ?? null;
    const n = nextByTtl.get(ttl) ?? null;
    if (p && !n) removed.push(p);
    else if (!p && n) added.push(n);
    else if (p && n && (p.ip ?? "*") !== (n.ip ?? "*")) changed.push({ ttl, from: p, to: n });
  }
  return { added, removed, changed };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

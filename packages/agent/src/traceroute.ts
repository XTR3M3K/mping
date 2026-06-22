import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as dns } from "node:dns";
import type { Route } from "@mping/shared";

const exec = promisify(execFile);

// Reverse-DNS cache so stable routes don't re-resolve every cycle.
const DNS_TTL_MS = 60 * 60 * 1000;
const dnsCache = new Map<string, { host: string | null; at: number }>();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("dns timeout")), ms)),
  ]);
}

/** Best-effort PTR lookup for a hop IP (cached, time-boxed). */
async function reverseDns(ip: string): Promise<string | null> {
  const cached = dnsCache.get(ip);
  if (cached && Date.now() - cached.at < DNS_TTL_MS) return cached.host;
  let host: string | null = null;
  try {
    const names = await withTimeout(dns.reverse(ip), 1500);
    host = names[0] ?? null;
  } catch {
    host = null; // no PTR / private range / timeout
  }
  dnsCache.set(ip, { host, at: Date.now() });
  return host;
}

/** Populate each responding hop's `host` with its reverse-DNS name (parallel). */
async function resolveHostnames(route: Route): Promise<Route> {
  await Promise.all(
    route.map(async (h) => {
      if (h.ip) h.host = await reverseDns(h.ip);
    }),
  );
  return route;
}

interface MtrHub {
  count: number;
  host: string;
  "Loss%": number;
  Last: number;
  Avg: number;
}

/**
 * Try `mtr --json` first (per-hop loss/rtt), fall back to `traceroute`.
 * We keep numeric output (`-n`) so IPs stay stable for change detection, then
 * fill in reverse-DNS names separately for display.
 */
export async function traceOnce(host: string): Promise<Route> {
  let route: Route;
  try {
    route = await traceMtr(host);
  } catch {
    route = await traceTraceroute(host);
  }
  return resolveHostnames(route);
}

async function traceMtr(host: string): Promise<Route> {
  const { stdout } = await exec("mtr", ["--json", "-n", "-c", "1", "-G", "2", host], {
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });
  const data = JSON.parse(stdout) as { report?: { hubs?: MtrHub[] } };
  const hubs = data.report?.hubs ?? [];
  return hubs.map((h) => {
    const ip = !h.host || h.host === "???" ? null : h.host;
    return {
      ttl: h.count,
      host: null,
      ip,
      rtt_ms: ip ? (Number.isFinite(h.Last) ? h.Last : h.Avg) : null,
      loss_pct: Number.isFinite(h["Loss%"]) ? h["Loss%"] : null,
    };
  });
}

const LINE_RE = /^\s*(\d+)\s+(.*)$/;
const IP_RE = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|[0-9a-fA-F:]{3,})/;
const TIME_RE = /([\d.]+)\s*ms/;

async function traceTraceroute(host: string): Promise<Route> {
  const { stdout } = await exec("traceroute", ["-n", "-q", "1", "-w", "2", "-m", "30", host], {
    timeout: 90_000,
    maxBuffer: 1024 * 1024,
  });
  const route: Route = [];
  for (const line of stdout.split("\n")) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const ttl = Number(m[1]);
    const rest = m[2]!;
    const ipMatch = IP_RE.exec(rest);
    const timeMatch = TIME_RE.exec(rest);
    const responded = !rest.trim().startsWith("*") && ipMatch;
    route.push({
      ttl,
      host: null,
      ip: responded ? ipMatch![1]! : null,
      rtt_ms: timeMatch ? parseFloat(timeMatch[1]!) : null,
      loss_pct: responded ? 0 : 100,
    });
  }
  return route;
}

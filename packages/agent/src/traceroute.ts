import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Route } from "@mping/shared";

const exec = promisify(execFile);

interface MtrHub {
  count: number;
  host: string;
  "Loss%": number;
  Last: number;
  Avg: number;
}

/** Try `mtr --json` first (per-hop loss/rtt), fall back to `traceroute`. */
export async function traceOnce(host: string): Promise<Route> {
  try {
    return await traceMtr(host);
  } catch {
    return await traceTraceroute(host);
  }
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

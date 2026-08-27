import { defaultPort, summarize, type AgentTarget, type Sample } from "@mping/shared";
import { pingOnce } from "./ping.js";
import { tcpOnce } from "./tcp.js";
import { httpOnce } from "./http.js";

/**
 * tcp/http probes cost a real connection each, so a "20 pings" style count
 * would hammer the target. Cap the attempts and space them out.
 */
const MAX_CHECKS = 10;
const CHECK_GAP_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Assemble a Sample from the RTTs of `attempted` connection attempts. */
function toSample(targetId: number, startedAt: Date, attempted: number, rtts: number[]): Sample {
  const sorted = [...rtts].sort((a, b) => a - b);
  const stats = summarize(sorted);
  const loss = attempted > 0 ? ((attempted - sorted.length) / attempted) * 100 : 100;
  return {
    time: startedAt.toISOString(),
    target_id: targetId,
    loss_pct: Math.max(0, Math.min(100, loss)),
    min_ms: stats.min,
    max_ms: stats.max,
    avg_ms: stats.avg,
    median_ms: stats.median,
    stddev_ms: stats.stddev,
    rtts: sorted,
  };
}

function portOf(t: AgentTarget): number | null {
  return t.port ?? defaultPort(t.type);
}

/** Run `attempt` up to `ping_count` times, stopping before the cycle is up. */
async function repeat(t: AgentTarget, attempt: () => Promise<number | null>): Promise<Sample> {
  const startedAt = new Date();
  const checks = Math.min(Math.max(t.ping_count, 1), MAX_CHECKS);
  // Never let one cycle bleed into the next: a slow host with 10 checks and a
  // 5s timeout would otherwise take 50s on a 30s interval.
  const deadline = Date.now() + t.interval_sec * 800;
  const rtts: number[] = [];
  let attempted = 0;

  for (let i = 0; i < checks; i++) {
    if (i > 0 && Date.now() > deadline) break;
    const rtt = await attempt();
    attempted++;
    if (rtt != null) rtts.push(rtt);
    if (i < checks - 1) await sleep(CHECK_GAP_MS);
  }
  return toSample(t.id, startedAt, attempted, rtts);
}

/** Run one measurement cycle for a target, whatever kind of probe it is. */
export async function probeOnce(t: AgentTarget): Promise<Sample> {
  if (t.type === "ping") {
    return pingOnce(t.id, t.host, t.ping_count, t.packet_size, t.timeout_ms);
  }

  const port = portOf(t);
  if (port == null) throw new Error(`${t.type} probe for ${t.host} has no port`);

  if (t.type === "tcp") {
    return repeat(t, () => tcpOnce(t.host, port, t.timeout_ms));
  }

  const secure = t.type === "https";
  return repeat(t, () =>
    httpOnce({
      secure,
      host: t.host,
      port,
      path: t.http_path ?? "/",
      timeoutMs: t.timeout_ms,
      verifyTls: t.verify_tls,
      expectStatus: t.http_expect_status,
    }),
  );
}

/** A cycle that failed outright still deserves a data point: 100% loss. */
export function lossSample(targetId: number, startedAt: Date): Sample {
  return toSample(targetId, startedAt, 1, []);
}

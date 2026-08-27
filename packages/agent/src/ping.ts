import { execFile } from "node:child_process";
import { platform } from "node:os";
import { summarize, type Sample } from "@mping/shared";

const RTT_RE = /time[=<]\s*([\d.]+)\s*ms/gi;

/** Seconds between echoes on Linux; macOS needs root to go below 1s. */
const PING_GAP_SEC = 0.2;

/** Seconds one cycle may take: the sends themselves plus a reply window. */
function budgetSec(count: number, gapSec: number, timeoutMs: number): number {
  return Math.ceil(count * gapSec + timeoutMs / 1000 + 2);
}

/** Build platform-appropriate ping args (no root needed; uses system ping). */
function pingArgs(host: string, count: number, packetSize: number, timeoutMs: number): string[] {
  if (platform() === "darwin") {
    // macOS: -W is the per-reply wait in *milliseconds* and -t bounds the whole
    // run in seconds — passing a per-reply timeout to -t cuts the cycle short
    // and reports the unsent echoes as loss. Sub-second -i needs root.
    return [
      "-c", String(count),
      "-W", String(timeoutMs),
      "-t", String(budgetSec(count, 1, timeoutMs)),
      "-s", String(packetSize),
      host,
    ];
  }
  // Linux iputils: -i interval, -W per-reply timeout (whole seconds), -s payload.
  const waitSec = Math.max(1, Math.round(timeoutMs / 1000));
  return [
    "-c", String(count),
    "-i", String(PING_GAP_SEC),
    "-W", String(waitSec),
    "-w", String(budgetSec(count, PING_GAP_SEC, timeoutMs)),
    "-s", String(packetSize),
    host,
  ];
}

/**
 * Run one ping cycle. Resolves a Sample even on total loss (rtts empty).
 * Never rejects on non-zero exit (ping exits 1 on loss).
 */
export function pingOnce(
  targetId: number,
  host: string,
  count: number,
  packetSize: number,
  timeoutMs = 1000,
): Promise<Sample> {
  const startedAt = new Date();
  const gapSec = platform() === "darwin" ? 1 : PING_GAP_SEC;
  return new Promise((resolve) => {
    execFile(
      "ping",
      pingArgs(host, count, packetSize, timeoutMs),
      // Backstop only: ping's own -t/-w should end the run well before this.
      { timeout: (budgetSec(count, gapSec, timeoutMs) + 10) * 1000, maxBuffer: 1024 * 1024 },
      (_err, stdout) => {
        const rtts: number[] = [];
        let m: RegExpExecArray | null;
        RTT_RE.lastIndex = 0;
        while ((m = RTT_RE.exec(stdout)) !== null) rtts.push(parseFloat(m[1]!));
        const received = rtts.length;
        const loss_pct = count > 0 ? ((count - received) / count) * 100 : 100;
        const sorted = [...rtts].sort((a, b) => a - b);
        const stats = summarize(sorted);
        resolve({
          time: startedAt.toISOString(),
          target_id: targetId,
          loss_pct: Math.max(0, Math.min(100, loss_pct)),
          min_ms: stats.min,
          max_ms: stats.max,
          avg_ms: stats.avg,
          median_ms: stats.median,
          stddev_ms: stats.stddev,
          rtts: sorted,
        });
      },
    );
  });
}

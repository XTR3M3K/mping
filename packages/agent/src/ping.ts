import { execFile } from "node:child_process";
import { platform } from "node:os";
import { summarize, type Sample } from "@mping/shared";

const RTT_RE = /time[=<]\s*([\d.]+)\s*ms/gi;

/** Build platform-appropriate ping args (no root needed; uses system ping). */
function pingArgs(host: string, count: number, packetSize: number): string[] {
  const isMac = platform() === "darwin";
  if (isMac) {
    // macOS: -i below 1s needs root; keep default interval. -s sets payload size.
    return ["-c", String(count), "-t", "5", "-s", String(packetSize), host];
  }
  // Linux iputils: -i interval, -W per-reply timeout (s), -s payload size.
  return ["-c", String(count), "-i", "0.2", "-W", "1", "-s", String(packetSize), host];
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
): Promise<Sample> {
  const startedAt = new Date();
  return new Promise((resolve) => {
    execFile(
      "ping",
      pingArgs(host, count, packetSize),
      { timeout: (count + 10) * 1000, maxBuffer: 1024 * 1024 },
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

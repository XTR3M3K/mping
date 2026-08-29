import type { AgentTarget, Sample } from "@mping/shared";
import { loadConfig } from "./config.js";
import { ServerClient, HttpError } from "./client.js";
import { probeOnce, lossSample } from "./probe.js";
import { traceOnce } from "./traceroute.js";
import { Limiter } from "./limiter.js";

const cfg = loadConfig();
const client = new ServerClient(cfg);

// Probes are capped so a large target list can't spawn hundreds of pings (or
// sockets) at once — that used to starve the event loop and drop whole cycles.
const probeLimiter = new Limiter(cfg.maxConcurrentProbes);
const traceLimiter = new Limiter(cfg.maxConcurrentTraceroutes);

// ── Resilient sample buffer: survives transient server outages ──
const MAX_BUFFER = 5000;
let buffer: Sample[] = [];

function enqueue(sample: Sample): void {
  buffer.push(sample);
  if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
}

async function flushLoop(): Promise<void> {
  for (;;) {
    if (buffer.length > 0) {
      const batch = buffer.slice(0, 500);
      try {
        await client.pushSamples(batch);
        buffer = buffer.slice(batch.length);
      } catch (err) {
        // A batch the server refuses outright (bad request) would otherwise be
        // retried forever, freezing every other probe's history behind it.
        // 401/403/429 are transient (rotated token, rate limit) — keep those.
        const fatal =
          err instanceof HttpError &&
          err.status >= 400 &&
          err.status < 500 &&
          ![401, 403, 429].includes(err.status);
        if (fatal) {
          console.warn(
            `[flush] server rejected ${batch.length} sample(s): ${(err as Error).message} — dropping`,
          );
          buffer = buffer.slice(batch.length);
        } else {
          console.warn(`[flush] ${(err as Error).message} — buffered ${buffer.length}`);
        }
      }
    }
    await sleep(2000);
  }
}

// ── Per-target runner ──
class TargetRunner {
  private stopped = false;
  constructor(public target: AgentTarget) {}

  start(): void {
    void this.loop(this.target.interval_sec, probeLimiter, () => this.probe());
    if (this.target.traceroute_enabled) {
      void this.loop(this.target.traceroute_interval_sec, traceLimiter, () => this.trace());
    }
  }

  stop(): void {
    this.stopped = true;
  }

  /**
   * Fixed-cadence scheduler: ticks are absolute so a slow cycle doesn't push
   * every later one back, and the first tick is jittered so N targets don't all
   * fire in the same instant after a config reload.
   */
  private async loop(intervalSec: number, limiter: Limiter, run: () => Promise<void>): Promise<void> {
    const period = intervalSec * 1000;
    let next = Date.now() + Math.random() * Math.min(period, 10_000);
    while (!this.stopped) {
      await sleep(Math.max(0, next - Date.now()));
      if (this.stopped) return;
      await limiter.run(run);
      next += period;
      // Fell far behind (suspended laptop, overloaded host): resync instead of
      // firing a burst of catch-up cycles.
      if (next < Date.now()) next = Date.now() + period;
    }
  }

  private async probe(): Promise<void> {
    const t = this.target;
    const startedAt = new Date();
    try {
      enqueue(await probeOnce(t));
    } catch (err) {
      // A probe that couldn't even run is an outage, not a missing data point.
      console.warn(`[probe ${t.type} ${t.host}] ${(err as Error).message}`);
      enqueue(lossSample(t.id, startedAt));
    }
  }

  /** Trace right now, outside the normal cadence (a UI "run now" request). */
  async traceNow(): Promise<void> {
    if (this.stopped) return;
    await traceLimiter.run(() => this.trace());
  }

  private async trace(): Promise<void> {
    const t = this.target;
    try {
      const hops = await traceOnce(t.host);
      if (hops.length > 0) await client.pushTraceroute(t.id, hops);
    } catch (err) {
      console.warn(`[trace ${t.host}] ${(err as Error).message}`);
    }
  }
}

const runners = new Map<number, TargetRunner>();

function reconcile(targets: AgentTarget[]): void {
  const seen = new Set<number>();
  for (const t of targets) {
    seen.add(t.id);
    const existing = runners.get(t.id);
    if (!existing) {
      const r = new TargetRunner(t);
      runners.set(t.id, r);
      r.start();
      console.log(`+ target ${t.id} ${t.type} ${t.host} (every ${t.interval_sec}s)`);
    } else if (JSON.stringify(existing.target) !== JSON.stringify(t)) {
      existing.stop();
      const r = new TargetRunner(t);
      runners.set(t.id, r);
      r.start();
      console.log(`~ target ${t.id} ${t.host} reconfigured`);
    }
  }
  for (const [id, r] of runners) {
    if (!seen.has(id)) {
      r.stop();
      runners.delete(id);
      // Drop anything still buffered for it so a deleted probe can't keep
      // pushing samples the server will reject.
      buffer = buffer.filter((s) => s.target_id !== id);
      console.log(`- target ${id} removed`);
    }
  }
}

/**
 * Claim queued instructions. Kept separate from the config poll because it runs
 * far more often — it is what makes the UI's "trace now" button feel immediate.
 */
async function commandLoop(): Promise<void> {
  for (;;) {
    try {
      for (const cmd of await client.fetchCommands()) {
        const runner = runners.get(cmd.target_id);
        if (!runner) continue;
        console.log(`! traceroute now for target ${cmd.target_id}`);
        void runner.traceNow();
      }
    } catch (err) {
      console.warn(`[commands] ${(err as Error).message}`);
    }
    await sleep(cfg.commandPollSec * 1000);
  }
}

async function configLoop(): Promise<void> {
  for (;;) {
    try {
      const config = await client.fetchConfig();
      reconcile(config.targets);
    } catch (err) {
      console.warn(`[config] ${(err as Error).message}`);
    }
    await sleep(cfg.configRefreshSec * 1000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log(`mping-agent "${cfg.name}" → ${cfg.server}`);
  for (let i = 0; ; i++) {
    try {
      await client.register();
      break;
    } catch (err) {
      console.warn(`[register] ${(err as Error).message} — retrying`);
      await sleep(Math.min(30_000, 2000 * (i + 1)));
    }
  }
  void flushLoop();
  void commandLoop();
  await configLoop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

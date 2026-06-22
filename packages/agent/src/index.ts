import type { AgentTarget, Sample } from "@mping/shared";
import { loadConfig } from "./config.js";
import { ServerClient } from "./client.js";
import { pingOnce } from "./ping.js";
import { traceOnce } from "./traceroute.js";

const cfg = loadConfig();
const client = new ServerClient(cfg);

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
        console.warn(`[flush] ${(err as Error).message} — buffered ${buffer.length}`);
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
    void this.pingLoop();
    if (this.target.traceroute_enabled) void this.traceLoop();
  }

  stop(): void {
    this.stopped = true;
  }

  private async pingLoop(): Promise<void> {
    while (!this.stopped) {
      const t = this.target;
      try {
        const sample = await pingOnce(t.id, t.host, t.ping_count, t.packet_size);
        enqueue(sample);
      } catch (err) {
        console.warn(`[ping ${t.host}] ${(err as Error).message}`);
      }
      await sleep(this.target.interval_sec * 1000);
    }
  }

  private async traceLoop(): Promise<void> {
    while (!this.stopped) {
      const t = this.target;
      try {
        const hops = await traceOnce(t.host);
        if (hops.length > 0) await client.pushTraceroute(t.id, hops);
      } catch (err) {
        console.warn(`[trace ${t.host}] ${(err as Error).message}`);
      }
      await sleep(this.target.traceroute_interval_sec * 1000);
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
      console.log(`+ target ${t.id} ${t.host} (ping ${t.interval_sec}s)`);
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
      console.log(`- target ${id} removed`);
    }
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
  await configLoop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

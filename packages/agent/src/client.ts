import { AgentConfigSchema, type AgentConfig, type Sample, type Route } from "@mping/shared";
import type { AgentConfig as RuntimeConfig } from "./config.js";

export class ServerClient {
  constructor(private readonly cfg: RuntimeConfig) {}

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.cfg.token}`,
      "content-type": "application/json",
    };
  }

  async register(): Promise<void> {
    const res = await fetch(`${this.cfg.server}/api/agent/register`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ name: this.cfg.name }),
    });
    if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  }

  async fetchConfig(): Promise<AgentConfig> {
    const res = await fetch(`${this.cfg.server}/api/agent/config`, { headers: this.headers() });
    if (!res.ok) throw new Error(`config fetch failed: ${res.status}`);
    return AgentConfigSchema.parse(await res.json());
  }

  async pushSamples(samples: Sample[]): Promise<void> {
    if (samples.length === 0) return;
    const res = await fetch(`${this.cfg.server}/api/agent/samples`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ samples }),
    });
    if (!res.ok) throw new Error(`sample push failed: ${res.status} ${await res.text()}`);
  }

  async pushTraceroute(targetId: number, hops: Route): Promise<void> {
    const res = await fetch(`${this.cfg.server}/api/agent/traceroute`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ target_id: targetId, run_at: new Date().toISOString(), hops }),
    });
    if (!res.ok) throw new Error(`traceroute push failed: ${res.status} ${await res.text()}`);
  }
}

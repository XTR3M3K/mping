import {
  AgentCommandsSchema,
  AgentConfigSchema,
  type AgentCommand,
  type AgentConfig,
  type Route,
  type Sample,
} from "@mping/shared";
import type { AgentConfig as RuntimeConfig } from "./config.js";

/** Carries the status code so callers can tell "retry later" from "give up". */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class ServerClient {
  constructor(private readonly cfg: RuntimeConfig) {}

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.cfg.token}`,
      "content-type": "application/json",
    };
  }

  private async post(path: string, body: unknown, what: string): Promise<void> {
    const res = await fetch(`${this.cfg.server}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new HttpError(res.status, `${what} failed: ${res.status} ${await res.text()}`);
  }

  async register(): Promise<void> {
    await this.post("/api/agent/register", { name: this.cfg.name }, "register");
  }

  async fetchConfig(): Promise<AgentConfig> {
    const res = await fetch(`${this.cfg.server}/api/agent/config`, { headers: this.headers() });
    if (!res.ok) throw new HttpError(res.status, `config fetch failed: ${res.status}`);
    return AgentConfigSchema.parse(await res.json());
  }

  /** Claim any one-shot instructions the server has queued for us. */
  async fetchCommands(): Promise<AgentCommand[]> {
    const res = await fetch(`${this.cfg.server}/api/agent/commands`, { headers: this.headers() });
    if (!res.ok) throw new HttpError(res.status, `command fetch failed: ${res.status}`);
    return AgentCommandsSchema.parse(await res.json()).commands;
  }

  async pushSamples(samples: Sample[]): Promise<void> {
    if (samples.length === 0) return;
    await this.post("/api/agent/samples", { samples }, "sample push");
  }

  async pushTraceroute(targetId: number, hops: Route): Promise<void> {
    await this.post(
      "/api/agent/traceroute",
      { target_id: targetId, run_at: new Date().toISOString(), hops },
      "traceroute push",
    );
  }
}

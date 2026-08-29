function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface AgentConfig {
  server: string;
  token: string;
  name: string;
  /** How often to re-pull the target list from the server (seconds). */
  configRefreshSec: number;
  /** How often to claim one-shot instructions (e.g. "traceroute now"). */
  commandPollSec: number;
  /** Upper bound on probe cycles running at the same instant. */
  maxConcurrentProbes: number;
  /** Traceroutes are far heavier than a probe, so they get their own budget. */
  maxConcurrentTraceroutes: number;
}

export function loadConfig(): AgentConfig {
  const server = (arg("--server") ?? process.env.MPING_SERVER ?? "http://localhost:4420").replace(/\/$/, "");
  const token = arg("--token") ?? process.env.MPING_TOKEN ?? "";
  const name = arg("--name") ?? process.env.MPING_NAME ?? "local";
  if (!token) {
    console.error("Missing collector token. Pass --token <token> or set MPING_TOKEN.");
    process.exit(1);
  }
  return {
    server,
    token,
    name,
    configRefreshSec: num(process.env.MPING_CONFIG_REFRESH_SEC, 30),
    commandPollSec: num(process.env.MPING_COMMAND_POLL_SEC, 5),
    maxConcurrentProbes: num(process.env.MPING_MAX_CONCURRENT_PROBES, 32),
    maxConcurrentTraceroutes: num(process.env.MPING_MAX_CONCURRENT_TRACEROUTES, 4),
  };
}

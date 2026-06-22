function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export interface AgentConfig {
  server: string;
  token: string;
  name: string;
  /** How often to re-pull the target list from the server (seconds). */
  configRefreshSec: number;
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
    configRefreshSec: Number(process.env.MPING_CONFIG_REFRESH_SEC ?? 60),
  };
}

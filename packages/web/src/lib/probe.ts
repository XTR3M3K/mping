import { defaultPort, type Target } from "@mping/shared";

/**
 * What the probe actually talks to, rendered the way an operator would type it:
 * a bare host for ICMP, `host:port` for TCP, a full URL for HTTP(S).
 */
export function probeAddress(t: Target): string {
  const port = t.port ?? defaultPort(t.type);
  if (t.type === "ping") return t.host;
  if (t.type === "tcp") return `${t.host}:${port ?? "?"}`;
  const scheme = t.type;
  const shown = (scheme === "https" && port === 443) || (scheme === "http" && port === 80) ? "" : `:${port}`;
  const path = t.http_path && t.http_path !== "/" ? t.http_path : "";
  return `${scheme}://${t.host}${shown}${path}`;
}

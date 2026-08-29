import type {
  AlertEvent,
  Collector,
  MultiSeriesResponse,
  SeriesResponse,
  Settings,
  Target,
  TargetCreate,
  TargetUpdate,
  TracerouteView,
} from "@mping/shared";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // Only declare a JSON content-type when we actually send a body, otherwise
  // an empty application/json request is rejected by the server parser.
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (init?.body != null) headers["content-type"] = "application/json";
  const res = await fetch(`/api${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
  return data as T;
}

export const api = {
  // auth
  me: () => req<{ authed: boolean }>("/auth/me"),
  login: (password: string) =>
    req<{ ok: true }>("/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => req<{ ok: true }>("/auth/logout", { method: "POST" }),
  changePassword: (current: string, next: string) =>
    req("/auth/password", { method: "POST", body: JSON.stringify({ current, next }) }),

  // targets
  listTargets: () => req<Target[]>("/targets"),
  getTarget: (id: number) => req<Target>(`/targets/${id}`),
  createTarget: (body: TargetCreate) =>
    req<Target>("/targets", { method: "POST", body: JSON.stringify(body) }),
  updateTarget: (id: number, body: TargetUpdate) =>
    req<Target>(`/targets/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteTarget: (id: number) => req<void>(`/targets/${id}`, { method: "DELETE" }),
  /** Renew a live watch so collectors probe this target faster while watched. */
  keepLive: (id: number, interval_sec: number) =>
    req<{ interval_sec: number; ttl_sec: number }>(`/targets/${id}/live`, {
      method: "POST",
      body: JSON.stringify({ interval_sec }),
    }),

  // collectors
  listCollectors: () => req<Collector[]>("/collectors"),
  createCollector: (name: string, location_label?: string) =>
    req<{ id: number; name: string; token: string }>("/collectors", {
      method: "POST",
      body: JSON.stringify({ name, location_label }),
    }),
  rotateCollectorToken: (id: number) =>
    req<{ token: string }>(`/collectors/${id}/token`, { method: "POST" }),
  deleteCollector: (id: number) => req<void>(`/collectors/${id}`, { method: "DELETE" }),

  // series + traceroute
  series: (id: number, from: number, to: number, collectorIds?: number[], res?: "raw" | "5m" | "1h") => {
    const p = new URLSearchParams({ from: String(from), to: String(to) });
    if (collectorIds?.length) p.set("collectorIds", collectorIds.join(","));
    if (res) p.set("res", res);
    return req<SeriesResponse>(`/targets/${id}/series?${p}`);
  },
  /** One request for the whole dashboard grid instead of one per card. */
  multiSeries: (targetIds: number[], from: number, to: number) => {
    const p = new URLSearchParams({
      targetIds: targetIds.join(","),
      from: String(from),
      to: String(to),
    });
    return req<MultiSeriesResponse>(`/series?${p}`);
  },
  traceroute: (id: number, collectorId: number) =>
    req<TracerouteView>(`/targets/${id}/traceroute?collectorId=${collectorId}`),
  /** Ask collectors to trace this target right away. */
  runTraceroute: (id: number, collectorId?: number) =>
    req<{ queued: number }>(
      `/targets/${id}/traceroute/run${collectorId != null ? `?collectorId=${collectorId}` : ""}`,
      { method: "POST" },
    ),
  tracerouteCollectors: (id: number) =>
    req<{ collector_id: number; name: string; run_at: string }[]>(
      `/targets/${id}/traceroute/collectors`,
    ),

  // alerts + settings
  alerts: (params?: { targetId?: number; kind?: string; limit?: number }) => {
    const p = new URLSearchParams();
    if (params?.targetId) p.set("targetId", String(params.targetId));
    if (params?.kind) p.set("kind", params.kind);
    if (params?.limit) p.set("limit", String(params.limit));
    return req<AlertEvent[]>(`/alerts?${p}`);
  },
  getSettings: () => req<Settings>("/settings"),
  updateSettings: (patch: Partial<Settings>) =>
    req<Settings>("/settings", { method: "PUT", body: JSON.stringify(patch) }),
};

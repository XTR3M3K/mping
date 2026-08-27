import { ProbeTypeSchema, type ProbeType, type Target } from "@mping/shared";
import { query } from "./db.js";

export interface TargetRow {
  id: number;
  name: string;
  host: string;
  type: string;
  group_name: string | null;
  interval_sec: number;
  ping_count: number;
  packet_size: number;
  port: number | null;
  http_path: string | null;
  http_expect_status: number | null;
  verify_tls: boolean;
  timeout_ms: number;
  enabled: boolean;
  latency_threshold_ms: number | null;
  alert_on_loss_pct: number | null;
  traceroute_enabled: boolean;
  traceroute_interval_sec: number;
  discord_webhook_url: string | null;
  created_at: Date;
}

/** Rows written before probe types existed default back to ping. */
function rowType(value: string): ProbeType {
  const parsed = ProbeTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : "ping";
}

export function mapTarget(r: TargetRow): Target {
  return {
    id: r.id,
    name: r.name,
    host: r.host,
    type: rowType(r.type),
    group_name: r.group_name,
    interval_sec: r.interval_sec,
    ping_count: r.ping_count,
    packet_size: r.packet_size,
    port: r.port,
    http_path: r.http_path,
    http_expect_status: r.http_expect_status,
    verify_tls: r.verify_tls,
    timeout_ms: r.timeout_ms,
    enabled: r.enabled,
    latency_threshold_ms: r.latency_threshold_ms,
    alert_on_loss_pct: r.alert_on_loss_pct,
    traceroute_enabled: r.traceroute_enabled,
    traceroute_interval_sec: r.traceroute_interval_sec,
    discord_webhook_url: r.discord_webhook_url,
    created_at: r.created_at.toISOString(),
  };
}

export async function getTargetById(id: number): Promise<Target | null> {
  const { rows } = await query<TargetRow>(`SELECT * FROM targets WHERE id = $1`, [id]);
  return rows[0] ? mapTarget(rows[0]) : null;
}

export async function listTargets(): Promise<Target[]> {
  const { rows } = await query<TargetRow>(`SELECT * FROM targets ORDER BY group_name NULLS FIRST, name`);
  return rows.map(mapTarget);
}

/** Fetch several targets at once, keyed by id (used by the ingest path). */
export async function getTargetsByIds(ids: number[]): Promise<Map<number, Target>> {
  if (ids.length === 0) return new Map();
  const { rows } = await query<TargetRow>(`SELECT * FROM targets WHERE id = ANY($1)`, [ids]);
  return new Map(rows.map((r) => [r.id, mapTarget(r)]));
}

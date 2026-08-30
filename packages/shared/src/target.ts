import { z } from "zod";

/**
 * What a probe actually measures:
 * - `ping`  ICMP echo round-trip (classic smokeping)
 * - `tcp`   time to complete a TCP handshake on `port`
 * - `http`  / `https` time to first response byte for a GET on `port`+`http_path`
 *
 * All four produce the same {@link Sample} shape (a vector of RTTs plus a loss
 * percentage), so charts, alerts and aggregates stay type-agnostic.
 */
export const ProbeTypeSchema = z.enum(["ping", "tcp", "http", "https"]);
export type ProbeType = z.infer<typeof ProbeTypeSchema>;

/** Port used when a http/https probe leaves `port` blank. */
export function defaultPort(type: ProbeType): number | null {
  if (type === "http") return 80;
  if (type === "https") return 443;
  return null;
}

/** Human label for a probe type, used in the UI and Discord embeds. */
export function probeLabel(type: ProbeType): string {
  return type === "ping" ? "ICMP" : type.toUpperCase();
}

export const TargetSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  host: z.string().min(1),
  type: ProbeTypeSchema,
  group_name: z.string().nullable(),
  interval_sec: z.number().int().min(5).max(3600),
  /** Echoes (ping) or connection attempts (tcp/http) per cycle. */
  ping_count: z.number().int().min(1).max(100),
  /** ICMP payload size; ignored by tcp/http probes. */
  packet_size: z.number().int().min(16).max(65500),
  /** tcp: required. http/https: defaults to 80/443 when null. */
  port: z.number().int().min(1).max(65535).nullable(),
  /** Request path for http/https probes; defaults to "/" when null. */
  http_path: z.string().nullable(),
  /** Exact status code to require; null accepts anything below 400. */
  http_expect_status: z.number().int().min(100).max(599).nullable(),
  /** Reject self-signed / expired certificates on https probes. */
  verify_tls: z.boolean(),
  /** Per-attempt timeout for tcp/http probes (ms). */
  timeout_ms: z.number().int().min(100).max(60000),
  enabled: z.boolean(),
  /** Alert when median RTT exceeds this (ms). Null disables latency alerts. */
  latency_threshold_ms: z.number().min(0).nullable(),
  /** Alert when loss exceeds this percent. Null disables loss alerts. */
  alert_on_loss_pct: z.number().min(0).max(100).nullable(),
  traceroute_enabled: z.boolean(),
  /** Traceroute cadence in seconds. */
  traceroute_interval_sec: z.number().int().min(30).max(86400),
  /** Per-target Discord webhook override; falls back to global when null. */
  discord_webhook_url: z.string().url().nullable(),
  created_at: z.string(),
});
export type Target = z.infer<typeof TargetSchema>;

export const TargetCreateSchema = TargetSchema.omit({
  id: true,
  created_at: true,
})
  .partial({
    type: true,
    group_name: true,
    packet_size: true,
    ping_count: true,
    interval_sec: true,
    port: true,
    http_path: true,
    http_expect_status: true,
    verify_tls: true,
    timeout_ms: true,
    enabled: true,
    latency_threshold_ms: true,
    alert_on_loss_pct: true,
    traceroute_enabled: true,
    traceroute_interval_sec: true,
    discord_webhook_url: true,
  })
  .extend({
    name: z.string().min(1),
    host: z.string().min(1),
  })
  .superRefine((v, ctx) => {
    if ((v.type ?? "ping") === "tcp" && v.port == null) {
      ctx.addIssue({ code: "custom", path: ["port"], message: "TCP probes need a port" });
    }
  });
export type TargetCreate = z.infer<typeof TargetCreateSchema>;

/** Same fields as create, all optional — a PATCH body. */
export const TargetUpdateSchema = TargetSchema.omit({ id: true, created_at: true })
  .partial()
  .superRefine((v, ctx) => {
    if (v.type === "tcp" && v.port === null) {
      ctx.addIssue({ code: "custom", path: ["port"], message: "TCP probes need a port" });
    }
  });
export type TargetUpdate = z.infer<typeof TargetUpdateSchema>;

/** Bulk create from a CSV import. */
export const TargetImportSchema = z.object({
  rows: z.array(TargetCreateSchema).min(1).max(500),
  /** What to do with a probe whose name already exists. */
  mode: z.enum(["skip", "update"]).default("skip"),
});
export type TargetImport = z.infer<typeof TargetImportSchema>;

export const ImportRowResultSchema = z.object({
  /** Index into the submitted rows, so the UI can point at the right line. */
  index: z.number().int(),
  name: z.string(),
  status: z.enum(["created", "updated", "skipped", "failed"]),
  error: z.string().optional(),
});
export type ImportRowResult = z.infer<typeof ImportRowResultSchema>;

export const TargetImportResultSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  rows: z.array(ImportRowResultSchema),
});
export type TargetImportResult = z.infer<typeof TargetImportResultSchema>;

/**
 * Slim view of a target an agent needs to do its job. Probe-type fields carry
 * defaults so a freshly updated agent still works against a server that hasn't
 * been upgraded yet.
 */
export const AgentTargetSchema = z.object({
  id: z.number().int(),
  host: z.string(),
  type: ProbeTypeSchema.default("ping"),
  interval_sec: z.number().int(),
  ping_count: z.number().int(),
  packet_size: z.number().int(),
  port: z.number().int().nullable().default(null),
  http_path: z.string().nullable().default(null),
  http_expect_status: z.number().int().nullable().default(null),
  verify_tls: z.boolean().default(true),
  timeout_ms: z.number().int().default(5000),
  traceroute_enabled: z.boolean(),
  traceroute_interval_sec: z.number().int(),
});
export type AgentTarget = z.infer<typeof AgentTargetSchema>;

export const AgentConfigSchema = z.object({
  collector_id: z.number().int(),
  targets: z.array(AgentTargetSchema),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

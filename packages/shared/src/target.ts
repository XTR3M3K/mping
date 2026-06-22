import { z } from "zod";

/** Configuration for a monitored target (v1: ping only). */
export const TargetSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  host: z.string().min(1),
  type: z.literal("ping"),
  group_name: z.string().nullable(),
  interval_sec: z.number().int().min(5).max(3600),
  ping_count: z.number().int().min(1).max(100),
  packet_size: z.number().int().min(16).max(65500),
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
  type: true,
}).partial({
  group_name: true,
  packet_size: true,
  ping_count: true,
  interval_sec: true,
  enabled: true,
  latency_threshold_ms: true,
  alert_on_loss_pct: true,
  traceroute_enabled: true,
  traceroute_interval_sec: true,
  discord_webhook_url: true,
}).extend({
  name: z.string().min(1),
  host: z.string().min(1),
});
export type TargetCreate = z.infer<typeof TargetCreateSchema>;

export const TargetUpdateSchema = TargetCreateSchema.partial();
export type TargetUpdate = z.infer<typeof TargetUpdateSchema>;

/** Slim view of a target an agent needs to do its job. */
export const AgentTargetSchema = z.object({
  id: z.number().int(),
  host: z.string(),
  interval_sec: z.number().int(),
  ping_count: z.number().int(),
  packet_size: z.number().int(),
  traceroute_enabled: z.boolean(),
  traceroute_interval_sec: z.number().int(),
});
export type AgentTarget = z.infer<typeof AgentTargetSchema>;

export const AgentConfigSchema = z.object({
  collector_id: z.number().int(),
  targets: z.array(AgentTargetSchema),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

import { z } from "zod";
import { RouteSchema } from "./traceroute.js";

export const CollectorSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  location_label: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  online: z.boolean(),
});
export type Collector = z.infer<typeof CollectorSchema>;

export const LoginSchema = z.object({ password: z.string().min(1) });
export type LoginBody = z.infer<typeof LoginSchema>;

export const AgentRegisterSchema = z.object({
  name: z.string().min(1),
  location_label: z.string().nullable().optional(),
});
export type AgentRegister = z.infer<typeof AgentRegisterSchema>;

/** Traceroute run pushed by an agent. */
export const TracerouteReportSchema = z.object({
  target_id: z.number().int(),
  run_at: z.string().datetime(),
  hops: RouteSchema,
});
export type TracerouteReport = z.infer<typeof TracerouteReportSchema>;

export const TracerouteHistoryEntrySchema = z.object({
  id: z.number().int(),
  changed_at: z.string(),
  route_hash: z.string(),
  prev_hash: z.string().nullable(),
  hops: RouteSchema,
});
export type TracerouteHistoryEntry = z.infer<typeof TracerouteHistoryEntrySchema>;

export const TracerouteViewSchema = z.object({
  target_id: z.number().int(),
  collector_id: z.number().int(),
  current: z
    .object({ run_at: z.string(), hops: RouteSchema })
    .nullable(),
  history: z.array(TracerouteHistoryEntrySchema),
});
export type TracerouteView = z.infer<typeof TracerouteViewSchema>;

/**
 * A one-shot instruction for a collector, claimed on its next poll. Only used
 * to make "trace this path right now" possible from the UI — everything else
 * the agent needs it pulls as config.
 */
export const AgentCommandSchema = z.object({
  id: z.number().int(),
  kind: z.literal("traceroute"),
  target_id: z.number().int(),
});
export type AgentCommand = z.infer<typeof AgentCommandSchema>;

export const AgentCommandsSchema = z.object({ commands: z.array(AgentCommandSchema) });
export type AgentCommands = z.infer<typeof AgentCommandsSchema>;

export const SettingsSchema = z.object({
  discord_webhook_url: z.string().url().nullable(),
  default_latency_threshold_ms: z.number().min(0).nullable(),
  default_alert_on_loss_pct: z.number().min(0).max(100).nullable(),
  /** Consecutive bad cycles before a latency/loss alert fires. */
  alert_debounce_cycles: z.number().int().min(1).max(20),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** Messages broadcast over the live WebSocket feed. */
export const WsMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("sample"),
    target_id: z.number().int(),
    collector_id: z.number().int(),
    collector_name: z.string(),
    t: z.number(),
    median_ms: z.number().nullable(),
    loss_pct: z.number(),
    // Defaulted so a live view keeps working against an older server.
    min_ms: z.number().nullable().default(null),
    max_ms: z.number().nullable().default(null),
  }),
  z.object({ type: z.literal("alert"), target_id: z.number().int() }),
  z.object({
    type: z.literal("traceroute"),
    target_id: z.number().int(),
    collector_id: z.number().int(),
    /** Whether this run differed from the previous one. */
    changed: z.boolean(),
  }),
]);
export type WsMessage = z.infer<typeof WsMessageSchema>;

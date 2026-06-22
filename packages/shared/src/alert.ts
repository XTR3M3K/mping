import { z } from "zod";
import { HopSchema } from "./traceroute.js";

export const AlertKindSchema = z.enum(["latency", "loss", "route_change"]);
export type AlertKind = z.infer<typeof AlertKindSchema>;

export const AlertStatusSchema = z.enum(["firing", "recovered", "info"]);
export type AlertStatus = z.infer<typeof AlertStatusSchema>;

/** A logged alert transition, shown in the UI alerts feed. */
export const AlertEventSchema = z.object({
  id: z.number().int(),
  target_id: z.number().int(),
  target_name: z.string(),
  collector_id: z.number().int(),
  collector_name: z.string(),
  kind: AlertKindSchema,
  status: AlertStatusSchema,
  payload: z.object({
    value: z.number().nullable().optional(),
    threshold: z.number().nullable().optional(),
    median_ms: z.number().nullable().optional(),
    loss_pct: z.number().nullable().optional(),
    message: z.string().optional(),
    added: z.array(HopSchema).optional(),
    removed: z.array(HopSchema).optional(),
    changed: z
      .array(z.object({ ttl: z.number(), from: HopSchema.nullable(), to: HopSchema.nullable() }))
      .optional(),
  }),
  created_at: z.string(),
});
export type AlertEvent = z.infer<typeof AlertEventSchema>;

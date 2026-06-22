import { z } from "zod";

/** A single hop in a traceroute path. */
export const HopSchema = z.object({
  ttl: z.number().int().min(1),
  /** Reverse-DNS host name if resolved, else null. */
  host: z.string().nullable(),
  /** IP address of the hop, or null when the hop did not respond (`*`). */
  ip: z.string().nullable(),
  /** Best/last RTT to this hop in ms, null when unknown. */
  rtt_ms: z.number().nullable(),
  /** Per-hop packet loss percentage (mtr provides this), null otherwise. */
  loss_pct: z.number().min(0).max(100).nullable(),
});
export type Hop = z.infer<typeof HopSchema>;

export const RouteSchema = z.array(HopSchema);
export type Route = z.infer<typeof RouteSchema>;

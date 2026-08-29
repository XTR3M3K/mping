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
  /**
   * Origin AS of the hop's IP, null for private ranges and unresolved hops.
   * Optional so routes recorded before ASN lookup existed still parse.
   */
  asn: z.number().int().nullable().default(null),
  /** Short AS name, e.g. "CLOUDFLARENET". Null when unknown. */
  as_name: z.string().nullable().default(null),
});
export type Hop = z.infer<typeof HopSchema>;

export const RouteSchema = z.array(HopSchema);
export type Route = z.infer<typeof RouteSchema>;

/** How a hop compares against the same TTL in the previous route. */
export type HopChange = "same" | "added" | "removed" | "changed";

export interface MergedHop {
  ttl: number;
  change: HopChange;
  /** The hop as it is now; null when the TTL disappeared from the path. */
  hop: Hop | null;
  /** The hop as it was; null for an added TTL or when there is no previous route. */
  before: Hop | null;
}

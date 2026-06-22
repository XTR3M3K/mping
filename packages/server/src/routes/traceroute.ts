import type { FastifyInstance } from "fastify";
import type { Route, TracerouteHistoryEntry, TracerouteView } from "@mping/shared";
import { query } from "../db.js";
import { requireAuth } from "./auth.js";

export async function tracerouteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/targets/:id/traceroute", async (req, reply) => {
    const targetId = Number((req.params as { id: string }).id);
    const q = req.query as { collectorId?: string };
    const collectorId = Number(q.collectorId);
    if (!Number.isInteger(collectorId)) {
      return reply.code(400).send({ error: "collectorId required" });
    }

    const current = await query<{ run_at: Date; hops: Route }>(
      `SELECT run_at, hops FROM traceroute_runs
       WHERE target_id = $1 AND collector_id = $2 ORDER BY run_at DESC LIMIT 1`,
      [targetId, collectorId],
    );
    const history = await query<{
      id: number; changed_at: Date; route_hash: string; prev_hash: string | null; hops: Route;
    }>(
      `SELECT id, changed_at, route_hash, prev_hash, hops FROM traceroute_history
       WHERE target_id = $1 AND collector_id = $2 ORDER BY changed_at DESC LIMIT 100`,
      [targetId, collectorId],
    );

    const view: TracerouteView = {
      target_id: targetId,
      collector_id: collectorId,
      current: current.rows[0]
        ? { run_at: current.rows[0].run_at.toISOString(), hops: current.rows[0].hops }
        : null,
      history: history.rows.map(
        (r): TracerouteHistoryEntry => ({
          id: r.id,
          changed_at: r.changed_at.toISOString(),
          route_hash: r.route_hash,
          prev_hash: r.prev_hash,
          hops: r.hops,
        }),
      ),
    };
    return view;
  });

  // Which collectors have traceroute data for this target (for the tab's selector).
  app.get("/api/targets/:id/traceroute/collectors", async (req) => {
    const targetId = Number((req.params as { id: string }).id);
    const { rows } = await query<{ collector_id: number; name: string; run_at: Date }>(
      `SELECT DISTINCT ON (r.collector_id) r.collector_id, c.name, r.run_at
       FROM traceroute_runs r JOIN collectors c ON c.id = r.collector_id
       WHERE r.target_id = $1 ORDER BY r.collector_id, r.run_at DESC`,
      [targetId],
    );
    return rows.map((r) => ({ collector_id: r.collector_id, name: r.name, run_at: r.run_at.toISOString() }));
  });
}

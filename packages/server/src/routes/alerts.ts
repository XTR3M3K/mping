import type { FastifyInstance } from "fastify";
import type { AlertEvent } from "@mping/shared";
import { query } from "../db.js";
import { requireAuth } from "./auth.js";

interface AlertEventRow {
  id: number;
  target_id: number;
  target_name: string;
  collector_id: number;
  collector_name: string;
  kind: AlertEvent["kind"];
  status: AlertEvent["status"];
  payload: AlertEvent["payload"];
  created_at: Date;
}

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/alerts", async (req) => {
    const q = req.query as { targetId?: string; kind?: string; limit?: string };
    const params: unknown[] = [];
    const where: string[] = [];
    if (q.targetId) {
      params.push(Number(q.targetId));
      where.push(`e.target_id = $${params.length}`);
    }
    if (q.kind) {
      params.push(q.kind);
      where.push(`e.kind = $${params.length}`);
    }
    const limit = Math.min(Number(q.limit) || 100, 500);
    params.push(limit);

    const { rows } = await query<AlertEventRow>(
      `SELECT e.id, e.target_id, t.name AS target_name, e.collector_id, c.name AS collector_name,
              e.kind, e.status, e.payload, e.created_at
       FROM alert_events e
       JOIN targets t ON t.id = e.target_id
       JOIN collectors c ON c.id = e.collector_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY e.created_at DESC LIMIT $${params.length}`,
      params,
    );

    return rows.map(
      (r): AlertEvent => ({
        id: r.id,
        target_id: r.target_id,
        target_name: r.target_name,
        collector_id: r.collector_id,
        collector_name: r.collector_name,
        kind: r.kind,
        status: r.status,
        payload: r.payload,
        created_at: r.created_at.toISOString(),
      }),
    );
  });
}

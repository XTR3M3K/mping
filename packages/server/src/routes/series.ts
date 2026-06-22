import type { FastifyInstance } from "fastify";
import type { CollectorSeries, SeriesPoint, SeriesResolution, SeriesResponse } from "@mping/shared";
import { query } from "../db.js";
import { requireAuth } from "./auth.js";

interface SeriesRow {
  t: Date;
  collector_id: number;
  collector_name: string;
  loss_pct: number;
  min_ms: number | null;
  max_ms: number | null;
  median_ms: number | null;
  b0: number | null; b1: number | null; b2: number | null; b3: number | null;
  b4: number | null; b5: number | null; b6: number | null;
}

/** Pick a resolution so we never return more than ~1500 points per collector. */
function pickResolution(fromMs: number, toMs: number): SeriesResolution {
  const hours = (toMs - fromMs) / 3_600_000;
  if (hours <= 6) return "raw";
  if (hours <= 24 * 4) return "5m";
  return "1h";
}

const SOURCE: Record<SeriesResolution, { table: string; timeCol: string }> = {
  raw: { table: "samples", timeCol: "time" },
  "5m": { table: "samples_5m", timeCol: "bucket" },
  "1h": { table: "samples_1h", timeCol: "bucket" },
};

export async function seriesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/targets/:id/series", async (req, reply) => {
    const targetId = Number((req.params as { id: string }).id);
    const q = req.query as { from?: string; to?: string; res?: string; collectorIds?: string };
    const to = q.to ? Number(q.to) : Date.now();
    const from = q.from ? Number(q.from) : to - 6 * 3_600_000;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
      return reply.code(400).send({ error: "invalid range" });
    }
    const resolution: SeriesResolution =
      q.res === "raw" || q.res === "5m" || q.res === "1h" ? q.res : pickResolution(from, to);
    const { table, timeCol } = SOURCE[resolution];

    const params: unknown[] = [targetId, new Date(from).toISOString(), new Date(to).toISOString()];
    let collectorFilter = "";
    if (q.collectorIds) {
      const ids = q.collectorIds.split(",").map(Number).filter(Number.isInteger);
      if (ids.length) {
        params.push(ids);
        collectorFilter = `AND s.collector_id = ANY($${params.length})`;
      }
    }

    const { rows } = await query<SeriesRow>(
      `SELECT s.${timeCol} AS t, s.collector_id, c.name AS collector_name,
              s.loss_pct, s.min_ms, s.max_ms, s.median_ms,
              s.b0, s.b1, s.b2, s.b3, s.b4, s.b5, s.b6
       FROM ${table} s
       JOIN collectors c ON c.id = s.collector_id
       WHERE s.target_id = $1 AND s.${timeCol} >= $2 AND s.${timeCol} <= $3 ${collectorFilter}
       ORDER BY s.collector_id, s.${timeCol}`,
      params,
    );

    const byCollector = new Map<number, CollectorSeries>();
    for (const r of rows) {
      let cs = byCollector.get(r.collector_id);
      if (!cs) {
        cs = { collector_id: r.collector_id, collector_name: r.collector_name, points: [] };
        byCollector.set(r.collector_id, cs);
      }
      const point: SeriesPoint = {
        t: r.t.getTime(),
        loss_pct: r.loss_pct,
        median_ms: r.median_ms,
        min_ms: r.min_ms,
        max_ms: r.max_ms,
        bands: [r.b0, r.b1, r.b2, r.b3, r.b4, r.b5, r.b6],
      };
      cs.points.push(point);
    }

    const response: SeriesResponse = {
      target_id: targetId,
      resolution,
      from,
      to,
      series: [...byCollector.values()],
    };
    return response;
  });
}

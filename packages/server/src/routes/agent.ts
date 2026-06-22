import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AgentRegisterSchema,
  SampleBatchSchema,
  TracerouteReportSchema,
  computeBands,
  routeHash,
  type AgentConfig,
} from "@mping/shared";
import { query, tx } from "../db.js";
import { hashToken } from "../crypto.js";
import { getTargetById, type TargetRow } from "../repo.js";
import { evaluateSampleAlerts, notifyRouteChange } from "../alerts.js";
import { broadcast } from "../ws.js";

interface AuthedCollector {
  id: number;
  name: string;
}

/** Resolve the collector from the Bearer token, updating last_seen_at. */
async function authCollector(req: FastifyRequest, reply: FastifyReply): Promise<AuthedCollector | null> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    await reply.code(401).send({ error: "missing token" });
    return null;
  }
  const { rows } = await query<{ id: number; name: string }>(
    `UPDATE collectors SET last_seen_at = now() WHERE token_hash = $1 RETURNING id, name`,
    [hashToken(token)],
  );
  if (!rows[0]) {
    await reply.code(401).send({ error: "invalid token" });
    return null;
  }
  return rows[0];
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  // Register / heartbeat (idempotent by name). Token is set out-of-band by an admin.
  app.post("/api/agent/register", async (req, reply) => {
    const collector = await authCollector(req, reply);
    if (!collector) return;
    const parsed = AgentRegisterSchema.safeParse(req.body ?? {});
    if (parsed.success && parsed.data.location_label !== undefined) {
      await query(`UPDATE collectors SET location_label = $1 WHERE id = $2`, [
        parsed.data.location_label,
        collector.id,
      ]);
    }
    return { collector_id: collector.id, name: collector.name };
  });

  // Pull the target list this collector should probe.
  app.get("/api/agent/config", async (req, reply) => {
    const collector = await authCollector(req, reply);
    if (!collector) return;
    const { rows } = await query<TargetRow>(`SELECT * FROM targets WHERE enabled = true ORDER BY id`);
    const config: AgentConfig = {
      collector_id: collector.id,
      targets: rows.map((r) => ({
        id: r.id,
        host: r.host,
        interval_sec: r.interval_sec,
        ping_count: r.ping_count,
        packet_size: r.packet_size,
        traceroute_enabled: r.traceroute_enabled,
        traceroute_interval_sec: r.traceroute_interval_sec,
      })),
    };
    return config;
  });

  // Push a batch of ping samples.
  app.post("/api/agent/samples", async (req, reply) => {
    const collector = await authCollector(req, reply);
    if (!collector) return;
    const parsed = SampleBatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    for (const s of parsed.data.samples) {
      const bands = computeBands(s.rtts); // [min,p10,p25,median,p75,p90,max]
      await query(
        `INSERT INTO samples
           (time, target_id, collector_id, loss_pct, min_ms, max_ms, avg_ms, median_ms, stddev_ms,
            b0,b1,b2,b3,b4,b5,b6)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          s.time, s.target_id, collector.id, s.loss_pct, s.min_ms, s.max_ms, s.avg_ms, s.median_ms,
          s.stddev_ms, bands[0], bands[1], bands[2], bands[3], bands[4], bands[5], bands[6],
        ],
      );

      const target = await getTargetById(s.target_id);
      if (!target) continue;
      broadcast({
        type: "sample",
        target_id: s.target_id,
        collector_id: collector.id,
        collector_name: collector.name,
        t: new Date(s.time).getTime(),
        median_ms: s.median_ms,
        loss_pct: s.loss_pct,
      });
      await evaluateSampleAlerts(target, collector.id, collector.name, s).catch((e) =>
        req.log.error(e, "alert eval failed"),
      );
    }
    return { ok: true, count: parsed.data.samples.length };
  });

  // Push a traceroute run; store + diff against history + alert on change.
  app.post("/api/agent/traceroute", async (req, reply) => {
    const collector = await authCollector(req, reply);
    if (!collector) return;
    const parsed = TracerouteReportSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const { target_id, run_at, hops } = parsed.data;

    const target = await getTargetById(target_id);
    if (!target) return reply.code(404).send({ error: "unknown target" });

    const hash = routeHash(hops);
    const changeInfo = await tx(async (client) => {
      // Always record the latest run (overwrite previous "current").
      await client.query(
        `INSERT INTO traceroute_runs (target_id, collector_id, run_at, route_hash, hops)
         VALUES ($1,$2,$3,$4,$5)`,
        [target_id, collector.id, run_at, hash, JSON.stringify(hops)],
      );
      // Compare against the most recent history entry.
      const { rows } = await client.query<{ route_hash: string; hops: unknown }>(
        `SELECT route_hash, hops FROM traceroute_history
         WHERE target_id = $1 AND collector_id = $2 ORDER BY changed_at DESC LIMIT 1`,
        [target_id, collector.id],
      );
      const last = rows[0];
      if (last && last.route_hash === hash) return null; // unchanged
      await client.query(
        `INSERT INTO traceroute_history (target_id, collector_id, changed_at, route_hash, prev_hash, hops)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [target_id, collector.id, run_at, hash, last?.route_hash ?? null, JSON.stringify(hops)],
      );
      return { prev: (last?.hops as typeof hops) ?? [], next: hops, isFirst: !last };
    });

    if (changeInfo && !changeInfo.isFirst) {
      await notifyRouteChange(target, collector.id, collector.name, changeInfo.prev, changeInfo.next).catch(
        (e) => req.log.error(e, "route change notify failed"),
      );
    }
    return { ok: true, changed: changeInfo !== null };
  });
}

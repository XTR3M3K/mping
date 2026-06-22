import type { FastifyInstance } from "fastify";
import { TargetCreateSchema, TargetUpdateSchema } from "@mping/shared";
import { query } from "../db.js";
import { getTargetById, listTargets, mapTarget, type TargetRow } from "../repo.js";
import { requireAuth } from "./auth.js";

const DEFAULTS = {
  group_name: null,
  interval_sec: 60,
  ping_count: 20,
  packet_size: 56,
  enabled: true,
  latency_threshold_ms: null,
  alert_on_loss_pct: null,
  traceroute_enabled: true,
  traceroute_interval_sec: 300,
  discord_webhook_url: null,
};

export async function targetRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/targets", async () => listTargets());

  app.get("/api/targets/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const target = await getTargetById(id);
    if (!target) return reply.code(404).send({ error: "not found" });
    return target;
  });

  app.post("/api/targets", async (req, reply) => {
    const parsed = TargetCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const t = { ...DEFAULTS, ...parsed.data };
    const { rows } = await query<TargetRow>(
      `INSERT INTO targets
        (name, host, type, group_name, interval_sec, ping_count, packet_size, enabled,
         latency_threshold_ms, alert_on_loss_pct, traceroute_enabled, traceroute_interval_sec, discord_webhook_url)
       VALUES ($1,$2,'ping',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        t.name, t.host, t.group_name, t.interval_sec, t.ping_count, t.packet_size, t.enabled,
        t.latency_threshold_ms, t.alert_on_loss_pct, t.traceroute_enabled, t.traceroute_interval_sec,
        t.discord_webhook_url,
      ],
    );
    return reply.code(201).send(mapTarget(rows[0]!));
  });

  app.patch("/api/targets/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = TargetUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const allowed = [
      "name", "host", "group_name", "interval_sec", "ping_count", "packet_size", "enabled",
      "latency_threshold_ms", "alert_on_loss_pct", "traceroute_enabled", "traceroute_interval_sec",
      "discord_webhook_url",
    ] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const key of allowed) {
      if (key in parsed.data) {
        vals.push((parsed.data as Record<string, unknown>)[key]);
        sets.push(`${key} = $${vals.length}`);
      }
    }
    if (sets.length === 0) {
      const existing = await getTargetById(id);
      return existing ?? reply.code(404).send({ error: "not found" });
    }
    vals.push(id);
    const { rows } = await query<TargetRow>(
      `UPDATE targets SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
      vals,
    );
    if (!rows[0]) return reply.code(404).send({ error: "not found" });
    return mapTarget(rows[0]);
  });

  app.delete("/api/targets/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await query(`DELETE FROM targets WHERE id = $1`, [id]);
    return reply.code(204).send();
  });
}

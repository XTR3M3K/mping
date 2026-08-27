import type { FastifyInstance } from "fastify";
import { TargetCreateSchema, TargetUpdateSchema, defaultPort } from "@mping/shared";
import { query } from "../db.js";
import { getTargetById, listTargets, mapTarget, type TargetRow } from "../repo.js";
import { requireAuth } from "./auth.js";

const DEFAULTS = {
  type: "ping" as const,
  group_name: null,
  interval_sec: 60,
  ping_count: 20,
  packet_size: 56,
  port: null as number | null,
  http_path: null as string | null,
  http_expect_status: null as number | null,
  verify_tls: true,
  timeout_ms: 5000,
  enabled: true,
  latency_threshold_ms: null,
  alert_on_loss_pct: null,
  traceroute_enabled: true,
  traceroute_interval_sec: 300,
  discord_webhook_url: null,
};

/** Columns a client may write, in insert order. */
const COLUMNS = [
  "name", "host", "type", "group_name", "interval_sec", "ping_count", "packet_size",
  "port", "http_path", "http_expect_status", "verify_tls", "timeout_ms", "enabled",
  "latency_threshold_ms", "alert_on_loss_pct", "traceroute_enabled", "traceroute_interval_sec",
  "discord_webhook_url",
] as const;

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
    // http/https probes work without an explicit port; fill in the scheme default.
    if (t.port == null) t.port = defaultPort(t.type);

    const values = COLUMNS.map((c) => (t as Record<string, unknown>)[c]);
    const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(",");
    const { rows } = await query<TargetRow>(
      `INSERT INTO targets (${COLUMNS.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      values,
    );
    return reply.code(201).send(mapTarget(rows[0]!));
  });

  app.patch("/api/targets/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = TargetUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const patch = { ...parsed.data } as Record<string, unknown>;
    // Switching an http/https probe on without a port keeps it usable.
    if (typeof patch.type === "string" && !("port" in patch)) {
      patch.port = defaultPort(patch.type as (typeof DEFAULTS)["type"]);
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const key of COLUMNS) {
      if (key in patch) {
        vals.push(patch[key]);
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

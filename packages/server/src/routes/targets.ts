import type { FastifyInstance } from "fastify";
import {
  LIVE_INTERVAL_MAX_SEC,
  LIVE_INTERVAL_MIN_SEC,
  LIVE_WATCH_TTL_SEC,
  TargetCreateSchema,
  TargetImportSchema,
  TargetUpdateSchema,
  clamp,
  defaultPort,
  type ImportRowResult,
  type TargetImportResult,
} from "@mping/shared";
import { query } from "../db.js";
import { getTargetById, listTargets, mapTarget, type TargetRow } from "../repo.js";
import { schedulePurge } from "../purge.js";
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

  /**
   * Bulk create from a CSV import. Rows are applied one by one and reported
   * individually: one malformed line shouldn't cost the operator the other
   * ninety-nine, and a partial import they can see beats an opaque rollback.
   */
  app.post("/api/targets/import", async (req, reply) => {
    const parsed = TargetImportSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const { rows, mode } = parsed.data;

    const results: ImportRowResult[] = [];
    for (const [index, row] of rows.entries()) {
      const t = { ...DEFAULTS, ...row };
      if (t.port == null) t.port = defaultPort(t.type);
      try {
        const existing = await query<{ id: number }>(`SELECT id FROM targets WHERE name = $1`, [t.name]);
        if (existing.rows[0] && mode === "skip") {
          results.push({ index, name: t.name, status: "skipped" });
          continue;
        }
        if (existing.rows[0]) {
          const sets = COLUMNS.map((c, i) => `${c} = $${i + 1}`).join(", ");
          await query(`UPDATE targets SET ${sets} WHERE id = $${COLUMNS.length + 1}`, [
            ...COLUMNS.map((c) => (t as Record<string, unknown>)[c]),
            existing.rows[0].id,
          ]);
          results.push({ index, name: t.name, status: "updated" });
          continue;
        }
        const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(",");
        await query(
          `INSERT INTO targets (${COLUMNS.join(", ")}) VALUES (${placeholders})`,
          COLUMNS.map((c) => (t as Record<string, unknown>)[c]),
        );
        results.push({ index, name: t.name, status: "created" });
      } catch (err) {
        req.log.warn({ err }, `import row ${index} failed`);
        results.push({ index, name: t.name, status: "failed", error: (err as Error).message });
      }
    }

    const count = (s: ImportRowResult["status"]) => results.filter((r) => r.status === s).length;
    const result: TargetImportResult = {
      created: count("created"),
      updated: count("updated"),
      skipped: count("skipped"),
      failed: count("failed"),
      rows: results,
    };
    return result;
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

  /**
   * Renew a live watch: while a browser holds this open, collectors probe the
   * target every `interval_sec` instead of its configured cadence. The row
   * expires on its own, so closing the tab (or the browser) ends live mode.
   */
  app.post("/api/targets/:id/live", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid id" });
    const body = (req.body ?? {}) as { interval_sec?: number };
    const requested = Number(body.interval_sec ?? LIVE_INTERVAL_MIN_SEC);
    const interval = clamp(
      Number.isFinite(requested) ? Math.round(requested) : LIVE_INTERVAL_MIN_SEC,
      LIVE_INTERVAL_MIN_SEC,
      LIVE_INTERVAL_MAX_SEC,
    );
    const { rowCount } = await query(
      `INSERT INTO live_watches (target_id, interval_sec, until)
       SELECT id, $2, now() + ($3 || ' seconds')::interval FROM targets WHERE id = $1
       ON CONFLICT (target_id) DO UPDATE
         SET interval_sec = EXCLUDED.interval_sec, until = EXCLUDED.until`,
      [id, interval, String(LIVE_WATCH_TTL_SEC)],
    );
    if (!rowCount) return reply.code(404).send({ error: "not found" });
    return { interval_sec: interval, ttl_sec: LIVE_WATCH_TTL_SEC };
  });

  app.delete("/api/targets/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid id" });

    // Deleting the row cascades into traceroute/alert tables (small, instant).
    // Sample history deliberately has no FK and is purged in the background —
    // a year of compressed chunks must never block this request.
    const { rowCount } = await query(`DELETE FROM targets WHERE id = $1`, [id]);
    if (!rowCount) return reply.code(404).send({ error: "not found" });
    schedulePurge({ targetId: id }, req.log);
    return reply.code(204).send();
  });
}

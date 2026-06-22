import type { FastifyInstance } from "fastify";
import type { Collector } from "@mping/shared";
import { query } from "../db.js";
import { generateToken, hashToken } from "../crypto.js";
import { env } from "../env.js";
import { requireAuth } from "./auth.js";

interface CollectorRow {
  id: number;
  name: string;
  location_label: string | null;
  last_seen_at: Date | null;
}

function mapCollector(r: CollectorRow): Collector {
  const online =
    r.last_seen_at != null &&
    Date.now() - r.last_seen_at.getTime() < env.collectorOnlineWindowSec * 1000;
  return {
    id: r.id,
    name: r.name,
    location_label: r.location_label,
    last_seen_at: r.last_seen_at?.toISOString() ?? null,
    online,
  };
}

export async function collectorRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/collectors", async () => {
    const { rows } = await query<CollectorRow>(
      `SELECT id, name, location_label, last_seen_at FROM collectors ORDER BY name`,
    );
    return rows.map(mapCollector);
  });

  // Create a collector and return its token ONCE (not stored in plaintext).
  app.post("/api/collectors", async (req, reply) => {
    const body = req.body as { name?: string; location_label?: string | null };
    if (!body.name) return reply.code(400).send({ error: "name required" });
    const token = generateToken();
    try {
      const { rows } = await query<{ id: number }>(
        `INSERT INTO collectors (name, token_hash, location_label) VALUES ($1,$2,$3) RETURNING id`,
        [body.name, hashToken(token), body.location_label ?? null],
      );
      return reply.code(201).send({ id: rows[0]!.id, name: body.name, token });
    } catch (e) {
      if ((e as Error).message.includes("duplicate")) {
        return reply.code(409).send({ error: "collector name already exists" });
      }
      throw e;
    }
  });

  // Rotate a collector's token.
  app.post("/api/collectors/:id/token", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const token = generateToken();
    const { rowCount } = await query(`UPDATE collectors SET token_hash = $1 WHERE id = $2`, [
      hashToken(token),
      id,
    ]);
    if (!rowCount) return reply.code(404).send({ error: "not found" });
    return { token };
  });

  app.delete("/api/collectors/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await query(`DELETE FROM collectors WHERE id = $1`, [id]);
    return reply.code(204).send();
  });
}

import type { FastifyInstance } from "fastify";
import { SettingsSchema } from "@mping/shared";
import { getSettings, updateSettings } from "../settings.js";
import { requireAuth } from "./auth.js";

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/settings", async () => getSettings());

  app.put("/api/settings", async (req, reply) => {
    const parsed = SettingsSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return updateSettings(parsed.data);
  });
}

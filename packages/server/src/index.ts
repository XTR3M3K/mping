import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { env } from "./env.js";
import { pool } from "./db.js";
import { migrate } from "./migrate.js";
import { registerWsClient } from "./ws.js";
import { authRoutes, isAuthed } from "./routes/auth.js";
import { agentRoutes } from "./routes/agent.js";
import { targetRoutes } from "./routes/targets.js";
import { collectorRoutes } from "./routes/collectors.js";
import { seriesRoutes } from "./routes/series.js";
import { tracerouteRoutes } from "./routes/traceroute.js";
import { alertRoutes } from "./routes/alerts.js";
import { settingsRoutes } from "./routes/settings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// In dev (tsx) __dirname is packages/server/src; in prod (built) it's packages/server/dist.
const webDist = join(__dirname, "../../web/dist");

async function main(): Promise<void> {
  await migrate();

  const app = Fastify({
    logger: { level: env.isProd ? "info" : "debug" },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  // Accept empty bodies on application/json requests (e.g. POST /logout),
  // which Fastify's default parser otherwise rejects with a 400.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = body as string;
    if (!text || text.length === 0) return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      (err as Error & { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  // Cookie plugin with a signing secret (used for the signed auth cookie).
  await app.register(cookie, { secret: env.sessionSecret });
  await app.register(websocket);

  app.get("/healthz", async () => {
    await pool.query("SELECT 1");
    return { ok: true };
  });

  // API routes
  await app.register(authRoutes);
  await app.register(agentRoutes);
  await app.register(targetRoutes);
  await app.register(collectorRoutes);
  await app.register(seriesRoutes);
  await app.register(tracerouteRoutes);
  await app.register(alertRoutes);
  await app.register(settingsRoutes);

  // Live WebSocket feed (session-cookie auth)
  app.get("/api/ws", { websocket: true }, (socket, req) => {
    if (!isAuthed(req)) {
      socket.close(4401, "unauthorized");
      return;
    }
    registerWsClient(socket);
  });

  // Serve the built SPA with history fallback (skips /api and /healthz).
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/healthz")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.log.warn(`web build not found at ${webDist} — run "pnpm --filter @mping/web build"`);
  }

  warnInsecureDefaults(app);

  // Graceful shutdown so containers stop cleanly (drain HTTP, close the pool).
  let shuttingDown = false;
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      app.log.info(`${sig} received, shutting down`);
      app
        .close()
        .then(() => pool.end())
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  }

  await app.listen({ port: env.port, host: env.host });
}

/** Loudly flag known-insecure defaults when running in production. */
function warnInsecureDefaults(app: import("fastify").FastifyInstance): void {
  if (!env.isProd) return;
  const w = (m: string) => app.log.warn(`SECURITY: ${m}`);
  if (env.sessionSecret.startsWith("change-me") || env.sessionSecret.startsWith("dev-only")) {
    w("SESSION_SECRET is a default value — set a strong random secret (openssl rand -hex 32)");
  }
  if (env.adminPassword === "admin") w("ADMIN_PASSWORD is still 'admin' — change it");
  if (env.bootstrapCollectorToken && env.bootstrapCollectorToken.includes("change-me")) {
    w("BOOTSTRAP_COLLECTOR_TOKEN is a default value — rotate it");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

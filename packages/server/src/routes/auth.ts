import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { LoginSchema } from "@mping/shared";
import { verifyPassword } from "../crypto.js";
import { getPasswordHash, setPassword } from "../settings.js";

/**
 * preHandler guard: rejects unauthenticated UI requests. Must `return reply` so
 * Fastify halts the lifecycle and does NOT run the route handler.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  if (req.session.get("authed") !== true) {
    return reply.code(401).send({ error: "unauthorized" });
  }
}

// Lightweight per-IP brute-force throttle for the login endpoint (no deps).
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 10;
const loginFails = new Map<string, { count: number; resetAt: number }>();

function loginThrottle(ip: string): { blocked: boolean } {
  const now = Date.now();
  const entry = loginFails.get(ip);
  if (entry && now > entry.resetAt) loginFails.delete(ip);
  const cur = loginFails.get(ip);
  return { blocked: !!cur && cur.count >= MAX_FAILS };
}

function recordFail(ip: string): void {
  const now = Date.now();
  const cur = loginFails.get(ip);
  if (!cur || now > cur.resetAt) loginFails.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  else cur.count++;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", async (req, reply) => {
    if (loginThrottle(req.ip).blocked) {
      return reply.code(429).send({ error: "too many attempts, try again later" });
    }
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const hash = await getPasswordHash();
    if (!hash || !verifyPassword(parsed.data.password, hash)) {
      recordFail(req.ip);
      return reply.code(401).send({ error: "invalid password" });
    }
    loginFails.delete(req.ip);
    req.session.set("authed", true);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (req) => {
    req.session.delete();
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => {
    return { authed: req.session.get("authed") === true };
  });

  app.post("/api/auth/password", { preHandler: requireAuth }, async (req, reply) => {
    const body = req.body as { current?: string; next?: string };
    const hash = await getPasswordHash();
    if (!hash || !body.current || !verifyPassword(body.current, hash)) {
      return reply.code(401).send({ error: "current password incorrect" });
    }
    if (!body.next || body.next.length < 4) {
      return reply.code(400).send({ error: "new password too short" });
    }
    await setPassword(body.next);
    return { ok: true };
  });
}

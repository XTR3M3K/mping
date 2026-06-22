import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { LoginSchema } from "@mping/shared";
import { verifyPassword } from "../crypto.js";
import { getPasswordHash, setPassword } from "../settings.js";
import { env } from "../env.js";

// Auth state is a single signed cookie (HMAC integrity via SESSION_SECRET).
// No secret payload is stored, so signing — not encryption — is sufficient,
// which lets us avoid the native `sodium-native` dependency entirely.
const AUTH_COOKIE = "mping_auth";
const COOKIE_OPTS = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.isProd,
  maxAge: 60 * 60 * 24 * 30,
};

export function setAuthCookie(reply: FastifyReply): void {
  reply.setCookie(AUTH_COOKIE, "1", { ...COOKIE_OPTS, signed: true });
}

export function clearAuthCookie(reply: FastifyReply): void {
  reply.clearCookie(AUTH_COOKIE, { path: "/" });
}

export function isAuthed(req: FastifyRequest): boolean {
  const raw = req.cookies[AUTH_COOKIE];
  if (!raw) return false;
  const r = req.unsignCookie(raw);
  return r.valid && r.value === "1";
}

/**
 * preHandler guard: rejects unauthenticated UI requests. Must `return reply` so
 * Fastify halts the lifecycle and does NOT run the route handler.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  if (!isAuthed(req)) {
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
    setAuthCookie(reply);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    clearAuthCookie(reply);
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => {
    return { authed: isAuthed(req) };
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

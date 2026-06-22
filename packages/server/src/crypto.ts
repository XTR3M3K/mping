import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";

/** Hash a password with a per-password salt: `scrypt$<salt>$<hash>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  const computed = scryptSync(password, salt!, 64);
  const expected = Buffer.from(hash!, "hex");
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/** Generate a collector API token (shown once). */
export function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

/** One-way hash for storing/looking up collector tokens. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

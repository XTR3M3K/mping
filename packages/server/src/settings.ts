import type { Settings } from "@mping/shared";
import { query } from "./db.js";
import { env } from "./env.js";
import { hashPassword, hashToken } from "./crypto.js";

const DEFAULT_SETTINGS: Settings = {
  discord_webhook_url: null,
  default_latency_threshold_ms: null,
  default_alert_on_loss_pct: 20,
  alert_debounce_cycles: 3,
};

async function getRaw<T>(key: string): Promise<T | null> {
  const { rows } = await query<{ value: T }>(`SELECT value FROM settings WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}

async function setRaw(key: string, value: unknown): Promise<void> {
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}

export async function getSettings(): Promise<Settings> {
  const stored = await getRaw<Partial<Settings>>("app");
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await setRaw("app", next);
  return next;
}

export async function getPasswordHash(): Promise<string | null> {
  return getRaw<string>("password_hash");
}

export async function setPassword(password: string): Promise<void> {
  await setRaw("password_hash", hashPassword(password));
}

/** Seed defaults + initial admin password on first boot. */
export async function seedSettings(): Promise<void> {
  if ((await getRaw("app")) === null) await setRaw("app", DEFAULT_SETTINGS);
  if ((await getPasswordHash()) === null) await setPassword(env.adminPassword);
  await seedBootstrapCollector();
}

/**
 * Upsert a bootstrap collector from env so a bundled agent can connect with a
 * known token. Keeps the token_hash in sync if the env token changes.
 */
async function seedBootstrapCollector(): Promise<void> {
  const { bootstrapCollectorName: name, bootstrapCollectorToken: token } = env;
  if (!name || !token) return;
  await query(
    `INSERT INTO collectors (name, token_hash) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET token_hash = EXCLUDED.token_hash`,
    [name, hashToken(token)],
  );
}

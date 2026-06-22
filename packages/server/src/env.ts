function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export const env = {
  databaseUrl: required("DATABASE_URL", "postgres://mping:mping@localhost:5432/mping"),
  port: Number(process.env.PORT ?? 4420),
  host: process.env.HOST ?? "0.0.0.0",
  publicUrl: (process.env.PUBLIC_URL ?? "http://localhost:4420").replace(/\/$/, ""),
  sessionSecret: required("SESSION_SECRET", "dev-only-insecure-secret-please-change-0123456789ab"),
  adminPassword: process.env.ADMIN_PASSWORD ?? "admin",
  isProd: process.env.NODE_ENV === "production",
  // Optional: auto-create a collector on boot so a bundled agent can connect
  // without a manual UI step (used by docker-compose's local agent).
  bootstrapCollectorName: process.env.BOOTSTRAP_COLLECTOR_NAME ?? "",
  bootstrapCollectorToken: process.env.BOOTSTRAP_COLLECTOR_TOKEN ?? "",
  /** A collector is considered online if seen within this many seconds. */
  collectorOnlineWindowSec: 90,
};

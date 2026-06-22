/**
 * Ordered, idempotent DDL statements. Each runs in its own autocommit
 * statement (TimescaleDB continuous-aggregate DDL cannot run inside a txn).
 * Errors matching `ignoreIfContains` are treated as "already applied".
 */
export interface Stmt {
  sql: string;
  ignoreIfContains?: string[];
}

export const STATEMENTS: Stmt[] = [
  { sql: `CREATE EXTENSION IF NOT EXISTS timescaledb` },

  {
    sql: `CREATE TABLE IF NOT EXISTS collectors (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL UNIQUE,
      token_hash    TEXT NOT NULL,
      location_label TEXT,
      last_seen_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  },

  {
    sql: `CREATE TABLE IF NOT EXISTS targets (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      host          TEXT NOT NULL,
      type          TEXT NOT NULL DEFAULT 'ping',
      group_name    TEXT,
      interval_sec  INTEGER NOT NULL DEFAULT 60,
      ping_count    INTEGER NOT NULL DEFAULT 20,
      packet_size   INTEGER NOT NULL DEFAULT 56,
      enabled       BOOLEAN NOT NULL DEFAULT true,
      latency_threshold_ms     DOUBLE PRECISION,
      alert_on_loss_pct        DOUBLE PRECISION,
      traceroute_enabled       BOOLEAN NOT NULL DEFAULT true,
      traceroute_interval_sec  INTEGER NOT NULL DEFAULT 300,
      discord_webhook_url      TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  },

  {
    sql: `CREATE TABLE IF NOT EXISTS samples (
      time         TIMESTAMPTZ NOT NULL,
      target_id    INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      collector_id INTEGER NOT NULL REFERENCES collectors(id) ON DELETE CASCADE,
      loss_pct     DOUBLE PRECISION NOT NULL,
      min_ms       DOUBLE PRECISION,
      max_ms       DOUBLE PRECISION,
      avg_ms       DOUBLE PRECISION,
      median_ms    DOUBLE PRECISION,
      stddev_ms    DOUBLE PRECISION,
      b0 DOUBLE PRECISION, b1 DOUBLE PRECISION, b2 DOUBLE PRECISION,
      b3 DOUBLE PRECISION, b4 DOUBLE PRECISION, b5 DOUBLE PRECISION, b6 DOUBLE PRECISION
    )`,
  },
  {
    sql: `SELECT create_hypertable('samples', 'time', if_not_exists => TRUE, chunk_time_interval => INTERVAL '1 day')`,
  },
  {
    sql: `CREATE INDEX IF NOT EXISTS samples_target_collector_time_idx
          ON samples (target_id, collector_id, time DESC)`,
  },

  {
    sql: `CREATE TABLE IF NOT EXISTS traceroute_runs (
      id           BIGSERIAL PRIMARY KEY,
      target_id    INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      collector_id INTEGER NOT NULL REFERENCES collectors(id) ON DELETE CASCADE,
      run_at       TIMESTAMPTZ NOT NULL,
      route_hash   TEXT NOT NULL,
      hops         JSONB NOT NULL
    )`,
  },
  {
    sql: `CREATE INDEX IF NOT EXISTS traceroute_runs_latest_idx
          ON traceroute_runs (target_id, collector_id, run_at DESC)`,
  },

  {
    sql: `CREATE TABLE IF NOT EXISTS traceroute_history (
      id           BIGSERIAL PRIMARY KEY,
      target_id    INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      collector_id INTEGER NOT NULL REFERENCES collectors(id) ON DELETE CASCADE,
      changed_at   TIMESTAMPTZ NOT NULL,
      route_hash   TEXT NOT NULL,
      prev_hash    TEXT,
      hops         JSONB NOT NULL
    )`,
  },
  {
    sql: `CREATE INDEX IF NOT EXISTS traceroute_history_idx
          ON traceroute_history (target_id, collector_id, changed_at DESC)`,
  },

  {
    sql: `CREATE TABLE IF NOT EXISTS alert_state (
      target_id     INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      collector_id  INTEGER NOT NULL REFERENCES collectors(id) ON DELETE CASCADE,
      kind          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ok',
      bad_streak    INTEGER NOT NULL DEFAULT 0,
      good_streak   INTEGER NOT NULL DEFAULT 0,
      last_value    DOUBLE PRECISION,
      since         TIMESTAMPTZ,
      last_notified_at TIMESTAMPTZ,
      PRIMARY KEY (target_id, collector_id, kind)
    )`,
  },

  {
    sql: `CREATE TABLE IF NOT EXISTS alert_events (
      id           BIGSERIAL PRIMARY KEY,
      target_id    INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      collector_id INTEGER NOT NULL REFERENCES collectors(id) ON DELETE CASCADE,
      kind         TEXT NOT NULL,
      status       TEXT NOT NULL,
      payload      JSONB NOT NULL DEFAULT '{}',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  },
  {
    sql: `CREATE INDEX IF NOT EXISTS alert_events_created_idx ON alert_events (created_at DESC)`,
  },

  {
    sql: `CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value JSONB NOT NULL
    )`,
  },

  // ── Continuous aggregates for fast long-range smoke rendering ──
  {
    sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS samples_5m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket(INTERVAL '5 minutes', time) AS bucket,
        target_id, collector_id,
        avg(loss_pct)  AS loss_pct,
        min(min_ms)    AS min_ms,
        max(max_ms)    AS max_ms,
        avg(median_ms) AS median_ms,
        min(b0) AS b0, avg(b1) AS b1, avg(b2) AS b2, avg(b3) AS b3,
        avg(b4) AS b4, avg(b5) AS b5, max(b6) AS b6
      FROM samples
      GROUP BY bucket, target_id, collector_id
      WITH NO DATA`,
    ignoreIfContains: ["already exists"],
  },
  {
    sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS samples_1h
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket(INTERVAL '1 hour', time) AS bucket,
        target_id, collector_id,
        avg(loss_pct)  AS loss_pct,
        min(min_ms)    AS min_ms,
        max(max_ms)    AS max_ms,
        avg(median_ms) AS median_ms,
        min(b0) AS b0, avg(b1) AS b1, avg(b2) AS b2, avg(b3) AS b3,
        avg(b4) AS b4, avg(b5) AS b5, max(b6) AS b6
      FROM samples
      GROUP BY bucket, target_id, collector_id
      WITH NO DATA`,
    ignoreIfContains: ["already exists"],
  },
  {
    sql: `SELECT add_continuous_aggregate_policy('samples_5m',
      start_offset => INTERVAL '3 hours', end_offset => INTERVAL '5 minutes',
      schedule_interval => INTERVAL '5 minutes')`,
    ignoreIfContains: ["already", "duplicate"],
  },
  {
    sql: `SELECT add_continuous_aggregate_policy('samples_1h',
      start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
      schedule_interval => INTERVAL '1 hour')`,
    ignoreIfContains: ["already", "duplicate"],
  },
  {
    sql: `SELECT add_retention_policy('samples', INTERVAL '30 days', if_not_exists => TRUE)`,
    ignoreIfContains: ["already", "duplicate"],
  },
];

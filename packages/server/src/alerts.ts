import type { AlertKind, AlertStatus, Route, Sample, Target } from "@mping/shared";
import { diffRoutes } from "@mping/shared";
import { query } from "./db.js";
import { getSettings } from "./settings.js";
import { sendDiscord, formatHop, type DiscordEmbedInput } from "./discord.js";
import { broadcast } from "./ws.js";

interface AlertStateRow {
  status: AlertStatus | "ok";
  bad_streak: number;
  good_streak: number;
}

async function loadState(targetId: number, collectorId: number, kind: AlertKind): Promise<AlertStateRow> {
  const { rows } = await query<AlertStateRow>(
    `SELECT status, bad_streak, good_streak FROM alert_state
     WHERE target_id = $1 AND collector_id = $2 AND kind = $3`,
    [targetId, collectorId, kind],
  );
  return rows[0] ?? { status: "ok", bad_streak: 0, good_streak: 0 };
}

async function saveState(
  targetId: number,
  collectorId: number,
  kind: AlertKind,
  status: AlertStatus | "ok",
  badStreak: number,
  goodStreak: number,
  value: number | null,
  notified: boolean,
): Promise<void> {
  await query(
    `INSERT INTO alert_state (target_id, collector_id, kind, status, bad_streak, good_streak, last_value, since, last_notified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now(), ${notified ? "now()" : "NULL"})
     ON CONFLICT (target_id, collector_id, kind) DO UPDATE SET
       status = EXCLUDED.status,
       bad_streak = EXCLUDED.bad_streak,
       good_streak = EXCLUDED.good_streak,
       last_value = EXCLUDED.last_value,
       since = CASE WHEN alert_state.status <> EXCLUDED.status THEN now() ELSE alert_state.since END,
       last_notified_at = CASE WHEN ${notified} THEN now() ELSE alert_state.last_notified_at END`,
    [targetId, collectorId, kind, status, badStreak, goodStreak, value],
  );
}

async function logEvent(
  targetId: number,
  collectorId: number,
  kind: AlertKind,
  status: AlertStatus,
  payload: unknown,
): Promise<void> {
  await query(
    `INSERT INTO alert_events (target_id, collector_id, kind, status, payload)
     VALUES ($1,$2,$3,$4,$5)`,
    [targetId, collectorId, kind, status, JSON.stringify(payload)],
  );
  broadcast({ type: "alert", target_id: targetId });
}

/** Generic debounced threshold transition for latency/loss. */
async function evaluateThreshold(opts: {
  target: Target;
  collectorId: number;
  collectorName: string;
  kind: Extract<AlertKind, "latency" | "loss">;
  bad: boolean;
  value: number | null;
  threshold: number;
  debounce: number;
  webhook: string | null;
  unit: string;
}): Promise<void> {
  const { target, collectorId, collectorName, kind, bad, value, threshold, debounce, webhook, unit } = opts;
  const state = await loadState(target.id, collectorId, kind);
  let badStreak = bad ? state.bad_streak + 1 : 0;
  let goodStreak = bad ? 0 : state.good_streak + 1;
  let status = state.status;
  let transition: AlertStatus | null = null;

  if (status !== "firing" && badStreak >= debounce) {
    status = "firing";
    transition = "firing";
  } else if (status === "firing" && goodStreak >= debounce) {
    status = "recovered";
    transition = "recovered";
  }

  await saveState(target.id, collectorId, kind, status, badStreak, goodStreak, value, transition !== null);
  if (!transition) return;

  const label = kind === "latency" ? "Latency" : "Packet loss";
  const valStr = value != null ? `${value.toFixed(1)}${unit}` : "n/a";
  const payload = { value, threshold, message: `${label} ${transition}` };
  await logEvent(target.id, collectorId, kind, transition, payload);

  const embed: DiscordEmbedInput = {
    kind,
    status: transition,
    targetId: target.id,
    targetName: target.name,
    collectorName,
    title:
      transition === "firing"
        ? `${label} alert — ${target.name}`
        : `${label} recovered — ${target.name}`,
    fields: [
      { name: label, value: valStr, inline: true },
      { name: "Threshold", value: `${threshold}${unit}`, inline: true },
    ],
  };
  await sendDiscord(webhook, embed);
}

/** Run latency + loss alert evaluation for one pushed sample. */
export async function evaluateSampleAlerts(
  target: Target,
  collectorId: number,
  collectorName: string,
  sample: Sample,
): Promise<void> {
  const settings = await getSettings();
  const webhook = target.discord_webhook_url ?? settings.discord_webhook_url;
  const debounce = settings.alert_debounce_cycles;

  const latencyThreshold = target.latency_threshold_ms ?? settings.default_latency_threshold_ms;
  if (latencyThreshold != null) {
    await evaluateThreshold({
      target,
      collectorId,
      collectorName,
      kind: "latency",
      bad: sample.median_ms != null && sample.median_ms > latencyThreshold,
      value: sample.median_ms,
      threshold: latencyThreshold,
      debounce,
      webhook,
      unit: "ms",
    });
  }

  const lossThreshold = target.alert_on_loss_pct ?? settings.default_alert_on_loss_pct;
  if (lossThreshold != null) {
    await evaluateThreshold({
      target,
      collectorId,
      collectorName,
      kind: "loss",
      bad: sample.loss_pct > lossThreshold,
      value: sample.loss_pct,
      threshold: lossThreshold,
      debounce,
      webhook,
      unit: "%",
    });
  }
}

/** Send a Discord embed + log event for a detected traceroute route change. */
export async function notifyRouteChange(
  target: Target,
  collectorId: number,
  collectorName: string,
  prev: Route,
  next: Route,
): Promise<void> {
  const settings = await getSettings();
  const webhook = target.discord_webhook_url ?? settings.discord_webhook_url;
  const { added, removed, changed } = diffRoutes(prev, next);

  await logEvent(target.id, collectorId, "route_change", "info", { added, removed, changed });

  const lines: string[] = [];
  for (const c of changed) {
    lines.push(`✏️ ttl ${c.ttl}: ${c.from ? formatHop(c.from) : "*"} → ${c.to ? formatHop(c.to) : "*"}`);
  }
  for (const h of added) lines.push(`➕ ${formatHop(h)}`);
  for (const h of removed) lines.push(`➖ ${formatHop(h)}`);
  const description = lines.slice(0, 12).join("\n") || "Route changed.";

  await sendDiscord(webhook, {
    kind: "route_change",
    status: "info",
    targetId: target.id,
    targetName: target.name,
    collectorName,
    title: `Route changed — ${target.name}`,
    description,
    fields: [{ name: "Hops", value: String(next.length), inline: true }],
  });
}

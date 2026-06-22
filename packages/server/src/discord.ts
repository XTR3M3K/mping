import type { AlertKind, AlertStatus, Hop } from "@mping/shared";
import { env } from "./env.js";

const COLORS = {
  firing: 0xef4444, // red-500
  recovered: 0x22c55e, // green-500
  info: 0x6366f1, // indigo-500 (route change)
} as const;

const EMOJI: Record<AlertStatus, string> = {
  firing: "🔴",
  recovered: "🟢",
  info: "🔀",
};

interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbedInput {
  kind: AlertKind;
  status: AlertStatus;
  targetId: number;
  targetName: string;
  collectorName: string;
  title: string;
  description?: string;
  fields?: EmbedField[];
}

function buildEmbed(input: DiscordEmbedInput) {
  const url = `${env.publicUrl}/targets/${input.targetId}`;
  return {
    title: `${EMOJI[input.status]} ${input.title}`,
    description: input.description,
    url,
    color: COLORS[input.status],
    fields: [
      { name: "Target", value: input.targetName, inline: true },
      { name: "Collector", value: input.collectorName, inline: true },
      ...(input.fields ?? []),
    ],
    footer: { text: "mping" },
    timestamp: new Date().toISOString(),
  };
}

/** Send an embed, falling back to the global webhook. Retries once on 429. */
export async function sendDiscord(
  webhookUrl: string | null,
  input: DiscordEmbedInput,
): Promise<void> {
  if (!webhookUrl) return;
  const body = JSON.stringify({ embeds: [buildEmbed(input)] });
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "1");
      await new Promise((r) => setTimeout(r, (isNaN(retryAfter) ? 1 : retryAfter) * 1000));
      continue;
    }
    if (!res.ok) {
      console.warn(`Discord webhook failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return;
  }
}

/** Render a compact hop line for route-change diffs. */
export function formatHop(h: Hop): string {
  const where = h.ip ?? "*";
  const name = h.host && h.host !== h.ip ? ` (${h.host})` : "";
  const rtt = h.rtt_ms != null ? ` — ${h.rtt_ms.toFixed(1)}ms` : "";
  return `\`${String(h.ttl).padStart(2)}\` ${where}${name}${rtt}`;
}

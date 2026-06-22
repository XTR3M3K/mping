import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell, TrendingUp, PercentDiamond, GitBranch } from "lucide-react";
import { clsx } from "clsx";
import type { AlertEvent } from "@mping/shared";
import { api } from "../lib/api.js";
import { useLiveFeed } from "../lib/useLiveFeed.js";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState, Skeleton, Chip } from "../components/ui.js";
import { fmtMs, fmtLoss, fmtRelTime, fmtClock } from "../lib/format.js";

const KINDS = [
  { key: "", label: "All" },
  { key: "latency", label: "Latency" },
  { key: "loss", label: "Loss" },
  { key: "route_change", label: "Route" },
];

export function Alerts() {
  const qc = useQueryClient();
  const [kind, setKind] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["alerts", kind],
    queryFn: () => api.alerts({ kind: kind || undefined, limit: 200 }),
    refetchInterval: 30_000,
  });

  useLiveFeed((msg) => {
    if (msg.type === "alert") qc.invalidateQueries({ queryKey: ["alerts"] });
  });

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Alerts</h1>
          <p className="text-sm text-muted mt-0.5">Threshold breaches and route changes</p>
        </div>
      </div>

      <div className="flex items-center gap-1 bg-surface-2 rounded-xl p-1 border border-border w-fit mb-5">
        {KINDS.map((k) => (
          <button
            key={k.key}
            onClick={() => setKind(k.key)}
            className={clsx("px-3 py-1.5 rounded-lg text-sm font-medium transition-colors", kind === k.key ? "bg-accent text-white" : "text-muted hover:text-gray-200")}
          >
            {k.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : !data?.length ? (
        <div className="card">
          <EmptyState icon={<Bell className="h-12 w-12" />} title="No alerts" hint="When a probe crosses its threshold or its route changes, it'll show up here." />
        </div>
      ) : (
        <div className="space-y-2">
          {data.map((e) => (
            <AlertRow key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertRow({ event }: { event: AlertEvent }) {
  const { icon, tone } = meta(event);
  return (
    <Link to={`/targets/${event.target_id}`} className="card p-3.5 flex items-center gap-3.5 hover:border-accent/40 transition-colors">
      <div className={clsx("h-10 w-10 rounded-xl grid place-items-center shrink-0", tone.bg)}>{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{event.target_name}</span>
          <Chip className="!bg-surface-2 shrink-0">{event.collector_name}</Chip>
        </div>
        <div className="text-sm text-muted truncate">{describe(event)}</div>
      </div>
      <div className="text-right shrink-0">
        <StatusChip event={event} />
        <div className="text-xs text-faint mt-1" title={fmtClock(event.created_at)}>{fmtRelTime(event.created_at)}</div>
      </div>
    </Link>
  );
}

function StatusChip({ event }: { event: AlertEvent }) {
  if (event.kind === "route_change") return <Chip tone="accent">changed</Chip>;
  return event.status === "firing" ? <Chip tone="bad">firing</Chip> : <Chip tone="good">recovered</Chip>;
}

function meta(e: AlertEvent): { icon: JSX.Element; tone: { bg: string } } {
  if (e.kind === "route_change") return { icon: <GitBranch className="h-5 w-5 text-accent-soft" />, tone: { bg: "bg-accent/15" } };
  if (e.kind === "loss") {
    const firing = e.status === "firing";
    return { icon: <PercentDiamond className={clsx("h-5 w-5", firing ? "text-bad" : "text-good")} />, tone: { bg: firing ? "bg-bad/15" : "bg-good/15" } };
  }
  const firing = e.status === "firing";
  return { icon: <TrendingUp className={clsx("h-5 w-5", firing ? "text-bad" : "text-good")} />, tone: { bg: firing ? "bg-bad/15" : "bg-good/15" } };
}

function describe(e: AlertEvent): string {
  const p = e.payload;
  if (e.kind === "route_change") {
    const a = p.added?.length ?? 0;
    const r = p.removed?.length ?? 0;
    const c = p.changed?.length ?? 0;
    const parts = [a && `+${a} hop`, r && `−${r} hop`, c && `${c} changed`].filter(Boolean);
    return parts.length ? `Route ${parts.join(", ")}` : "Route changed";
  }
  if (e.kind === "latency") {
    return `Median ${fmtMs(p.value ?? null)} ${e.status === "firing" ? "exceeded" : "back under"} ${fmtMs(p.threshold ?? null)}`;
  }
  return `Loss ${fmtLoss(p.value ?? null)} ${e.status === "firing" ? "exceeded" : "back under"} ${fmtLoss(p.threshold ?? null)}`;
}

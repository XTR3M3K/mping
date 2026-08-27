import { useMemo } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Activity, Plus, Radio } from "lucide-react";
import type { CollectorSeries, MultiSeriesResponse, Target } from "@mping/shared";
import { probeLabel } from "@mping/shared";
import { api } from "../lib/api.js";
import { useUI } from "../state/ui.js";
import { SmokeChart } from "../components/SmokeChart.js";
import { Chip, EmptyState, Skeleton } from "../components/ui.js";
import { fmtMs, fmtLoss, lossColor, collectorColor } from "../lib/format.js";
import { probeAddress } from "../lib/probe.js";

/** Round the window to whole minutes so the query key is stable between renders. */
const BUCKET_MS = 60_000;

export function Dashboard() {
  const { rangeMs, live } = useUI();
  const { data: targets, isLoading } = useQuery({ queryKey: ["targets"], queryFn: api.listTargets });

  const to = Math.ceil(Date.now() / BUCKET_MS) * BUCKET_MS;
  const from = to - rangeMs;
  const ids = useMemo(() => (targets ?? []).map((t) => t.id), [targets]);

  // A single request for every card: one per card used to queue behind the
  // server's connection pool once there were more than a handful of probes,
  // which is what left cards blank and charts full of gaps.
  const { data: series, isLoading: seriesLoading } = useQuery<MultiSeriesResponse>({
    queryKey: ["dashboard-series", ids, from, to],
    queryFn: () => api.multiSeries(ids, from, to),
    enabled: ids.length > 0,
    refetchInterval: live ? 15_000 : false,
    // Keep the previous window on screen while the next one loads.
    placeholderData: keepPreviousData,
  });

  const byTarget = useMemo(() => {
    const map = new Map<number, CollectorSeries[]>();
    for (const entry of series?.targets ?? []) map.set(entry.target_id, entry.series);
    return map;
  }, [series]);

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted mt-0.5">Latency across all probes</p>
        </div>
        <Link to="/settings" className="btn-ghost">
          <Plus className="h-4 w-4" /> Add probe
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      ) : !targets?.length ? (
        <div className="card">
          <EmptyState
            icon={<Activity className="h-12 w-12" />}
            title="No probes yet"
            hint="Create your first probe and point a collector at it to start charting latency."
            action={
              <Link to="/settings" className="btn-primary">
                <Plus className="h-4 w-4" /> Create a probe
              </Link>
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {targets.map((t) => (
            <TargetCard
              key={t.id}
              target={t}
              series={byTarget.get(t.id) ?? []}
              loading={seriesLoading}
              from={from}
              to={to}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TargetCard({
  target,
  series,
  loading,
  from,
  to,
}: {
  target: Target;
  series: CollectorSeries[];
  loading: boolean;
  from: number;
  to: number;
}) {
  // Representative series = collector with the most points.
  const rep: CollectorSeries | undefined = useMemo(
    () => [...series].sort((a, b) => b.points.length - a.points.length)[0],
    [series],
  );
  const last = rep?.points[rep.points.length - 1];

  return (
    <Link
      to={`/targets/${target.id}`}
      className="card p-4 hover:border-accent/40 transition-colors group flex flex-col"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <div className="font-semibold truncate group-hover:text-accent-soft transition-colors">
            {target.name}
          </div>
          <div className="text-xs text-faint font-mono truncate">{probeAddress(target)}</div>
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className={`text-lg font-bold font-mono ${lossColor(last?.loss_pct)}`}>
            {fmtMs(last?.median_ms)}
          </div>
          <div className="text-xs text-muted">{fmtLoss(last?.loss_pct ?? 0)} loss</div>
        </div>
      </div>

      <div className="-mx-1">
        {rep && rep.points.length > 0 ? (
          <SmokeChart points={rep.points} height={120} compact thresholdMs={target.latency_threshold_ms} domainX={[from, to]} />
        ) : loading ? (
          <Skeleton className="h-[120px] rounded-xl mx-1" />
        ) : (
          <div className="h-[120px] grid place-items-center text-xs text-faint">
            <span className="flex items-center gap-1.5">
              <Radio className="h-3.5 w-3.5" /> waiting for data…
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <Chip tone={target.type === "ping" ? "neutral" : "accent"}>{probeLabel(target.type)}</Chip>
        {series.map((c) => (
          <Chip key={c.collector_id} className="!bg-surface-2">
            <span className="h-2 w-2 rounded-full" style={{ background: collectorColor(c.collector_id) }} />
            {c.collector_name}
          </Chip>
        ))}
        {target.latency_threshold_ms != null && (
          <Chip tone="accent">{`> ${target.latency_threshold_ms}ms alert`}</Chip>
        )}
      </div>
    </Link>
  );
}

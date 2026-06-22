import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Grid2x2, LineChart as LineIcon, Route, Activity, Settings as SettingsIcon } from "lucide-react";
import { clsx } from "clsx";
import type { SeriesResponse, SeriesPoint } from "@mping/shared";
import { api } from "../lib/api.js";
import { useUI } from "../state/ui.js";
import { useLiveFeed } from "../lib/useLiveFeed.js";
import { SmokeChart } from "../components/SmokeChart.js";
import { OverlayChart } from "../components/OverlayChart.js";
import { TracerouteTab } from "../components/TracerouteTab.js";
import { Chip, EmptyState, Skeleton } from "../components/ui.js";
import { fmtMs, fmtLoss, lossColor, collectorColor } from "../lib/format.js";

type Tab = "latency" | "traceroute";
type LatencyView = "grid" | "overlay";

export function TargetDetail() {
  const { id } = useParams();
  const targetId = Number(id);
  const qc = useQueryClient();
  const { rangeMs, rangeKey, live } = useUI();
  const [tab, setTab] = useState<Tab>("latency");
  const [view, setView] = useState<LatencyView>("grid");

  const { data: target } = useQuery({ queryKey: ["target", targetId], queryFn: () => api.getTarget(targetId) });

  const seriesKey = ["detail-series", targetId, rangeKey];
  const { data: series, isLoading } = useQuery<SeriesResponse>({
    queryKey: seriesKey,
    queryFn: () => {
      const to = Date.now();
      return api.series(targetId, to - rangeMs, to);
    },
    refetchInterval: live ? 20_000 : false,
  });

  // Live tail: append median-only points as samples arrive.
  useLiveFeed((msg) => {
    if (!live || msg.type !== "sample" || msg.target_id !== targetId) return;
    qc.setQueryData<SeriesResponse>(seriesKey, (prev) => {
      if (!prev) return prev;
      const point: SeriesPoint = {
        t: msg.t,
        loss_pct: msg.loss_pct,
        median_ms: msg.median_ms,
        min_ms: null,
        max_ms: null,
        bands: [null, null, null, msg.median_ms, null, null, null],
      };
      const next = { ...prev, series: prev.series.map((s) => ({ ...s, points: [...s.points] })) };
      let cs = next.series.find((s) => s.collector_id === msg.collector_id);
      if (!cs) {
        cs = { collector_id: msg.collector_id, collector_name: msg.collector_name, points: [] };
        next.series = [...next.series, cs];
      }
      if (cs.points[cs.points.length - 1]?.t !== msg.t) cs.points.push(point);
      return next;
    });
  });

  const to = Date.now();
  const from = to - rangeMs;
  const collectors = series?.series ?? [];

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-gray-200 mb-3">
        <ChevronLeft className="h-4 w-4" /> Dashboard
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            {target?.name ?? <Skeleton className="h-7 w-40" />}
          </h1>
          <div className="text-sm text-faint font-mono mt-0.5">{target?.host}</div>
        </div>
        <div className="flex items-center gap-2">
          {target?.latency_threshold_ms != null && <Chip tone="accent">{`alert > ${target.latency_threshold_ms}ms`}</Chip>}
          {target?.alert_on_loss_pct != null && <Chip tone="warn">{`alert > ${target.alert_on_loss_pct}% loss`}</Chip>}
          <Link to="/settings" className="btn-ghost py-2"><SettingsIcon className="h-4 w-4" /></Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-border/60">
        <TabBtn active={tab === "latency"} onClick={() => setTab("latency")} icon={<Activity className="h-4 w-4" />}>
          Latency
        </TabBtn>
        <TabBtn active={tab === "traceroute"} onClick={() => setTab("traceroute")} icon={<Route className="h-4 w-4" />}>
          Traceroute
        </TabBtn>
      </div>

      {tab === "latency" && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-muted">
              {collectors.length} collector{collectors.length === 1 ? "" : "s"}
              {series?.resolution && series.resolution !== "raw" && (
                <Chip className="ml-2">{series.resolution} avg</Chip>
              )}
            </div>
            <div className="flex items-center gap-1 bg-surface-2 rounded-xl p-1 border border-border">
              <ViewBtn active={view === "grid"} onClick={() => setView("grid")} icon={<Grid2x2 className="h-4 w-4" />} label="Grid" />
              <ViewBtn active={view === "overlay"} onClick={() => setView("overlay")} icon={<LineIcon className="h-4 w-4" />} label="Overlay" />
            </div>
          </div>

          {isLoading ? (
            <Skeleton className="h-72 rounded-2xl" />
          ) : collectors.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<Activity className="h-12 w-12" />}
                title="No data yet"
                hint="Point a collector at this server with the probe enabled. Samples will appear here within a cycle."
              />
            </div>
          ) : view === "grid" ? (
            <div className={clsx("grid gap-4", collectors.length > 1 ? "lg:grid-cols-2" : "grid-cols-1")}>
              {collectors.map((c) => {
                const last = c.points[c.points.length - 1];
                return (
                  <div key={c.collector_id} className="card p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 font-medium">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: collectorColor(c.collector_id) }} />
                        {c.collector_name}
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className={clsx("font-mono font-semibold", lossColor(last?.loss_pct))}>{fmtMs(last?.median_ms)}</span>
                        <span className="text-muted">{fmtLoss(last?.loss_pct ?? 0)}</span>
                      </div>
                    </div>
                    <SmokeChart
                      points={c.points}
                      height={220}
                      domainX={[from, to]}
                      thresholdMs={target?.latency_threshold_ms}
                      baseColor={collectorColor(c.collector_id)}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="card p-4">
              <OverlayChart series={collectors} height={340} domainX={[from, to]} thresholdMs={target?.latency_threshold_ms} />
              <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-border/60">
                {collectors.map((c) => (
                  <span key={c.collector_id} className="flex items-center gap-1.5 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: collectorColor(c.collector_id) }} />
                    {c.collector_name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === "traceroute" && target && <TracerouteTab targetId={targetId} />}
    </div>
  );
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
        active ? "border-accent text-white" : "border-transparent text-muted hover:text-gray-200",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function ViewBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={clsx("flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-medium transition-colors", active ? "bg-accent text-white" : "text-muted hover:text-gray-200")}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

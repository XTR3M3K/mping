import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radio, RefreshCw, Route as RouteIcon } from "lucide-react";
import { clsx } from "clsx";
import { mergeRoutes, type SeriesPoint, type Target, type TracerouteView } from "@mping/shared";
import { api } from "../lib/api.js";
import { useLiveFeed } from "../lib/useLiveFeed.js";
import { SmokeChart } from "./SmokeChart.js";
import { HopTable } from "./HopTable.js";
import { Chip, EmptyState, Skeleton } from "./ui.js";
import { fmtLoss, fmtMs, fmtRelTime, collectorColor, lossColor } from "../lib/format.js";

const WINDOWS = [
  { key: "5m", ms: 5 * 60_000 },
  { key: "15m", ms: 15 * 60_000 },
  { key: "1h", ms: 60 * 60_000 },
];

interface LiveSeries {
  collector_id: number;
  collector_name: string;
  points: SeriesPoint[];
  /** Wall-clock of the last sample, for the "beat" indicator. */
  lastAt: number;
}

/**
 * A single probe watched as it happens: samples arrive over the WebSocket and
 * land on the chart one by one, and the path underneath can be re-traced on
 * demand rather than at the probe's own traceroute cadence.
 */
export function LiveTab({ target }: { target: Target }) {
  const [windowMs, setWindowMs] = useState(WINDOWS[0]!.ms);
  const [series, setSeries] = useState<Map<number, LiveSeries>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  const [lastTrace, setLastTrace] = useState<{ collector_id: number; changed: boolean; at: number } | null>(null);

  // Seed from history so the chart isn't empty for the first interval.
  const { data: seed, isLoading } = useQuery({
    queryKey: ["live-seed", target.id, windowMs],
    queryFn: () => api.series(target.id, Date.now() - windowMs, Date.now(), undefined, "raw"),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!seed) return;
    setSeries((prev) => {
      const next = new Map(prev);
      for (const s of seed.series) {
        const existing = next.get(s.collector_id);
        // Keep anything the socket delivered while the seed was in flight.
        const live = existing?.points.filter((p) => p.t > (s.points[s.points.length - 1]?.t ?? 0)) ?? [];
        next.set(s.collector_id, {
          collector_id: s.collector_id,
          collector_name: s.collector_name,
          points: [...s.points, ...live],
          lastAt: existing?.lastAt ?? 0,
        });
      }
      return next;
    });
  }, [seed]);

  useLiveFeed(
    useCallback(
      (msg) => {
        if (msg.type === "traceroute" && msg.target_id === target.id) {
          setLastTrace({ collector_id: msg.collector_id, changed: msg.changed, at: Date.now() });
          return;
        }
        if (msg.type !== "sample" || msg.target_id !== target.id) return;
        setSeries((prev) => {
          const next = new Map(prev);
          const cur = next.get(msg.collector_id);
          const point: SeriesPoint = {
            t: msg.t,
            loss_pct: msg.loss_pct,
            median_ms: msg.median_ms,
            min_ms: msg.min_ms,
            max_ms: msg.max_ms,
            // Only the outer band is known live; the ladder fills in on reload.
            bands: [msg.min_ms, null, null, msg.median_ms, null, null, msg.max_ms],
          };
          const points = [...(cur?.points ?? []), point].filter((p) => p.t !== msg.t || p === point);
          next.set(msg.collector_id, {
            collector_id: msg.collector_id,
            collector_name: msg.collector_name,
            points,
            lastAt: Date.now(),
          });
          return next;
        });
      },
      [target.id],
    ),
  );

  // Scroll the axis even while nothing arrives, and drop what fell out of it.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const from = now - windowMs;
  const collectors = useMemo(
    () =>
      [...series.values()]
        .map((s) => ({ ...s, points: s.points.filter((p) => p.t >= from) }))
        .sort((a, b) => a.collector_id - b.collector_id),
    [series, from],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Radio className="h-4 w-4 text-good animate-pulse" />
          Streaming samples as collectors report them
        </div>
        <div className="flex items-center gap-1 bg-surface-2 rounded-xl p-1 border border-border">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              onClick={() => setWindowMs(w.ms)}
              className={clsx(
                "px-2.5 py-1 rounded-lg text-sm font-medium transition-colors",
                windowMs === w.ms ? "bg-accent text-white" : "text-muted hover:text-gray-200",
              )}
            >
              {w.key}
            </button>
          ))}
        </div>
      </div>

      {isLoading && collectors.length === 0 ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : collectors.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Radio className="h-12 w-12" />}
            title="Waiting for the first sample"
            hint="Nothing has arrived in this window yet. Samples appear the moment a collector reports one."
          />
        </div>
      ) : (
        <div className={clsx("grid gap-4", collectors.length > 1 ? "lg:grid-cols-2" : "grid-cols-1")}>
          {collectors.map((c) => (
            <LiveChart key={c.collector_id} series={c} from={from} to={now} target={target} />
          ))}
        </div>
      )}

      <LiveTraceroute target={target} lastTrace={lastTrace} />
    </div>
  );
}

function LiveChart({
  series,
  from,
  to,
  target,
}: {
  series: LiveSeries;
  from: number;
  to: number;
  target: Target;
}) {
  const last = series.points[series.points.length - 1];
  // A sample landing within the last two seconds counts as "just now".
  const fresh = Date.now() - series.lastAt < 2000;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 font-medium">
          <span
            className={clsx("h-2.5 w-2.5 rounded-full transition-transform", fresh && "scale-150")}
            style={{ background: collectorColor(series.collector_id) }}
          />
          {series.collector_name}
        </div>
        <div className="flex items-baseline gap-3">
          <span className={clsx("font-mono text-xl font-semibold", lossColor(last?.loss_pct))}>
            {fmtMs(last?.median_ms)}
          </span>
          <span className="text-sm text-muted">{fmtLoss(last?.loss_pct ?? 0)}</span>
        </div>
      </div>
      <SmokeChart
        points={series.points}
        height={200}
        domainX={[from, to]}
        thresholdMs={target.latency_threshold_ms}
        baseColor={collectorColor(series.collector_id)}
      />
      <div className="flex items-center justify-between text-xs text-faint mt-1">
        <span>{series.points.length} samples in window</span>
        <span>{last ? `last ${fmtRelTime(new Date(last.t).toISOString())}` : "—"}</span>
      </div>
    </div>
  );
}

function LiveTraceroute({
  target,
  lastTrace,
}: {
  target: Target;
  lastTrace: { collector_id: number; changed: boolean; at: number } | null;
}) {
  const [collectorId, setCollectorId] = useState<number | null>(null);
  const [queuedAt, setQueuedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: collectors } = useQuery({
    queryKey: ["trace-collectors", target.id],
    queryFn: () => api.tracerouteCollectors(target.id),
  });
  useEffect(() => {
    if (collectorId == null && collectors?.length) setCollectorId(collectors[0]!.collector_id);
  }, [collectors, collectorId]);

  const { data: view, refetch, isFetching } = useQuery<TracerouteView>({
    queryKey: ["traceroute", target.id, collectorId],
    queryFn: () => api.traceroute(target.id, collectorId!),
    enabled: collectorId != null,
  });

  // A run landing for the collector on screen replaces the path in place.
  const seen = useRef(0);
  useEffect(() => {
    if (!lastTrace || lastTrace.at === seen.current) return;
    if (lastTrace.collector_id !== collectorId) return;
    seen.current = lastTrace.at;
    setQueuedAt(null);
    void refetch();
  }, [lastTrace, collectorId, refetch]);

  const run = async () => {
    setError(null);
    try {
      const res = await api.runTraceroute(target.id, collectorId ?? undefined);
      if (res.queued === 0) setError("No collector is online to run it.");
      else setQueuedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rows = view?.current ? mergeRoutes(null, view.current.hops) : [];

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <RouteIcon className="h-4 w-4 text-accent-soft" /> Live traceroute
          {lastTrace?.changed && Date.now() - lastTrace.at < 30_000 && <Chip tone="warn">route changed</Chip>}
        </h3>
        <div className="flex items-center gap-2">
          {(collectors?.length ?? 0) > 1 && (
            <div className="flex items-center gap-1">
              {collectors!.map((c) => (
                <button
                  key={c.collector_id}
                  onClick={() => setCollectorId(c.collector_id)}
                  className={clsx(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm border transition-colors",
                    collectorId === c.collector_id
                      ? "border-accent bg-accent/15 text-white"
                      : "border-border bg-surface-2 text-muted hover:text-gray-200",
                  )}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: collectorColor(c.collector_id) }} />
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <button className="btn-ghost py-1.5" onClick={run} disabled={queuedAt != null}>
            <RefreshCw className={clsx("h-4 w-4", (queuedAt != null || isFetching) && "animate-spin")} />
            {queuedAt != null ? "Tracing…" : "Run now"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-bad mb-2">{error}</p>}
      {queuedAt != null && (
        <p className="text-xs text-faint mb-2">
          Queued — the collector picks it up within a few seconds and the path below updates itself.
        </p>
      )}

      {!view?.current ? (
        <p className="text-sm text-faint py-8 text-center">
          No path recorded yet for this collector. Run one to see it.
        </p>
      ) : (
        <>
          <div className="text-xs text-muted mb-2">Last run {fmtRelTime(view.current.run_at)}</div>
          <HopTable rows={rows} />
        </>
      )}
    </div>
  );
}

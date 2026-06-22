import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, GitBranch, Route as RouteIcon } from "lucide-react";
import { clsx } from "clsx";
import { diffRoutes, type Route, type TracerouteView } from "@mping/shared";
import { api } from "../lib/api.js";
import { EmptyState, Skeleton, Chip } from "./ui.js";
import { fmtMs, fmtRelTime, fmtClock, collectorColor } from "../lib/format.js";

export function TracerouteTab({ targetId }: { targetId: number }) {
  const { data: collectors, isLoading: loadingCols } = useQuery({
    queryKey: ["trace-collectors", targetId],
    queryFn: () => api.tracerouteCollectors(targetId),
  });
  const [collectorId, setCollectorId] = useState<number | null>(null);

  useEffect(() => {
    if (collectorId == null && collectors?.length) setCollectorId(collectors[0]!.collector_id);
  }, [collectors, collectorId]);

  const { data: view, isLoading } = useQuery<TracerouteView>({
    queryKey: ["traceroute", targetId, collectorId],
    queryFn: () => api.traceroute(targetId, collectorId!),
    enabled: collectorId != null,
  });

  if (loadingCols) return <Skeleton className="h-72 rounded-2xl" />;
  if (!collectors?.length) {
    return (
      <div className="card">
        <EmptyState
          icon={<RouteIcon className="h-12 w-12" />}
          title="No traceroute data"
          hint="Enable traceroute on this probe; collectors run it on a slower cadence and the path appears here."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {collectors.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          {collectors.map((c) => (
            <button
              key={c.collector_id}
              onClick={() => setCollectorId(c.collector_id)}
              className={clsx(
                "flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors",
                collectorId === c.collector_id ? "border-accent bg-accent/15 text-white" : "border-border bg-surface-2 text-muted hover:text-gray-200",
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: collectorColor(c.collector_id) }} />
              {c.name}
            </button>
          ))}
        </div>
      )}

      {isLoading || !view ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : (
        <div className="grid lg:grid-cols-2 gap-5">
          <CurrentRoute view={view} />
          <ChangeHistory view={view} />
        </div>
      )}
    </div>
  );
}

function CurrentRoute({ view }: { view: TracerouteView }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <RouteIcon className="h-4 w-4 text-accent-soft" /> Current path
        </h3>
        {view.current && <span className="text-xs text-muted">{fmtRelTime(view.current.run_at)}</span>}
      </div>
      {!view.current ? (
        <p className="text-sm text-faint py-8 text-center">No route recorded yet.</p>
      ) : (
        <HopTable hops={view.current.hops} />
      )}
    </div>
  );
}

function HopTable({ hops }: { hops: Route }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/60">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-faint text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left font-medium px-3 py-2 w-10">#</th>
            <th className="text-left font-medium px-3 py-2">Hop</th>
            <th className="text-right font-medium px-3 py-2 w-20">RTT</th>
            <th className="text-right font-medium px-3 py-2 w-16">Loss</th>
          </tr>
        </thead>
        <tbody>
          {hops.map((h, i) => (
            <tr key={`${h.ttl}-${i}`} className="border-t border-border/40">
              <td className="px-3 py-1.5 font-mono text-faint">{h.ttl}</td>
              <td className="px-3 py-1.5 font-mono">
                {h.ip ?? <span className="text-faint">* * *</span>}
                {h.host && h.host !== h.ip && <span className="text-faint"> ({h.host})</span>}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-muted">{fmtMs(h.rtt_ms)}</td>
              <td className="px-3 py-1.5 text-right font-mono">
                {h.loss_pct != null && h.loss_pct > 0 ? (
                  <span className="text-bad">{h.loss_pct.toFixed(0)}%</span>
                ) : (
                  <span className="text-faint">0%</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChangeHistory({ view }: { view: TracerouteView }) {
  const { history } = view;
  return (
    <div className="card p-4">
      <h3 className="font-semibold flex items-center gap-2 mb-3">
        <GitBranch className="h-4 w-4 text-accent-soft" /> Route changes
        <Chip className="ml-1">{history.length}</Chip>
      </h3>
      {history.length === 0 ? (
        <p className="text-sm text-faint py-8 text-center">No changes recorded. The path has been stable.</p>
      ) : (
        <div className="space-y-2">
          {history.map((entry, i) => {
            // The previous route is the next-older history entry.
            const prev = history[i + 1]?.hops ?? null;
            return (
              <HistoryItem
                key={entry.id}
                changedAt={entry.changed_at}
                hops={entry.hops}
                prev={prev}
                isInitial={entry.prev_hash == null}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function HistoryItem({
  changedAt,
  hops,
  prev,
  isInitial,
}: {
  changedAt: string;
  hops: Route;
  prev: Route | null;
  isInitial: boolean;
}) {
  const [open, setOpen] = useState(false);
  const diff = prev ? diffRoutes(prev, hops) : { added: [], removed: [], changed: [] };
  const changeCount = diff.added.length + diff.removed.length + diff.changed.length;

  return (
    <div className="rounded-xl border border-border/60 bg-surface-2/50 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-surface-2 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={clsx("h-2 w-2 rounded-full shrink-0", isInitial ? "bg-accent" : "bg-warn")} />
          <div className="min-w-0">
            <div className="text-sm font-medium">{fmtClock(changedAt)}</div>
            <div className="text-xs text-faint">{fmtRelTime(changedAt)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isInitial ? (
            <Chip tone="accent">first seen</Chip>
          ) : (
            <>
              {diff.added.length > 0 && <Chip tone="good">+{diff.added.length}</Chip>}
              {diff.removed.length > 0 && <Chip tone="bad">−{diff.removed.length}</Chip>}
              {diff.changed.length > 0 && <Chip tone="warn">~{diff.changed.length}</Chip>}
            </>
          )}
          <ChevronDown className={clsx("h-4 w-4 text-faint transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-border/40 space-y-1.5 text-sm font-mono">
          {isInitial || changeCount === 0 ? (
            <HopTable hops={hops} />
          ) : (
            <>
              {diff.changed.map((c) => (
                <div key={`c${c.ttl}`} className="flex flex-wrap items-center gap-2">
                  <span className="text-faint w-8">ttl {c.ttl}</span>
                  <span className="text-bad line-through">{c.from?.ip ?? "*"}</span>
                  <span className="text-faint">→</span>
                  <span className="text-good">{c.to?.ip ?? "*"}</span>
                </div>
              ))}
              {diff.added.map((h) => (
                <div key={`a${h.ttl}`} className="text-good">+ ttl {h.ttl}: {h.ip ?? "*"} {h.rtt_ms != null && `(${fmtMs(h.rtt_ms)})`}</div>
              ))}
              {diff.removed.map((h) => (
                <div key={`r${h.ttl}`} className="text-bad">− ttl {h.ttl}: {h.ip ?? "*"}</div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

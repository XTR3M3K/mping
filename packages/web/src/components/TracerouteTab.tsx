import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, GitBranch, Route as RouteIcon } from "lucide-react";
import { clsx } from "clsx";
import { mergeRoutes, shortAsName, type Hop, type MergedHop, type Route, type TracerouteView } from "@mping/shared";
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
        <div className="grid xl:grid-cols-2 gap-5 items-start">
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
        <HopTable rows={mergeRoutes(null, view.current.hops)} />
      )}
    </div>
  );
}

const ROW_TONE: Record<MergedHop["change"], string> = {
  same: "",
  added: "bg-good/10",
  removed: "bg-bad/10",
  changed: "bg-warn/10",
};

const MARKER: Record<MergedHop["change"], { sign: string; className: string }> = {
  same: { sign: "", className: "text-faint" },
  added: { sign: "+", className: "text-good" },
  removed: { sign: "−", className: "text-bad" },
  changed: { sign: "~", className: "text-warn" },
};

/**
 * One table for both the live path and a historical change: every row is a TTL,
 * annotated with how it differs from the previous route. Showing the diff in
 * place means a change can be read as a whole traceroute, not as a few
 * disconnected lines.
 */
function HopTable({ rows, diff = false }: { rows: MergedHop[]; diff?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/60">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-faint text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left font-medium px-3 py-2 w-10">#</th>
            <th className="text-left font-medium px-3 py-2">Hop</th>
            <th className="text-left font-medium px-3 py-2">ASN</th>
            <th className="text-right font-medium px-3 py-2 w-20">RTT</th>
            <th className="text-right font-medium px-3 py-2 w-16">Loss</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const shown = row.hop ?? row.before;
            const marker = MARKER[row.change];
            return (
              <tr key={row.ttl} className={clsx("border-t border-border/40", ROW_TONE[row.change])}>
                <td className="px-3 py-1.5 font-mono text-faint whitespace-nowrap">
                  {diff && marker.sign && <span className={clsx("mr-1", marker.className)}>{marker.sign}</span>}
                  {row.ttl}
                </td>
                {/* No nowrap here: an "old → new" pair is the widest thing in
                    the table and must be allowed to wrap inside a narrow card. */}
                <td className="px-3 py-1.5 font-mono">
                  <HopAddress row={row} />
                </td>
                <td className="px-3 py-1.5">
                  <AsnCell row={row} />
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-muted whitespace-nowrap">
                  {row.change === "removed" ? "—" : fmtMs(shown?.rtt_ms)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono whitespace-nowrap">
                  {row.change === "removed" ? (
                    <span className="text-faint">—</span>
                  ) : shown?.loss_pct != null && shown.loss_pct > 0 ? (
                    <span className="text-bad">{shown.loss_pct.toFixed(0)}%</span>
                  ) : (
                    <span className="text-faint">0%</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function address(h: Hop): string {
  return h.ip ?? "* * *";
}

function HopAddress({ row }: { row: MergedHop }) {
  const { hop, before, change } = row;
  if (change === "removed" && before) {
    return <span className="text-bad line-through">{address(before)}</span>;
  }
  if (!hop) return <span className="text-faint">* * *</span>;
  return (
    <>
      {change === "changed" && before && (
        <>
          <span className="text-bad line-through">{address(before)}</span>
          <span className="text-faint mx-1.5">→</span>
        </>
      )}
      <span className={clsx(!hop.ip && "text-faint", change === "changed" && "text-good")}>{address(hop)}</span>
      {hop.host && hop.host !== hop.ip && <span className="text-faint"> ({hop.host})</span>}
    </>
  );
}

function AsnCell({ row }: { row: MergedHop }) {
  const hop = row.change === "removed" ? row.before : row.hop;
  if (!hop?.asn) return <span className="text-faint text-xs">—</span>;
  const name = shortAsName(hop.as_name);
  // The AS can change even when the IP doesn't — worth flagging on a diff row.
  const moved = row.before?.asn != null && row.hop?.asn != null && row.before.asn !== row.hop.asn;
  return (
    // Name under the number, like the hop's reverse-DNS sits under its IP: the
    // cell can then shrink, which keeps RTT and Loss on screen in a narrow card.
    <div
      className={clsx("text-xs leading-tight", row.change === "removed" && "line-through")}
      title={hop.as_name ?? undefined}
    >
      <div className={clsx("font-mono", moved ? "text-warn" : "text-muted")}>AS{hop.asn}</div>
      {name && <div className="text-faint truncate max-w-[9rem]">{name}</div>}
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
          {history.map((entry, i) => (
            <HistoryItem
              key={entry.id}
              changedAt={entry.changed_at}
              hops={entry.hops}
              // The previous route is the next-older history entry.
              prev={history[i + 1]?.hops ?? null}
              isInitial={entry.prev_hash == null}
            />
          ))}
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
  const [onlyChanges, setOnlyChanges] = useState(false);

  const rows = mergeRoutes(isInitial ? null : prev, hops);
  const changedRows = rows.filter((r) => r.change !== "same");
  const counts = {
    added: changedRows.filter((r) => r.change === "added").length,
    removed: changedRows.filter((r) => r.change === "removed").length,
    changed: changedRows.filter((r) => r.change === "changed").length,
  };
  const hasDiff = changedRows.length > 0;

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
            <div className="text-xs text-faint">
              {fmtRelTime(changedAt)} · {hops.length} hops
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isInitial ? (
            <Chip tone="accent">first seen</Chip>
          ) : (
            <>
              {counts.added > 0 && <Chip tone="good">+{counts.added}</Chip>}
              {counts.removed > 0 && <Chip tone="bad">−{counts.removed}</Chip>}
              {counts.changed > 0 && <Chip tone="warn">~{counts.changed}</Chip>}
            </>
          )}
          <ChevronDown className={clsx("h-4 w-4 text-faint transition-transform", open && "rotate-180")} />
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-3 border-t border-border/40 space-y-2">
          {hasDiff && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-faint">
                Full path as recorded at this change{prev && !isInitial ? ", diffed against the previous one" : ""}.
              </span>
              <div className="flex items-center gap-1 bg-surface-2 rounded-lg p-0.5 border border-border shrink-0">
                <ScopeBtn active={!onlyChanges} onClick={() => setOnlyChanges(false)}>Full path</ScopeBtn>
                <ScopeBtn active={onlyChanges} onClick={() => setOnlyChanges(true)}>Changes</ScopeBtn>
              </div>
            </div>
          )}
          <HopTable rows={onlyChanges ? changedRows : rows} diff={hasDiff} />
        </div>
      )}
    </div>
  );
}

function ScopeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "px-2 py-0.5 rounded-md text-xs font-medium transition-colors",
        active ? "bg-accent text-white" : "text-muted hover:text-gray-200",
      )}
    >
      {children}
    </button>
  );
}

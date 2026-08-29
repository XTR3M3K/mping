import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, GitBranch, History, Route as RouteIcon } from "lucide-react";
import { clsx } from "clsx";
import {
  mergeRoutes,
  shortAsName,
  type Hop,
  type MergedHop,
  type TracerouteHistoryEntry,
  type TracerouteView,
} from "@mping/shared";
import { api } from "../lib/api.js";
import { EmptyState, Skeleton, Chip } from "./ui.js";
import { fmtMs, fmtRelTime, fmtClock, fmtDay, collectorColor } from "../lib/format.js";
import { useElementSize } from "../lib/useElementSize.js";

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
        <PathPanes view={view} />
      )}
    </div>
  );
}

/**
 * The path as it is now, the path as it was, and the list of moments it
 * changed — the change feed picks which historical path is on screen instead of
 * unfolding its own copy of the table.
 */
function PathPanes({ view }: { view: TracerouteView }) {
  const { history } = view;
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Track the selection by id, not index: a refetch that prepends a new change
  // would otherwise silently slide the view onto a different entry.
  const selected = useMemo(() => {
    const i = history.findIndex((h) => h.id === selectedId);
    return i >= 0 ? i : 0;
  }, [history, selectedId]);

  return (
    <div className="grid xl:grid-cols-2 gap-5 items-start">
      <div className="space-y-5">
        <CurrentRoute view={view} />
        <HistoricalPath
          history={history}
          selected={selected}
          onSelect={(i) => setSelectedId(history[i]?.id ?? null)}
        />
      </div>
      <ChangeHistory
        history={history}
        selectedId={history[selected]?.id ?? null}
        onSelect={(id) => setSelectedId(id)}
      />
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

/** Diff rows for a history entry against the next-older one. */
function rowsFor(history: TracerouteHistoryEntry[], index: number): MergedHop[] {
  const entry = history[index];
  if (!entry) return [];
  const isInitial = entry.prev_hash == null;
  return mergeRoutes(isInitial ? null : (history[index + 1]?.hops ?? null), entry.hops);
}

function HistoricalPath({
  history,
  selected,
  onSelect,
}: {
  history: TracerouteHistoryEntry[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const [onlyChanges, setOnlyChanges] = useState(false);
  const entry = history[selected];
  const rows = rowsFor(history, selected);
  const changedRows = rows.filter((r) => r.change !== "same");
  const hasDiff = changedRows.length > 0;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <History className="h-4 w-4 text-accent-soft" /> Historical path
        </h3>
        {entry && (
          <span className="text-xs text-muted">
            {fmtClock(entry.changed_at)} · {fmtRelTime(entry.changed_at)}
          </span>
        )}
      </div>

      {!entry ? (
        <p className="text-sm text-faint py-8 text-center">
          Nothing recorded yet. Paths appear here the first time a collector traces this probe.
        </p>
      ) : (
        <div className="space-y-3">
          <Timeline history={history} selected={selected} onSelect={onSelect} />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-faint">
              {entry.prev_hash == null
                ? "First path recorded for this collector."
                : "Path as recorded then, diffed against the previous one."}
            </span>
            {hasDiff && (
              <div className="flex items-center gap-1 bg-surface-2 rounded-lg p-0.5 border border-border shrink-0">
                <ScopeBtn active={!onlyChanges} onClick={() => setOnlyChanges(false)}>Full path</ScopeBtn>
                <ScopeBtn active={onlyChanges} onClick={() => setOnlyChanges(true)}>Changes</ScopeBtn>
              </div>
            )}
          </div>
          <HopTable rows={onlyChanges ? changedRows : rows} diff={hasDiff} />
        </div>
      )}
    </div>
  );
}

/**
 * Changes laid out on a real time axis, so 65 days of quiet followed by three
 * flaps this morning looks like exactly that. Clustered ticks are nudged apart
 * to stay clickable, and the steppers walk the list in strict order.
 */
const TICK_MIN_GAP_PX = 14;
/** Past this many entries a time axis is unreadable; space them evenly. */
const TICK_EVEN_SPACING_ABOVE = 40;

/** Tick offsets in px, ordered oldest → newest, never closer than the min gap. */
function tickPositions(times: number[], width: number): number[] {
  const n = times.length;
  if (n === 0 || width <= 0) return [];
  const pad = 8;
  const usable = Math.max(1, width - pad * 2);
  const oldest = times[n - 1]!;
  const newest = times[0]!;
  const span = newest - oldest;

  // times is newest-first; lay the axis out oldest → newest.
  const raw = times
    .map((t, i) =>
      span > 0 && n <= TICK_EVEN_SPACING_ABOVE
        ? pad + ((t - oldest) / span) * usable
        : pad + (n === 1 ? usable / 2 : ((n - 1 - i) / (n - 1)) * usable),
    )
    .reverse();

  // Push overlapping ticks right, then pull the whole run back if it spills.
  for (let i = 1; i < raw.length; i++) {
    raw[i] = Math.max(raw[i]!, raw[i - 1]! + TICK_MIN_GAP_PX);
  }
  const overflow = raw[raw.length - 1]! - (width - pad);
  if (overflow > 0) {
    for (let i = raw.length - 1; i >= 0; i--) {
      raw[i] = Math.min(raw[i]!, (raw[i + 1] ?? width - pad) - TICK_MIN_GAP_PX);
    }
  }
  return raw.reverse(); // back to newest-first, matching `history`
}

function Timeline({
  history,
  selected,
  onSelect,
}: {
  history: TracerouteHistoryEntry[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const [axisRef, { width }] = useElementSize<HTMLDivElement>();
  const times = history.map((h) => new Date(h.changed_at).getTime());
  const positions = tickPositions(times, width);
  const oldest = history[history.length - 1];
  const newest = history[0];

  return (
    <div>
      <div className="flex items-center gap-2">
        <StepBtn label="Older" disabled={selected >= history.length - 1} onClick={() => onSelect(selected + 1)}>
          <ChevronLeft className="h-4 w-4" />
        </StepBtn>

        <div ref={axisRef} className="relative flex-1 h-9">
          <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />
          {positions.length > 0 &&
            history.map((h, i) => {
              const active = i === selected;
              const initial = h.prev_hash == null;
              return (
                <button
                  key={h.id}
                  onClick={() => onSelect(i)}
                  title={`${fmtClock(h.changed_at)} · ${h.hops.length} hops`}
                  aria-label={fmtClock(h.changed_at)}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 p-1.5 group"
                  style={{ left: positions[i] }}
                >
                  <span
                    className={clsx(
                      "block rounded-full transition-all",
                      active
                        ? "h-3 w-3 bg-accent ring-4 ring-accent/25"
                        : clsx("h-2 w-2 group-hover:scale-125", initial ? "bg-accent/60" : "bg-warn/70"),
                    )}
                  />
                </button>
              );
            })}
        </div>

        <StepBtn label="Newer" disabled={selected <= 0} onClick={() => onSelect(selected - 1)}>
          <ChevronRight className="h-4 w-4" />
        </StepBtn>
      </div>
      {history.length > 1 && oldest && newest && (
        <div className="flex justify-between px-7 text-[10px] text-faint tabular-nums">
          <span>{fmtDay(oldest.changed_at)}</span>
          <span>{fmtDay(newest.changed_at)}</span>
        </div>
      )}
    </div>
  );
}

function StepBtn({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="shrink-0 rounded-lg border border-border bg-surface-2 p-1 text-muted transition-colors hover:text-gray-200 disabled:opacity-30 disabled:hover:text-muted"
    >
      {children}
    </button>
  );
}

function ChangeHistory({
  history,
  selectedId,
  onSelect,
}: {
  history: TracerouteHistoryEntry[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
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
              entry={entry}
              rows={rowsFor(history, i)}
              active={entry.id === selectedId}
              onSelect={() => onSelect(entry.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryItem({
  entry,
  rows,
  active,
  onSelect,
}: {
  entry: TracerouteHistoryEntry;
  rows: MergedHop[];
  active: boolean;
  onSelect: () => void;
}) {
  const isInitial = entry.prev_hash == null;
  const counts = {
    added: rows.filter((r) => r.change === "added").length,
    removed: rows.filter((r) => r.change === "removed").length,
    changed: rows.filter((r) => r.change === "changed").length,
  };

  return (
    <button
      onClick={onSelect}
      aria-pressed={active}
      className={clsx(
        "w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-accent bg-accent/10"
          : "border-border/60 bg-surface-2/50 hover:bg-surface-2",
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className={clsx("h-2 w-2 rounded-full shrink-0", isInitial ? "bg-accent" : "bg-warn")} />
        <div className="min-w-0">
          <div className="text-sm font-medium">{fmtClock(entry.changed_at)}</div>
          <div className="text-xs text-faint">
            {fmtRelTime(entry.changed_at)} · {entry.hops.length} hops
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
      </div>
    </button>
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

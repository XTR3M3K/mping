import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, History, Route as RouteIcon } from "lucide-react";
import { clsx } from "clsx";
import {
  mergeRoutes,
  type MergedHop,
  type TracerouteHistoryEntry,
  type TracerouteView,
} from "@mping/shared";
import { api } from "../lib/api.js";
import { EmptyState, Skeleton, Chip } from "./ui.js";
import { HopTable } from "./HopTable.js";
import { fmtRelTime, fmtClock, fmtDay, collectorColor } from "../lib/format.js";
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

  // Stacked, not side by side: both are hop tables of the same path, and
  // reading one under the other beats comparing across a gutter.
  return (
    <div className="space-y-5">
      <CurrentRoute view={view} />
      <HistoricalPath
        history={history}
        selected={selected}
        onSelect={(i) => setSelectedId(history[i]?.id ?? null)}
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
  const counts = {
    added: changedRows.filter((r) => r.change === "added").length,
    removed: changedRows.filter((r) => r.change === "removed").length,
    changed: changedRows.filter((r) => r.change === "changed").length,
  };

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <History className="h-4 w-4 text-accent-soft" /> Historical path
          <Chip className="ml-1">{history.length}</Chip>
        </h3>
        {entry && (
          <div className="flex items-center gap-2">
            {entry.prev_hash == null ? (
              <Chip tone="accent">first seen</Chip>
            ) : (
              <>
                {counts.added > 0 && <Chip tone="good">+{counts.added}</Chip>}
                {counts.removed > 0 && <Chip tone="bad">−{counts.removed}</Chip>}
                {counts.changed > 0 && <Chip tone="warn">~{counts.changed}</Chip>}
              </>
            )}
            <span className="text-xs text-muted whitespace-nowrap">
              {fmtClock(entry.changed_at)} · {fmtRelTime(entry.changed_at)}
            </span>
          </div>
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

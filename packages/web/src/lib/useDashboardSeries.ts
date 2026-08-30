import { useCallback, useEffect, useRef, useState } from "react";
import type { CollectorSeries } from "@mping/shared";
import { api } from "./api.js";

/**
 * Ids per request. Small enough that the query string stays far away from the
 * 8KB header limit a proxy or Node itself will enforce — asking for a couple of
 * thousand targets at once produced a 431 and no charts at all — and small
 * enough that one response is tens of KB rather than megabytes.
 */
const BATCH = 40;
/** Start loading a card before it scrolls into view. */
const ROOT_MARGIN = "600px 0px";
/** Coalesce the burst of intersection events a scroll produces. */
const DEBOUNCE_MS = 120;
const REFRESH_MS = 15_000;
/** Round the window so a redraw doesn't shift every chart by a few pixels. */
const BUCKET_MS = 60_000;

export interface DashboardSeries {
  from: number;
  to: number;
  /** Series for a card, or undefined while it hasn't been fetched yet. */
  seriesFor: (targetId: number) => CollectorSeries[] | undefined;
  /** Whether this card's first fetch has completed (so it can stop showing a skeleton). */
  isLoaded: (targetId: number) => boolean;
  /** Ref callback that puts a card under observation. */
  observe: (targetId: number) => (el: HTMLElement | null) => void;
}

/**
 * Feeds the dashboard grid one screenful at a time. With a couple of thousand
 * probes, fetching every card's history up front is both a request nothing will
 * accept and a payload nobody reads: only what is on (or near) the screen is
 * loaded, and only that is refreshed while live.
 */
export function useDashboardSeries(rangeMs: number, live: boolean): DashboardSeries {
  const [data, setData] = useState<Map<number, CollectorSeries[]>>(new Map());
  const [loaded, setLoaded] = useState<Set<number>>(new Set());
  const [window_, setWindow] = useState(() => makeWindow(rangeMs));

  const visible = useRef<Set<number>>(new Set());
  const inflight = useRef<Set<number>>(new Set());
  const elements = useRef<Map<Element, number>>(new Map());
  const observer = useRef<IntersectionObserver | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new range invalidates everything we cached for the old one.
  useEffect(() => {
    setData(new Map());
    setLoaded(new Set());
    setWindow(makeWindow(rangeMs));
  }, [rangeMs]);

  const fetchIds = useCallback(
    async (ids: number[], from: number, to: number) => {
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH).filter((id) => !inflight.current.has(id));
        if (chunk.length === 0) continue;
        chunk.forEach((id) => inflight.current.add(id));
        try {
          const res = await api.multiSeries(chunk, from, to);
          setData((prev) => {
            const next = new Map(prev);
            for (const entry of res.targets) next.set(entry.target_id, entry.series);
            return next;
          });
          setLoaded((prev) => new Set([...prev, ...chunk]));
        } catch {
          // Leave them unloaded; the next scroll or refresh tick retries.
        } finally {
          chunk.forEach((id) => inflight.current.delete(id));
        }
      }
    },
    [],
  );

  // Load what came into view, after the scroll settles. Kept in a ref as well:
  // the observer must be created once and outlive every state change, so its
  // callback can't close over one particular version of this.
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const wanted = [...visible.current].filter((id) => !loaded.has(id) && !inflight.current.has(id));
      if (wanted.length > 0) void fetchIds(wanted, window_.from, window_.to);
    }, DEBOUNCE_MS);
  }, [fetchIds, loaded, window_]);

  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;

  /**
   * Created on demand rather than in an effect: ref callbacks run before
   * effects, so an effect-created observer misses the first commit entirely,
   * and re-creating it on a state change would strand every card that had
   * already registered with the previous one.
   */
  const getObserver = useCallback((): IntersectionObserver | null => {
    if (typeof IntersectionObserver === "undefined") return null;
    if (!observer.current) {
      observer.current = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const id = elements.current.get(entry.target);
            if (id == null) continue;
            if (entry.isIntersecting) visible.current.add(id);
            else visible.current.delete(id);
          }
          scheduleRef.current();
        },
        { rootMargin: ROOT_MARGIN },
      );
    }
    return observer.current;
  }, []);

  useEffect(() => {
    const pending = timer;
    return () => {
      observer.current?.disconnect();
      observer.current = null;
      elements.current.clear();
      if (pending.current) clearTimeout(pending.current);
    };
  }, []);

  // Cards already on screen when the range changes still need their new data.
  useEffect(() => {
    schedule();
  }, [schedule]);

  // While live, roll the window forward and refresh only what's on screen.
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      const next = makeWindow(rangeMs);
      setWindow(next);
      const onScreen = [...visible.current];
      if (onScreen.length > 0) void fetchIds(onScreen, next.from, next.to);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [live, rangeMs, fetchIds]);

  const observe = useCallback(
    (targetId: number) => (el: HTMLElement | null) => {
      const io = getObserver();
      if (!io) return;
      // Stop watching the node this card used to occupy (grids reuse them).
      for (const [node, id] of elements.current) {
        if (id === targetId && node !== el) {
          io.unobserve(node);
          elements.current.delete(node);
        }
      }
      if (!el) return;
      elements.current.set(el, targetId);
      io.observe(el);
    },
    [getObserver],
  );

  return {
    from: window_.from,
    to: window_.to,
    seriesFor: (id) => data.get(id),
    isLoaded: (id) => loaded.has(id),
    observe,
  };
}

function makeWindow(rangeMs: number): { from: number; to: number } {
  const to = Math.ceil(Date.now() / BUCKET_MS) * BUCKET_MS;
  return { from: to - rangeMs, to };
}

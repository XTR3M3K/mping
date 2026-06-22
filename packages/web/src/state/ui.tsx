import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { presetByKey } from "../lib/timeRange.js";

interface UIState {
  rangeKey: string;
  setRangeKey: (k: string) => void;
  rangeMs: number;
  live: boolean;
  setLive: (v: boolean) => void;
}

const Ctx = createContext<UIState | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [rangeKey, setRangeKey] = useState("3h");
  const [live, setLive] = useState(true);
  const value = useMemo<UIState>(
    () => ({ rangeKey, setRangeKey, rangeMs: presetByKey(rangeKey).ms, live, setLive }),
    [rangeKey, live],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUI(): UIState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUI must be used within UIProvider");
  return ctx;
}

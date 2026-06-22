import { clsx } from "clsx";
import { Radio } from "lucide-react";
import { useUI } from "../state/ui.js";
import { RANGE_PRESETS } from "../lib/timeRange.js";

export function TopBar() {
  const { rangeKey, setRangeKey, live, setLive } = useUI();
  return (
    <div className="flex items-center justify-between w-full gap-3">
      <div className="hidden sm:flex items-center gap-1 bg-surface-2 rounded-xl p-1 border border-border">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setRangeKey(p.key)}
            className={clsx(
              "px-2.5 py-1 rounded-lg text-sm font-medium transition-colors",
              rangeKey === p.key ? "bg-accent text-white" : "text-muted hover:text-gray-200",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Mobile: compact range select */}
      <select
        value={rangeKey}
        onChange={(e) => setRangeKey(e.target.value)}
        className="sm:hidden input py-1.5 w-28"
      >
        {RANGE_PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            Last {p.label}
          </option>
        ))}
      </select>

      <button
        onClick={() => setLive(!live)}
        className={clsx(
          "btn text-sm",
          live ? "bg-good/15 text-good border border-good/30" : "btn-ghost",
        )}
      >
        <Radio className={clsx("h-4 w-4", live && "animate-pulse")} />
        <span className="hidden sm:inline">{live ? "Live" : "Paused"}</span>
      </button>
    </div>
  );
}

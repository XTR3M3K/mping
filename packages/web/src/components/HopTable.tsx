import { clsx } from "clsx";
import { shortAsName, type Hop, type MergedHop } from "@mping/shared";
import { fmtMs } from "../lib/format.js";

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
export function HopTable({ rows, diff = false }: { rows: MergedHop[]; diff?: boolean }) {
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

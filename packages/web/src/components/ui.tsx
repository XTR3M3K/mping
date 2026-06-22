import { clsx } from "clsx";
import type { ReactNode } from "react";

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        "h-6 w-6 rounded-full border-2 border-accent/30 border-t-accent animate-spin",
        className,
      )}
    />
  );
}

export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "accent";
  className?: string;
}) {
  const tones = {
    neutral: "bg-surface-3 text-muted",
    good: "bg-good/15 text-good",
    warn: "bg-warn/15 text-warn",
    bad: "bg-bad/15 text-bad",
    accent: "bg-accent/15 text-accent-soft",
  };
  return <span className={clsx("chip", tones[tone], className)}>{children}</span>;
}

export function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      className={clsx(
        "inline-block h-2 w-2 rounded-full",
        online ? "bg-good animate-pulse-ring" : "bg-faint",
      )}
    />
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {icon && <div className="text-faint mb-4">{icon}</div>}
      <h3 className="text-lg font-semibold text-gray-200">{title}</h3>
      {hint && <p className="text-sm text-muted mt-1 max-w-sm">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-surface-2", className)} />;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{children}</h2>
      {right}
    </div>
  );
}

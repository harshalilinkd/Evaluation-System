/** MetricWidget — the standard dashboard tile. DESIGN.md §5.4. */

import { TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

export type MetricTrend = {
  /** Signed percentage, e.g. 4.23 or -1.5. */
  value: number;
  /** What the change is measured against — "vs last cycle". */
  caption?: string;
};

/**
 * §5.4: "a label (body-sm, ink-muted), a massive number (display-lg, ink), and a
 * small trend indicator."
 *
 * The trend pill is green up / red down — that is the one place green carries
 * meaning as "positive", which is exactly why green is not a tier colour
 * (DESIGN.md §2). A green that also meant "the MD said this" would make every
 * good delta read as a final score.
 */
export function MetricWidget({
  label,
  value,
  caption,
  trend,
  accent = "primary",
  icon,
  enterIndex,
  className,
}: {
  label: string;
  value: string | number;
  caption?: string;
  trend?: MetricTrend | null;
  /** Tints the small rule above the number, so a row of tiles reads as a set. */
  accent?: "primary" | "cyan" | "pink" | "green" | "amber";
  /** Sits opposite the label, tinted to match the accent. Decorative. */
  icon?: React.ReactNode;
  /** Position in the stagger (task 16). */
  enterIndex?: number;
  className?: string;
}) {
  // Written out in full, never interpolated: Tailwind scans statically, so
  // `bg-accent-${accent}` compiles to nothing at all.
  const accentBar = {
    primary: "bg-accent-primary",
    cyan: "bg-accent-cyan",
    pink: "bg-accent-pink",
    green: "bg-accent-green",
    amber: "bg-warning",
  }[accent];

  const accentInk = {
    primary: "bg-accent-primary/10 text-accent-primary",
    cyan: "bg-accent-cyan/10 text-accent-cyan",
    pink: "bg-accent-pink/10 text-accent-pink",
    green: "bg-accent-green/10 text-accent-green",
    amber: "bg-warning/10 text-warning",
  }[accent];

  const isUp = (trend?.value ?? 0) >= 0;

  return (
    <div
      className={cn("card-enter card-surface flex flex-col gap-3 p-6", className)}
      style={enterIndex === undefined ? undefined : ({ "--enter-index": enterIndex } as React.CSSProperties)}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={cn("h-1 w-8 rounded-pill", accentBar)} aria-hidden />
        {icon ? (
          <span
            aria-hidden
            className={cn("flex size-8 items-center justify-center rounded-input", accentInk)}
          >
            {icon}
          </span>
        ) : null}
      </div>

      <p className="text-body-sm text-ink-muted">{label}</p>

      {/* §3: display-lg at 700, and tabular so a row of tiles lines up. */}
      <p className="tabular text-display-lg text-ink">{value}</p>

      <div className="flex items-center gap-2">
        {trend ? (
          <span
            className={cn(
              "tabular inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-body-sm",
              isUp ? "bg-success-tint text-success" : "bg-critical-tint text-critical",
            )}
          >
            {isUp ? (
              <TrendingUp className="size-3" aria-hidden />
            ) : (
              <TrendingDown className="size-3" aria-hidden />
            )}
            {isUp ? "+" : ""}
            {trend.value.toFixed(2)}%
          </span>
        ) : null}
        {(trend?.caption ?? caption) ? (
          <span className="text-body-sm text-ink-faint">{trend?.caption ?? caption}</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A dashboard card that is not a metric — a chart, a list. Same surface, same
 * stagger, so a mixed grid arrives as one thing.
 */
export function DashboardCard({
  title,
  action,
  enterIndex,
  className,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  enterIndex?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn("card-enter card-surface p-6", className)}
      style={enterIndex === undefined ? undefined : ({ "--enter-index": enterIndex } as React.CSSProperties)}
    >
      <header className="flex items-start justify-between gap-4 pb-4">
        {/* §5.1: title in display-sm at the top left, interactive element right. */}
        <h2 className="text-display-sm text-ink">{title}</h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

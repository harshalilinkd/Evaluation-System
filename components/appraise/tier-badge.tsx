/** TierBadge and TierLegend. DESIGN.md §6.3. */

import { cn } from "@/lib/utils";
import { TIER_CLASSES, TIER_LABELS, type Tier } from "@/components/appraise/tier";

/**
 * An 8px dot in the tier colour plus the word (§6.3).
 *
 * One component, used everywhere. The whole convention rests on the reader
 * learning that amber means "the employee said this" — which only happens if
 * the mark looks identical on the form, the table, the chart and the printout.
 */
export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-pill border px-2.5 py-1",
        TIER_CLASSES[tier].chip,
        className,
      )}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-pill", TIER_CLASSES[tier].dot)} aria-hidden />
      <span className="type-label">{TIER_LABELS[tier]}</span>
    </span>
  );
}

/**
 * §6.3: appears once at the top of any screen showing more than one tier.
 *
 * Defaults to all three, which is the collision view's case. Pass a subset for
 * the HOD review screen, where only self and lead are in play — showing an
 * emerald key on a screen with no emerald on it teaches the wrong thing.
 */
export function TierLegend({
  tiers = ["self", "lead", "final"],
  className,
}: {
  tiers?: readonly Tier[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} role="list">
      {tiers.map((tier) => (
        <span key={tier} role="listitem">
          <TierBadge tier={tier} />
        </span>
      ))}
    </div>
  );
}

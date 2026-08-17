/** The manager's queue, while it loads. */

import { Shimmer } from "@/components/appraise/page-skeleton";
import { TableSkeleton } from "@/components/appraise/states";

/**
 * THREE counts, not five — this queue has its own. A skeleton that promises a
 * different number of tiles from the one that arrives is a page that jumps,
 * which is the thing a skeleton exists to prevent.
 */
export default function Loading() {
  return (
    <div className="space-y-4 px-4 py-4 lg:px-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your team</span>
      <div className="space-y-2">
        <Shimmer className="h-6 w-32" />
        <Shimmer className="h-3 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Shimmer key={i} className="h-16 rounded-card" />
        ))}
      </div>
      <TableSkeleton rows={6} columns={5} />
    </div>
  );
}

/** The report queue, while it loads. */

import { Shimmer } from "@/components/appraise/page-skeleton";
import { TableSkeleton } from "@/components/appraise/states";

/**
 * A HEADER, FIVE COUNTS AND A TABLE — the shape this screen actually has, so
 * nothing moves when the rows arrive. `TableSkeleton` already existed and had
 * never been used by a route; this is what it was built for.
 */
export default function Loading() {
  return (
    <div className="space-y-4 px-4 py-4 lg:px-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading reports</span>
      <div className="space-y-2">
        <Shimmer className="h-6 w-32" />
        <Shimmer className="h-3 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Shimmer key={i} className="h-16 rounded-card" />
        ))}
      </div>
      <TableSkeleton rows={6} columns={5} />
    </div>
  );
}

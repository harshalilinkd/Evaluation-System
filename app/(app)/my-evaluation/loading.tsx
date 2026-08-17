/** The employee's own screen, while it loads. */

import { CardSkeleton, Shimmer } from "@/components/appraise/page-skeleton";

/**
 * Its own shape rather than the group's, because this page is a DOCUMENT and
 * the group skeleton is a grid of cards. A three-column shimmer collapsing into
 * a single centred column is a bigger jump than no skeleton at all.
 *
 * `max-w-form`, the same cap the real screen uses, so the column lands where it
 * was already sitting.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-form space-y-8 px-4 py-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your evaluation</span>
      <div className="space-y-2">
        <Shimmer className="h-6 w-56" />
        <Shimmer className="h-3 w-72" />
      </div>
      <CardSkeleton lines={4} />
      <CardSkeleton lines={6} />
    </div>
  );
}

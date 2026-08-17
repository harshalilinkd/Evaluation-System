/** The fallback every authenticated screen falls back to while it loads. */

import { PageSkeleton } from "@/components/appraise/page-skeleton";

/**
 * AT THE GROUP LEVEL, so no route can be added without one.
 *
 * Next uses the NEAREST `loading.tsx`, so a screen with its own gets that and
 * everything else gets this. Putting the safety net here rather than on each
 * route is what makes the guarantee structural: a new page inherits a loading
 * state instead of needing somebody to remember one — the same reasoning P15-1
 * gives for putting the print routes outside the app shell.
 */
export default function Loading() {
  return <PageSkeleton cards={4} columns={3} label="Loading this page" />;
}

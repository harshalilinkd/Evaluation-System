/** /people/[id]/scorecard — superseded by /scorecard?person=[id]. */

import { redirect } from "next/navigation";

/**
 * Kept as a redirect rather than deleted. It was the canonical path from P16
 * and is linked from the roster and the collision view, but two routes
 * rendering the same screen is a drift risk — and only one of them can keep
 * the sidebar's Scorecard item highlighted.
 */
export default async function Page({ params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  redirect(`/scorecard?person=${profileId}`);
}

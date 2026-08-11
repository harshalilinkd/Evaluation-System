/** One completed worker appraisal, both sides, for HR and the MD. */

import type { Metadata } from "next";

import { WorkerReviewClient } from "@/app/(app)/admin/worker-appraisals/[cycleId]/[evaluationId]/review-client";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { getWorkerReview } from "@/lib/worker/review";

export const metadata: Metadata = { title: "Worker appraisal" };

export default async function Page({
  params,
}: {
  params: Promise<{ cycleId: string; evaluationId: string }>;
}) {
  // §9: the guard is the first statement. `getWorkerReview` re-checks it,
  // because a page guard protects a page and not an action.
  const { roles } = await requireRole(["HR_ADMIN", "MD"]);

  const { cycleId, evaluationId } = await params;
  const review = await getWorkerReview(evaluationId);

  if (!review.ok) {
    return <ErrorState title="Not available" body={review.error.message} />;
  }

  return <WorkerReviewClient isMd={roles.includes("MD")} review={review.data} cycleId={cycleId} />;
}

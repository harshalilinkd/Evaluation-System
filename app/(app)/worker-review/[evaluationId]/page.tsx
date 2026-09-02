/** The supervisor's review of one production appraisal (0100). */

import type { Metadata } from "next";

import { WorkerReviewForm } from "@/app/(app)/worker-review/[evaluationId]/review-form";
import { ErrorState } from "@/components/appraise/states";
import { requireAuth } from "@/lib/auth/guards";
import { getWorkerReviewSheet } from "@/lib/worker/review-sheet";

export const metadata: Metadata = { title: "Review an appraisal" };

export default async function Page({ params }: { params: Promise<{ evaluationId: string }> }) {
  // §9: the guard is the first statement. No role check beyond signed-in —
  // `getWorkerReviewSheet` refuses anybody who is not the assigned reviewer,
  // and RLS refuses them the row underneath that.
  await requireAuth();

  const { evaluationId } = await params;
  const sheet = await getWorkerReviewSheet(evaluationId);

  if (!sheet.ok) {
    return <ErrorState title="This review is not available" body={sheet.error.message} />;
  }

  return <WorkerReviewForm sheet={sheet.data} />;
}

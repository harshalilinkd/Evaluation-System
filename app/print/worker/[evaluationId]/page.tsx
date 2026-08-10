/** /print/worker/[id] — one signature-ready worker appraisal. */

import type { Metadata } from "next";

import { PrintToolbar } from "@/app/print/print-toolbar";
import { WorkerSheet } from "@/app/print/worker-sheet";
import { requireRole } from "@/lib/auth/guards";
import { getWorkerReview } from "@/lib/worker/review";

export const metadata: Metadata = { title: "Worker appraisal" };

export default async function Page({ params }: { params: Promise<{ evaluationId: string }> }) {
  /* -- HR and the MD only, and there is no redacted edition.
        The sheet carries the salary block, which §5 confines to those two. A
        supervisor-facing version could be built by dropping it, but nobody has
        asked for one and inventing it would mean two layouts of a signed
        document that must not drift (P20-13's reasoning, arrived at from the
        other direction). -- */
  await requireRole(["HR_ADMIN", "MD"]);

  const { evaluationId } = await params;
  const review = await getWorkerReview(evaluationId);

  if (!review.ok) {
    return <p style={{ padding: "20mm" }}>{review.error.message}</p>;
  }

  return (
    <>
      <PrintToolbar label="Print this appraisal" />
      <WorkerSheet review={review.data} />
    </>
  );
}

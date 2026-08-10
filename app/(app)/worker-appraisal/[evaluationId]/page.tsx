/** The worker appraisal sheet. One route, both sides — who you are decides which. */

import type { Metadata } from "next";

import { WorkerSheetForm } from "@/app/(app)/worker-appraisal/[evaluationId]/sheet-form";
import { ErrorState } from "@/components/appraise/states";
import { requireAuth } from "@/lib/auth/guards";
import { getWorkerSheet } from "@/lib/worker/form";

export const metadata: Metadata = { title: "Worker appraisal" };

export default async function Page({ params }: { params: Promise<{ evaluationId: string }> }) {
  // §9: the guard is the first statement. No role check beyond signed-in —
  // `getWorkerSheet` decides which side the caller is on and refuses anybody
  // who is neither, and RLS refuses them the row underneath that.
  await requireAuth();

  const { evaluationId } = await params;
  const sheet = await getWorkerSheet(evaluationId);

  if (!sheet.ok) {
    return <ErrorState title="This sheet is not available" body={sheet.error.message} />;
  }

  return <WorkerSheetForm sheet={sheet.data} />;
}

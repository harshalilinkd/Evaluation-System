/** /print/summary/[cycleId] — the summary alone, landscape, for HR filing. P15 route 3. */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PrintToolbar } from "@/app/print/print-toolbar";
import { SummarySheet } from "@/app/print/summary-sheet";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { buildBatchPack } from "@/lib/print/batch";

export const metadata: Metadata = { title: "Summary" };

export default async function Page({ params }: { params: Promise<{ cycleId: string }> }) {
  await requireRole(ADMIN_ROLES);
  const { cycleId } = await params;

  // summaryOnly: the documents are the expensive half, and this route never
  // shows them.
  const pack = await buildBatchPack(cycleId, { summaryOnly: true });
  if (!pack.ok) notFound();

  return (
    // print-landscape switches the @page box; the sheet widens on screen to
    // match, so the preview is the same shape as the paper.
    <div className="print-canvas print-landscape">
      <PrintToolbar label="Print summary" />
      <SummarySheet pack={pack.data} standalone />
    </div>
  );
}

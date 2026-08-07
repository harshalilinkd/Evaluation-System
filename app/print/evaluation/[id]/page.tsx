/** /print/evaluation/[id] — one signable evaluation. P15 route 1. */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EvaluationSheet } from "@/app/print/evaluation-sheet";
import { PrintToolbar } from "@/app/print/print-toolbar";
import { requireEvaluationAccess } from "@/lib/auth/guards";
import { buildPrintDocument, type PrintAudience } from "@/lib/print/document";

export const metadata: Metadata = { title: "Evaluation" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ copy?: string }>;
}) {
  const { id } = await params;
  const { copy } = await searchParams;

  // A print route is still a data route. "view" admits the evaluatee, their
  // lead, HR and the MD — and RLS decides before that, so a record this person
  // cannot see is indistinguishable from one that does not exist.
  await requireEvaluationAccess(id, "view");

  // ?copy=employee produces the redacted copy. A parameter rather than an
  // inference from who is signed in, because HR legitimately prints one to hand
  // over — see the note in lib/print/document.ts.
  const audience: PrintAudience = copy === "employee" ? "employee" : "internal";

  const doc = await buildPrintDocument(id, audience);
  if (!doc.ok) notFound();

  return (
    <div className="print-canvas">
      <PrintToolbar />
      <EvaluationSheet doc={doc.data} />
    </div>
  );
}

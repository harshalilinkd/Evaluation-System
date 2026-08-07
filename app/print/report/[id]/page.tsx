/** /print/report/[id] — the combined report as a signable A4 document (P20). */

import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";

import { PrintToolbar } from "@/app/print/print-toolbar";
import { ReportSheet } from "@/app/print/report-sheet";
import { checkRole } from "@/lib/auth/guards";
import { buildEvaluationReport } from "@/lib/reports/build";

export const metadata: Metadata = { title: "Report" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  /* -- 403, NOT a redacted document.
        Every other print route admits the evaluatee and their lead, and hands
        out a redacted copy where §9 requires one. This one cannot: the report's
        whole content is both sides of a blind evaluation together, so there is
        no version of it that is safe for anybody but HR and the MD. A redacted
        edition would be a nearly-empty page that still confirms what it is —
        the brief asks for a refusal, and a refusal is the honest answer. -- */
  const auth = await checkRole(["HR_ADMIN", "MD"]);
  if (!auth.ok) forbidden();

  const isHr = auth.session.roles.includes("HR_ADMIN");
  const report = await buildEvaluationReport(id, isHr ? "HR_ADMIN" : "MD");
  if (!report.ok) notFound();

  /* -- The saved file name. Browsers take the document title for the PDF's
        default name, so the title IS the file name — {code}-{cycle}-{type}. -- */
  const header = report.data.header;
  const slug = [
    header.employeeCode ?? header.employeeName.replace(/\s+/g, "-"),
    header.cycleName.replace(/\s+/g, "-"),
    header.cycleType,
  ]
    .join("-")
    .replace(/[^A-Za-z0-9-]/g, "")
    .toLowerCase();

  return (
    <div className="print-canvas">
      <title>{slug}</title>
      <PrintToolbar />
      <ReportSheet report={report.data} />
    </div>
  );
}

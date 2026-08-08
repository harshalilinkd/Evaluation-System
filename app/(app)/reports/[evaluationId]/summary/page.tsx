/** /reports/[evaluationId]/summary — the executive view. HR and the MD only (§5, §9). */

import type { Metadata } from "next";

import { ExecutiveSummary } from "@/app/(app)/reports/[evaluationId]/summary/executive-client";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { getSalaryBand } from "@/lib/increment/queries";
import { buildEvaluationReport } from "@/lib/reports/build";

export const metadata: Metadata = { title: "Executive summary" };

/**
 * THE VIEW FOR A LIVE INTERVIEW.
 *
 * The detailed report at `../` is unchanged and remains the record. This is a
 * second reading of the SAME data, laid out for the ninety seconds at the start
 * of a meeting: the two scores, the gap, what the HOD said needs work, and the
 * whole salary model with a calculator — all above the fold, no scrolling.
 *
 * Nothing here is a new source of truth. Both reads are the ones the detailed
 * report already uses, so the two views cannot disagree about a number.
 */
export default async function Page({ params }: { params: Promise<{ evaluationId: string }> }) {
  const { evaluationId } = await params;

  /* -- Identical guard to the detailed report, and for the identical reason:
        this screen shows BOTH layers of a blind evaluation side by side, plus
        salary. §9 gives that to HR and the MD alone, and the guard runs before
        any markup exists so a HOD gets a not-authorised page rather than a
        redacted one. RLS refuses them the SELF layer regardless. -- */
  const session = await requireRole(["HR_ADMIN", "MD"]);
  const isHr = session.roles.includes("HR_ADMIN");

  const report = await buildEvaluationReport(evaluationId, isHr ? "HR_ADMIN" : "MD");
  if (!report.ok) {
    return <ErrorState title="Could not open this summary" body={report.error.message} />;
  }

  const data = report.data;

  /* -- Same condition as the detailed report (P20-3): the salary key EXISTS on
        the report object only when the cycle is an increment AND the caller is
        HR or the MD. If the block is not theirs to see, the query never runs —
        rather than running and being hidden, which is a filter somebody can
        forget. -- */
  const salary = data.salary ? await getSalaryBand(evaluationId) : null;

  return (
    <ExecutiveSummary
      evaluationId={evaluationId}
      report={data}
      salary={salary?.ok ? salary.data : null}
      role={isHr ? "HR_ADMIN" : "MD"}
    />
  );
}

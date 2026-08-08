/** /reports/[evaluationId] — the combined report. HR and the MD only (§5, §9). */

import type { Metadata } from "next";

import { HrRail, MdRail } from "@/app/(app)/reports/[evaluationId]/action-rail";
import {
  HeaderBand,
  LearningBand,
  MetaPanel,
  NarrativeBand,
  RatingsBand,
  ReportTopBar,
} from "@/app/(app)/reports/[evaluationId]/report-bands";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { SalaryBand } from "@/app/(app)/reports/[evaluationId]/salary-band";
import { getSalaryBand } from "@/lib/increment/queries";
import { buildEvaluationReport } from "@/lib/reports/build";

export const metadata: Metadata = { title: "Report" };

export default async function Page({ params }: { params: Promise<{ evaluationId: string }> }) {
  const { evaluationId } = await params;

  /* -- §5's blindness invariant: this is the only screen where both layers of a
        blind evaluation appear together, and §9 gives it to HR and the MD alone.
        A HOD opening it — even for their own report — is redirected here, before
        any markup exists, and gets a not-authorised page rather than a redacted
        view. RLS refuses them the SELF layer regardless. -- */
  const session = await requireRole(["HR_ADMIN", "MD"]);
  const isHr = session.roles.includes("HR_ADMIN");

  /* -- The audience decides whether the salary block EXISTS on the object. It
        is passed explicitly rather than inferred inside the builder, so the one
        place that decides is visible from here (P15-7). -- */
  const report = await buildEvaluationReport(evaluationId, isHr ? "HR_ADMIN" : "MD");
  if (!report.ok) {
    return <ErrorState title="Could not open this report" body={report.error.message} />;
  }

  const data = report.data;

  /* -- P21 replaces P20's placeholder band. Loaded only when the salary key
        EXISTS on the report — which is itself gated on the cycle being an
        increment AND the caller being HR or the MD (P20-3). One condition, in
        one place: if the block is not the caller's to see, the query never
        runs. -- */
  const salary = data.salary ? await getSalaryBand(evaluationId) : null;
  const employeeFirst = data.header.employeeName.trim().split(/\s+/)[0] ?? "the employee";

  /* -- The bands are NUMBERED, and the numbers are assigned here rather than
        inside each band. Band 6 only exists on an increment cycle, so a band
        that hard-coded its own index would be wrong the moment the one above it
        was conditional — which is exactly the case this report has. -- */
  return (
    /* -- `data-wide` raises the shell's 1180px cap to 1440 for this route only
          (see globals.css). The document shares its width with a fixed 320px
          decision rail, so at the default cap the report itself had ~830px for
          a four-column table whose two answer columns each hold a phrase — and
          every one of them wrapped. Not full bleed: this page also carries
          prose, and prose does not want 2000px (UI2-9). -- */
    <div data-wide className="space-y-0">
      {/* The way out. It was missing entirely: the only exit from a report was
          the browser's back button or the sidebar. */}
      <ReportTopBar report={data} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-8">
          {/* No heading over this one, at the owner's instruction. It is the
              identity card — the employee's name IS its title, and "1 · At a
              glance" above their name read as a label on a form rather than the
              top of a document. The numbered headings start at Ratings. */}
          <HeaderBand report={data} />

          <RatingsBand report={data} />
          <LearningBand report={data} />

          <NarrativeBand
            index={3}
            title={`${employeeFirst}'s own words`}
            hint="Achievements, difficulties, ideas and the support they asked for. Shown in full."
            blocks={data.narratives.employeeVoice}
            tone="self"
          />

          <NarrativeBand
            index={4}
            title="The lead's assessment"
            hint="Strengths, improvement, training, responsibility, promotion, concerns and final remarks."
            blocks={data.narratives.leadAssessment}
            tone="lead"
          />

          {salary?.ok ? (
            <SalaryBand
              data={salary.data}
              evaluationId={evaluationId}
              status={data.header.status}
              isHr={isHr}
            />
          ) : null}
        </div>

        {/* The rail follows the reader down a five-band document; a decision
            panel that scrolls off at band 2 is one somebody has to hunt for. */}
        <div className="space-y-4 lg:sticky lg:top-16 lg:self-start">
          {isHr ? <HrRail report={data} /> : <MdRail report={data} />}
          <MetaPanel report={data} />
        </div>
      </div>
    </div>
  );
}

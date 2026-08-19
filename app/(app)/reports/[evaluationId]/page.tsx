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

          {/* -- STILL OPEN: say which side is outstanding.
                HR reaches this report as soon as ONE side is in, so a record
                arriving here half-finished is now ordinary rather than an
                error. Without this the missing column reads as somebody who
                rated nothing — which is a different and untrue claim, and the
                one §11 keeps insisting on (missing is not zero).

                It also states that the record is not reviewable yet, because
                the rail's Send button is absent at OPEN and a control that is
                simply not there explains nothing (§13.4).

                No §5 problem in naming the side: this page is HR and the MD
                only, and P20-13 answers 403 to everybody else. -- */}
          {data.header.status === "OPEN" ? (
            <p className="rounded-card border border-warning/40 bg-warning-tint px-4 py-3 font-sans text-body-sm text-ink">
              <span className="font-medium">This is still being filled in.</span>{" "}
              {data.meta.selfSubmittedAt && !data.meta.leadSubmittedAt
                ? `${data.header.employeeName} has submitted; their manager has not yet.`
                : !data.meta.selfSubmittedAt && data.meta.leadSubmittedAt
                  ? `Their manager has submitted; ${data.header.employeeName} has not yet.`
                  : "One side is still outstanding."}{" "}
              You can read what is here now. It becomes reviewable once both sides are in.
            </p>
          ) : null}

          {/* -- THE NUMBERS ARE COUNTED, NOT WRITTEN DOWN.
                They were hard-coded, and had drifted: Ratings was 1, the
                comparison band and the employee's words were BOTH 3, there was
                no 2, and salary was 5. A reader who says "look at three" then
                has to ask which three, and a missing number reads as a missing
                section on a document that gets signed.

                Counting also survives a band being absent — the comparison band
                renders nothing when no topic is in the snapshot, and everything
                after it now closes up instead of leaving a hole. -- */}
          <RatingsBand report={data} index={1} />
          {data.narratives.paired.length > 0 ? (
            <LearningBand report={data} index={2} />
          ) : null}

          <NarrativeBand
            index={data.narratives.paired.length > 0 ? 3 : 2}
            title={`${employeeFirst}'s own words`}
            hint="Every free-text answer they gave, in the order the questions were asked."
            blocks={data.narratives.employeeVoice}
            tone="self"
          />

          <NarrativeBand
            index={data.narratives.paired.length > 0 ? 4 : 3}
            title={
              data.header.coLeadName
                ? `${data.header.leadName ?? "The manager"}'s assessment`
                : "The lead's assessment"
            }
            hint="Every question the manager answered, in the order they were asked. Ratings are in section 1 with their scores."
            blocks={data.narratives.leadAssessment}
            tone="lead"
          />

          {/* -- A BAND OF THEIR OWN, where there is a second manager (0083).
                 Merging the two would present one verdict where there are two,
                 and leave the reader unable to tell who wrote which — on a
                 report whose whole purpose is that the two rated blind to each
                 other. Named, because that is what tells them apart (§13.8:
                 never colour alone, and both managers share the manager hue). -- */}
          {data.header.coLeadName && data.narratives.coLeadAssessment.length > 0 ? (
            <NarrativeBand
              index={data.narratives.paired.length > 0 ? 5 : 4}
              title={`${data.header.coLeadName}'s assessment`}
              hint="The same questions, answered independently by their second reviewer."
              blocks={data.narratives.coLeadAssessment}
              tone="lead"
            />
          ) : null}

          {salary?.ok ? (
            <SalaryBand
              data={salary.data}
              evaluationId={evaluationId}
              status={data.header.status}
              isHr={isHr}
              index={data.narratives.paired.length > 0 ? 5 : 4}
              selfOverall={data.summary.selfOverall}
              leadOverall={data.summary.leadOverall}
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

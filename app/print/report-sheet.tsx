/**
 * The combined report as a signable A4 document (P20).
 *
 * A SERVER component. Nothing here is interactive, and that is what makes a
 * whole-cycle pack possible: the browser receives finished HTML with no
 * hydration work proportional to the size of the document (P15-4).
 */

import { SCALE_0_5_LABELS } from "@/components/appraise/tier";
import type { EvaluationReport } from "@/lib/reports/types";
import { formatDate, formatDateTime } from "@/lib/utils/date";

function score(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function gapText(value: number | null): string {
  if (value === null) return "—";
  return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

/**
 * The mean of the two sides.
 *
 * ADDED AT THE OWNER'S EXPLICIT INSTRUCTION, and it is a deliberate amendment to
 * §11 rather than an oversight — that section said "there is no final score
 * column", on the reasoning that averaging a self-rating with a manager's
 * produces a number describing neither. The concern was put to the owner with
 * that reasoning and they chose the column. Recorded in §18.
 *
 * BOTH OR NOTHING. Where either side is absent this is an em dash, never the one
 * figure that exists — Manager Review has no self column at all, and printing
 * the manager's 3.00 there as an "average" would state that both sides agreed on
 * a section only one of them answered. §11's own rule that missing is not zero,
 * applied to a column §11 did not want.
 */
function average(self: number | null, lead: number | null): string {
  if (self === null || lead === null) return "—";
  return ((self + lead) / 2).toFixed(2);
}

function firstName(full: string | null): string {
  return (full ?? "").trim().split(/\s+/)[0] || "they";
}

export function ReportSheet({ report }: { report: EvaluationReport }) {
  const { header, summary, narratives, meta, review } = report;
  const employee = firstName(header.employeeName);
  const lead = firstName(header.leadName);

  return (
    <article className="print-sheet">
      {/* ---------- Masthead ---------- */}
      {/* -- CENTRED AND STACKED, at the owner's instruction.

            It was three columns — mark on the left, title in the middle, cycle
            on the right — which made the title compete with a block of small
            print for the top of the page and left the mark reading as a corner
            logo rather than as a letterhead. The cycle moves down into the
            employee details, where it is one fact among several rather than a
            second heading.

            Empty alt on the mark: a broken decorative image renders as nothing,
            so a missing file leaves the caption standing rather than putting a
            broken glyph on a signed document. -- */}
      <header className="print-header print-header-stacked">
        {/* eslint-disable-next-line @next/next/no-img-element -- rendered to paper; the optimiser has no part to play. */}
        <img src="/logo.png" alt="" className="print-logo" />
        <h1 className="print-title">Performance Evaluation Report</h1>
        <span className="print-brand-sub">Performance Evaluation</span>
      </header>

      {/* ---------- Band 1 ---------- */}
      <section className="print-block">
        <h2>Employee</h2>
        <dl className="print-meta">
          <div><dt>Name</dt><dd>{header.employeeName}</dd></div>
          <div><dt>Employee code</dt><dd>{header.employeeCode ?? "—"}</dd></div>
          <div><dt>Department</dt><dd>{header.department ?? "—"}</dd></div>
          <div><dt>Designation</dt><dd>{header.designation ?? "—"}</dd></div>
          <div>
            <dt>Date of joining</dt>
            <dd>{header.dateOfJoining ? formatDate(header.dateOfJoining) : "—"}</dd>
          </div>
          <div><dt>Rated by</dt><dd>{header.leadName ?? "—"}</dd></div>
          {/* -- THE CYCLE, as a third row rather than a corner block.
                Three fields, so the grid stays a clean multiple of its three
                columns — seven or eight would leave a ragged last row, and the
                rule that hides the trailing border keys on the last three
                children. Split into cycle, period and type because they are
                three separate facts that were being run together with a
                middle dot. -- */}
          <div><dt>Cycle</dt><dd>{header.cycleName || "—"}</dd></div>
          <div><dt>Period</dt><dd>{header.period || "—"}</dd></div>
          <div><dt>Cycle type</dt><dd>{header.cycleType ? `${header.cycleType}` : "—"}</dd></div>
        </dl>

        <table className="print-table">
          <thead>
            <tr>
              <th>Section</th>
              <th>Self</th>
              <th>Manager</th>
              <th>Average</th>
              <th>Gap</th>
            </tr>
          </thead>
          <tbody>
            {summary.sections.map((s) => (
              <tr key={s.section}>
                <td>{s.label}</td>
                <td className="print-num">{score(s.self)}</td>
                <td className="print-num">{score(s.lead)}</td>
                <td className="print-num">{average(s.self, s.lead)}</td>
                <td className="print-num">{gapText(s.gap)}</td>
              </tr>
            ))}
            <tr className="print-total">
              <td>Overall</td>
              <td className="print-num">{score(summary.selfOverall)}</td>
              <td className="print-num">{score(summary.leadOverall)}</td>
              <td className="print-num">{average(summary.selfOverall, summary.leadOverall)}</td>
              <td className="print-num">{gapText(summary.overallGap)}</td>
            </tr>
          </tbody>
        </table>
        <p>
          Gap is the lead&rsquo;s average minus the employee&rsquo;s.{" "}
          {summary.flaggedCount > 0
            ? `${summary.flaggedCount} question${summary.flaggedCount === 1 ? " differs" : "s differ"} by ${summary.flagThreshold} or more.`
            : "No question differs by the flagging threshold."}{" "}
          This figure is for HR and management only.
        </p>
      </section>

      {/* ---------- The grading scale ----------
          Printed on the document because somebody who has never used the
          application has to be able to read this sheet (P15-9). The wording is
          §6's, taken from the constant rather than retyped. */}
      <section className="print-block">
        <h2>The rating scale</h2>
        <table className="print-table">
          <tbody>
            {SCALE_0_5_LABELS.map((label) => (
              <tr key={label.value}>
                <td className="print-num">{label.value}</td>
                <td>{label.full}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ---------- Band 2 ---------- */}
      {report.sections.map((section) => (
        <section key={section.section} className="print-section print-block">
          <h2>{section.label}</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th>Question</th>
                <th>Self</th>
                <th>Manager</th>
                <th>Gap</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row) => (
                <tr key={row.questionId}>
                  <td>
                    {row.flag !== "none" ? "▲ " : ""}
                    {row.text}
                    {row.leadComment ? (
                      <>
                        <br />
                        <em>{row.leadComment}</em>
                      </>
                    ) : null}
                  </td>
                  <td>{row.selfAnswer ?? "—"}</td>
                  <td>{row.leadAnswer ?? "—"}</td>
                  <td className="print-num">{gapText(row.gap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {/* ---------- Band 3 ---------- */}
      {narratives.paired.length > 0 ? (
        <section className="print-section print-block">
          <h2>Learning and improvement</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th>Topic</th>
                <th>What {employee} said</th>
                <th>What {lead} said</th>
              </tr>
            </thead>
            <tbody>
              {narratives.paired.map((pair) => (
                <tr key={pair.topic}>
                  <td>{pair.topic}</td>
                  <td>{pair.selfAnswer ?? "—"}</td>
                  <td>{pair.leadAnswer ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {/* ---------- Band 4 ---------- */}
      {narratives.employeeVoice.length > 0 ? (
        <section className="print-section print-block">
          <h2>{header.employeeName}&rsquo;s own words</h2>
          {narratives.employeeVoice.map((block) => (
            <div key={block.question} className="print-narrative">
              <h3>{block.question}</h3>
              <p>{block.answer ?? "—"}</p>
            </div>
          ))}
        </section>
      ) : null}

      {/* ---------- Band 5 ---------- */}
      {narratives.leadAssessment.length > 0 ? (
        <section className="print-section print-block">
          <h2>The lead&rsquo;s assessment</h2>
          {narratives.leadAssessment.map((block) => (
            <div key={block.question} className="print-narrative">
              <h3>{block.question}</h3>
              <p>{block.answer ?? "—"}</p>
            </div>
          ))}
        </section>
      ) : null}

      {/* ---------- Band 6 ----------
          Rendered only when the key EXISTS. The route returns 403 for anybody
          who is not HR or the MD, so this is never a redaction — the block is
          either the caller's to see or the document was never produced. */}
      {report.salary ? (
        <section className="print-section print-block">
          <h2>Salary</h2>
          <p>Salary review is added in the increment step.</p>
        </section>
      ) : null}

      {/* ---------- Review ---------- */}
      <section className="print-section print-block">
        <h2>Review</h2>
        <div className="print-narrative">
          <h3>HR summary</h3>
          <p>{review.hrSummary ?? "—"}</p>
        </div>
        <div className="print-narrative">
          <h3>HR recommendation</h3>
          <p>{review.hrRecommendation ? review.hrRecommendation.replace(/_/g, " ") : "—"}</p>
        </div>
        <div className="print-narrative">
          <h3>Management remarks</h3>
          <p>{review.mdRemarks ?? "—"}</p>
        </div>
      </section>

      {/* ---------- Meta ---------- */}
      <section className="print-block">
        <h2>Record</h2>
        <dl className="print-meta">
          <div>
            <dt>Self submitted</dt>
            <dd>
              {meta.selfSkipped
                ? "Skipped"
                : meta.selfSubmittedAt
                  ? formatDateTime(meta.selfSubmittedAt)
                  : "—"}
            </dd>
          </div>
          <div>
            <dt>Manager submitted</dt>
            <dd>
              {meta.leadSkipped
                ? "Skipped"
                : meta.leadSubmittedAt
                  ? formatDateTime(meta.leadSubmittedAt)
                  : "—"}
            </dd>
          </div>
          <div>
            <dt>Returned</dt>
            <dd>{meta.returns.length === 0 ? "Never" : `${meta.returns.length} time(s)`}</dd>
          </div>
        </dl>
      </section>

      {/* ---------- Signatures ----------

          THE ATTESTATION WAS ALREADY HERE AND WAS BEING THROWN AWAY.

          `md_reviewed_by`, `md_reviewed_at` and `md_outcome` are written when
          the MD approves, and 0029's column-level trigger means HR physically
          cannot write the MD's half of that row — it is not a claim the sheet
          is making, it is a record the database enforced. It was computed in
          `build.ts`, typed on `ReportReview`, passed into this component, and
          then this section rendered three blank ruled lines over the top of it.

          So a signed record was being printed as though nobody had signed it,
          and somebody was expected to sign it again by hand.

          Where the review exists, the line is replaced by the name, the date
          and the outcome. Where it does not, the rule stays and the sheet is
          signed on paper as before — the same document either way, which is
          what keeps a half-finished record from looking finished. */}
      <section className="print-signatures print-block">
        {/* Markup matched to print.css, which already defines `.rule`, `.who`,
            `.name` and `.date` — the last two existed for exactly this and had
            never been used here. The old block emitted a bare <span> and <p>,
            so none of that CSS applied and the "signature line" was not even
            drawing a line. */}
        {[
          {
            who: "Manager",
            /* -- NAMED, AND DATED FROM WHAT THEY ACTUALLY DID.

                  The date was blank, and the reason was real: nothing in the
                  system records a manager SIGNING this report. HR reviews it and
                  the MD approves it; the manager's act is submitting their
                  ratings, and there was no field for that here.

                  So the date is the one they earned — `leadSubmittedAt`, the
                  moment they submitted — and the verb says which act it was.
                  "Rated" rather than "Reviewed" or "Approved" is the whole
                  distinction: it states what this person did without borrowing
                  the meaning of what the two beside them did.

                  The RULE above stays empty either way. A wet signature is still
                  wanted on a printed sheet, and a recorded submission is not
                  one — P34-11 holds: signed where the database says so, ruled
                  where it does not. -- */
            name: header.leadName ?? null,
            when: meta.leadSubmittedAt,
            verb: "Rated",
            mark: null as string | null,
          },
          {
            who: "HR",
            name: review?.hrReviewedByName ?? null,
            when: review?.hrReviewedAt ?? null,
            verb: "Reviewed",
            mark: review?.hrSignature ?? null,
          },
          {
            who: "Managing Director",
            name: review?.mdReviewedByName ?? null,
            when: review?.mdReviewedAt ?? null,
            // The outcome, not just the name: "reviewed" and "approved" are
            // different acts and a signed sheet must not blur them.
            verb: review?.mdOutcome === "APPROVED" ? "Approved" : "Reviewed",
            mark: review?.mdSignature ?? null,
          },
        ].map((cell) => (
          <div key={cell.who} className="print-signature">
            {/* -- THE MARK SITS ON THE RULE, not instead of it.
                  A signature floating with no line under it reads as a graphic
                  somebody dropped in; on the line it reads as signed. Where
                  there is no image the rule is empty and the sheet is signed by
                  hand exactly as before — the same document either way, so an
                  unsigned record cannot be made to look signed by printing it.

                  A data URI, so the page needs no network at print time: a
                  printed sheet lays out before any fetch would return, and the
                  batch pack renders up to 47 of these server-side. -- */}
            <div className="rule">
              {cell.mark && cell.name ? (
                // eslint-disable-next-line @next/next/no-img-element -- inline
                // data; the optimiser has nothing to fetch.
                <img src={cell.mark} alt="" className="mark" />
              ) : null}
            </div>
            <p className="who">{cell.who}</p>
            {/* Signed where the database says so, ruled where it does not — the
                same document either way, so a half-finished record cannot be
                made to look finished by printing it. */}
            <p className="name">{cell.name ?? " "}</p>
            <p className="date">
              {cell.name && cell.when
                ? `${cell.verb} ${formatDate(cell.when)}`
                : "Date: ____________"}
            </p>
          </div>
        ))}
      </section>
    </article>
  );
}

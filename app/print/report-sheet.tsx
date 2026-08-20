/**
 * The combined report as a signable A4 document (P20).
 *
 * A SERVER component. Nothing here is interactive, and that is what makes a
 * whole-cycle pack possible: the browser receives finished HTML with no
 * hydration work proportional to the size of the document (P15-4).
 */

import { SCALE_0_5_LABELS } from "@/components/appraise/tier";
import type { EvaluationReport } from "@/lib/reports/types";
import { coLeadRole, LEAD_ROLE, possessive } from "@/lib/reports/reviewer";
import { formatDate } from "@/lib/utils/date";

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

/**
 * What the managers TOGETHER say, where a person has two (0083).
 *
 * The Average column then averages this against Self, so AMEND-5's definition
 * is untouched — it is still the mean of the Self and Manager figures. What a
 * second reviewer changes is what the manager figure IS, and it is the same
 * rule the owner set for the hike percentage, so the printed sheet and the
 * salary card cannot say different things about one person.
 *
 * With one manager it returns their figure, which is what keeps every sheet
 * printed to date identical.
 */
function managerMean(lead: number | null, coLead: number | null): number | null {
  if (lead === null) return coLead;
  if (coLead === null) return lead;
  return (lead + coLead) / 2;
}

function firstName(full: string | null): string {
  return (full ?? "").trim().split(/\s+/)[0] || "they";
}

export function ReportSheet({ report }: { report: EvaluationReport }) {
  const { header, summary, narratives, meta, review } = report;

  // No second manager, no third column — every sheet printed to date is
  // byte-identical.
  /* -- ROLES, NOT NAMES, at the owner's instruction: "instead of their names
        manager and design coordinator means their designation should mention
        everywhere". Read from the one shared module so this sheet and the
        screen cannot say different things about the same person. -- */
  const secondManager = header.coLeadName
    ? coLeadRole(header.coLeadDesignation, header.coLeadName)
    : null;
  const employee = firstName(header.employeeName);


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

            THE "PERFORMANCE EVALUATION" CAPTION IS GONE, at the owner's
            instruction — it sat directly under "Performance Evaluation Report"
            and said the same thing twice. P27's addendum had added it when the
            wordmark was removed; with a centred mark over a centred title there
            is nothing left for it to caption.

            Worth stating because it removes a fallback: `alt` is empty so a
            broken image renders as NOTHING rather than a broken glyph on a
            signed document (P27), and the caption used to be what still named
            the company if `public/logo.png` were missing. Nothing does now, so
            that file is load-bearing. -- */}
      <header className="print-header print-header-stacked">
        {/* eslint-disable-next-line @next/next/no-img-element -- rendered to paper; the optimiser has no part to play. */}
        <img src="/logo.png" alt="" className="print-logo" />
        <h1 className="print-title">Performance Evaluation Report</h1>
      </header>

      {/* ---------- Band 1 ---------- */}
      {/* -- "EMPLOYEE & CYCLE", at the owner's instruction after asking whether
            "Employee details" still fitted.

            It did not, and the reason is worth keeping: FIX-37 moved the cycle,
            period and type into this block, so a heading naming only the
            employee would sit over three rows it does not describe. That is the
            same class of small untruth as a column labelled with the wrong unit
            — cheap to fix now, and the sort of thing nobody questions once it
            has been printed a hundred times. -- */}
      <section className="print-block">
        <h2>Employee &amp; cycle</h2>
        <dl className="print-meta">
          <div><dt>Name</dt><dd>{header.employeeName}</dd></div>
          <div><dt>Employee code</dt><dd>{header.employeeCode ?? "—"}</dd></div>
          <div><dt>Department</dt><dd>{header.department ?? "—"}</dd></div>
          <div><dt>Designation</dt><dd>{header.designation ?? "—"}</dd></div>
          <div>
            <dt>Date of joining</dt>
            <dd>{header.dateOfJoining ? formatDate(header.dateOfJoining) : "—"}</dd>
          </div>
          <div>
            <dt>Manager</dt>
            {/* -- The ROLE is the label and the NAME is the value, which is the
                   right way round for an identity block: this row exists to say
                   who signed, and the column heading in the table below is
                   where the role belongs.

                   `leadDesignation` is deliberately not printed. It is a
                   free-text profile field holding whatever was typed there, and
                   on the report that prompted this it held "HR-Admin" — an
                   access level rather than a job. -- */}
            <dd>{header.leadName ?? "—"}</dd>
          </div>
          {/* -- A second reviewer is a fact about who rated this person, so it
                belongs in the identity block and not only in a column heading.
                Rendered only where there is one: the grid is three columns and
                the rule that hides the trailing border keys on the last three
                children, so an always-present empty row would put two rules
                across the foot of the block (FIX-34). -- */}
          {header.coLeadName ? (
            <div>
              <dt>{secondManager}</dt>
              <dd>{header.coLeadName}</dd>
            </div>
          ) : null}
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

        {/* -- THE ONE BLOCK ON THE SHEET WITH NO HEADING, until now.
              Every other band carries one — Employee & cycle, The rating scale,
              What they said, Record. This table is the most important thing on
              the page and it simply appeared under the identity grid, which is
              most of what read as unstructured: the eye had nothing to tell it
              a new subject had started. -- */}
        <h2 className="print-subhead">Scores by section</h2>
        <table className="print-table">
          <thead>
            <tr>
              <th>Section</th>
              <th className="print-num">Self</th>
              <th className="print-num">{LEAD_ROLE}</th>
              {secondManager ? <th className="print-num">{secondManager}</th> : null}
              <th className="print-num">Average</th>
              <th className="print-num">Gap</th>
            </tr>
          </thead>
          <tbody>
            {summary.sections.map((s) => (
              <tr key={s.section}>
                <td>{s.label}</td>
                <td className="print-num">{score(s.self)}</td>
                <td className="print-num">{score(s.lead)}</td>
                {secondManager ? <td className="print-num">{score(s.coLead)}</td> : null}
                <td className="print-num">{average(s.self, managerMean(s.lead, s.coLead))}</td>
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
                <th>{LEAD_ROLE}</th>
                {secondManager ? <th>{secondManager}</th> : null}
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
                  {/* -- THE NUMERAL, because the scale is printed in full
                         directly above this table. At the owner's instruction:
                         "we have mentioned rating scale at top then why me
                         mention in each que field ... please show only no".

                         §6's wording is untouched — §17 forbids paraphrasing it
                         and nothing here does. It is stated once, where a
                         reader meets it, instead of three times per row. That
                         also lets the three answer columns hold a numeral
                         instead of 284px of text, which is what made every row
                         wrap.

                         A non-scale answer — Yes/No, a date, a chosen option —
                         still prints as itself: `selfScale` is null for those
                         and the band holds more than ratings. -- */}
                  <td className="print-num">{row.selfScale ?? row.selfAnswer ?? "—"}</td>
                  <td className="print-num">{row.leadScale ?? row.leadAnswer ?? "—"}</td>
                  {secondManager ? (
                    <td className="print-num">{row.coLeadScale ?? row.coLeadAnswer ?? "—"}</td>
                  ) : null}
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
                <th>What {LEAD_ROLE} said</th>
                {secondManager ? <th>What {secondManager} said</th> : null}
              </tr>
            </thead>
            <tbody>
              {narratives.paired.map((pair) => (
                <tr key={pair.topic}>
                  <td>{pair.topic}</td>
                  <td>{pair.selfAnswer ?? "—"}</td>
                  <td>{pair.leadAnswer ?? "—"}</td>
                  {secondManager ? <td>{pair.coLeadAnswer ?? "—"}</td> : null}
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
          <h2>{possessive(LEAD_ROLE)} assessment</h2>
          {narratives.leadAssessment.map((block) => (
            <div key={block.question} className="print-narrative">
              <h3>{block.question}</h3>
              <p>{block.answer ?? "—"}</p>
            </div>
          ))}
        </section>
      ) : null}

      {/* -- The SECOND manager's own written verdict, as its own signed-off
             section. Merged with the one above it would present one assessment
             where there are two, on the document a pay decision is signed
             from — and the two were written blind to each other, which is the
             reason both were collected. -- */}
      {secondManager && narratives.coLeadAssessment.length > 0 ? (
        <section className="print-section print-block">
          <h2>{possessive(secondManager ?? "")} assessment</h2>
          {narratives.coLeadAssessment.map((block) => (
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

      {/* -- THE RECORD BLOCK IS GONE, at the owner's instruction: "remove
            record fields from report". It printed when each side submitted and
            how many times the form had been sent back — process, not appraisal,
            and on a signed sheet it read as filler beside the sections that
            carry the decision.

            NOTHING WAS LOST. Every one of those facts is on `/reports` for
            anybody who needs it, and the timestamps live in `audit_log`, which
            is append-only for every caller (§12). This removes them from a
            document, never from the record. -- */}
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
          {
            /* -- THE COMPANY STAMP, asked for as a fourth field in the row.

                  It carries no name, no date and no mark, and that is not an
                  omission — a stamp is applied to the paper after it is printed.
                  The other three cells state what the DATABASE recorded; this
                  one states where something goes. Giving it a name or a date
                  would claim the system had witnessed a stamp it cannot see.

                  The rule is drawn the same as the others so the row reads as
                  one band, and the four cells sit on the same baseline. -- */
            who: "Company stamp",
            name: null,
            when: null,
            verb: null as string | null,
            mark: null as string | null,
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
            {/* -- The stamp cell takes no date line. Everywhere else the blank
                  reads "Date: ____________" because somebody signs and dates by
                  hand; a stamp carries its own date or none, and printing a date
                  rule under it asks for something nobody fills in. -- */}
            <p className="date">
              {cell.verb === null
                ? " "
                : cell.name && cell.when
                  ? `${cell.verb} ${formatDate(cell.when)}`
                  : "Date: ____________"}
            </p>
          </div>
        ))}
      </section>
    </article>
  );
}

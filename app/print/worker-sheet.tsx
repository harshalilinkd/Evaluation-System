/** The worker appraisal, laid out as the paper form it replaces. Server component. */

import type { WorkerReview } from "@/lib/worker/review";
import { formatDate, formatInr } from "@/lib/utils/date";

/*
 * A SERVER COMPONENT, like every other print sheet (P15-4). A pack of forty
 * receives finished HTML with no hydration work proportional to its size.
 *
 * The layout follows the paper form ROW FOR ROW, deliberately: the same eight
 * qualities in the same order, three tick columns, then the overall, the
 * comment, the salary line and three signatures. Somebody who has filled the
 * paper version for years should be able to read this without being taught it.
 *
 * NO TIER COLOURS (P15-10). Who said what is carried by the column headings —
 * position and text, which survive a monochrome laser. A tint would say the
 * same thing in a way that vanishes on the printer this will actually meet.
 */

const TICKS = ["EXCELLENT", "SATISFACTORY", "NEEDS_IMPROVEMENT"] as const;
const TICK_HEAD: Record<string, string> = {
  EXCELLENT: "Excellent",
  SATISFACTORY: "Satisfactory",
  NEEDS_IMPROVEMENT: "Needs Improvement",
};

export function WorkerSheet({ review, index }: { review: WorkerReview; index?: number }) {
  return (
    <section
      className={index !== undefined && index > 0 ? "print-sheet print-page-break" : "print-sheet"}
    >
      {/* -- CENTRED, at the owner's instruction, and the same treatment the
            report sheet already had (FIX-37). Three columns — mark left, round
            right — made the mark read as a corner logo rather than a
            letterhead. The round moves down into the metadata, where it is one
            fact among several. -- */}
      <header className="print-header print-header-stacked">
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size mark at the top of a page bound for paper; next/image would defer the one element that should paint first. */}
        <img src="/logo.png" alt="" className="print-logo" />
        <h1 className="print-title">Worker Performance Appraisal</h1>
      </header>

      {/* -- The metadata band, in the paper form's own order. -- */}
      <table className="print-meta">
        <tbody>
          <tr>
            <th scope="row">Worker Name</th>
            <td>{review.workerName}</td>
            <th scope="row">Appraisal Period</th>
            <td>{review.periodLabel || "—"}</td>
          </tr>
          <tr>
            <th scope="row">Department</th>
            <td>{review.department ?? "—"}</td>
            <th scope="row">Designation</th>
            <td>{review.designation ?? "—"}</td>
          </tr>
          <tr>
            <th scope="row">Supervisor Name</th>
            <td>{review.supervisorName ?? "—"}</td>
            {/* The round, moved out of the corner. Three rows of two now, so
                every label starts at the same x and every value beside it. */}
            <th scope="row">Round</th>
            <td>{review.cycleName || "—"}</td>
          </tr>
        </tbody>
      </table>

      {/* -- Performance Check. Three columns with a mark in one, exactly as the
            paper sheet is filled in by hand. A single "Excellent" cell would
            read faster on screen and would stop matching the form somebody is
            comparing it against. -- */}
      <div className="print-block">
        <h2 className="print-block-title">Performance Check</h2>
        <table className="print-ratings">
          <thead>
            <tr>
              <th scope="col" style={{ width: "8%" }}>
                Sr.
              </th>
              <th scope="col">Qualities</th>
              {TICKS.map((t) => (
                <th key={t} scope="col" style={{ width: "16%" }}>
                  {TICK_HEAD[t]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {review.rows.map((row, i) => (
              <tr key={row.questionId}>
                <td className="print-num">{i + 1}.</td>
                <td>{row.text}</td>
                {TICKS.map((t) => (
                  <td key={t} className="print-tick">
                    {row.supervisor === t ? "✓" : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* -- ONE LABEL COLUMN, so these three read as one block.

            They were three separate paragraphs of inline runs, each starting
            wherever its own text began: "Overall Performance" at the margin,
            "Salary:" at the margin, "Training Required:" twelve millimetres
            into a line, and the three figures wherever the words before them
            ended. Nothing lined up with anything, which is most of what read as
            unprofessional.

            A 34mm label column fixes every row to the same edge. The paper
            form's wording is untouched (§17) — only where it sits. -- */}
      <div className="print-block print-fields">
        {/* The overall, repeated beneath the table exactly as the paper form
            repeats it. Dropping a line from a form people know is how they stop
            trusting the printed version. */}
        <div className="print-field">
          <span className="print-field-label">Overall Performance</span>
          <span className="print-field-body">
            {TICKS.map((t) => (
              <span key={t} className="print-inline-tick">
                {TICK_HEAD[t]}{" "}
                <span className="print-box">{review.overallTick === t ? "✓" : ""}</span>
              </span>
            ))}
          </span>
        </div>

        <div className="print-field">
          <span className="print-field-label">Salary</span>
          <span className="print-field-body">
            <span className="print-inline-tick">
              Same{" "}
              <span className="print-box">
                {review.salary?.salaryChanged === false ? "✓" : ""}
              </span>
            </span>
            <span className="print-inline-tick">
              New <span className="print-box">{review.salary?.salaryChanged ? "✓" : ""}</span>
            </span>
          </span>
        </div>

        <div className="print-field">
          <span className="print-field-label">Training Required</span>
          <span className="print-field-body">
            <span className="print-inline-tick">
              Yes{" "}
              <span className="print-box">{review.trainingRequired === true ? "✓" : ""}</span>
            </span>
            <span className="print-inline-tick">
              No <span className="print-box">{review.trainingRequired === false ? "✓" : ""}</span>
            </span>
          </span>
        </div>
      </div>

      {/* -- THE THREE FIGURES, AS A ROW OF THREE.
            They were an inline run — label, rule, label, rule — so each figure
            landed wherever the words before it ended and the three rules were
            different lengths. Equal columns, the caption above and the figure on
            its own rule beneath: the shape a form actually uses. -- */}
      <div className="print-block print-salary-row">
        <div className="print-salary-cell">
          <span className="print-salary-label">Old Salary</span>
          <span className="print-salary-value">{formatInr(review.salary?.oldCtc ?? null)}</span>
        </div>
        <div className="print-salary-cell">
          <span className="print-salary-label">Salary Increment %</span>
          <span className="print-salary-value">
            {review.salary?.incrementPct === null || review.salary?.incrementPct === undefined
              ? "—"
              : `${review.salary.incrementPct}%`}
          </span>
        </div>
        <div className="print-salary-cell">
          <span className="print-salary-label">New Salary</span>
          <span className="print-salary-value">{formatInr(review.salary?.newCtc ?? null)}</span>
        </div>
      </div>

      {/* The comment last of the three, because it is the only one that needs
          room rather than a line. */}
      <div className="print-block">
        <p className="print-comment-label">Supervisor Comment</p>
        <p className="print-comment">{review.supervisorComment || " "}</p>
      </div>

      {/* -- Three signatures and the stamp, as printed. The form exists to be
            signed; §13.7 makes the pack a first-class output and this block is
            the reason. -- */}
      {/* -- FOUR CELLS OF EQUAL WIDTH, each with a rule above its label.

            None of `.print-sig`, `.print-sig-line` or `.print-sig-label` had a
            rule in print.css, so this block rendered as four bare words in a row
            with no lines at all — `<span>` is inline, so the "signature line"
            drew nothing whatever. The rules are added there; the markup below
            gains only the names and the MD's mark.

            THE MD'S SIGNATURE APPEARS ONLY WHEN THEY HAVE APPROVED. `mdApproval`
            is null until the appraisal is CLOSED with an MD review recorded
            against it, so a sheet printed mid-flow shows a ruled line exactly as
            before. The same document either way — an unfinished record cannot be
            made to look finished by printing it (P34-11). -- */}
      <div className="print-block print-signatures">
        <div className="print-sig">
          <span className="print-sig-line" />
          <span className="print-sig-label">Supervisor Signature</span>
          <span className="print-sig-name">{review.supervisorName ?? " "}</span>
          <span className="print-sig-when">Date: ____________</span>
        </div>
        <div className="print-sig">
          <span className="print-sig-line" />
          <span className="print-sig-label">HR Signature</span>
          <span className="print-sig-name">&nbsp;</span>
          <span className="print-sig-when">Date: ____________</span>
        </div>
        <div className="print-sig">
          <span className="print-sig-line">
            {review.mdApproval?.signature ? (
              // A data URI, so the page needs no network at print time — and
              // this renders to paper, where the optimiser has no part to play.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={review.mdApproval.signature} alt="" className="mark" />
            ) : null}
          </span>
          <span className="print-sig-label">MD Signature</span>
          <span className="print-sig-name">{review.mdApproval?.name ?? " "}</span>
          <span className="print-sig-when">
            {review.mdApproval
              ? `Approved ${formatDate(review.mdApproval.at)}`
              : "Date: ____________"}
          </span>
        </div>
        {/* -- WIDER, AND THE DASHED BOX IS GONE at the owner's instruction.

              It was a bordered area on the reasoning that a stamp is round and
              about 40mm across, so a quarter of the row with a rule to sit "on"
              is not how anybody stamps a document. The width stays for that
              reason; the border does not — a dashed rectangle in a row of four
              hairlines is the one element that does not belong to the set, and
              it read as a placeholder rather than as part of the document.

              Still no name and no date line: a stamp is applied to the paper
              after this is printed, so the system has nothing to record. -- */}
        <div className="print-sig print-sig--stamp">
          <span className="print-sig-line" />
          <span className="print-sig-label">Company Stamp</span>
        </div>
      </div>

    </section>
  );
}

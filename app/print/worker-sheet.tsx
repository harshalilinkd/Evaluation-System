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
      <header className="print-header">
        <div className="print-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size mark at the top of a page bound for paper; next/image would defer the one element that should paint first. */}
          <img src="/logo.png" alt="" className="print-logo" />
        </div>
        <span className="print-period">
          {review.cycleName} · {review.periodLabel}
        </span>
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
            <td colSpan={3}>{review.supervisorName ?? "—"}</td>
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

      {/* -- The paper form repeats the overall beneath the table. Kept, because
            it is what a reader signs against and because dropping a line from a
            form people know is how they stop trusting the printed version. -- */}
      <div className="print-block">
        <p>
          <strong>Overall Performance</strong>
          {TICKS.map((t) => (
            <span key={t} className="print-inline-tick">
              {TICK_HEAD[t]} <span className="print-box">{review.overallTick === t ? "✓" : ""}</span>
            </span>
          ))}
        </p>
      </div>

      <div className="print-block">
        <p>
          <strong>Supervisor Comment:</strong>
        </p>
        <p className="print-comment">{review.supervisorComment || " "}</p>
      </div>

      <div className="print-block">
        <p>
          <strong>Salary:</strong>
          <span className="print-inline-tick">
            Same <span className="print-box">{review.salary?.salaryChanged === false ? "✓" : ""}</span>
          </span>
          <span className="print-inline-tick">
            New <span className="print-box">{review.salary?.salaryChanged ? "✓" : ""}</span>
          </span>
          <span className="print-inline-tick" style={{ marginLeft: "12mm" }}>
            <strong>Training Required:</strong> Yes{" "}
            <span className="print-box">{review.trainingRequired === true ? "✓" : ""}</span> / No{" "}
            <span className="print-box">{review.trainingRequired === false ? "✓" : ""}</span>
          </span>
        </p>

        {/* -- The three figures print only when there IS a change.
              Blank rules under a "Same" tick invite somebody to fill them in by
              hand afterwards, which is how a signed record acquires a number
              nobody recorded. -- */}
        <p className="print-salary">
          Old Salary <span className="print-rule">{formatInr(review.salary?.oldCtc ?? null)}</span>
          Salary Increment %{" "}
          <span className="print-rule">
            {review.salary?.incrementPct === null || review.salary?.incrementPct === undefined
              ? "—"
              : `${review.salary.incrementPct}%`}
          </span>
          New Salary <span className="print-rule">{formatInr(review.salary?.newCtc ?? null)}</span>
        </p>
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
        <div className="print-sig">
          <span className="print-sig-line" />
          <span className="print-sig-label">Company Stamp</span>
          <span className="print-sig-name">&nbsp;</span>
          <span className="print-sig-when">&nbsp;</span>
        </div>
      </div>

      <p className="print-footnote">
        Reviewed status: {review.status === "CLOSED" ? "Closed" : review.status === "REVIEWED" ? "Reviewed by HR" : "Not yet reviewed"}
        {" · "}
        Printed {formatDate(new Date().toISOString())}
      </p>
    </section>
  );
}

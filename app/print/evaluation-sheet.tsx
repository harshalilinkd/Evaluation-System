/** One evaluation, printed. DESIGN.md §7a. Server component — no interactivity. */

import { Fragment } from "react";

import { SECTION_LABELS } from "@/lib/forms/labels";
import type { PrintDocument } from "@/lib/print/document";
import { formatDate, formatInr, formatScore } from "@/lib/utils/date";

/**
 * The whole document, top to bottom, in the order the source form has it.
 *
 * A server component with no `"use client"`: nothing here reacts to anything.
 * That is also what makes a 47-person batch pack possible — the browser
 * receives finished HTML rather than 47 components to hydrate.
 */
export function EvaluationSheet({ doc, index }: { doc: PrintDocument; index?: number }) {
  return (
    // Each evaluation in a pack starts on a fresh sheet. The first does not,
    // or the pack opens on a blank page.
    <section className={index !== undefined && index > 0 ? "print-sheet print-page-break" : "print-sheet"}>
      {/* ---------- 1. Letterhead ---------- */}
      <header className="print-header">
        <div className="print-brand">
          {/*
            The mark alone, with the caption beneath it. No wordmark beside it:
            the artwork IS the company name, and setting it twice competes with
            the document title for the top of the page.

            `alt` is empty on purpose. An empty alt means decorative, and a
            browser renders NOTHING for a broken decorative image — no icon, no
            stray text. So a missing file leaves the caption standing on its own
            rather than putting a broken-image glyph on a document somebody is
            about to sign. Drop the artwork at public/logo.png.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element -- next/image cannot be used in a print route: it needs the optimiser at runtime, and this sheet is rendered to paper. */}
          <img src="/logo.png" alt="" className="print-logo" />
          <span className="print-brand-sub">Performance Evaluation</span>
        </div>

        <h1 className="print-title">
          Employee Performance Evaluation
          {/* Labelled, so nobody has to work out which copy they are holding. */}
          {doc.audience === "employee" ? (
            <span className="print-title-sub">Employee copy</span>
          ) : null}
        </h1>

        <span className="print-period">
          <strong>Period</strong>
          {doc.meta.period}
        </span>
      </header>

      {/* ---------- 2. Metadata ---------- */}
      <table className="print-meta">
        <tbody>
          <tr>
            <td>Employee Name</td><td>{doc.meta.employeeName}</td>
            <td>Employee Code</td><td>{doc.meta.employeeCode ?? "—"}</td>
          </tr>
          <tr>
            <td>Department</td><td>{doc.meta.department ?? "—"}</td>
            <td>Designation</td><td>{doc.meta.designation ?? "—"}</td>
          </tr>
          <tr>
            <td>Date of Joining</td><td>{formatDate(doc.meta.dateOfJoining)}</td>
            <td>Evaluation Period</td><td>{doc.meta.period}</td>
          </tr>
          <tr>
            <td>Reporting Lead</td><td>{doc.meta.leadName ?? "—"}</td>
            <td>Date of Evaluation</td><td>{formatDate(doc.meta.evaluationDate)}</td>
          </tr>
        </tbody>
      </table>

      {/* ---------- 3. Grading scale ---------- */}
      {/* §6's wording, verbatim, ON the document — the acceptance criterion is
          that somebody who has never used the app can read this sheet. */}
      <div className="print-block print-scale">
        <span className="label">Grading scale</span>
        {doc.scaleLegend.map((l) => `${l.value} = ${l.label}`).join("   ·   ")}
      </div>

      {/* ---------- 4. KPI ---------- */}
      {doc.kpi.length > 0 ? (
        <div className="print-section">
          {/* From SECTION_LABELS, never retyped (§0.2). */}
          <h2>{SECTION_LABELS.KPI}</h2>
          <table className="print-table">
            <thead>
              <tr><th style={{ width: "50%" }}>Measure</th><th>Employee</th><th>Lead</th></tr>
            </thead>
            <tbody>
              {doc.kpi.map((row) => (
                <tr key={row.question}>
                  <td>{row.question}</td>
                  <td>{row.self}</td>
                  <td>{row.lead}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* ---------- 5. Ratings ---------- */}
      <div className="print-section">
        <h2>Ratings</h2>
        <table className="print-table">
          <thead>
            <tr>
              <th style={{ width: "6%" }}>Sr.</th>
              <th style={{ width: "30%" }}>Criteria</th>
              <th style={{ width: "24%" }}>Description</th>
              <th style={{ width: "7%" }}>Self</th>
              <th style={{ width: "7%" }}>Lead</th>
              <th style={{ width: "7%" }}>Final</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {doc.sections.map((section) => (
              // Fragment with a key, not <>: a keyless fragment in a list makes
              // React re-create every row whenever the section list changes.
              <Fragment key={section.section}>
                {/* A ruled sub-heading per section, so a table running over two
                    pages still says what it is describing. */}
                <tr className="print-group">
                  {/* A td, not a th: a th inside tbody inherits the header's
                      uppercase caps treatment, which turned a section name into
                      another column heading. The band is styled by its row
                      class instead of an inline colour. */}
                  <td colSpan={7}>{section.label}</td>
                </tr>
                {section.rows.map((row) => (
                  <tr key={row.questionId}>
                    <td className="print-num">{row.index}</td>
                    <td>{row.text}</td>
                    <td style={{ fontSize: "8.5pt" }}>{row.helpText ?? "—"}</td>
                    <td className="print-num">{row.self ?? "—"}</td>
                    <td className="print-num">{row.lead ?? "—"}</td>
                    <td className="print-num"><strong>{row.final ?? "—"}</strong></td>
                    <td style={{ fontSize: "8.5pt" }}>{row.remark ?? ""}</td>
                  </tr>
                ))}
              </Fragment>
            ))}

            {/* ---------- 6. Final average ---------- */}
            <tr className="print-total">
              <td colSpan={3}>Overall average rating</td>
              <td className="print-num">{formatScore(doc.selfAverage)}</td>
              <td className="print-num">{formatScore(doc.leadAverage)}</td>
              <td className="print-num">{formatScore(doc.finalAverage)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {/* ---------- 7. Narrative ---------- */}
      {doc.employeeNarrative.length > 0 ? (
        <div className="print-section">
          <h2>In the employee&rsquo;s words</h2>
          <div className="print-narrative">
            {doc.employeeNarrative.map((n) => (
              <div key={n.heading} className="print-block">
                <h3>{n.heading}</h3>
                <p>{n.body}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {doc.leadNarrative.length > 0 ? (
        <div className="print-section">
          <h2>{SECTION_LABELS.MANAGER_REVIEW}</h2>
          <div className="print-narrative">
            {doc.leadNarrative.map((n) => (
              <div key={n.heading} className="print-block">
                <h3>{n.heading}</h3>
                <p>{n.body}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Said plainly rather than left as an unexplained gap: an employee
          holding a shorter document should know why it is shorter. */}
      {doc.redacted ? (
        <p className="print-block" style={{ marginTop: "4mm", fontSize: "8.5pt", fontStyle: "italic" }}>
          Internal review comments are not included on an employee copy.
        </p>
      ) : null}

      {/* ---------- 8. Decision ---------- */}
      {doc.decision ? (
        <div className="print-section">
          <h2>Management decision</h2>
          <table className="print-meta">
            <tbody>
              <tr>
                <td>Promotion recommendation</td><td>{doc.decision.promotion ?? "—"}</td>
                <td>Training required</td>
                <td>{doc.decision.trainingRequired === null ? "—" : doc.decision.trainingRequired ? "Yes" : "No"}</td>
              </tr>
              <tr>
                <td>Salary</td><td>{doc.decision.incrementType ?? "—"}</td>
                <td>Increment %</td>
                <td className="print-num">{doc.decision.incrementPct ?? "—"}</td>
              </tr>
              <tr>
                <td>Current salary</td><td>{formatInr(doc.decision.oldSalary)}</td>
                <td>New salary</td><td>{formatInr(doc.decision.newSalary)}</td>
              </tr>
              {doc.decision.concerns ? (
                <tr><td>Concerns</td><td colSpan={3}>{doc.decision.concerns}</td></tr>
              ) : null}
              {doc.decision.remarks ? (
                <tr><td>Remarks</td><td colSpan={3}>{doc.decision.remarks}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* ---------- 9. Signatures ---------- */}
      {/* break-inside: avoid on the block, so the three cells never orphan onto
          a page of their own — the commonest way a pack stops being
          signature-ready. */}
      <div className="print-signatures">
        {[
          { who: "Reporting Lead", name: doc.meta.leadName },
          { who: "HR", name: null },
          { who: "Management", name: null },
        ].map((cell) => (
          <div key={cell.who} className="print-signature">
            <div className="rule" />
            <p className="who">{cell.who}</p>
            <p className="name">{cell.name ?? " "}</p>
            <p className="date">Date: ____________</p>
          </div>
        ))}
      </div>
    </section>
  );
}

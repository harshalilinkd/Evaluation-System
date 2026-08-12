/** The summary sheet. Shared by the batch pack's page 2 and route 3. */

import type { BatchPack } from "@/lib/print/batch";
import { formatDate, formatScore } from "@/lib/utils/date";

export function SummarySheet({ pack, standalone = false }: { pack: BatchPack; standalone?: boolean }) {
  return (
    <section className={standalone ? "print-sheet" : "print-sheet print-page-break"}>
      <header className="print-header">
        <div className="print-brand">
          {/* The mark, with its caption beneath. Empty alt: a broken decorative
              image renders as nothing, so a missing file leaves the caption
              standing rather than a broken glyph on a signed document. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- rendered to paper; the optimiser has no part to play. */}
          <img src="/logo.png" alt="" className="print-logo" />
        </div>
        <h1 className="print-title">Evaluation Summary</h1>
        <span className="print-period">
          <strong>Cycle</strong>
          {pack.cycle.name}
          <br />
          {pack.cycle.periodLabel}
        </span>
      </header>

      <table className="print-table" style={{ marginTop: "4mm" }}>
        <thead>
          <tr>
            <th style={{ width: "5%" }}>Sr.</th>
            <th>Employee</th>
            <th style={{ width: "10%" }}>Code</th>
            <th>Department</th>
            <th style={{ width: "7%" }}>Self</th>
            <th style={{ width: "7%" }}>Manager</th>
            <th style={{ width: "7%" }}>Final</th>
            <th style={{ width: "14%" }}>Promotion</th>
            <th style={{ width: "8%" }}>Incr. %</th>
          </tr>
        </thead>
        <tbody>
          {pack.summary.map((row, i) => (
            <tr key={row.evaluationId}>
              <td className="print-num">{i + 1}</td>
              <td>{row.name}</td>
              <td className="print-num">{row.employeeCode ?? "—"}</td>
              <td>{row.department}</td>
              <td className="print-num">{formatScore(row.self)}</td>
              <td className="print-num">{formatScore(row.lead)}</td>
              <td className="print-num"><strong>{formatScore(row.final)}</strong></td>
              <td>{row.promotion ?? "—"}</td>
              <td className="print-num">{row.incrementPct ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ marginTop: "4mm", fontSize: "8.5pt" }}>
        Generated {formatDate(pack.generatedOn)} · {pack.total} evaluations
      </p>
    </section>
  );
}

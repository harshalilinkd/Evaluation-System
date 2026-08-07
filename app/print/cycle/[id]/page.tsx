/** /print/cycle/[id] — the batch pack. P15 route 2. */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EvaluationSheet } from "@/app/print/evaluation-sheet";
import { PrintToolbar } from "@/app/print/print-toolbar";
import { SummarySheet } from "@/app/print/summary-sheet";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { buildBatchPack } from "@/lib/print/batch";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/date";

export const metadata: Metadata = { title: "Evaluation pack" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ department?: string; copy?: string; all?: string; go?: string }>;
}) {
  await requireRole(ADMIN_ROLES);

  const { id } = await params;
  const { department, copy, all, go } = await searchParams;

  const supabase = await createClient();
  const { data: cycle } = await supabase
    .from("evaluation_cycles")
    .select("id, name, period_label")
    .eq("id", id)
    .maybeSingle();

  if (!cycle) notFound();

  /* ---------- The filter screen ---------- */
  //
  // A 47-person pack is a minute of somebody's printer. It is not built until
  // they have said what they want in it — ?go=1 is the deliberate act.
  if (!go) {
    const { data: departments } = await supabase.from("departments").select("id, name").order("name");

    return (
      <div className="print-canvas">
        <div className="print-sheet no-print">
          <h1 className="print-title" style={{ textAlign: "left" }}>
            {cycle.name} — print pack
          </h1>
          <p style={{ marginTop: "2mm", fontSize: "10pt" }}>{cycle.period_label}</p>

          <form method="get" style={{ marginTop: "8mm", display: "grid", gap: "4mm", maxWidth: "90mm" }}>
            <input type="hidden" name="go" value="1" />

            <label style={{ display: "grid", gap: "1mm", fontSize: "10pt" }}>
              Department
              <select name="department" defaultValue={department ?? ""}
                style={{ padding: "2mm", border: "0.5pt solid #000", fontSize: "10pt" }}>
                <option value="">Every department</option>
                {(departments ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>

            <label style={{ display: "flex", gap: "2mm", alignItems: "center", fontSize: "10pt" }}>
              <input type="checkbox" name="all" value="1" defaultChecked={all === "1"} />
              Include evaluations that are not finalised yet
            </label>

            <label style={{ display: "flex", gap: "2mm", alignItems: "center", fontSize: "10pt" }}>
              <input type="checkbox" name="copy" value="employee" defaultChecked={copy === "employee"} />
              Employee copies (internal comments removed)
            </label>

            <button type="submit"
              style={{ marginTop: "2mm", padding: "3mm", background: "#000", color: "#fff",
                       border: 0, fontSize: "10pt", fontWeight: 700, cursor: "pointer" }}>
              Build the pack
            </button>
          </form>

          <p style={{ marginTop: "6mm", fontSize: "9pt" }}>
            <Link href={`/print/summary/${id}`}>Print the summary sheet only</Link>
          </p>
        </div>
      </div>
    );
  }

  /* ---------- The pack ---------- */
  const pack = await buildBatchPack(id, {
    departmentId: department || null,
    finalisedOnly: all !== "1",
    employeeCopies: copy === "employee",
  });

  if (!pack.ok) notFound();

  return (
    <div className="print-canvas">
      <PrintToolbar label={`Print ${pack.data.total} evaluations`} />

      {/* ---------- 1. Cover ---------- */}
      <section className="print-sheet">
        <header className="print-header">
          <div className="print-brand">
            {/* The mark, with its caption beneath. Empty alt: a broken decorative
                image renders as nothing, so a missing file leaves the caption
                standing rather than a broken glyph on a signed document. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- rendered to paper; the optimiser has no part to play. */}
            <img src="/logo.png" alt="" className="print-logo" />
            <span className="print-brand-sub">Performance Evaluation</span>
          </div>
          <h1 className="print-title">
            Evaluation Pack
            {pack.data.documents.some((d) => d.redacted) ? (
              <span className="print-title-sub">Employee copies</span>
            ) : null}
          </h1>
          <span className="print-period">
            <strong>Period</strong>
            {pack.data.cycle.periodLabel}
          </span>
        </header>

        <table className="print-meta">
          <tbody>
            <tr>
              <td>Cycle</td><td>{pack.data.cycle.name}</td>
              <td>Generated</td><td>{formatDate(pack.data.generatedOn)}</td>
            </tr>
            <tr>
              <td>Evaluations</td><td className="print-num">{pack.data.total}</td>
              <td>Departments</td><td className="print-num">{pack.data.byDepartment.length}</td>
            </tr>
          </tbody>
        </table>

        <div className="print-section">
          <h2>By department</h2>
          <table className="print-table">
            <thead><tr><th>Department</th><th style={{ width: "20%" }}>Evaluations</th></tr></thead>
            <tbody>
              {pack.data.byDepartment.map((d) => (
                <tr key={d.name}><td>{d.name}</td><td className="print-num">{d.count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="print-section">
          <h2>Decisions</h2>
          <table className="print-table">
            <tbody>
              <tr><td>Recommended for promotion</td><td className="print-num">{pack.data.decisionSummary.promoted}</td></tr>
              <tr><td>Can be considered</td><td className="print-num">{pack.data.decisionSummary.considered}</td></tr>
              <tr><td>Not recommended</td><td className="print-num">{pack.data.decisionSummary.notPromoted}</td></tr>
              <tr><td>With a salary increment</td><td className="print-num">{pack.data.decisionSummary.withIncrement}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- 2. Summary ---------- */}
      <SummarySheet pack={pack.data} />

      {/* ---------- 3. Every evaluation, each on a fresh page ---------- */}
      {pack.data.documents.map((doc, i) => (
        <EvaluationSheet key={pack.data.summary[i]?.evaluationId ?? i} doc={doc} index={i + 1} />
      ))}
    </div>
  );
}

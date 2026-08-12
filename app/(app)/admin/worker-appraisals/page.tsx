/** /admin/worker-appraisals — every appraisal, every round, one table. */

import type { Metadata } from "next";

import { WorkerBoard } from "@/app/(app)/admin/worker-appraisals/[cycleId]/board";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { listWorkerRaters } from "@/lib/worker/raters";

export const metadata: Metadata = { title: "Production appraisals" };

export default async function Page() {
  // §9: the guard is the first statement.
  await requireRole(["HR_ADMIN", "MD"]);

  const supabase = await createClient();

  /* -- THE ROUNDS LIST IS GONE, at the owner's instruction.
        It was a page of cards — "test · august · Running" beside "test · Aug ·
        Running" — standing between the menu item and the work, and rounds are
        free to share a name so the two were near-indistinguishable. FIX-40
        redirected past it when there was only one; that was a patch on the same
        complaint, and the answer the owner asked for is that there is no list
        at all.

        Every appraisal in every round is a row now, with the round in its own
        column. Two appraisals of the same worker are two rows that differ in
        that column — which is what "nothing should get overwritten" looks like
        on screen, rather than a count of "earlier" ones hanging off a name.

        Binned rounds are excluded here as everywhere (FIX-17); they live in
        Settings › Recycle bin. -- */
  const { data: cycles } = await supabase
    .from("worker_cycles")
    .select("id, name, period_label, status, self_due_on, supervisor_due_on, md_due_on")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const cycleIds = (cycles ?? []).map((c) => c.id);
  const cycleOf = new Map((cycles ?? []).map((c) => [c.id, c]));

  const [{ data: rows }, { data: workerPool }] = await Promise.all([
    cycleIds.length
      ? supabase
          .from("worker_evaluations")
          .select(
            "id, cycle_id, worker_id, supervisor_id, department_id, status, self_submitted_at, supervisor_submitted_at, self_skipped, supervisor_skipped, self_filled_via, overall_tick",
          )
          .in("cycle_id", cycleIds)
          .is("excluded_at", null)
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("profiles")
      .select("id, full_name, employee_code, reports_to")
      .eq("track", "WORKER")
      .eq("is_active", true)
      .order("full_name"),
  ]);

  const raters = await listWorkerRaters();

  const evaluationIds = (rows ?? []).map((r) => r.id);
  const workerIds = (rows ?? []).map((r) => r.worker_id);

  /* -- The detail columns. Every one is HR-and-MD-only data (§5), and all three
        go through the authenticated client — so 0050's and 0051's policies
        decide, and a caller who slipped past the guard gets empty columns
        rather than figures. The guard is the clean exit, not the protection. -- */
  const [{ data: decisions }, { data: employment }, { data: supervisorRows }, { data: departments }] =
    await Promise.all([
      evaluationIds.length
        ? supabase
            .from("worker_evaluation_decisions")
            .select("evaluation_id, salary_changed, old_ctc, increment_pct, new_ctc")
            .in("evaluation_id", evaluationIds)
        : Promise.resolve({ data: [] }),
      workerIds.length
        ? supabase
            .from("employment_records")
            .select("profile_id, last_increment_date, next_increment_date, current_ctc")
            .in("profile_id", workerIds)
        : Promise.resolve({ data: [] }),
      evaluationIds.length
        ? supabase
            .from("worker_evaluation_responses")
            .select("evaluation_id, training_required")
            .eq("layer", "SUPERVISOR")
            .in("evaluation_id", evaluationIds)
        : Promise.resolve({ data: [] }),
      supabase.from("departments").select("id, name"),
    ]);

  const decisionOf = new Map((decisions ?? []).map((d) => [d.evaluation_id, d]));
  const employmentOf = new Map((employment ?? []).map((e) => [e.profile_id, e]));
  const trainingOf = new Map((supervisorRows ?? []).map((r) => [r.evaluation_id, r.training_required]));
  const departmentOf = new Map((departments ?? []).map((d) => [d.id, d.name]));

  const ids = [
    ...new Set(
      [
        ...(rows ?? []).flatMap((r) => [r.worker_id, r.supervisor_id]),
        ...(workerPool ?? []).map((w) => w.reports_to),
      ].filter((v): v is string => Boolean(v)),
    ),
  ];
  const { data: people } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));

  return (
    <WorkerBoard
      /* Null is the whole signal: no single round, so the Round column appears
         and the per-round controls do not. */
      cycle={null}
      rows={(rows ?? []).map((r) => ({
        id: r.id,
        workerId: r.worker_id,
        workerName: nameOf.get(r.worker_id) ?? "—",
        supervisorName: r.supervisor_id ? (nameOf.get(r.supervisor_id) ?? "—") : "—",
        selfIn: Boolean(r.self_submitted_at) || r.self_skipped,
        supervisorIn: Boolean(r.supervisor_submitted_at) || r.supervisor_skipped,
        selfSubmittedAt: r.self_submitted_at,
        supervisorSubmittedAt: r.supervisor_submitted_at,
        handedOver: r.self_filled_via === "HANDOVER",
        status: r.status,
        overallTick: r.overall_tick,
        department: r.department_id ? (departmentOf.get(r.department_id) ?? null) : null,
        trainingRequired: trainingOf.get(r.id) ?? null,
        salaryChanged: decisionOf.get(r.id)?.salary_changed ?? null,
        newCtc: decisionOf.get(r.id)?.new_ctc ?? null,
        incrementPct: decisionOf.get(r.id)?.increment_pct ?? null,
        currentCtc: employmentOf.get(r.worker_id)?.current_ctc ?? null,
        lastIncrementDate: employmentOf.get(r.worker_id)?.last_increment_date ?? null,
        nextIncrementDate: employmentOf.get(r.worker_id)?.next_increment_date ?? null,
        cycleId: r.cycle_id,
        roundName: cycleOf.get(r.cycle_id)?.name ?? "—",
        roundPeriod: cycleOf.get(r.cycle_id)?.period_label ?? "",
      }))}
      workers={(workerPool ?? []).map((w) => ({
        id: w.id,
        name: w.full_name,
        employeeCode: w.employee_code,
        supervisorId: w.reports_to,
        supervisorName: w.reports_to ? (nameOf.get(w.reports_to) ?? null) : null,
      }))}
      raters={raters}
    />
  );
}

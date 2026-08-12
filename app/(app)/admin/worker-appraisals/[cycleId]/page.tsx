/** One worker appraisal round: who is in it, where each side is, and what happens next. */

import type { Metadata } from "next";

import { WorkerBoard } from "@/app/(app)/admin/worker-appraisals/[cycleId]/board";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { listWorkerRaters } from "@/lib/worker/raters";

export const metadata: Metadata = { title: "Worker appraisals" };

export default async function Page({ params }: { params: Promise<{ cycleId: string }> }) {
  await requireRole(["HR_ADMIN", "MD"]);

  const { cycleId } = await params;
  const supabase = await createClient();

  const [{ data: cycle }, { data: rows }, { data: workerPool }] =
    await Promise.all([
      supabase
        .from("worker_cycles")
        .select("id, name, period_label, status, self_due_on, supervisor_due_on, md_due_on")
        .eq("id", cycleId)
        .maybeSingle(),
      supabase
        .from("worker_evaluations")
        .select(
          "id, worker_id, supervisor_id, department_id, status, self_submitted_at, supervisor_submitted_at, self_skipped, supervisor_skipped, self_filled_via, overall_tick",
        )
        .eq("cycle_id", cycleId)
        .is("excluded_at", null),
      supabase
        .from("profiles")
        .select("id, full_name, employee_code, reports_to")
        .eq("track", "WORKER")
        .eq("is_active", true)
        .order("full_name"),
    ]);

  const raters = await listWorkerRaters();

  if (!cycle) return <ErrorState title="Not found" body="That round no longer exists." />;

  const evaluationIds = (rows ?? []).map((r) => r.id);
  const workerIds = (rows ?? []).map((r) => r.worker_id);

  /* -- The detail columns.
        Every one of these is HR-and-MD-only data (§5), and this page is guarded
        to exactly those two — but the guard is the clean exit, not the
        protection: all three go through the authenticated client, so 0050's and
        0051's policies decide, and a caller who slipped past the guard would
        get empty columns rather than figures. -- */
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

  /* -- WHERE THIS ROUND SITS, AND WHAT EACH WORKER HAS BEHIND THEM.
        Both answer the same report: a new round reads as having overwritten the
        last one, because the board looks identical whichever round it shows and
        cannot reach any other. Nothing is overwritten — a worker may be in as
        many rounds as exist — and these two reads are how the screen says so.

        Live rounds only, oldest first, so "Round 2 of 3" counts the same rounds
        the list shows. A binned round is not part of the run (FIX-32). -- */
  const [{ data: allRounds }, { data: otherAppraisals }] = await Promise.all([
    supabase
      .from("worker_cycles")
      .select("id")
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    workerIds.length > 0
      ? supabase
          .from("worker_evaluations")
          .select("worker_id, cycle_id")
          .in("worker_id", workerIds)
          .neq("cycle_id", cycleId)
          .is("excluded_at", null)
      : Promise.resolve({ data: [] as { worker_id: string; cycle_id: string }[] }),
  ]);

  const roundIds = (allRounds ?? []).map((c) => c.id);
  const roundCount = roundIds.length;
  const roundIndex = roundIds.indexOf(cycleId) + 1;

  /* -- Counted against the LIVE rounds only, so binning a round takes its
        appraisal out of the tally rather than leaving a link to a round nobody
        can open. -- */
  const liveRounds = new Set(roundIds);
  const earlierOf = new Map<string, number>();
  for (const row of otherAppraisals ?? []) {
    if (!liveRounds.has(row.cycle_id)) continue;
    earlierOf.set(row.worker_id, (earlierOf.get(row.worker_id) ?? 0) + 1);
  }

  return (
    <WorkerBoard
      roundIndex={roundIndex}
      roundCount={roundCount}
      cycle={cycle}
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
        earlierAppraisals: earlierOf.get(r.worker_id) ?? 0,
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

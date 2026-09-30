/** One worker appraisal round: who is in it, where each side is, and what happens next. */

import type { Metadata } from "next";

import { WorkerBoard } from "@/app/(app)/admin/worker-appraisals/[cycleId]/board";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { CONTACT_COLUMNS, contactFor } from "@/lib/notify/contacts";
import { listWorkerRaters } from "@/lib/worker/raters";
import { sheetDeliveryFor } from "@/lib/worker/sheet-delivery";

export const metadata: Metadata = { title: "Worker appraisals" };

export default async function Page({ params }: { params: Promise<{ cycleId: string }> }) {
  /* -- THE SESSION WAS BEING DISCARDED HERE, and the all-rounds page beside
        this one already knew better. Without it `mdView` defaulted to false, so
        the MD opening a round got HR's vocabulary throughout: a row the MD had
        sent BACK to HR read "Filled in — ready for your review" with a Review
        button, and the "Ready for you" tile counted it — telling the MD that
        something was waiting on her which she had just handed back.

        Which vocabulary to use is a property of the READER, so the reader has
        to reach the component. Same rule as the other page, word for word: an
        MD who also holds HR_ADMIN is HR here, because they do HR's job on this
        screen. -- */
  const session = await requireRole(["HR_ADMIN", "MD"]);
  const viewerIsMdOnly =
    session.roles.includes("MD") && !session.roles.includes("HR_ADMIN");

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
          "id, worker_id, supervisor_id, reviewer_id, department_id, status, self_submitted_at, supervisor_submitted_at, self_skipped, supervisor_skipped, self_filled_via, overall_tick",
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
            .select("evaluation_id, salary_changed, old_ctc, increment_pct, new_ctc, supervisor_comment, training_required")
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

  /* -- WHO ALREADY HAS A LIVE APPRAISAL, and in which round.
        Somebody with one open elsewhere must not be ticked into a second: the
        team leader would get two sheets for the same person in the same period,
        which is the "multiple links" complaint the staff side had to fix (0096,
        0091). CLOSED ones are deliberately not counted — a worker being
        appraised again next period is the ordinary case (FIX-43), and a binned
        round is not a round.

        Two queries merged in TypeScript rather than an embedded join: the
        hand-authored `types/database.ts` declares no relationship between these
        two tables, and supabase-js resolves an embed from exactly that at
        compile time (F24-19, P3-7). -- */
  /* -- WHOEVER REVIEWED LAST TIME, as the launch dialog's default.
        Once more than one person holds the Supervisor access level the app has
        no basis for choosing between them, and picking one alphabetically
        would assign a pay recommendation by accident. "The same person as last
        round" is a real answer rather than a guess — and it comes from the
        data, so it works for every HR user rather than only the browser that
        set it. Null on the very first round. -- */
  const { data: lastReviewed } = await supabase
    .from("worker_evaluations")
    .select("reviewer_id, created_at")
    .not("reviewer_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  /* -- WHO IS AN ADMINISTRATOR, so the launch dialog can say so.
        A worker's Reports-to is trusted as their team leader whatever access
        level they hold — the owner's instruction, and right: a line manager
        should not need a permission granted before they can rate their own
        people. What it cannot do is tell an administrator apart from a shop
        floor manager, and three workers on this roster report to an HR admin
        or the MD. The form then lands on a desk that has no business rating
        anybody, and the first anybody knows is a message arriving.

        A caution, not a block: HR may genuinely be somebody's manager on a
        small site, and refusing it would be the app overruling a fact about
        the company (§13.4 asks for the reason, not for the door). -- */
  const [{ data: adminGrants }, { data: supervisorGrants }] = await Promise.all([
    supabase.from("user_roles").select("profile_id").in("role", ["HR_ADMIN", "MD"]),
    supabase.from("user_roles").select("profile_id").eq("role", "SUPERVISOR"),
  ]);

  /* -- A SUPERVISOR GRANT ANSWERS THE QUESTION THIS FLAG ASKS.
        The warning exists to say "this is an administrator, not a shop-floor
        manager" — and holding the Supervisor access level is exactly the
        evidence that they are one. Somebody who holds both is not a mistake to
        warn about, so they are subtracted here rather than flagged and then
        explained away. -- */
  const isSupervisor = new Set((supervisorGrants ?? []).map((r) => r.profile_id));
  const adminIds = [
    ...new Set((adminGrants ?? []).map((r) => r.profile_id).filter((id) => !isSupervisor.has(id))),
  ];

  const poolIds = (workerPool ?? []).map((w) => w.id);

  const { data: liveRows } = poolIds.length
    ? await supabase
        .from("worker_evaluations")
        .select("worker_id, cycle_id, status")
        .in("worker_id", poolIds)
        .neq("status", "CLOSED")
        .is("excluded_at", null)
    : { data: [] };

  const liveCycleIds = [...new Set((liveRows ?? []).map((r) => r.cycle_id))];
  const { data: liveCycles } = liveCycleIds.length
    ? await supabase
        .from("worker_cycles")
        .select("id, name")
        .in("id", liveCycleIds)
        .is("deleted_at", null)
    : { data: [] };

  const liveCycleName = new Map((liveCycles ?? []).map((c) => [c.id, c.name]));
  const openRoundOf = new Map<string, string>();
  for (const r of liveRows ?? []) {
    const roundName = liveCycleName.get(r.cycle_id);
    if (roundName && !openRoundOf.has(r.worker_id)) openRoundOf.set(r.worker_id, roundName);
  }

  const decisionOf = new Map((decisions ?? []).map((d) => [d.evaluation_id, d]));
  const employmentOf = new Map((employment ?? []).map((e) => [e.profile_id, e]));
  /* -- 0100 moved the training tick to the decisions row, because the response
        row it used to live on locks when the team leader submits and the person
        who answers it has not started then. The RESPONSE is still read as a
        fallback: every appraisal filed before 0100 has it there and nowhere
        else, and a column that silently empties for historic rows is worse than
        one extra lookup. -- */
  const legacyTrainingOf = new Map(
    (supervisorRows ?? []).map((r) => [r.evaluation_id, r.training_required]),
  );
  const trainingOf = new Map(
    evaluationIds.map((id) => [
      id,
      decisionOf.get(id)?.training_required ?? legacyTrainingOf.get(id) ?? null,
    ]),
  );
  const departmentOf = new Map((departments ?? []).map((d) => [d.id, d.name]));

  const ids = [
    ...new Set(
      [
        ...(rows ?? []).flatMap((r) => [r.worker_id, r.supervisor_id, r.reviewer_id]),
        ...(workerPool ?? []).map((w) => w.reports_to),
      ].filter((v): v is string => Boolean(v)),
    ),
  ];
  const { data: people } = ids.length
    ? await supabase
        .from("profiles")
        .select(`id, full_name, designation, ${CONTACT_COLUMNS}`)
        .in("id", ids)
    : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  /* -- THE ADDRESS THE SHEET ACTUALLY GOES TO, resolved by the same function
        that sends it. Not "the personal one" or "the work one" — asking
        `contactFor` means the screen cannot disagree with the send, and it
        cannot drift the next time a template's purpose changes (which is
        exactly what just happened: the production invite moved from personal
        to official, and this line needed no edit). -- */
  const designationOf = new Map(
    (people ?? []).map((p) => [p.id, p.designation ?? null] as const),
  );
  const emailOf = new Map(
    (people ?? []).map(
      (p) => [p.id, contactFor(p, "workerRatingInvite").email] as const,
    ),
  );

  /* -- Was the sheet actually sent? Read back per appraisal rather than
        inferred from the round having launched — those are two different
        facts, and treating them as one is what let a launch that reached
        nobody report plain success. -- */
  const deliveryOf = await sheetDeliveryFor(evaluationIds);

  return (
    <WorkerBoard
      mdView={viewerIsMdOnly}
      cycle={cycle}
      rows={(rows ?? []).map((r) => ({
        id: r.id,
        workerId: r.worker_id,
        workerName: nameOf.get(r.worker_id) ?? "—",
        supervisorId: r.supervisor_id,
        supervisorName: r.supervisor_id ? (nameOf.get(r.supervisor_id) ?? "—") : "—",
        supervisorEmail: r.supervisor_id ? (emailOf.get(r.supervisor_id) ?? null) : null,
        // 0100: the supervisor who reviews those ratings, where one is assigned.
        reviewerId: r.reviewer_id,
        reviewerName: r.reviewer_id ? (nameOf.get(r.reviewer_id) ?? "—") : null,
        reviewerEmail: r.reviewer_id ? (emailOf.get(r.reviewer_id) ?? null) : null,
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
        sheet: deliveryOf.get(r.id) ?? { status: null, at: null, error: null, attempts: 0 },
        nextIncrementDate: employmentOf.get(r.worker_id)?.next_increment_date ?? null,
        cycleId,
        roundName: cycle.name,
        roundPeriod: cycle.period_label,
      }))}
      workers={(workerPool ?? []).map((w) => ({
        id: w.id,
        name: w.full_name,
        employeeCode: w.employee_code,
        supervisorId: w.reports_to,
        supervisorName: w.reports_to ? (nameOf.get(w.reports_to) ?? null) : null,
        /* -- Their job title, so "Harshali Bhopale · HR-Admin" and "Harshali ·
              Design Coordinator" are tellable apart. Two people whose names
              start the same way read as one person otherwise, which is exactly
              how an administrator's name was mistaken for a supervisor's. -- */
        supervisorDesignation: w.reports_to ? (designationOf.get(w.reports_to) ?? null) : null,
        openRoundName: openRoundOf.get(w.id) ?? null,
      }))}
      raters={raters}
      adminIds={adminIds}
      lastReviewerId={lastReviewed?.reviewer_id ?? null}
    />
  );
}

/** /admin/worker-appraisals — every appraisal, every round, one table. */

import type { Metadata } from "next";

import { WorkerBoard } from "@/app/(app)/admin/worker-appraisals/[cycleId]/board";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { listWorkerRaters } from "@/lib/worker/raters";

export const metadata: Metadata = { title: "Production appraisals" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  // §9: the guard is the first statement.
  /* -- The session was being discarded. The board's stage labels are written
        from HR's point of view — "Ready for you" means ready for HR — and the
        MD reading that card is being told the wrong thing about their own
        queue. Which vocabulary to use is a property of the reader, so the
        reader has to reach the component. -- */
  const session = await requireRole(["HR_ADMIN", "MD"]);
  const viewerIsMdOnly =
    session.roles.includes("MD") && !session.roles.includes("HR_ADMIN");

  /* -- `?start=due` — the increment calendar's "Start for Production team". A
        word, never a list of ids: the dialog resolves WHO from the same rule
        the button counted by, so the two cannot report different people and the
        URL stays short enough to type, bookmark and reason about (PR-8).

        `?start=<uuid>` — "Start increment" on ONE row of that calendar. That
        button used to send every worker to the STAFF wizard, which has no form
        for them at all (§7). One person is the same round with one tick. -- */
  const params = await searchParams;
  const startDue = params.start === "due";
  const startWorkerId = params.start && params.start !== "due" ? params.start : undefined;

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
            "id, cycle_id, worker_id, supervisor_id, reviewer_id, department_id, status, self_submitted_at, supervisor_submitted_at, self_skipped, supervisor_skipped, self_filled_via, overall_tick",
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
  /* -- THE WHOLE POOL, not only the people already in a round.
        The table needs a figure per appraised worker; the Start-a-round dialog
        needs a next-increment date for everybody it might tick, and most of
        those have no appraisal yet. Deduped into one query rather than a second
        round trip for the overlap. -- */
  const workerIds = [
    ...new Set([
      ...(rows ?? []).map((r) => r.worker_id),
      ...(workerPool ?? []).map((w) => w.id),
    ]),
  ];

  /* -- The detail columns. Every one is HR-and-MD-only data (§5), and all three
        go through the authenticated client — so 0050's and 0051's policies
        decide, and a caller who slipped past the guard gets empty columns
        rather than figures. The guard is the clean exit, not the protection. -- */
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
  const { data: adminGrants } = await supabase
    .from("user_roles")
    .select("profile_id")
    .in("role", ["HR_ADMIN", "MD"]);

  const adminIds = [...new Set((adminGrants ?? []).map((r) => r.profile_id))];

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
    ? await supabase.from("profiles").select("id, full_name, email, work_email").in("id", ids)
    : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  /* -- The PERSONAL address, falling back to the work one. `contacts.ts` files
        the production rating invite as personal, so this is the address the
        sheet actually goes to — showing any other would be printing one thing
        and sending to another. -- */
  const emailOf = new Map(
    (people ?? []).map((p) => [p.id, p.email ?? p.work_email ?? null] as const),
  );

  return (
    <WorkerBoard
      /* Null is the whole signal: no single round, so the Round column appears
         and the per-round controls do not. */
      cycle={null}
      mdView={viewerIsMdOnly}
      rows={(rows ?? []).map((r) => ({
        id: r.id,
        workerId: r.worker_id,
        workerName: nameOf.get(r.worker_id) ?? "—",
        supervisorName: r.supervisor_id ? (nameOf.get(r.supervisor_id) ?? "—") : "—",
        supervisorEmail: r.supervisor_id ? (emailOf.get(r.supervisor_id) ?? null) : null,
        // 0100: the supervisor who reviews those ratings, where one is assigned.
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
        openRoundName: openRoundOf.get(w.id) ?? null,
        /* Undefined where there is no employment record, which is "we do not
           know" and not "not due" — the dialog ticks on due, so the two must
           not collapse into one. */
        nextIncrementOn: employmentOf.get(w.id)?.next_increment_date ?? null,
      }))}
      raters={raters}
      adminIds={adminIds}
      lastReviewerId={lastReviewed?.reviewer_id ?? null}
      startDue={startDue}
      startWorkerId={startWorkerId}
    />
  );
}

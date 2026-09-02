"use server";

/** Worker appraisal cycles. HR-guarded (§9), audited (§12), isolated from staff (§7). */

import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { notifyWorkerRoundOpened } from "@/lib/notify/events";
import type { Json } from "@/types/database";

/*
 * §7's ISOLATION RULE is why this file exists rather than a `track` branch in
 * `lib/cycles/actions.ts`: "never refactor a staff-module function to
 * accommodate the worker module or the reverse."
 *
 * It is deliberately shorter than the staff equivalent, and the differences are
 * the module, not an omission:
 *
 *   · No department mapping. Every worker answers the same eight qualities —
 *     there is no Job Specific Skills section on a tick sheet, so there is no
 *     per-department readiness to check (P9-7 does not apply here).
 *   · No question assembly. The bank IS the form: `worker_questions` in
 *     `sort_order`, filtered to active. Nothing to merge.
 *   · No invite tokens at launch. Workers sign in with the account HR creates
 *     them; §10's token flow is for staff invited by link, and adding it here
 *     would be building a second distribution system before anybody has asked
 *     for one.
 */

export type WorkerResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

function fail(code: string, message: string): WorkerResult<never> {
  return { ok: false, error: { code, message } };
}

async function guard() {
  return checkRole(["HR_ADMIN"]);
}

function revalidate(cycleId?: string) {
  revalidatePath("/admin/worker-appraisals");
  if (cycleId) revalidatePath(`/admin/worker-appraisals/${cycleId}`);
}

/* ============================================================ createCycle == */

export async function createWorkerCycle(input: {
  name: string;
  periodLabel: string;
  selfDueOn: string;
  supervisorDueOn: string;
  mdDueOn: string;
}): Promise<WorkerResult<{ id: string }>> {
  const auth = await guard();
  if (!auth.ok) return fail(auth.error.code, auth.error.message);

  const name = input.name.trim();
  const periodLabel = input.periodLabel.trim();
  if (name.length < 3) return fail("INVALID_INPUT", "Give the cycle a name.");
  if (periodLabel.length < 2) return fail("INVALID_INPUT", "Give the cycle a period, such as Q3 FY26.");

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("worker_cycles")
    .insert({
      name,
      period_label: periodLabel,
      starts_on: new Date().toISOString().slice(0, 10),
      self_due_on: input.selfDueOn || null,
      supervisor_due_on: input.supervisorDueOn || null,
      md_due_on: input.mdDueOn || null,
      status: "DRAFT",
      created_by: auth.session.profile.id,
    })
    .select("id")
    .single();

  if (error) return fail("QUERY_FAILED", error.message);

  await supabase.rpc("log_admin_action", {
    p_entity: "worker_cycle",
    p_entity_id: data.id,
    p_action: "worker_cycle.created",
    p_diff: { name, period_label: periodLabel } as Json,
  });

  revalidate();
  return { ok: true, data: { id: data.id } };
}

/* ============================================================== launch ==== */

/**
 * Open a worker cycle: freeze the sheet and put both forms live.
 *
 * NOT A PL/pgSQL FUNCTION, unlike `launch_cycle` for staff — and the reason is
 * worth stating rather than looking like an inconsistency. The staff launch has
 * to be one transaction because it assembles a DIFFERENT question list per
 * department and mints invite tokens, so a partial run leaves people frozen
 * against the wrong form (P10-2). Here every worker gets the identical eight
 * qualities and there are no tokens. A re-run is therefore safe and idempotent:
 * the unique constraints refuse a duplicate evaluation, a duplicate snapshot row
 * and a duplicate response row, so an interrupted launch is fixed by launching
 * again rather than by rolling back.
 *
 * §5's SNAPSHOT RULE still holds exactly as it does for staff: the sheet is
 * copied into `worker_evaluation_questions` at this moment, and editing the
 * worker form afterwards can never change what somebody was asked.
 */
export type WorkerAssignment = {
  workerId: string;
  /* -- Chosen by HR at launch, defaulted from `reports_to` but not bound to it.
        A profile's Reports-to was set once for a different purpose, and
        inheriting it silently is what put the MD down as the rater of a
        shop-floor helper. It is copied onto the appraisal here, so a later
        change to the profile cannot move an in-flight round (P3-6). -- */
  supervisorId: string | null;
  /* -- 0100: the SUPERVISOR who reviews those ticks and records the comment,
        the training tick and the recommended percentage.

        REQUIRED, at the owner's instruction — "before hr supervisor will review
        rating given by TL". An earlier version made it optional so that a shop
        floor with nobody holding the access level could still launch; the owner
        chose the opposite, and it is the better call: a round that quietly
        skipped the review step would produce appraisals with no comment, no
        training tick and no recommendation, and nothing on screen to say why.

        The TYPE stays nullable because the COLUMN is: every round launched
        before 0100 has none, and `submit_worker_layer` still sends those
        straight to HR. What changes is that a NEW round cannot be one of them,
        and the guard below is what says so. -- */
  reviewerId: string | null;
};

export async function launchWorkerCycle(
  cycleId: string,
  assignments: WorkerAssignment[],
): Promise<WorkerResult<{ opened: number }>> {
  const auth = await guard();
  if (!auth.ok) return fail(auth.error.code, auth.error.message);
  if (assignments.length === 0) return fail("NO_PARTICIPANTS", "Add at least one worker first.");

  const supervisorOf = new Map(assignments.map((a) => [a.workerId, a.supervisorId]));
  const reviewerOf = new Map(assignments.map((a) => [a.workerId, a.reviewerId]));
  const workerIds = assignments.map((a) => a.workerId);

  const supabase = await createClient();

  const { data: cycle } = await supabase
    .from("worker_cycles")
    .select("id, name, period_label, status, self_due_on, supervisor_due_on")
    .eq("id", cycleId)
    .maybeSingle();

  if (!cycle) return fail("NOT_FOUND", "That cycle no longer exists.");
  if (cycle.status !== "DRAFT") {
    return fail("ALREADY_LAUNCHED", "This cycle has already been launched.");
  }

  /* -- The sheet, frozen at this moment. -- */
  const { data: questions } = await supabase
    .from("worker_questions")
    .select("id, text, help_text, sort_order, is_required, is_overall")
    .eq("is_active", true)
    .order("sort_order");

  if (!questions || questions.length === 0) {
    return fail("NO_QUESTIONS", "The worker form has no questions on it yet.");
  }

  /* -- The people. Read from `profiles`, and the track filter is the module
        boundary (§5): a STAFF row must never reach a worker table. -- */
  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, department_id, reports_to, track, is_active")
    .in("id", workerIds)
    .eq("track", "WORKER")
    .eq("is_active", true);

  const eligible = people ?? [];
  if (eligible.length === 0) {
    return fail("NO_ELIGIBLE", "None of those people are active shop-floor workers.");
  }

  /* -- A worker with no supervisor cannot be appraised: nobody would be asked
        to fill the other side. Named, rather than launched and discovered
        later (P9-7's reasoning, applied to the thing that matters here). -- */
  const unsupervised = eligible.filter((p) => !supervisorOf.get(p.id));
  if (unsupervised.length > 0) {
    return fail(
      "NO_SUPERVISOR",
      `${unsupervised.map((p) => p.full_name).join(", ")} ${
        unsupervised.length === 1 ? "has" : "have"
      } nobody chosen to rate them.`,
    );
  }

  const selfLed = eligible.filter((p) => supervisorOf.get(p.id) === p.id);
  if (selfLed.length > 0) {
    return fail(
      "SELF_SUPERVISED",
      `${selfLed.map((p) => p.full_name).join(", ")} supervises themselves, so they would fill and see both sides.`,
    );
  }

  /* -- 0100: the reviewer is a SECOND pair of eyes, so they cannot be the
        person whose ticks they are reviewing, and they cannot be the worker.
        Either would collapse the two steps into one and leave nothing for the
        review to be a review OF — the same objection AMEND-2 makes about HR
        approving their own proposal. -- */
  /* -- The review step is not optional (0100 as amended). Refused by name,
        rather than launched and discovered when the first sheet lands on HR's
        desk with none of the three fields on it. -- */
  const unreviewed = eligible.filter((p) => !reviewerOf.get(p.id));
  if (unreviewed.length > 0) {
    return fail(
      "NO_REVIEWER",
      `${unreviewed.map((p) => p.full_name).join(", ")} ${
        unreviewed.length === 1 ? "has" : "have"
      } nobody chosen to review the ratings and decide the increment. Pick a supervisor for each, or grant somebody the Supervisor access level on Settings › Users.`,
    );
  }

  /* -- THE REVIEWER MUST HOLD THE SUPERVISOR ACCESS LEVEL, and that replaces
        an earlier "they cannot also be the rater".

        The old rule was a second-pair-of-eyes argument and it produced a dead
        end on a small floor: where the team leader IS the only supervisor,
        nobody could be chosen and the round could not launch. The owner named
        that case directly — "for some employees rated by means reports to
        assign is supervisor means supervisor will rate them and take increment
        decision also" — so one person doing both is a fact about the size of
        the team rather than a mistake to prevent. They still do both STEPS:
        rate, submit, then review and recommend, so the three fields live in
        one place whoever filled them.

        What must still be true is that the pay recommendation is made by
        somebody the company has given that standing to, and that is a role.
        Re-checked here rather than trusted from the dialog — §9, and the
        action is callable with any payload. -- */
  const namedReviewers = [
    ...new Set(
      eligible.map((p) => reviewerOf.get(p.id)).filter((id): id is string => Boolean(id)),
    ),
  ];

  const { data: supervisorGrants } = namedReviewers.length
    ? await supabase
        .from("user_roles")
        .select("profile_id")
        .eq("role", "SUPERVISOR")
        .in("profile_id", namedReviewers)
    : { data: [] };

  const holdsSupervisor = new Set((supervisorGrants ?? []).map((r) => r.profile_id));
  const notSupervisors = eligible.filter((p) => {
    const id = reviewerOf.get(p.id);
    return Boolean(id) && !holdsSupervisor.has(id as string);
  });

  if (notSupervisors.length > 0) {
    return fail(
      "REVIEWER_NOT_SUPERVISOR",
      `${notSupervisors.map((p) => p.full_name).join(", ")}: the person chosen to review and decide the increment does not hold the Supervisor access level. Grant it on Settings › Users, or pick somebody who has it.`,
    );
  }

  /* -- NOBODY WITH A LIVE APPRAISAL ELSEWHERE.
        Two open sheets for one worker means their team leader is handed two
        forms for the same person in the same period — the "multiple links"
        complaint the staff side had to fix (0096, 0091). CLOSED ones are not
        counted: being appraised again next period is the ordinary case
        (FIX-43), and a binned round is not a round.

        Re-checked here rather than trusted from the dialog. §9, and the action
        takes whatever payload it is given. -- */
  const { data: liveElsewhere } = await supabase
    .from("worker_evaluations")
    .select("worker_id, cycle_id, status")
    .in("worker_id", eligible.map((p) => p.id))
    .neq("cycle_id", cycleId)
    .neq("status", "CLOSED")
    .is("excluded_at", null);

  const liveCycleIds = [...new Set((liveElsewhere ?? []).map((r) => r.cycle_id))];
  const { data: liveCycles } = liveCycleIds.length
    ? await supabase
        .from("worker_cycles")
        .select("id, name")
        .in("id", liveCycleIds)
        .is("deleted_at", null)
    : { data: [] };

  const liveNames = new Map((liveCycles ?? []).map((c) => [c.id, c.name]));
  const busy = eligible
    .map((p) => {
      const row = (liveElsewhere ?? []).find(
        (r) => r.worker_id === p.id && liveNames.has(r.cycle_id),
      );
      return row ? `${p.full_name} (${liveNames.get(row.cycle_id)})` : null;
    })
    .filter((v): v is string => v !== null);

  if (busy.length > 0) {
    return fail(
      "ALREADY_IN_A_ROUND",
      `${busy.join(", ")} ${busy.length === 1 ? "is" : "are"} already being appraised in another round that is still open. Finish or bin it before starting a second one for them.`,
    );
  }

  const reviewsThemselves = eligible.filter((p) => reviewerOf.get(p.id) === p.id);
  if (reviewsThemselves.length > 0) {
    return fail(
      "REVIEWER_IS_WORKER",
      `${reviewsThemselves.map((p) => p.full_name).join(", ")} would be reviewing their own appraisal.`,
    );
  }

  /* -- Who was opened, so the raters can be told. Collected in the loop rather
        than re-queried afterwards: a second read would have to work out which
        rows are new, and a re-run would then message people twice. -- */
  const openedRows: Array<{ evaluationId: string; raterId: string; workerName: string }> = [];
  let opened = 0;
  // Told apart, because they mean opposite things: a duplicate is an
  // idempotent re-run, anything else is a launch that did not happen.
  let duplicates = 0;
  const failures: string[] = [];

  for (const person of eligible) {
    const { data: evaluation, error: evalError } = await supabase
      .from("worker_evaluations")
      .insert({
        cycle_id: cycleId,
        worker_id: person.id,
        supervisor_id: supervisorOf.get(person.id) ?? null,
        reviewer_id: reviewerOf.get(person.id) ?? null,
        department_id: person.department_id,
        status: "OPEN",
      })
      .select("id")
      .single();

    /* -- A duplicate means this person was opened by an earlier run. Skip
          rather than fail: the launch is idempotent by design.

          EVERY OTHER FAILURE USED TO BE SKIPPED TOO, and that is a different
          thing entirely. A policy refusal, a missing department, a constraint
          — all of them fell into this `continue`, the loop finished, the cycle
          was marked ACTIVE and the action returned success. A launch that
          opened NOBODY reported that it had worked, and HR was left with a
          live round containing no workers and no explanation.

          23505 is the unique violation, and it is the only one that is
          genuinely a re-run rather than a fault. -- */
    if (evalError || !evaluation) {
      const code = (evalError as { code?: string } | null)?.code;
      if (code === "23505") {
        duplicates += 1;
      } else if (evalError) {
        failures.push(`${person.full_name}: ${evalError.message}`);
      }
      continue;
    }

    await supabase.from("worker_evaluation_questions").insert(
      questions.map((q, index) => ({
        evaluation_id: evaluation.id,
        question_id: q.id,
        text: q.text,
        help_text: q.help_text,
        // Renumbered sequentially so the frozen order is reproducible from
        // `order by sort_order` alone (P3-3).
        sort_order: (index + 1) * 10,
        is_required: q.is_required,
        is_overall: q.is_overall,
      })),
    );

    /* -- ONE response row. The supervisor fills the sheet; the worker does not.
          At the owner's instruction, and it matches the paper form: the tick
          sheet has one column of ticks and a Supervisor Signature under it.

          `self_skipped` rather than a new column. It already means "this layer
          is not being collected, do not wait for it" — 0047 gave it to HR for
          advancing past a missing side, and a worker round simply never
          collects one. Everything downstream then works unchanged:
          `submit_worker_layer` treats a skipped layer as in, so the supervisor
          submitting moves the record straight to PENDING_REVIEW. -- */
    await supabase
      .from("worker_evaluation_responses")
      .insert([{ evaluation_id: evaluation.id, layer: "SUPERVISOR" }]);

    await supabase
      .from("worker_evaluations")
      .update({ self_skipped: true })
      .eq("id", evaluation.id);

    await supabase.rpc("log_admin_action", {
      p_entity: "worker_evaluation",
      p_entity_id: evaluation.id,
      p_action: "worker_evaluation.opened",
      p_diff: { cycle_id: cycleId } as Json,
    });

    const raterId = supervisorOf.get(person.id);
    if (raterId) {
      openedRows.push({
        evaluationId: evaluation.id,
        raterId,
        workerName: person.full_name,
      });
    }

    opened += 1;
  }

  /* -- Refuse to open a round that opened nobody.

        The cycle stays DRAFT so HR can fix the cause and launch again, rather
        than being left with an ACTIVE round holding no workers — which cannot
        be launched a second time (`ALREADY_LAUNCHED`) and so is a dead end
        (§13.4). `duplicates` is what keeps a genuine interrupted re-run
        working: it opened nobody NEW and that is correct. -- */
  if (opened === 0 && duplicates === 0) {
    return fail(
      "NONE_OPENED",
      failures.length > 0
        ? `Nobody was opened for this round. ${failures[0]}`
        : "Nobody was opened for this round. Check that the people you chose are active shop-floor workers.",
    );
  }

  await supabase.from("worker_cycles").update({ status: "ACTIVE" }).eq("id", cycleId);

  await supabase.rpc("log_admin_action", {
    p_entity: "worker_cycle",
    p_entity_id: cycleId,
    p_action: "worker_cycle.launched",
    p_diff: { opened } as Json,
  });

  /* -- AFTER THE COMMIT, and it cannot throw (PW-2). The round is durable and
        audited by this point; a provider outage or a team leader with no phone
        must never turn a launched round into a reported failure. -- */
  await notifyWorkerRoundOpened({
    cycleName: cycle.name,
    periodLabel: cycle.period_label,
    dueOn: cycle.supervisor_due_on,
    opened: openedRows,
  });

  revalidate(cycleId);
  return { ok: true, data: { opened } };
}

/* ====================================================== addWorkersToRound == */

/**
 * Add somebody to a round that is already running.
 *
 * There was no way to do this at all: `launchWorkerCycle` refuses any cycle
 * that is not DRAFT, and nothing else inserted into `worker_evaluations`. So a
 * worker who joined after a round opened, or who HR simply missed, could not be
 * appraised in it — the only remedy was a whole new round, which is a different
 * period and a different sheet.
 *
 * WHICH QUESTIONS THEY GET IS THE ONE REAL DECISION HERE, and it is §5's.
 *
 * The obvious implementation reads the live `worker_questions` bank, which is
 * what `launchWorkerCycle` does — correct at launch, wrong here. HR may have
 * edited the form since this round opened, and §5's snapshot rule exists so
 * that editing the bank can never change what somebody was asked. A latecomer
 * frozen against a newer sheet would be appraised on different questions from
 * everybody beside them, and the round would no longer be one comparable
 * exercise.
 *
 * So the sheet is copied from a PEER: the frozen rows of an evaluation already
 * in this cycle. The bank is used only when the cycle somehow holds none, which
 * cannot happen for a round that launched.
 */
export async function addWorkersToRound(
  cycleId: string,
  assignments: WorkerAssignment[],
): Promise<WorkerResult<{ added: number }>> {
  const auth = await guard();
  if (!auth.ok) return fail(auth.error.code, auth.error.message);
  if (assignments.length === 0) return fail("NO_PARTICIPANTS", "Choose at least one worker.");

  const supervisorOf = new Map(assignments.map((a) => [a.workerId, a.supervisorId]));
  const reviewerOf = new Map(assignments.map((a) => [a.workerId, a.reviewerId]));
  const supabase = await createClient();

  const { data: cycle } = await supabase
    .from("worker_cycles")
    .select("id, name, period_label, status, supervisor_due_on")
    .eq("id", cycleId)
    .maybeSingle();

  if (!cycle) return fail("NOT_FOUND", "That round no longer exists.");

  // DRAFT belongs to launch, and a finished round is finished. Named rather
  // than silently doing nothing (§13.4).
  if (cycle.status === "DRAFT") {
    return fail("NOT_LAUNCHED", "This round has not been launched yet — use Start a round instead.");
  }
  if (cycle.status !== "ACTIVE") {
    return fail("NOT_ACTIVE", "This round is closed, so nobody can be added to it.");
  }

  /* -- The peer's frozen sheet. See the note above. -- */
  const { data: peer } = await supabase
    .from("worker_evaluations")
    .select("id")
    .eq("cycle_id", cycleId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let sheet: Array<{
    question_id: string;
    text: string;
    help_text: string | null;
    sort_order: number;
    is_required: boolean;
    is_overall: boolean;
  }> = [];

  if (peer) {
    const { data: frozen } = await supabase
      .from("worker_evaluation_questions")
      .select("question_id, text, help_text, sort_order, is_required, is_overall")
      .eq("evaluation_id", peer.id)
      .order("sort_order");
    sheet = frozen ?? [];
  }

  if (sheet.length === 0) {
    const { data: questions } = await supabase
      .from("worker_questions")
      .select("id, text, help_text, sort_order, is_required, is_overall")
      .eq("is_active", true)
      .order("sort_order");
    sheet = (questions ?? []).map((q, index) => ({
      question_id: q.id,
      text: q.text,
      help_text: q.help_text,
      sort_order: (index + 1) * 10,
      is_required: q.is_required,
      is_overall: q.is_overall,
    }));
  }

  if (sheet.length === 0) {
    return fail("NO_QUESTIONS", "The worker form has no questions on it.");
  }

  /* -- Same eligibility rules as the launch, for the same reasons. §5's module
        boundary is the `track` filter; the two refusals below are PR-8's. -- */
  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, department_id, track, is_active")
    .in("id", assignments.map((a) => a.workerId))
    .eq("track", "WORKER")
    .eq("is_active", true);

  const eligible = people ?? [];
  if (eligible.length === 0) {
    return fail("NO_ELIGIBLE", "None of those people are active shop-floor workers.");
  }

  const unsupervised = eligible.filter((p) => !supervisorOf.get(p.id));
  if (unsupervised.length > 0) {
    return fail(
      "NO_SUPERVISOR",
      `${unsupervised.map((p) => p.full_name).join(", ")} ${
        unsupervised.length === 1 ? "has" : "have"
      } nobody chosen to rate them.`,
    );
  }

  const selfLed = eligible.filter((p) => supervisorOf.get(p.id) === p.id);
  if (selfLed.length > 0) {
    return fail(
      "SELF_SUPERVISED",
      `${selfLed.map((p) => p.full_name).join(", ")} supervises themselves, so they would fill and see both sides.`,
    );
  }

  /* -- 0100: the reviewer is a SECOND pair of eyes, so they cannot be the
        person whose ticks they are reviewing, and they cannot be the worker.
        Either would collapse the two steps into one and leave nothing for the
        review to be a review OF — the same objection AMEND-2 makes about HR
        approving their own proposal. -- */
  /* -- The review step is not optional (0100 as amended). Refused by name,
        rather than launched and discovered when the first sheet lands on HR's
        desk with none of the three fields on it. -- */
  const unreviewed = eligible.filter((p) => !reviewerOf.get(p.id));
  if (unreviewed.length > 0) {
    return fail(
      "NO_REVIEWER",
      `${unreviewed.map((p) => p.full_name).join(", ")} ${
        unreviewed.length === 1 ? "has" : "have"
      } nobody chosen to review the ratings and decide the increment. Pick a supervisor for each, or grant somebody the Supervisor access level on Settings › Users.`,
    );
  }

  /* -- THE REVIEWER MUST HOLD THE SUPERVISOR ACCESS LEVEL, and that replaces
        an earlier "they cannot also be the rater".

        The old rule was a second-pair-of-eyes argument and it produced a dead
        end on a small floor: where the team leader IS the only supervisor,
        nobody could be chosen and the round could not launch. The owner named
        that case directly — "for some employees rated by means reports to
        assign is supervisor means supervisor will rate them and take increment
        decision also" — so one person doing both is a fact about the size of
        the team rather than a mistake to prevent. They still do both STEPS:
        rate, submit, then review and recommend, so the three fields live in
        one place whoever filled them.

        What must still be true is that the pay recommendation is made by
        somebody the company has given that standing to, and that is a role.
        Re-checked here rather than trusted from the dialog — §9, and the
        action is callable with any payload. -- */
  const namedReviewers = [
    ...new Set(
      eligible.map((p) => reviewerOf.get(p.id)).filter((id): id is string => Boolean(id)),
    ),
  ];

  const { data: supervisorGrants } = namedReviewers.length
    ? await supabase
        .from("user_roles")
        .select("profile_id")
        .eq("role", "SUPERVISOR")
        .in("profile_id", namedReviewers)
    : { data: [] };

  const holdsSupervisor = new Set((supervisorGrants ?? []).map((r) => r.profile_id));
  const notSupervisors = eligible.filter((p) => {
    const id = reviewerOf.get(p.id);
    return Boolean(id) && !holdsSupervisor.has(id as string);
  });

  if (notSupervisors.length > 0) {
    return fail(
      "REVIEWER_NOT_SUPERVISOR",
      `${notSupervisors.map((p) => p.full_name).join(", ")}: the person chosen to review and decide the increment does not hold the Supervisor access level. Grant it on Settings › Users, or pick somebody who has it.`,
    );
  }

  /* -- NOBODY WITH A LIVE APPRAISAL ELSEWHERE.
        Two open sheets for one worker means their team leader is handed two
        forms for the same person in the same period — the "multiple links"
        complaint the staff side had to fix (0096, 0091). CLOSED ones are not
        counted: being appraised again next period is the ordinary case
        (FIX-43), and a binned round is not a round.

        Re-checked here rather than trusted from the dialog. §9, and the action
        takes whatever payload it is given. -- */
  const { data: liveElsewhere } = await supabase
    .from("worker_evaluations")
    .select("worker_id, cycle_id, status")
    .in("worker_id", eligible.map((p) => p.id))
    .neq("cycle_id", cycleId)
    .neq("status", "CLOSED")
    .is("excluded_at", null);

  const liveCycleIds = [...new Set((liveElsewhere ?? []).map((r) => r.cycle_id))];
  const { data: liveCycles } = liveCycleIds.length
    ? await supabase
        .from("worker_cycles")
        .select("id, name")
        .in("id", liveCycleIds)
        .is("deleted_at", null)
    : { data: [] };

  const liveNames = new Map((liveCycles ?? []).map((c) => [c.id, c.name]));
  const busy = eligible
    .map((p) => {
      const row = (liveElsewhere ?? []).find(
        (r) => r.worker_id === p.id && liveNames.has(r.cycle_id),
      );
      return row ? `${p.full_name} (${liveNames.get(row.cycle_id)})` : null;
    })
    .filter((v): v is string => v !== null);

  if (busy.length > 0) {
    return fail(
      "ALREADY_IN_A_ROUND",
      `${busy.join(", ")} ${busy.length === 1 ? "is" : "are"} already being appraised in another round that is still open. Finish or bin it before starting a second one for them.`,
    );
  }

  const reviewsThemselves = eligible.filter((p) => reviewerOf.get(p.id) === p.id);
  if (reviewsThemselves.length > 0) {
    return fail(
      "REVIEWER_IS_WORKER",
      `${reviewsThemselves.map((p) => p.full_name).join(", ")} would be reviewing their own appraisal.`,
    );
  }

  // Same as the launch: told, rather than left to notice.
  const addedRows: Array<{ evaluationId: string; raterId: string; workerName: string }> = [];
  let added = 0;
  let already = 0;
  const failures: string[] = [];

  for (const person of eligible) {
    const { data: evaluation, error: evalError } = await supabase
      .from("worker_evaluations")
      .insert({
        cycle_id: cycleId,
        worker_id: person.id,
        supervisor_id: supervisorOf.get(person.id) ?? null,
        reviewer_id: reviewerOf.get(person.id) ?? null,
        department_id: person.department_id,
        status: "OPEN",
      })
      .select("id")
      .single();

    if (evalError || !evaluation) {
      // 23505 is the (cycle_id, worker_id) unique — they are already in this
      // round, which is not a fault. Everything else is (F15-16).
      if ((evalError as { code?: string } | null)?.code === "23505") already += 1;
      else if (evalError) failures.push(`${person.full_name}: ${evalError.message}`);
      continue;
    }

    await supabase.from("worker_evaluation_questions").insert(
      sheet.map((q) => ({ ...q, evaluation_id: evaluation.id })),
    );

    // One response row, and `self_skipped` — the same shape the launch writes,
    // because a worker round collects the supervisor's side only.
    await supabase
      .from("worker_evaluation_responses")
      .insert([{ evaluation_id: evaluation.id, layer: "SUPERVISOR" }]);

    await supabase
      .from("worker_evaluations")
      .update({ self_skipped: true })
      .eq("id", evaluation.id);

    await supabase.rpc("log_admin_action", {
      p_entity: "worker_evaluation",
      p_entity_id: evaluation.id,
      p_action: "worker_evaluation.added_to_round",
      p_diff: { cycle_id: cycleId, added_after_launch: true } as Json,
    });

    const raterId = supervisorOf.get(person.id);
    if (raterId) {
      addedRows.push({
        evaluationId: evaluation.id,
        raterId,
        workerName: person.full_name,
      });
    }

    added += 1;
  }

  if (added === 0) {
    return fail(
      already > 0 ? "ALREADY_IN" : "NONE_ADDED",
      already > 0
        ? "Everybody you chose is already in this round."
        : failures[0] ?? "Nobody could be added to this round.",
    );
  }

  // After the commit, and it cannot throw (PW-2).
  await notifyWorkerRoundOpened({
    cycleName: cycle.name,
    periodLabel: cycle.period_label,
    dueOn: cycle.supervisor_due_on,
    opened: addedRows,
  });

  revalidate(cycleId);
  return { ok: true, data: { added } };
}

/* ================================================ bin · restore · destroy == */

/*
 * §7's ISOLATION RULE again: these mirror `moveCycleToBin`,
 * `restoreCycleFromBin` and `deleteCycleForever` in `lib/cycles/actions.ts`
 * rather than being shared with them. The two modules agree today and are free
 * to diverge — binding them together would make a change to a staff cycle
 * silently a change to a shop-floor round.
 *
 * `worker_cycles.deleted_at` has existed since 0047 and NOTHING has ever
 * written it: there was no way to bin, restore or delete a worker round from
 * the product at all. A column with no path to it is a promise the interface
 * does not keep.
 */

export async function moveWorkerRoundToBin(
  cycleId: string,
  reason?: string,
): Promise<WorkerResult<{ id: string }>> {
  const auth = await guard();
  if (!auth.ok) return fail(auth.error.code, auth.error.message);

  const supabase = await createClient();

  const { data: cycle } = await supabase
    .from("worker_cycles")
    .select("id, name, status, deleted_at")
    .eq("id", cycleId)
    .maybeSingle();

  if (!cycle) return fail("NOT_FOUND", "That round no longer exists.");
  if (cycle.deleted_at) return fail("ALREADY_BINNED", "That round is already in the recycle bin.");

  const { error } = await supabase
    .from("worker_cycles")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", cycleId);

  if (error) return fail("QUERY_FAILED", error.message);

  await supabase.rpc("log_admin_action", {
    p_entity: "worker_cycle",
    p_entity_id: cycleId,
    p_action: "worker_cycle.binned",
    p_diff: { name: cycle.name, status: cycle.status, reason: reason ?? null } as Json,
  });

  revalidate(cycleId);
  return { ok: true, data: { id: cycleId } };
}

export async function restoreWorkerRound(cycleId: string): Promise<WorkerResult<{ id: string }>> {
  const auth = await guard();
  if (!auth.ok) return fail(auth.error.code, auth.error.message);

  const supabase = await createClient();

  const { data: cycle } = await supabase
    .from("worker_cycles")
    .select("id, name, deleted_at")
    .eq("id", cycleId)
    .maybeSingle();

  if (!cycle) return fail("NOT_FOUND", "That round no longer exists.");
  if (!cycle.deleted_at) return fail("NOT_BINNED", "That round is not in the recycle bin.");

  const { error } = await supabase
    .from("worker_cycles")
    .update({ deleted_at: null })
    .eq("id", cycleId);

  if (error) return fail("QUERY_FAILED", error.message);

  await supabase.rpc("log_admin_action", {
    p_entity: "worker_cycle",
    p_entity_id: cycleId,
    p_action: "worker_cycle.restored",
    p_diff: { name: cycle.name } as Json,
  });

  revalidate(cycleId);
  return { ok: true, data: { id: cycleId } };
}

/**
 * Destroy a round for good.
 *
 * TWO GATES, and they are the staff ones for the staff reasons.
 *
 * It must be binned first, so an irreversible act is never one click from an
 * ordinary one. And it must be DRAFT: a launched round cascades to every frozen
 * sheet and every tick in it (0047), and §5's snapshot rule is what makes an
 * appraisal a record rather than a screenshot of a form that has since changed.
 *
 * A launched round therefore stays in the bin, where it is invisible and costs
 * nothing. Clearing one out is an operator action with a database script behind
 * it, deliberately outside the product — see supabase/RESET-CYCLES-AND-PAY-ARMED.sql.
 */
export async function deleteWorkerRoundForever(
  cycleId: string,
): Promise<WorkerResult<{ id: string }>> {
  const auth = await guard();
  if (!auth.ok) return fail(auth.error.code, auth.error.message);

  const supabase = await createClient();

  const { data: cycle } = await supabase
    .from("worker_cycles")
    .select("id, name, period_label, status, deleted_at")
    .eq("id", cycleId)
    .maybeSingle();

  if (!cycle) return fail("NOT_FOUND", "That round no longer exists.");

  if (!cycle.deleted_at) {
    return fail(
      "NOT_BINNED",
      "Move it to the recycle bin first. Deleting for good is a second, separate step.",
    );
  }

  if (cycle.status !== "DRAFT") {
    return fail(
      "LAUNCHED",
      `${cycle.name} was launched, so it holds the frozen sheet and the ticks of everyone in it. Those cannot be destroyed — it stays in the recycle bin, where it takes up nothing and can be restored.`,
    );
  }

  // Logged BEFORE the row goes: `audit_log.entity_id` carries no foreign key,
  // so the record outlives what it describes and is the only remaining evidence
  // that this round existed.
  await supabase.rpc("log_admin_action", {
    p_entity: "worker_cycle",
    p_entity_id: cycleId,
    p_action: "worker_cycle.deleted_forever",
    p_diff: { name: cycle.name, period_label: cycle.period_label, status: cycle.status } as Json,
  });

  const { error } = await supabase.from("worker_cycles").delete().eq("id", cycleId);
  if (error) return fail("DELETE_REFUSED", error.message);

  revalidate(cycleId);
  return { ok: true, data: { id: cycleId } };
}

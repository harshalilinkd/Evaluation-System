"use server";

/** Worker appraisal cycles. HR-guarded (§9), audited (§12), isolated from staff (§7). */

import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
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
};

export async function launchWorkerCycle(
  cycleId: string,
  assignments: WorkerAssignment[],
): Promise<WorkerResult<{ opened: number }>> {
  const auth = await guard();
  if (!auth.ok) return fail(auth.error.code, auth.error.message);
  if (assignments.length === 0) return fail("NO_PARTICIPANTS", "Add at least one worker first.");

  const supervisorOf = new Map(assignments.map((a) => [a.workerId, a.supervisorId]));
  const workerIds = assignments.map((a) => a.workerId);

  const supabase = await createClient();

  const { data: cycle } = await supabase
    .from("worker_cycles")
    .select("id, status, self_due_on, supervisor_due_on")
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

  revalidate(cycleId);
  return { ok: true, data: { opened } };
}

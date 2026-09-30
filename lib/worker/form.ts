"use server";

/** One worker appraisal sheet: reading it, saving it, submitting it. §7-isolated. */

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

/*
 * §7: nothing here calls a staff function. `getEvaluationForm`, `buildZodSchema`
 * and `computeScores` are all for the 0-5 form and none of them is reachable
 * from this file — a tick sheet has no sections, no department merge and no
 * mean.
 */

export type WorkerTick = "EXCELLENT" | "SATISFACTORY" | "NEEDS_IMPROVEMENT";

export type WorkerSheetQuestion = {
  questionId: string;
  text: string;
  helpText: string | null;
  isRequired: boolean;
  isOverall: boolean;
};

export type WorkerSheet = {
  evaluationId: string;
  /* -- The paper form's metadata band.
        Read from `profiles` and the evaluation, never asked as questions
        (P2-9): a field somebody can type into is a field that can disagree with
        the record it was drawn from. -- */
  department: string | null;
  designation: string | null;
  /* -- Enough to know WHO is being rated. A name alone identifies nobody on a
        floor with two people of similar names, and it says nothing about how
        long they have been doing the job — which is the context a rating is
        made against. -- */
  employeeCode: string | null;
  dateOfJoining: string | null;
  supervisorName: string | null;
  /** Which side the VIEWER is on. Decided here, never sent by the browser. */
  layer: "SELF" | "SUPERVISOR";
  workerName: string;
  cycleName: string;
  periodLabel: string;
  dueOn: string | null;
  questions: WorkerSheetQuestion[];
  answers: Record<string, WorkerTick>;
  /* -- 0100: a DIFFERENT person reviews these ticks. The three fields below
        belong to them and are not on this sheet at all — the team leader rates
        and nothing else. -- */
  hasReviewer: boolean;
  /* -- 0101: the rater IS the supervisor, at the owner's instruction. They
        rate AND decide, on this one form, in one press. The three fields are
        here, and they are stored in `worker_evaluation_decisions` — the same
        place a separate supervisor stores them — rather than in the legacy
        columns, so the percentage can be read back. -- */
  alsoDecides: boolean;
  /** Paper form: "Supervisor Comment". Only when there is no reviewer. */
  overallComment: string;
  /** Paper form: "Training Required Yes/No". Supervisor layer only. */
  trainingRequired: boolean | null;
  /* -- The salary block. SUPERVISOR AND ADMINS ONLY — null on a worker's own
        sheet, because no policy admits them to that row and there is nothing to
        read (0051). Not "hidden": absent. -- */
  salary: {
    salaryChanged: boolean | null;
    oldCtc: number | null;
    incrementPct: number | null;
    newCtc: number | null;
  } | null;
  isSubmitted: boolean;
  /** Open for writing: the record is OPEN and this layer is neither in nor skipped. */
  isOpen: boolean;
  /* For the progress tracker — where the appraisal has got to since. */
  status: string;
  reviewerName: string | null;
  ratedAt: string | null;
  reviewedAt: string | null;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

function fail(code: string, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

/**
 * The sheet for whoever is asking.
 *
 * THE LAYER IS DERIVED FROM WHO THEY ARE, never passed in. A parameter would be
 * a request to read the other side, and RLS would refuse it — but the refusal
 * would arrive as an empty form rather than as a clear "not yours", and the
 * parameter would sit there inviting somebody to try (P6-11's reasoning).
 */
export async function getWorkerSheet(evaluationId: string): Promise<Result<WorkerSheet>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("NOT_AUTHENTICATED", "Please sign in again.");

  const supabase = await createClient();

  const { data: evaluation } = await supabase
    .from("worker_evaluations")
    .select(
      "id, cycle_id, worker_id, supervisor_id, reviewer_id, status, self_submitted_at, supervisor_submitted_at, reviewer_submitted_at, self_skipped, supervisor_skipped",
    )
    .eq("id", evaluationId)
    .maybeSingle();

  // RLS already hides an appraisal this person has nothing to do with, so a
  // missing row and a forbidden one are indistinguishable — deliberately.
  if (!evaluation) return fail("NOT_FOUND", "That appraisal is not available to you.");

  const layer: "SELF" | "SUPERVISOR" =
    evaluation.worker_id === profile.id
      ? "SELF"
      : evaluation.supervisor_id === profile.id
        ? "SUPERVISOR"
        : "SELF";

  /* -- HR and the MD can open the row but fill neither side. Rather than
        showing them a form they must not write, this refuses and points them at
        the report. -- */
  if (evaluation.worker_id !== profile.id && evaluation.supervisor_id !== profile.id) {
    return fail("NOT_A_RATER", "This sheet belongs to the worker and their supervisor.");
  }

  const [{ data: cycle }, { data: worker }, { data: snapshot }, { data: response }] =
    await Promise.all([
      supabase
        .from("worker_cycles")
        .select("name, period_label, self_due_on, supervisor_due_on")
        .eq("id", evaluation.cycle_id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("full_name, employee_code, designation, date_of_joining, departments(name)")
        .eq("id", evaluation.worker_id)
        .maybeSingle(),
      supabase
        .from("worker_evaluation_questions")
        .select("question_id, text, help_text, is_required, is_overall, sort_order")
        .eq("evaluation_id", evaluationId)
        .order("sort_order"),
      supabase
        .from("worker_evaluation_responses")
        .select("answers, submitted_at, overall_comment, training_required")
        .eq("evaluation_id", evaluationId)
        .eq("layer", layer)
        .maybeSingle(),
    ]);

  /* -- The OVERALL question is the supervisor's alone (§11): the worker's
        overall is the supervisor's tick, and a worker rating their own would
        produce a second figure with no defined meaning. Filtered out here so it
        is never rendered rather than rendered and ignored. -- */
  const rows = (snapshot ?? []).filter((q) => layer === "SUPERVISOR" || !q.is_overall);

  const submittedAt = response?.submitted_at ?? null;
  const skipped = layer === "SELF" ? evaluation.self_skipped : evaluation.supervisor_skipped;

  /* -- Read through the AUTHENTICATED client, so RLS decides. A worker gets
        nothing back here and the field is null for them — the screen is not
        making that decision, the policy is. -- */
  const separate =
    evaluation.reviewer_id !== null && evaluation.reviewer_id !== evaluation.supervisor_id;
  const alsoDecides =
    evaluation.reviewer_id !== null && evaluation.reviewer_id === evaluation.supervisor_id;
  /* -- The three fields are on this sheet unless somebody ELSE is going to
        fill them: a round with no reviewer at all (pre-0100, unchanged) and a
        rater who is also the supervisor (0101) both fill them here. -- */
  const hasReviewer = separate;

  /* -- Not queried at all once a supervisor owns the decision. Fetching it and
        choosing not to render it leaves the leak one careless line away; not
        fetching it keeps the figure out of the process (A3-8's reasoning). -- */
  /* -- 0101: through the FUNCTION for the combined case, never the table.
        `worker_evaluation_decisions` holds `old_ctc` and `new_ctc` and RLS is
        row-level, so a policy admitting them to their own recommendation would
        hand over the amounts with it. `worker_review_decision` names four
        columns and cannot return a fifth — which is also why the percentage
        can be read back here at all, and 0064's write-only path could not. -- */
  const { data: combinedRows } =
    layer === "SUPERVISOR" && alsoDecides
      ? await supabase.rpc("worker_review_decision", { p_evaluation_id: evaluationId })
      : { data: null };
  const combined = combinedRows?.[0] ?? null;

  const [{ data: decisions }, { data: employment }] =
    layer === "SUPERVISOR" && !hasReviewer && !alsoDecides
      ? await Promise.all([
          supabase
            .from("worker_evaluation_decisions")
            .select("salary_changed, old_ctc, increment_pct, new_ctc")
            .eq("evaluation_id", evaluationId)
            .maybeSingle(),
          /* -- Their salary on record, so "Old salary" arrives filled in.
                Retyping a figure the system already holds is how the two come
                to disagree — and the one that gets typed is the one somebody
                is guessing at. Read through the authenticated client, so 0051's
                policy decides whether this supervisor may see it at all. -- */
          supabase
            .from("employment_records")
            .select("current_ctc")
            .eq("profile_id", evaluation.worker_id)
            .maybeSingle(),
        ])
      : [{ data: null }, { data: null }];

  /* -- The team leader AND the supervisor who reviews them, in one trip. The
        supervisor's name is for the progress tracker; the profiles policy may
        not admit a team leader to a peer's row, and then it is simply null and
        the tracker says "Supervisor" — the read is not widened to get it. -- */
  const raterIds = [evaluation.supervisor_id, evaluation.reviewer_id].filter(
    (v): v is string => Boolean(v),
  );
  const { data: raterPeople } = raterIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", raterIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameOf = new Map((raterPeople ?? []).map((p) => [p.id, p.full_name]));
  const supervisor = evaluation.supervisor_id
    ? { full_name: nameOf.get(evaluation.supervisor_id) ?? null }
    : null;

  return {
    ok: true,
    data: {
      evaluationId,
      layer,
      workerName: worker?.full_name ?? "This worker",
      department: worker?.departments?.name ?? null,
      designation: worker?.designation ?? null,
      employeeCode: worker?.employee_code ?? null,
      dateOfJoining: worker?.date_of_joining ?? null,
      supervisorName: supervisor?.full_name ?? null,
      cycleName: cycle?.name ?? "",
      periodLabel: cycle?.period_label ?? "",
      dueOn: layer === "SELF" ? (cycle?.self_due_on ?? null) : (cycle?.supervisor_due_on ?? null),
      questions: rows.map((q) => ({
        questionId: q.question_id,
        text: q.text,
        helpText: q.help_text,
        isRequired: q.is_required,
        isOverall: q.is_overall,
      })),
      answers: (response?.answers ?? {}) as Record<string, WorkerTick>,
      hasReviewer,
      alsoDecides,
      /* -- TWO DIFFERENT COMMENTS, at the owner's instruction.
            With a separate supervisor this is the TEAM LEADER'S own comment,
            written beside the ticks they are making and stored on their own
            response row — theirs, and locked with the rest of their layer when
            they submit. The SUPERVISOR's comment is a different field on a
            different screen, filed with the salary decision they make.
            Where one person does both, there is one comment and it is the
            supervisor's, because that is the one HR reads beside the pay
            recommendation. -- */
      overallComment: hasReviewer
        ? (response?.overall_comment ?? "")
        : alsoDecides
          ? (combined?.supervisor_comment ?? "")
          : (response?.overall_comment ?? ""),
      /* -- The TEAM LEADER answers this too, at the owner's instruction —
            they are the one who sees whether somebody needs training. It is
            their RECOMMENDATION, on their own row; the supervisor's answer on
            the decisions row is the one HR reads, and it arrives prefilled with
            this. Not one control in two places (P8P-5): two stages of one
            decision, like the recommended percentage and the figure HR sets. -- */
      trainingRequired: alsoDecides
        ? (combined?.training_required ?? null)
        : (response?.training_required ?? null),
      salary:
        layer !== "SUPERVISOR" || hasReviewer
          ? null
          : alsoDecides
            ? {
                salaryChanged: combined?.salary_changed ?? null,
                /* -- No amount, ever. 0064 took the figures from supervisors
                      and 0100 kept it that way; the combined path recommends a
                      percentage exactly as the separate one does. -- */
                oldCtc: null,
                incrementPct: combined?.increment_pct ?? null,
                newCtc: null,
              }
            : {
                salaryChanged: decisions?.salary_changed ?? null,
                // What was recorded on this appraisal, else what they are on now.
                oldCtc: decisions?.old_ctc ?? employment?.current_ctc ?? null,
                incrementPct: decisions?.increment_pct ?? null,
                newCtc: decisions?.new_ctc ?? null,
              },
      isSubmitted: submittedAt !== null,
      isOpen: evaluation.status === "OPEN" && submittedAt === null && !skipped,
      status: evaluation.status,
      reviewerName: evaluation.reviewer_id
        ? (nameOf.get(evaluation.reviewer_id) ?? (hasReviewer ? "Supervisor" : null))
        : null,
      ratedAt: evaluation.supervisor_submitted_at,
      reviewedAt: evaluation.reviewer_submitted_at,
    },
  };
}

/**
 * Save a draft.
 *
 * A whole-object write rather than P12-4's patch merge, and the difference is
 * the form: eight ticks fit in one payload, and a tick is a single click that
 * cannot be half-typed. The ordering hazard a patch protects against — two
 * saves in flight, the older landing last and losing a keystroke — needs a
 * form somebody types into for twenty minutes.
 */
export async function saveWorkerSheet(
  evaluationId: string,
  answers: Record<string, WorkerTick>,
  /* -- Supervisor-only, and ignored on the SELF layer rather than rejected: the
        worker's sheet simply has no such fields, so a browser sending them is
        confused rather than malicious. -- */
  extras?: { overallComment?: string; trainingRequired?: boolean | null },
): Promise<Result<{ savedAt: string }>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("NOT_AUTHENTICATED", "Please sign in again.");

  const sheet = await getWorkerSheet(evaluationId);
  if (!sheet.ok) return sheet;
  if (!sheet.data.isOpen) {
    return fail("LOCKED", "This sheet is no longer open for changes.");
  }

  const supabase = await createClient();

  /* -- RLS is the real gate. `worker_responses_write` admits this row only if
        the caller owns this layer and the record is OPEN, so a forged
        `evaluationId` writes nothing rather than being caught here.

        WHICH IS ALSO HOW A REAL SAVE FAILED SILENTLY. A PostgREST `.update()`
        that matches ZERO rows is not an error — it succeeds, having done
        nothing. So when a policy refused the write, or the layer row was
        missing, or the record had moved on, this returned `ok: true` and the
        sheet printed "saved HH:MM" over answers that were never stored. That
        is the reported "worker appraisal not saving", and it is the worst shape
        a save bug can take: the screen states the opposite of what happened,
        so nobody reports it until the appraisal is opened later and is empty.

        `.select()` makes the update report what it touched. §0.7. -- */
  const { data: written, error } = await supabase
    .from("worker_evaluation_responses")
    .update({
      answers: answers as Json,
      /* -- The comment is written on EVERY supervisor-layer path, because on
            each of them somebody is writing one: the team leader's own where a
            supervisor reviews separately, and the decider's where they do not.

            IT WAS BEING DROPPED. 0100 excluded it whenever a reviewer existed,
            while the screen went on rendering the box — so a team leader typed
            a comment, saw "saved", and it went nowhere. Rendered-and-ignored is
            the worst of the three options (§0.7).

            `training_required` is NOT written here once a supervisor reviews:
            it is theirs, on their screen, filed with the salary decision. -- */
      ...(sheet.data.layer === "SUPERVISOR" && !sheet.data.alsoDecides
        ? {
            overall_comment: extras?.overallComment ?? null,
            training_required: extras?.trainingRequired ?? null,
          }
        : {}),
    })
    .eq("evaluation_id", evaluationId)
    .eq("layer", sheet.data.layer)
    .select("evaluation_id");

  if (error) return fail("SAVE_FAILED", error.message);

  if (!written || written.length === 0) {
    return fail(
      "NOT_WRITTEN",
      "Your ticks were not saved — this sheet is not open to you for changes. Reload the page; if it happens again, ask HR to check who is assigned to rate this worker.",
    );
  }

  return { ok: true, data: { savedAt: new Date().toISOString() } };
}

/**
 * Submit, and lock this side.
 *
 * The other side is not consulted and not reported on. Blind parallel rating
 * means a supervisor submitting learns nothing about whether the worker has,
 * and the reverse (§5).
 */
export async function submitWorkerSheet(
  evaluationId: string,
  answers: Record<string, WorkerTick>,
  extras?: { overallComment?: string; trainingRequired?: boolean | null },
): Promise<Result<{ ok: true }>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("NOT_AUTHENTICATED", "Please sign in again.");

  const sheet = await getWorkerSheet(evaluationId);
  if (!sheet.ok) return sheet;
  if (!sheet.data.isOpen) return fail("LOCKED", "This sheet has already been submitted.");

  /* -- Validated server-side against the FROZEN sheet, never against what the
        browser sent. Same rule as P12-7: the client's question list is not
        trusted any more than its answers. -- */
  const missing = sheet.data.questions.filter(
    (q) => q.isRequired && !answers[q.questionId],
  );
  if (missing.length > 0) {
    return fail(
      "INCOMPLETE",
      `${missing.length} ${missing.length === 1 ? "quality still needs" : "qualities still need"} a tick.`,
    );
  }

  const supabase = await createClient();

  /* -- The answers first, through RLS, by the person who gave them. -- */
  const { error: answersError } = await supabase
    .from("worker_evaluation_responses")
    .update({
      answers: answers as Json,
      /* -- The comment is written on EVERY supervisor-layer path, because on
            each of them somebody is writing one: the team leader's own where a
            supervisor reviews separately, and the decider's where they do not.

            IT WAS BEING DROPPED. 0100 excluded it whenever a reviewer existed,
            while the screen went on rendering the box — so a team leader typed
            a comment, saw "saved", and it went nowhere. Rendered-and-ignored is
            the worst of the three options (§0.7).

            `training_required` is NOT written here once a supervisor reviews:
            it is theirs, on their screen, filed with the salary decision. -- */
      ...(sheet.data.layer === "SUPERVISOR" && !sheet.data.alsoDecides
        ? {
            overall_comment: extras?.overallComment ?? null,
            training_required: extras?.trainingRequired ?? null,
          }
        : {}),
    })
    .eq("evaluation_id", evaluationId)
    .eq("layer", sheet.data.layer);

  if (answersError) return fail("SAVE_FAILED", answersError.message);

  /* -- THEN the submission itself, through 0052's function.
        This used to `update worker_evaluations` directly — which is HR-only
        (0047), so from a supervisor's session it matched no rows and returned
        no error. The answers saved; the fact that they had been SUBMITTED did
        not, and HR's board sat on "Not yet" for a sheet that was finished.

        The function also makes it atomic: the timestamp, §11's overall tick and
        the move to review were three round trips that could half-happen. -- */
  const { error: submitError } = await supabase.rpc("submit_worker_layer", {
    p_evaluation_id: evaluationId,
    p_layer: sheet.data.layer,
  });

  if (submitError) {
    return fail("SUBMIT_FAILED", submitError.message.replace(/^.*?:\s*/, "").trim() || submitError.message);
  }

  revalidatePath("/worker-appraisal");
  revalidatePath(`/worker-appraisal/${evaluationId}`);
  return { ok: true, data: { ok: true } };
}


/* ---------- The salary block ---------- */

export type WorkerSalaryInput = {
  salaryChanged: boolean | null;
  oldCtc: number | null;
  incrementPct: number | null;
  newCtc: number | null;
};

/**
 * Save the salary block on a worker's sheet.
 *
 * SEPARATE FROM `saveWorkerSheet`, deliberately. It writes a different table
 * with different policies, and folding it into the ratings save would mean one
 * call whose failure could be either "your ticks did not save" or "you may not
 * see salary" — two problems with nothing in common and different answers.
 *
 * §5 AS AMENDED BY 0051: the supervisor of that worker may write this while
 * their own sheet is unsubmitted, and HR and the MD at any time. The worker has
 * no policy on this table at all, so a forged call from their session writes
 * nothing — this function does not need to check that, and does not.
 */
export async function saveWorkerSalary(
  evaluationId: string,
  input: WorkerSalaryInput,
): Promise<Result<{ ok: true }>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("NOT_AUTHENTICATED", "Please sign in again.");

  /* -- A rise that lowers pay is a typo or a decision that should not be filed
        under that word. Caught here so it reads as a sentence; the CHECK
        constraint behind it is the backstop, not the message (P21-3). -- */
  if (
    input.salaryChanged &&
    input.oldCtc !== null &&
    input.newCtc !== null &&
    input.newCtc < input.oldCtc
  ) {
    return fail("LOWER", "The new salary is below the old one. Check the two figures.");
  }

  const supabase = await createClient();

  const { error } = await supabase.from("worker_evaluation_decisions").upsert(
    {
      evaluation_id: evaluationId,
      salary_changed: input.salaryChanged,
      // "Same" means no figures, not zeroes. A stored 0 would read as a salary.
      old_ctc: input.salaryChanged ? input.oldCtc : null,
      increment_pct: input.salaryChanged ? input.incrementPct : null,
      new_ctc: input.salaryChanged ? input.newCtc : null,
    },
    { onConflict: "evaluation_id" },
  );

  if (error) {
    return fail(
      "SAVE_FAILED",
      error.message.includes("row-level security")
        ? "You are not able to record salary on this appraisal."
        : error.message,
    );
  }

  return { ok: true, data: { ok: true } };
}

/* ---------- One form, where the rater is also the supervisor (0101) ---------- */

export type WorkerCombinedInput = {
  salaryChanged: boolean | null;
  incrementPct: number | null;
  comment: string;
  trainingRequired: boolean | null;
};

/**
 * Rate and decide in one press.
 *
 * At the owner's instruction: where the team leader IS the supervisor there is
 * no hand-over, so there is no second screen either. Everything commits in one
 * transaction inside `submit_worker_combined` — the decision, the layer lock,
 * §11's overall tick, both timestamps and two audit rows — because a
 * half-applied version of that is a record nobody can explain (P14-1).
 *
 * The required-tick check is the same one `submitWorkerSheet` runs, against the
 * FROZEN sheet rather than what the browser sent (P12-7). The other two rules
 * live in the function, in 0100's words, so this second route to HR cannot be
 * a laxer one than the first.
 */
export async function submitWorkerCombined(
  evaluationId: string,
  answers: Record<string, WorkerTick>,
  decision: WorkerCombinedInput,
): Promise<Result<{ ok: true }>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("NOT_AUTHENTICATED", "Please sign in again.");

  const sheet = await getWorkerSheet(evaluationId);
  if (!sheet.ok) return sheet;
  if (!sheet.data.isOpen) return fail("LOCKED", "This sheet has already been submitted.");
  if (!sheet.data.alsoDecides) {
    return fail("NOT_COMBINED", "This appraisal goes to a supervisor for review.");
  }

  const missing = sheet.data.questions.filter((q) => q.isRequired && !answers[q.questionId]);
  if (missing.length > 0) {
    return fail(
      "INCOMPLETE",
      `${missing.length} ${missing.length === 1 ? "quality still needs" : "qualities still need"} a tick.`,
    );
  }

  const supabase = await createClient();

  /* -- The ticks first, through RLS, by the person who gave them. The function
        below locks the layer but does not write the answers — same split as
        `submitWorkerSheet`, and for the same reason: the answers are written by
        the caller's own session so the policy decides. -- */
  const { error: answersError } = await supabase
    .from("worker_evaluation_responses")
    .update({ answers: answers as Json })
    .eq("evaluation_id", evaluationId)
    .eq("layer", "SUPERVISOR");

  if (answersError) return fail("SAVE_FAILED", answersError.message);

  const { error } = await supabase.rpc("submit_worker_combined", {
    p_evaluation_id: evaluationId,
    p_salary_changed: decision.salaryChanged,
    p_increment_pct: decision.salaryChanged ? decision.incrementPct : null,
    p_comment: decision.comment,
    p_training: decision.trainingRequired,
  });

  if (error) {
    return fail("SUBMIT_FAILED", error.message.replace(/^.*?:\s*/, "").trim() || error.message);
  }

  revalidatePath("/worker-appraisal");
  revalidatePath(`/worker-appraisal/${evaluationId}`);
  revalidatePath("/worker-team");
  return { ok: true, data: { ok: true } };
}

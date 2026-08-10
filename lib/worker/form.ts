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
  supervisorName: string | null;
  /** Which side the VIEWER is on. Decided here, never sent by the browser. */
  layer: "SELF" | "SUPERVISOR";
  workerName: string;
  cycleName: string;
  periodLabel: string;
  dueOn: string | null;
  questions: WorkerSheetQuestion[];
  answers: Record<string, WorkerTick>;
  /** Paper form: "Supervisor Comment". Supervisor layer only. */
  overallComment: string;
  /** Paper form: "Training Required Yes/No". Supervisor layer only. */
  trainingRequired: boolean | null;
  /* -- The salary block. SUPERVISOR AND ADMINS ONLY — null on a worker's own
        sheet, because no policy admits them to that row and there is nothing to
        read (0051). Not "hidden": absent. -- */
  salary: {
    salaryChanged: boolean;
    oldCtc: number | null;
    incrementPct: number | null;
    newCtc: number | null;
  } | null;
  isSubmitted: boolean;
  /** Open for writing: the record is OPEN and this layer is neither in nor skipped. */
  isOpen: boolean;
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
      "id, cycle_id, worker_id, supervisor_id, status, self_submitted_at, supervisor_submitted_at, self_skipped, supervisor_skipped",
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
        .select("full_name, designation, departments(name)")
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
  const [{ data: decisions }, { data: employment }] =
    layer === "SUPERVISOR"
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

  const { data: supervisor } = evaluation.supervisor_id
    ? await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", evaluation.supervisor_id)
        .maybeSingle()
    : { data: null };

  return {
    ok: true,
    data: {
      evaluationId,
      layer,
      workerName: worker?.full_name ?? "This worker",
      department: worker?.departments?.name ?? null,
      designation: worker?.designation ?? null,
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
      overallComment: response?.overall_comment ?? "",
      trainingRequired: response?.training_required ?? null,
      salary:
        layer === "SUPERVISOR"
          ? {
              salaryChanged: decisions?.salary_changed ?? false,
              // What was recorded on this appraisal, else what they are on now.
              oldCtc: decisions?.old_ctc ?? employment?.current_ctc ?? null,
              incrementPct: decisions?.increment_pct ?? null,
              newCtc: decisions?.new_ctc ?? null,
            }
          : null,
      isSubmitted: submittedAt !== null,
      isOpen: evaluation.status === "OPEN" && submittedAt === null && !skipped,
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
        `evaluationId` writes nothing rather than being caught here. -- */
  const { error } = await supabase
    .from("worker_evaluation_responses")
    .update({
      answers: answers as Json,
      ...(sheet.data.layer === "SUPERVISOR"
        ? {
            overall_comment: extras?.overallComment ?? null,
            training_required: extras?.trainingRequired ?? null,
          }
        : {}),
    })
    .eq("evaluation_id", evaluationId)
    .eq("layer", sheet.data.layer);

  if (error) return fail("SAVE_FAILED", error.message);

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
      ...(sheet.data.layer === "SUPERVISOR"
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
  salaryChanged: boolean;
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

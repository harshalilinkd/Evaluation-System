"use server";

/** The completed worker appraisal, both sides together. HR and the MD only. */

import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import type { WorkerTick } from "@/lib/worker/form";

export type WorkerReviewRow = {
  questionId: string;
  text: string;
  isOverall: boolean;
  /* -- ONE tick per quality. The supervisor fills the sheet and the worker does
        not, so there is no second column and nothing to compare — the
        difference-flagging this had was answering a question nobody asks of a
        one-sided form. -- */
  supervisor: WorkerTick | null;
};

export type WorkerReview = {
  evaluationId: string;
  workerName: string;
  department: string | null;
  designation: string | null;
  supervisorName: string | null;
  cycleName: string;
  periodLabel: string;
  status: string;
  rows: WorkerReviewRow[];
  supervisorComment: string;
  trainingRequired: boolean | null;
  overallTick: string | null;
  salary: {
    salaryChanged: boolean;
    oldCtc: number | null;
    incrementPct: number | null;
    newCtc: number | null;
  } | null;
  /**
   * What the employment record says they are on, for HR to start from.
   *
   * Read on HR's or the MD's session, so RLS is what permits it — this is the
   * auto-fill the SUPERVISOR was never able to do (0023 admits only HR and the
   * MD, so their copy of this query has always returned nothing, and the old
   * salary they used to type was recalled from memory).
   *
   * Null means there is no employment record. HR types the figure instead, and
   * the screen says which of the two it is rather than showing a blank box.
   */
  currentCtcOnRecord: number | null;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

/**
 * One completed worker appraisal.
 *
 * Guarded to HR and the MD, and read through the authenticated client so RLS
 * decides underneath the guard. The salary block is on this page and §5 confines
 * it to exactly these two roles — the page guard is the clean exit, the policy
 * is the protection (P16-9).
 */
export async function getWorkerReview(evaluationId: string): Promise<Result<WorkerReview>> {
  const auth = await checkRole(["HR_ADMIN", "MD"]);
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = await createClient();

  const { data: evaluation } = await supabase
    .from("worker_evaluations")
    .select(
      "id, cycle_id, worker_id, supervisor_id, status, overall_tick, supervisor_submitted_at",
    )
    .eq("id", evaluationId)
    .maybeSingle();

  if (!evaluation) return { ok: false, error: { code: "NOT_FOUND", message: "That appraisal no longer exists." } };

  const [{ data: cycle }, { data: people }, { data: snapshot }, { data: responses }, { data: decisions }] =
    await Promise.all([
      supabase
        .from("worker_cycles")
        .select("name, period_label")
        .eq("id", evaluation.cycle_id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("id, full_name, designation, departments(name)")
        .in("id", [evaluation.worker_id, evaluation.supervisor_id].filter((v): v is string => Boolean(v))),
      supabase
        .from("worker_evaluation_questions")
        .select("question_id, text, is_overall, sort_order")
        .eq("evaluation_id", evaluationId)
        .order("sort_order"),
      supabase
        .from("worker_evaluation_responses")
        .select("layer, answers, overall_comment, training_required")
        .eq("evaluation_id", evaluationId),
      supabase
        .from("worker_evaluation_decisions")
        .select("salary_changed, old_ctc, increment_pct, new_ctc")
        .eq("evaluation_id", evaluationId)
        .maybeSingle(),
    ]);

  /* -- The salary on record. Separate from the batch above because it is keyed
        by the WORKER's profile rather than by the evaluation, and it is only
        readable at all because this function runs on HR's or the MD's
        session. -- */
  const { data: employment } = await supabase
    .from("employment_records")
    .select("current_ctc")
    .eq("profile_id", evaluation.worker_id)
    .maybeSingle();

  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  const worker = byId.get(evaluation.worker_id);

  const supervisorRow = (responses ?? []).find((r) => r.layer === "SUPERVISOR");
  const supervisorAnswers = (supervisorRow?.answers ?? {}) as Record<string, WorkerTick>;

  return {
    ok: true,
    data: {
      evaluationId,
      workerName: worker?.full_name ?? "This worker",
      department: worker?.departments?.name ?? null,
      designation: worker?.designation ?? null,
      supervisorName: evaluation.supervisor_id
        ? (byId.get(evaluation.supervisor_id)?.full_name ?? null)
        : null,
      cycleName: cycle?.name ?? "",
      periodLabel: cycle?.period_label ?? "",
      status: evaluation.status,
      rows: (snapshot ?? []).map((q) => ({
        questionId: q.question_id,
        text: q.text,
        isOverall: q.is_overall,
        supervisor: supervisorAnswers[q.question_id] ?? null,
      })),
      supervisorComment: supervisorRow?.overall_comment ?? "",
      trainingRequired: supervisorRow?.training_required ?? null,
      overallTick: evaluation.overall_tick,
      currentCtcOnRecord: employment?.current_ctc ?? null,
      salary: decisions
        ? {
            salaryChanged: decisions.salary_changed,
            oldCtc: decisions.old_ctc,
            incrementPct: decisions.increment_pct,
            newCtc: decisions.new_ctc,
          }
        : null,
    },
  };
}

/**
 * Record HR's review, and either close it or pass it to the MD.
 *
 * TWO ENDINGS, ONE ACTION. The paper form carries three signatures —
 * supervisor, HR, MD — but not every appraisal needs the third: a sheet with no
 * pay change is HR's to finish, and one that proposes an increment is the
 * decision AMEND-2 restored a second pair of eyes for.
 *
 * NO NEW STATUS VALUE, and no migration. The enum already distinguishes them:
 * REVIEWED means HR is done and it is with the MD; CLOSED means it is finished.
 * Adding a WITH_MD would need `alter type` in its own transaction (AMEND-3 spent
 * a whole migration on that) to express something the two existing values
 * already say.
 */
export async function reviewWorkerAppraisal(
  evaluationId: string,
  remarks: string,
  /* -- What HR is doing, stated by them rather than inferred from whether a
        salary happens to be present. An appraisal with no pay change may still
        deserve the MD's eye, and one with a small correction may not. -- */
  outcome: "CLOSE" | "SEND_TO_MD" = "CLOSE",
): Promise<Result<{ ok: true }>> {
  const auth = await checkRole(["HR_ADMIN", "MD"]);
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = await createClient();

  const { data: evaluation } = await supabase
    .from("worker_evaluations")
    .select("id, status")
    .eq("id", evaluationId)
    .maybeSingle();

  if (!evaluation) return { ok: false, error: { code: "NOT_FOUND", message: "That appraisal no longer exists." } };

  /* -- Both sides have to be in. The board only offers this on a row that is
        ready, but a screen is not a guard (§9) and this action is reachable
        from any signed-in administrator's session. -- */
  /* -- WHERE IT MAY BE ACTED ON FROM.

        MANAGEMENT'S APPROVAL IS NOW REQUIRED TO CLOSE, at the owner's explicit
        instruction. CLOSE used to be reachable from PENDING_REVIEW as well, so
        HR could finish an appraisal alone and the MD never saw it. That was the
        right shape while a sheet with no pay change was HR's to finish; it is
        the wrong one now that every production appraisal carries a salary
        decision the supervisor recommended and HR priced (0064).

        So: PENDING_REVIEW is HR's, and their only move is to send it up.
        REVIEWED is management's, and closing is theirs alone. -- */
  const allowed = outcome === "CLOSE" ? ["REVIEWED"] : ["PENDING_REVIEW"];

  if (!allowed.includes(evaluation.status)) {
    return {
      ok: false,
      error: {
        code: "WRONG_STATUS",
        message:
          evaluation.status === "OPEN"
            ? "The supervisor has not submitted it yet."
            : evaluation.status === "CLOSED"
              ? "This appraisal is closed."
              : outcome === "CLOSE"
                // The case this rule creates, said plainly rather than as a
                // bare refusal: HR pressing Close on a sheet that has not been
                // sent up needs to know what to do instead (§13.4).
                ? "Send it to management first — an appraisal is closed by them, not by HR."
                : "This appraisal is already with management.",
      },
    };
  }

  /* -- And the ROLE, not only the status. §9: a screen is not a guard, and this
        action is reachable from any administrator's session — so without this
        HR could close a REVIEWED appraisal and the second pair of eyes would be
        a convention rather than a control. -- */
  if (outcome === "CLOSE" && !auth.session.roles.includes("MD")) {
    return {
      ok: false,
      error: {
        code: "NOT_PERMITTED",
        message: "Only management can approve and close a production appraisal.",
      },
    };
  }

  /* -- The remarks land on the DECISIONS row, not the evaluation.
        `worker_evaluations` is readable by the worker and their supervisor;
        management's remarks are neither's to read, and RLS cannot withhold a
        column (0050's reasoning, applied to the last field that needed it). -- */
  if (remarks.trim() !== "") {
    const { error: remarkError } = await supabase.from("worker_evaluation_decisions").upsert(
      {
        evaluation_id: evaluationId,
        md_remarks: remarks.trim(),
        decided_by: auth.session.profile.id,
        decided_at: new Date().toISOString(),
      },
      { onConflict: "evaluation_id" },
    );
    if (remarkError) {
      return { ok: false, error: { code: "SAVE_FAILED", message: remarkError.message } };
    }
  }

  const now = new Date().toISOString();
  const { data: moved, error } = await supabase
    .from("worker_evaluations")
    .update(
      outcome === "SEND_TO_MD"
        ? { status: "REVIEWED" }
        : { status: "CLOSED", md_reviewed_at: now, closed_at: now },
    )
    .eq("id", evaluationId)
    // Matched on the status we read, so two people acting at once cannot both
    // succeed — the second affects no rows rather than overwriting the first.
    .eq("status", evaluation.status)
    /* -- AND THAT OUTCOME IS NOW DETECTED. The guard above was correct and
          nothing looked at it: a zero-row update is a SUCCESS in PostgREST, so
          the second person was told their close had worked while the appraisal
          sat exactly where it was. The comment described the protection; this is
          what makes it reach the person it protects. -- */
    .select("id, status");

  if (error) return { ok: false, error: { code: "SAVE_FAILED", message: error.message } };

  if (!moved || moved.length === 0) {
    return {
      ok: false,
      error: {
        code: "ALREADY_MOVED",
        message:
          "Somebody else moved this appraisal on while you were reading it. Reload the page to see where it stands now.",
      },
    };
  }

  await supabase.rpc("log_admin_action", {
    p_entity: "worker_evaluation",
    p_entity_id: evaluationId,
    p_action: outcome === "SEND_TO_MD" ? "worker.sent_to_md" : "worker.closed",
    // §5: no figure in the diff. audit_log is readable by a lead for their own
    // reports (0013), so a salary there would walk past the confinement rule.
    p_diff: { remarks_recorded: remarks.trim() !== "" } as Json,
  });

  // The subtree, not just the list: the detail page is where this is read back.
  revalidatePath("/admin/worker-appraisals", "layout");
  return { ok: true, data: { ok: true } };
}

/* ==================================================== HR prices the sheet == */

/**
 * HR records what the worker is on and what they go to.
 *
 * The supervisor recommended a percentage and is shown no amount at all
 * (0064), so both figures here are HR's. `old_ctc` is seeded on their screen
 * from `employment_records` — the auto-fill the supervisor could never do,
 * because that table admits only HR and the MD.
 *
 * NOT A CLOSE, and not a send. This only records the figures; moving the
 * appraisal on stays `reviewWorkerAppraisal`, so a saved salary and a decision
 * are two separate acts rather than one button that quietly does both.
 *
 * 0064's trigger logs every change to either figure, before and after — which
 * is what answers "what did HR change after it came back" rather than only
 * "HR touched this".
 */
export async function saveWorkerSalaryAsHr(
  evaluationId: string,
  figures: { oldCtc: number | null; newCtc: number | null },
): Promise<Result<{ ok: true }>> {
  const auth = await checkRole(["HR_ADMIN", "MD"]);
  if (!auth.ok) return { ok: false, error: auth.error };

  const { oldCtc, newCtc } = figures;

  /* -- A rise that lowers pay is either a typo or a decision that should not be
        recorded under that label (P14-13). The table's own CHECK refuses it
        too; this is the sentence somebody can act on rather than a constraint
        violation. -- */
  if (oldCtc !== null && newCtc !== null && newCtc < oldCtc) {
    return {
      ok: false,
      error: {
        code: "BELOW_CURRENT",
        message: "The new salary is below the current one. Check both figures.",
      },
    };
  }

  const supabase = await createClient();

  /* -- `.select()`, so the write REPORTS WHAT IT TOUCHED.
        A PostgREST write that matches no row is not an error — it succeeds
        having done nothing, and the screen then says "Saved" over figures that
        were never stored. That is the exact shape of FIX-14, the worker sheet's
        own ratings (F15-14), 0066 and 0069, and it is the reported symptom here:
        HR types two figures, presses save, and the values are gone on the next
        screen that reads them. -- */
  const { data: written, error } = await supabase
    .from("worker_evaluation_decisions")
    .upsert(
      { evaluation_id: evaluationId, old_ctc: oldCtc, new_ctc: newCtc },
      { onConflict: "evaluation_id" },
    )
    .select("evaluation_id, old_ctc, new_ctc");

  if (error) return { ok: false, error: { code: "SAVE_FAILED", message: error.message } };

  if (!written || written.length === 0) {
    return {
      ok: false,
      error: {
        code: "NOT_WRITTEN",
        message:
          "The salary was not saved — the record did not accept the change. Reload the page and try again; if it keeps happening the appraisal may have been closed.",
      },
    };
  }

  /* -- BOTH paths, not just the list.
        Every other action in this module revalidates the list AND the specific
        round; this one revalidated only the list, so the detail page — the one
        the figures were typed on and are read back on — kept its cached render.
        A save that is durable and invisible is indistinguishable from one that
        failed. -- */
  revalidatePath("/admin/worker-appraisals", "layout");
  return { ok: true, data: { ok: true } };
}

/* ==================================================== the activity trail == */

export type WorkerActivity = {
  at: string;
  who: string;
  what: string;
  detail: string | null;
};

/**
 * What has happened to this appraisal, in words.
 *
 * The owner's requirement is explicit: "all actions, especially when a file is
 * bounced back to HR and modified, must be recorded in an activity log (e.g.
 * explicitly mentioning 'HR changed the new salary')."
 *
 * The rows were already being written — 0064 logs every salary change by
 * trigger, and every transition writes its own (§12) — and NOTHING RENDERED
 * THEM. A trail nobody can read is a trail that does not exist for the purpose
 * it was asked for.
 *
 * §5 note: no amount appears here, and none is available to. 0064's trigger
 * records WHICH figures moved and the percentage either side, never the rupee
 * values (P19-10) — audit diffs are read in places salary must not reach.
 */
export async function getWorkerActivity(evaluationId: string): Promise<WorkerActivity[]> {
  const auth = await checkRole(["HR_ADMIN", "MD"]);
  if (!auth.ok) return [];

  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("audit_log")
    .select("created_at, actor_id, action, from_status, to_status, reason, diff")
    .eq("entity", "worker_evaluation")
    .eq("entity_id", evaluationId)
    .order("created_at", { ascending: false });

  if (!rows || rows.length === 0) return [];

  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((v): v is string => Boolean(v)))];
  const { data: people } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));

  return rows.map((r) => {
    const diff = (r.diff ?? {}) as Record<string, unknown>;
    const changed = typeof diff.changed === "string" ? diff.changed : "";

    /* -- Said the way somebody reading it would say it. "worker_salary.changed"
          is what the database calls the event; "changed the new salary" is what
          happened, which is what the owner asked to see. -- */
    let what: string;
    let detail: string | null = r.reason ?? null;

    if (r.action === "worker_salary.changed") {
      const parts = [
        changed.includes("new_ctc") ? "the new salary" : null,
        changed.includes("old_ctc") ? "the current salary" : null,
        changed.includes("increment_pct") ? "the percentage" : null,
      ].filter(Boolean) as string[];
      what = parts.length > 0 ? `changed ${parts.join(" and ")}` : "changed the salary block";
      if (diff.pct_from !== diff.pct_to && diff.pct_to !== null && diff.pct_to !== undefined) {
        detail = `${diff.pct_from ?? "—"}% → ${diff.pct_to}%`;
      }
    } else if (r.action === "worker_evaluation.returned_to_hr") {
      what = "sent it back to HR";
    } else if (r.from_status && r.to_status) {
      what = `moved it from ${String(r.from_status).toLowerCase().replace(/_/g, " ")} to ${String(r.to_status).toLowerCase().replace(/_/g, " ")}`;
    } else {
      what = String(r.action).replace(/^worker_[a-z_]*\./, "").replace(/_/g, " ");
    }

    return {
      at: r.created_at,
      // A null actor is the system — the trigger that raises a status when both
      // sides are in has no person behind it and must not borrow one.
      who: r.actor_id ? (nameOf.get(r.actor_id) ?? "Somebody") : "The system",
      what,
      detail,
    };
  });
}

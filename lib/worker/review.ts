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
  /** What the TEAM LEADER wrote beside their ticks (0102). */
  raterComment: string;
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
  /**
   * The MD who approved, their mark and when — and ONLY once they have.
   *
   * The flow the owner set out: HR sends the form, the supervisor fills it and
   * proposes a percentage, HR passes the proposal to the MD, and the MD approves
   * or revises. The signature belongs to the last step and to no earlier one, so
   * this is null until the appraisal is CLOSED with an MD review recorded
   * against it. A sheet printed mid-flow shows a ruled line, exactly as it did
   * before — the same document either way, which is what stops an unfinished
   * record being made to look finished by printing it (P34-11).
   */
  mdApproval: { name: string; signature: string | null; at: string } | null;
  /**
   * When each stage happened, so the screen can say so rather than implying it.
   *
   * "All steps and stages should be transparent" was the ask, and the salary
   * card was the least transparent thing on the page: once the appraisal
   * closed it showed two bare figures with nothing to say who set them, when,
   * or that management had signed them off at all. Every one of these is
   * already on the evaluation row — they were simply never carried out of this
   * function.
   */
  stages: {
    supervisorSubmittedAt: string | null;
    mdReviewedAt: string | null;
    closedAt: string | null;
  };
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
      "id, cycle_id, worker_id, supervisor_id, status, overall_tick, supervisor_submitted_at, md_reviewed_at, closed_at",
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
        .select("salary_changed, old_ctc, increment_pct, new_ctc, decided_by, decided_at, supervisor_comment, training_required")
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

  /* -- THE MD'S APPROVAL, and only once it exists.

        Three things must all be true: the appraisal is CLOSED, an MD review is
        stamped on it, and somebody is recorded as having decided. Any one of
        them alone is not an approval — CLOSED can be reached by HR on a sheet
        with no pay change (W1-11), and a decisions row exists as soon as the
        supervisor records a percentage.

        Fetched separately because it is keyed on `decided_by`, which is not
        known until the row above has been read. A second trip on a page that is
        printed rather than typed into. -- */
  const approvedAt = evaluation.closed_at && evaluation.md_reviewed_at ? evaluation.md_reviewed_at : null;
  let mdApproval: WorkerReview["mdApproval"] = null;

  if (approvedAt && decisions?.decided_by) {
    const { data: md } = await supabase
      .from("profiles")
      .select("full_name, signature_image")
      .eq("id", decisions.decided_by)
      .maybeSingle();

    if (md) {
      mdApproval = {
        name: md.full_name,
        // Null is fine and stays null: the sheet then prints their NAME over a
        // ruled line, which is a record of who approved without claiming a
        // signature nobody uploaded.
        signature: md.signature_image,
        at: approvedAt,
      };
    }
  }

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
      /* -- 0100 moved both to the decisions row: the supervisor who writes
            them is not the person who ticked, and a response row locks on its
            own submission. The RESPONSE is read as a fallback, because every
            appraisal filed before 0100 has them there and nowhere else —
            dropping it would blank the comment on historic records rather than
            show it. -- */
      /* -- TWO COMMENTS NOW, and HR reads both.
            The team leader writes theirs beside the ticks; the supervisor
            writes theirs beside the salary decision. The fallback below is what
            keeps every appraisal filed before 0100 readable: there, one person
            wrote one comment and it is on the response row. -- */
      raterComment: supervisorRow?.overall_comment ?? "",
      supervisorComment:
        decisions?.supervisor_comment ?? (decisions ? "" : (supervisorRow?.overall_comment ?? "")),
      trainingRequired: decisions?.training_required ?? supervisorRow?.training_required ?? null,
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
      mdApproval,
      stages: {
        supervisorSubmittedAt: evaluation.supervisor_submitted_at,
        mdReviewedAt: evaluation.md_reviewed_at,
        closedAt: evaluation.closed_at,
      },
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

  /* -- AN UNPRICED RECOMMENDATION DOES NOT GO UP. This is the reported bug.

        The supervisor recommends a PERCENTAGE and is shown no amount at all
        (0064). HR turns it into money. Nothing was stopping HR skipping that
        step: the screen said "Needs a current salary and a percentage" and the
        Send button sat live beside it, so an 8% recommendation reached the MD
        with no figures on it — and the MD approved a pay rise whose amount
        nobody had ever written down. The card then read "HR priced it — Not
        priced" on every screen afterwards, which is what was reported as the
        figures having vanished. They had never been entered.

        Scoped to a sheet that actually recommends a change. Where the
        supervisor recorded none there is nothing to price and the hand-up is
        fine. -- */
  if (outcome === "SEND_TO_MD") {
    const { data: pricing } = await supabase
      .from("worker_evaluation_decisions")
      .select("salary_changed, increment_pct, old_ctc, new_ctc")
      .eq("evaluation_id", evaluationId)
      .maybeSingle();

    const recommendsAChange =
      pricing?.salary_changed === true || pricing?.increment_pct !== null;
    const priced = pricing?.old_ctc !== null && pricing?.new_ctc !== null;

    if (pricing && recommendsAChange && !priced) {
      return {
        ok: false,
        error: {
          code: "NOT_PRICED",
          message:
            "Set the current and new salary before sending this up. Management approves an amount, " +
            "and the supervisor is never shown one — so if you skip this there is no figure for them to approve.",
        },
      };
    }
  }

  /* -- THE MD'S CLOSE GOES THROUGH 0070, AND IT HAD TO.

        `worker_evaluations` carries one write policy — `worker_evaluations_hr_write`
        (0047), `for all ... using (is_hr())`. The MD is not HR, so the update
        below matched ZERO ROWS for them, and a PostgREST write that matches no
        row succeeds having done nothing. The zero-row guard then reported the
        only cause it knew of: "somebody else moved this appraisal on". Nobody
        had. The MD has never been able to close a production appraisal, and was
        told each time that somebody else was responsible.

        Remarks, both timestamps, the decision row and the audit row commit
        together inside the function, so a close cannot half-happen. -- */
  if (outcome === "CLOSE") {
    const { error: closeError } = await supabase.rpc("close_worker_appraisal", {
      p_evaluation_id: evaluationId,
      p_remarks: remarks.trim() === "" ? null : remarks.trim(),
    });

    if (closeError) {
      return {
        ok: false,
        error: {
          // The function raises a sentence per refusal — not management, gone,
          // already closed, still with HR. Passed through rather than replaced
          // by one generic failure (§0.7).
          code: "NOT_CLOSED",
          message: closeError.message,
        },
      };
    }

    revalidatePath("/admin/worker-appraisals", "layout");
    return { ok: true, data: { ok: true } };
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

  const { data: moved, error } = await supabase
    .from("worker_evaluations")
    // Only the hand-up reaches here now; the close returned above. Written as
    // one outcome rather than a ternary whose other arm can no longer be taken —
    // a dead branch reads as a live one to whoever edits this next.
    .update({ status: "REVIEWED" })
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
  /**
   * How many identical entries this line stands for.
   *
   * Absent or 1 is the ordinary case. An autosave writes a row per save, so a
   * run of them is folded for reading — the rows themselves are untouched
   * (§12).
   */
  times?: number;
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

  const entries = rows.map((r) => {
    const diff = (r.diff ?? {}) as Record<string, unknown>;
    const changed = typeof diff.changed === "string" ? diff.changed : "";

    /* -- Said the way somebody reading it would say it. "worker_salary.changed"
          is what the database calls the event; "changed the new salary" is what
          happened, which is what the owner asked to see. -- */
    let what: string;
    let detail: string | null = r.reason ?? null;
    // Read once, so the guard below and the value it admits cannot disagree.
    const named = ACTION_WORD[r.action];

    if (r.action === "worker_salary.changed") {
      const parts = [
        changed.includes("new_ctc") ? "the new salary" : null,
        changed.includes("old_ctc") ? "the current salary" : null,
        changed.includes("increment_pct") ? "the percentage" : null,
      ].filter(Boolean) as string[];
      what = parts.length > 0 ? `changed ${parts.join(" and ")}` : "changed the salary block";

      /* -- A FIRST value is "set to 8%", not "—% → 8%".
            It rendered the em dash for a missing previous figure and then a
            percent sign after it, so a first entry read "— —% → 8%" — which
            looks like a rendering fault rather than a number being entered for
            the first time. -- */
      const to = diff.pct_to;
      const from = diff.pct_from;
      if (to !== null && to !== undefined && from !== to) {
        detail =
          from === null || from === undefined ? `set to ${to}%` : `${from}% → ${to}%`;
      }
    } else if (named) {
      /* -- THE NAMED VERB WINS, and it did not.
            This branch sat AFTER the status one, so every row carrying a
            from/to — which is every transition — rendered as "moved it from
            with management to finished" while a precise word for it sat unused
            in the map. The MD sending an appraisal back read as a generic
            status move rather than "sent it back to HR", which is the one entry
            somebody scans this list for.

            "Approved and closed it" also tells a reader WHAT was done; "moved
            it from with management to finished" makes them translate two stage
            names to work it out. A LABEL, never the stored key (§13.5) — and
            never a paraphrase of the machinery either. -- */
      what = named;
    } else if (r.from_status && r.to_status) {
      /* -- The fallback for a transition nobody has named yet. Better than the
            raw action, which is a stored value on screen — `readable()` once
            let `worker.supervisor_submit` through as "worker.supervisor
            submit", because a regex that half-matches is worse than a map that
            misses. -- */
      what = `moved it from ${STAGE_WORD[String(r.from_status)] ?? readable(r.from_status)} to ${STAGE_WORD[String(r.to_status)] ?? readable(r.to_status)}`;
    } else {
      what = "made a change";
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

  return collapseRuns(entries);
}

/** §8's rule: an employee never sees the stored status, and neither does this. */
const STAGE_WORD: Record<string, string> = {
  DRAFT: "not started",
  OPEN: "in progress",
  PENDING_SUPERVISOR: "with the supervisor",
  PENDING_REVIEW: "with HR",
  REVIEWED: "with management",
  CLOSED: "finished",
};

const ACTION_WORD: Record<string, string> = {
  "worker.self_submit": "submitted the worker's own sheet",
  /* Retired with the self layer (WORKER-1), but still in the vocabulary — an
     action with no word here renders as "made a change", which says nothing. */
  "worker.self_submit_handover": "filled the worker's sheet on their behalf",
  "worker.ready_for_review": "completed the sheet for HR",
  "worker.supervisor_submit": "submitted their ratings",
  "worker_evaluation.returned_to_hr": "sent it back to HR",
  "worker_evaluation.opened": "opened the appraisal",
  "worker_evaluation.added_to_round": "was added to the round",
  "worker.sent_to_md": "sent it to management",
  "worker.closed": "approved and closed it",
  "worker_salary.changed": "changed the salary block",
};

function readable(value: string): string {
  return value.toLowerCase().replace(/_/g, " ");
}

/**
 * Fold a run of identical entries into one.
 *
 * An autosave writes an audit row per save, so a supervisor adjusting a
 * percentage three times produced three consecutive lines saying the same thing
 * at the same minute — which reads as the log being broken rather than as
 * somebody changing their mind. The rows are NOT deleted (§12: audit is
 * append-only and the record is the point); they are folded for READING, with a
 * count so the repetition is still visible.
 *
 * The same device `collapseRuns` performs on the cycle activity trail (P10B-6),
 * for the same reason and deliberately not shared — that one folds a different
 * row shape, and one function serving both would have to branch on which.
 */
function collapseRuns(entries: WorkerActivity[]): WorkerActivity[] {
  const out: WorkerActivity[] = [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (last && last.who === entry.who && last.what === entry.what && last.detail === entry.detail) {
      last.times = (last.times ?? 1) + 1;
      // Keep the EARLIEST of a run: "changed it three times, starting at 11:52"
      // is the true reading, and the rows arrive newest first.
      last.at = entry.at;
      continue;
    }
    out.push({ ...entry });
  }
  return out;
}

/* ================================================ management sends it back == */

/**
 * The MD returns an appraisal to HR for correction.
 *
 * THIS DID NOT EXIST. `worker_evaluation.returned_to_hr` has been in the
 * activity vocabulary since the trail was written, and nothing ever raised it —
 * so an appraisal that reached management could only go forward. The MD's
 * choices were to approve a figure they disagreed with or to leave it sitting
 * there, and neither is a decision.
 *
 * REVIEWED → PENDING_REVIEW, which is the only move it can be: the statuses
 * already express "with HR" and "with management", so this needs no new enum
 * value and no migration (the same reasoning W1-11 used for the two endings).
 *
 * A REASON IS REQUIRED. §8 requires one on every return in the staff module and
 * the argument is identical here: a form that comes back with no explanation
 * sends HR looking for the one person who knows why, and by then the reason is
 * somebody's recollection. It is recorded verbatim in the audit trail (§12) and
 * shown on the activity list.
 */
export async function returnWorkerToHr(
  evaluationId: string,
  reason: string,
): Promise<Result<{ ok: true }>> {
  /* -- MANAGEMENT ONLY, and deliberately not HR.
        HR sending it back to themselves is not a return, it is an edit — and
        they can already edit while it is theirs. The point of this action is
        that the second pair of eyes can decline (AMEND-2). -- */
  const auth = await checkRole(["MD"]);
  if (!auth.ok) return { ok: false, error: auth.error };

  const note = reason.trim();
  /* -- Ten, matching what the database will actually accept.
        0064's function raises below ten characters, so a client minimum of five
        would let somebody type six, press the button and read a raw Postgres
        exception. A form that accepts what the server then rejects is the
        two-copies-of-a-threshold problem P13-6 already had to unpick. -- */
  if (note.length < 10) {
    return {
      ok: false,
      error: {
        code: "REASON_REQUIRED",
        message: "Say what needs changing — at least ten characters, so HR knows what to do.",
      },
    };
  }

  const supabase = await createClient();

  /* -- THROUGH 0064'S FUNCTION, NOT A DIRECT UPDATE — and this is the whole
        reason the MD's actions were failing.

        `worker_evaluations` has exactly ONE write policy:
        `worker_evaluations_hr_write`, `for all ... using (is_hr())`. The MD is
        not HR, so any UPDATE they issue matches ZERO ROWS — and PostgREST
        reports zero rows as a success. The screen then says "somebody else
        moved this appraisal on", which is untrue and unactionable: nobody moved
        anything, and no amount of reloading will help.

        0064 already built `return_worker_to_hr` as SECURITY DEFINER for exactly
        this reason (W1-4's pattern: the capability goes to one narrow audited
        function rather than to a policy). It also writes its own audit row with
        the reason and the two statuses, so nothing further is logged here — a
        second row would report one return as two. -- */
  const { error } = await supabase.rpc("return_worker_to_hr", {
    p_evaluation_id: evaluationId,
    p_reason: note,
  });

  if (error) {
    return {
      ok: false,
      error: {
        // The function raises a SENTENCE for each of its four refusals — not
        // entitled, gone, wrong stage, reason too short. Passing it through is
        // what makes the screen say which one happened (§0.7).
        code: "NOT_RETURNED",
        message: error.message,
      },
    };
  }

  revalidatePath("/admin/worker-appraisals", "layout");
  return { ok: true, data: { ok: true } };
}

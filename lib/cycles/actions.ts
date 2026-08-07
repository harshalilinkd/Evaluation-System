"use server";

/** Cycle server actions. Every one is HR-guarded (§9) and audited (§12). */

import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { dispatchLaunchInvites } from "@/lib/cycles/dispatch-launch";
import { transition } from "@/lib/evaluations/state-machine";
import { buildLaunchPlan } from "@/lib/cycles/launch";
import {
  cycleBasicsSchema,
  cycleDatesSchema,
  cycleError,
  participantsSchema,
  plural,
  today,
  type CycleResult,
  type ParticipantRow,
  type ReadinessReport,
} from "@/lib/cycles/schema";
import { buildReadinessReport } from "@/lib/cycles/validate";
import { createClient } from "@/lib/supabase/server";
import type { Json, TablesUpdate } from "@/types/database";

/**
 * §9: "Every server action re-checks the role and the state machine guard
 * before writing." checkRole is requireRole's action-shaped twin — same
 * membership test, but it returns the standard error object instead of
 * redirecting, because §14 forbids an action navigating on its own.
 */
async function guard() {
  return checkRole(ADMIN_ROLES);
}

/** Postgres RAISE messages are written for HR, so they are passed through as-is. */
function fromPostgres(code: string, message: string) {
  return cycleError(code, message.replace(/^.*?:\s*/, "").trim() || message);
}

function revalidateCycles(cycleId?: string) {
  revalidatePath("/admin/cycles");
  if (cycleId) revalidatePath(`/admin/cycles/${cycleId}`);
}

/* ============================================================ createCycle == */

export type CycleDraftInput = {
  name: string;
  period_label: string;
  variance_threshold: number;
  disclosure: string;
  starts_on?: string;
  self_due_on?: string;
  lead_due_on?: string;
  md_due_on?: string;
};

/**
 * Creates a DRAFT cycle. Draft only — there is no path from here to ACTIVE
 * except launchCycle, which is the whole point of the phase.
 *
 * Dates are optional at creation so the wizard can save a draft from step 1
 * before step 2 has been filled in. They are mandatory at launch, where
 * blocking guard 4 checks them.
 */
export async function createCycle(input: CycleDraftInput): Promise<CycleResult<{ id: string }>> {
  const auth = await guard();
  if (!auth.ok) return auth;

  const basics = cycleBasicsSchema.safeParse(input);
  if (!basics.success) {
    return cycleError("INVALID_INPUT", basics.error.issues[0]?.message ?? "Check the highlighted fields.");
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("evaluation_cycles")
    .insert({
      name: basics.data.name,
      period_label: basics.data.period_label,
      variance_threshold: basics.data.variance_threshold,
      disclosure: basics.data.disclosure,
      // P10: "Set track_scope to STAFF on write and remove any track selector
      // from the UI. Do not drop the column." The column stays for the worker
      // module, which has its own cycles; this module never writes anything
      // else, so §5's module boundary holds by construction rather than by
      // remembering to tick a box.
      track_scope: "STAFF",
      starts_on: input.starts_on || null,
      self_due_on: input.self_due_on || null,
      lead_due_on: input.lead_due_on || null,
      md_due_on: input.md_due_on || null,
      status: "DRAFT",
      created_by: auth.session.profile.id,
    })
    .select("id")
    .single();

  if (error) return fromPostgres("QUERY_FAILED", error.message);

  await supabase.rpc("log_admin_action", {
    p_entity: "cycle",
    p_entity_id: data.id,
    p_action: "cycle.created",
    p_diff: { name: basics.data.name, period_label: basics.data.period_label } as Json,
  });

  revalidateCycles();
  return { ok: true, data: { id: data.id } };
}

/* ============================================================ updateCycle == */

/**
 * P10: "blocked once status is ACTIVE except for due dates, which may be
 * extended but never shortened below today".
 *
 * The asymmetry is deliberate and worth stating: extending a deadline gives
 * people more time and invalidates nothing. Shortening one retroactively makes
 * submissions late that were on time when they were made, and every "overdue"
 * badge on the board would change meaning for work already done.
 */
export async function updateCycle(
  cycleId: string,
  input: Partial<CycleDraftInput>,
): Promise<CycleResult<{ id: string }>> {
  const auth = await guard();
  if (!auth.ok) return auth;

  const supabase = await createClient();

  const { data: cycle, error: readError } = await supabase
    .from("evaluation_cycles")
    .select("id, name, status, starts_on, self_due_on, lead_due_on, md_due_on")
    .eq("id", cycleId)
    .maybeSingle();

  if (readError) return fromPostgres("QUERY_FAILED", readError.message);
  if (!cycle) return cycleError("CYCLE_NOT_FOUND", "That cycle no longer exists.");

  if (cycle.status === "CLOSED") {
    return cycleError("CYCLE_CLOSED", "This cycle is closed. Closed cycles are a record and cannot be edited.");
  }

  // Typed against the table rather than as a loose record, so a typo in a
  // column name is a compile error instead of a silently ignored update.
  const patch: TablesUpdate<"evaluation_cycles"> = {};

  if (cycle.status === "ACTIVE") {
    /* -- Live cycle: due dates only, forwards only. -- */
    const fields = ["self_due_on", "lead_due_on", "md_due_on"] as const;
    const attemptedOther =
      (input.name !== undefined && input.name !== cycle.name) ||
      input.period_label !== undefined ||
      input.variance_threshold !== undefined ||
      input.disclosure !== undefined ||
      (input.starts_on !== undefined && input.starts_on !== cycle.starts_on);

    if (attemptedOther) {
      return cycleError(
        "CYCLE_ACTIVE",
        "This cycle is live. Only the due dates can still be changed, and only forwards.",
      );
    }

    for (const field of fields) {
      const next = input[field];
      if (!next) continue;

      const current = cycle[field];
      if (current && next < current) {
        return cycleError(
          "DATE_SHORTENED",
          `A deadline can only be moved later. ${labelFor(field)} is currently ${current}.`,
        );
      }
      if (next < today()) {
        return cycleError("DATE_IN_PAST", `${labelFor(field)} cannot be set in the past.`);
      }
      patch[field] = next;
    }

    if (Object.keys(patch).length === 0) {
      return cycleError("NO_CHANGE", "Nothing to change.");
    }
  } else {
    /* -- Draft: everything is editable. -- */
    if (input.name !== undefined || input.period_label !== undefined) {
      const basics = cycleBasicsSchema.safeParse({
        name: input.name ?? cycle.name,
        period_label: input.period_label ?? "",
        variance_threshold: input.variance_threshold ?? 2,
        disclosure: input.disclosure ?? "SCORE_AND_DECISION",
      });
      if (!basics.success) {
        return cycleError("INVALID_INPUT", basics.error.issues[0]?.message ?? "Check the highlighted fields.");
      }
      patch.name = basics.data.name;
      patch.period_label = basics.data.period_label;
      patch.variance_threshold = basics.data.variance_threshold;
      patch.disclosure = basics.data.disclosure;
    }

    const dates = {
      starts_on: input.starts_on ?? cycle.starts_on,
      self_due_on: input.self_due_on ?? cycle.self_due_on,
      lead_due_on: input.lead_due_on ?? cycle.lead_due_on,
      md_due_on: input.md_due_on ?? cycle.md_due_on,
    };

    // Only validated once all four are present — a half-filled draft is a
    // normal state for the wizard and must still save.
    if (dates.starts_on && dates.self_due_on && dates.lead_due_on && dates.md_due_on) {
      const parsed = cycleDatesSchema.safeParse(dates);
      if (!parsed.success) {
        return cycleError("INVALID_DATES", parsed.error.issues[0]?.message ?? "Check the dates.");
      }
    }

    Object.assign(patch, dates);
  }

  const { error } = await supabase.from("evaluation_cycles").update(patch).eq("id", cycleId);
  if (error) return fromPostgres("QUERY_FAILED", error.message);

  await supabase.rpc("log_admin_action", {
    p_entity: "cycle",
    p_entity_id: cycleId,
    p_action: cycle.status === "ACTIVE" ? "cycle.dates_extended" : "cycle.updated",
    p_diff: patch as Json,
  });

  revalidateCycles(cycleId);
  return { ok: true, data: { id: cycleId } };
}

function labelFor(field: "self_due_on" | "lead_due_on" | "md_due_on"): string {
  return field === "self_due_on"
    ? "The employee deadline"
    : field === "lead_due_on"
      ? "The lead deadline"
      : "The MD deadline";
}

/* =================================================== setCycleParticipants == */

/**
 * Writes the roster as DRAFT evaluation rows.
 *
 * Participants are not stored separately: §8 starts at DRAFT, so the evaluation
 * must exist before it can be transitioned, and the roster HR builds in the
 * wizard is literally the set of rows launch will move to CYCLE_ACTIVE. There
 * is no moment where a "participant list" and the evaluations can disagree.
 *
 * Only ever runs against a DRAFT cycle — the RLS policies added in 0009 are
 * scoped to status = 'DRAFT', so even a bug here cannot re-point a live
 * evaluation. After launch, exclude/reassign are the routes.
 */
export async function setCycleParticipants(
  cycleId: string,
  rows: ParticipantRow[],
): Promise<CycleResult<{ included: number; removed: number }>> {
  const auth = await guard();
  if (!auth.ok) return auth;

  const parsed = participantsSchema.safeParse(rows);
  if (!parsed.success) return cycleError("INVALID_INPUT", "The participant list is malformed.");

  const supabase = await createClient();

  const { data: cycle } = await supabase
    .from("evaluation_cycles")
    .select("id, status")
    .eq("id", cycleId)
    .maybeSingle();

  if (!cycle) return cycleError("CYCLE_NOT_FOUND", "That cycle no longer exists.");
  if (cycle.status !== "DRAFT") {
    return cycleError(
      "CYCLE_LAUNCHED",
      "This cycle has launched. Use Withdraw to take somebody out, which keeps their record.",
    );
  }

  const included = parsed.data.filter((r) => r.included);
  const excluded = parsed.data.filter((r) => !r.included);

  /* -- Departments and tracks come from the profile, never from the client. -- */
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, department_id, track, is_active")
    .in("id", included.length > 0 ? included.map((r) => r.profileId) : ["00000000-0000-0000-0000-000000000000"]);

  if (profileError) return fromPostgres("QUERY_FAILED", profileError.message);

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  // §5 module boundary. Refused here rather than filtered out, because silently
  // dropping somebody HR ticked is worse than telling them why.
  const workers = included.filter((r) => byId.get(r.profileId)?.track === "WORKER");
  if (workers.length > 0) {
    return cycleError(
      "WORKER_NOT_ALLOWED",
      "Workers are appraised in their own module and cannot be added to a staff cycle.",
    );
  }

  /* -- THE MD IS NOT APPRAISED, at the owner's explicit instruction.
        Nobody in this product is above them to rate them: §8's flow needs an
        evaluatee AND a lead, and the MD is the top of the chain the lead picker
        offers. An MD participant would either have no rater at all or be rated
        by somebody they approve the pay of.

        Refused here as well as hidden in the wizard, for the reason the worker
        rule states directly above: the roster filter is one refactor away from
        being dropped, and this action is what actually writes the rows. -- */
  const { data: mdRoles } = await supabase
    .from("user_roles")
    .select("profile_id")
    .eq("role", "MD")
    .in("profile_id", included.length > 0 ? included.map((r) => r.profileId) : ["00000000-0000-0000-0000-000000000000"]);

  if (mdRoles && mdRoles.length > 0) {
    const names = mdRoles
      .map((r) => byId.get(r.profile_id)?.full_name)
      .filter((n): n is string => Boolean(n));
    return cycleError(
      "MD_NOT_EVALUATED",
      names.length > 0
        ? `${names.join(", ")} ${names.length === 1 ? "holds" : "hold"} the MD role and cannot be appraised in a cycle.`
        : "The MD cannot be appraised in a cycle.",
    );
  }

  const { data: existing } = await supabase
    .from("evaluations")
    .select("id, evaluatee_id")
    .eq("cycle_id", cycleId);

  const existingByProfile = new Map((existing ?? []).map((e) => [e.evaluatee_id, e.id]));

  /* -- Upsert the included. -- */
  if (included.length > 0) {
    const payload = included
      .filter((r) => byId.has(r.profileId))
      .map((r) => {
        const person = byId.get(r.profileId);
        return {
          cycle_id: cycleId,
          evaluatee_id: r.profileId,
          lead_id: r.leadId,
          // Copied at creation so a transfer mid-cycle does not retroactively
          // move the appraisal to another department (0003).
          department_id: person?.department_id ?? null,
          track: "STAFF" as const,
          status: "DRAFT" as const,
        };
      });

    const { error } = await supabase
      .from("evaluations")
      .upsert(payload, { onConflict: "cycle_id,evaluatee_id" });

    if (error) return fromPostgres("QUERY_FAILED", error.message);
  }

  /* -- Remove the unticked. -- */
  //
  // A plain delete, and safe: the cycle is DRAFT, so these rows carry no frozen
  // snapshot and no answers. After launch the delete policy no longer matches
  // and exclude_evaluation() is the only route, which archives instead.
  const toRemove = excluded
    .map((r) => existingByProfile.get(r.profileId))
    .filter((id): id is string => Boolean(id));

  if (toRemove.length > 0) {
    const { error } = await supabase.from("evaluations").delete().in("id", toRemove);
    if (error) return fromPostgres("QUERY_FAILED", error.message);
  }

  revalidateCycles(cycleId);
  return { ok: true, data: { included: included.length, removed: toRemove.length } };
}

/* =================================================== validateCycleForLaunch */

/** The readiness report. Never a boolean — see ReadinessReport. */
export async function validateCycleForLaunch(cycleId: string): Promise<CycleResult<ReadinessReport>> {
  const auth = await guard();
  if (!auth.ok) return auth;
  return buildReadinessReport(cycleId);
}

/* ============================================================ launchCycle == */

export type LaunchOutcome = {
  cycleId: string;
  evaluations: number;
  questions: number;
  /** Two per participant — one per layer (item 14e). */
  tokens: number;
  messagesSent: number;
  /** Held back by the per-HOD cap; the cron sweep picks them up (item 16). */
  messagesQueued: number;
};

/**
 * THE TRANSACTION.
 *
 * Three phases, and the split is what makes it all-or-nothing:
 *
 *   1. Re-validate. P10 step 1: "Never trust the client's readiness." The
 *      wizard's report was computed when step 4 rendered; between then and now
 *      somebody can retire a department's last question or deactivate an
 *      employee.
 *   2. Assemble every snapshot in TypeScript — all reads, no writes, one
 *      assembly algorithm shared with the preview (§5).
 *   3. Hand the finished rows to launch_cycle(), which writes everything in a
 *      single database transaction and re-checks every blocking guard row by
 *      row as it goes.
 *
 * If phase 3 raises anywhere — person 1 or person 47 — the whole transaction
 * unwinds and not one row survives. That is the acceptance criterion "a forced
 * failure mid-launch leaves zero rows behind", and it is the reason the write
 * side is a database function rather than a loop of PostgREST calls.
 */
export async function launchCycle(cycleId: string): Promise<CycleResult<LaunchOutcome>> {
  const auth = await guard();
  if (!auth.ok) return auth;

  /* -- 1. Re-validate, server-side. -- */
  const report = await buildReadinessReport(cycleId);
  if (!report.ok) return report;

  if (!report.data.canLaunch) {
    const first = report.data.blocking[0];
    return cycleError(
      "NOT_READY",
      first
        ? `${first.message}${report.data.blocking.length > 1 ? ` And ${plural(report.data.blocking.length - 1, "other issue")}.` : ""}`
        : "This cycle is not ready to launch.",
    );
  }

  /* -- 2. Assemble. Reads only. -- */
  const supabaseRead = await createClient();
  const { data: cycleRow } = await supabaseRead
    .from("evaluation_cycles")
    .select("cycle_type, cycle_kind")
    .eq("id", cycleId)
    .maybeSingle();

  const cycleType = cycleRow?.cycle_type === "INCREMENT" ? "INCREMENT" : "EVALUATION";
  const cycleKind = cycleRow?.cycle_kind === "ROLLING" ? "ROLLING" : "BATCH";

  const plan = await buildLaunchPlan(cycleId, { cycleType, cycleKind });
  if (!plan.ok) return plan;

  /* -- 3. Commit. -- */
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("launch_cycle", {
    p_cycle_id: cycleId,
    p_payload: plan.data.payload as unknown as Json,
  });

  if (error) {
    // The function's RAISE messages are already written for HR and already name
    // the person who failed, so they are surfaced rather than replaced.
    return fromPostgres("LAUNCH_FAILED", error.message);
  }

  const result = (data ?? {}) as { evaluations?: number; questions?: number; tokens?: number };

  /* -- 4. Dispatch, AFTER the commit (item 15).
        Never inside: a provider outage must not roll back a launch that is
        already durable and audited. PW-2 made the same call for transitions. -- */
  const dispatched = await dispatchLaunchInvites(cycleId, plan.data);

  revalidateCycles(cycleId);
  revalidatePath("/dashboard");

  return {
    ok: true,
    data: {
      cycleId,
      evaluations: result.evaluations ?? plan.data.payload.length,
      questions: result.questions ?? plan.data.totalQuestions,
      tokens: result.tokens ?? 0,
      messagesSent: dispatched.sent,
      messagesQueued: dispatched.queued,
    },
  };
}

/* =========================================================== archiveCycle == */

/**
 * P10: "sets status CLOSED, never deletes."
 *
 * The cycle's own status, not its evaluations'. Each evaluation reaches CLOSED
 * through §8's MD_FINALIZED -> CLOSED transition and nowhere else; archiving
 * the container does not fake that for the contents, which would put unfinished
 * appraisals in the "finalised" cohort of every report.
 */
export async function archiveCycle(cycleId: string): Promise<CycleResult<{ id: string }>> {
  const auth = await guard();
  if (!auth.ok) return auth;

  const supabase = await createClient();

  const { data: cycle } = await supabase
    .from("evaluation_cycles")
    .select("id, name, status")
    .eq("id", cycleId)
    .maybeSingle();

  if (!cycle) return cycleError("CYCLE_NOT_FOUND", "That cycle no longer exists.");
  if (cycle.status === "CLOSED") return cycleError("ALREADY_CLOSED", "This cycle is already archived.");

  const { error } = await supabase
    .from("evaluation_cycles")
    .update({ status: "CLOSED" })
    .eq("id", cycleId);

  if (error) return fromPostgres("QUERY_FAILED", error.message);

  await supabase.rpc("log_admin_action", {
    p_entity: "cycle",
    p_entity_id: cycleId,
    p_action: "cycle.archived",
    p_diff: { from: cycle.status, to: "CLOSED" } as Json,
  });

  revalidateCycles(cycleId);
  return { ok: true, data: { id: cycleId } };
}

/* ========================================================= recycle bin === */

/**
 * Move a cycle to the recycle bin.
 *
 * NOT A DELETE, AND IT CANNOT BE ONE.
 *
 * `evaluation_cycles` cascades to `evaluations`, which cascades to
 * `evaluation_questions` — so a real DELETE would take every frozen snapshot in
 * the cycle with it, the one thing §5 exists to prevent. 0009 blocks that with
 * a trigger and 0032 leaves the trigger exactly where it is.
 *
 * So binning marks the row and hides it. Everything it contains stays on disk,
 * untouched and restorable, and a launched cycle can be binned as safely as a
 * draft — because binning does not reach the contents at all.
 */
export async function moveCycleToBin(
  cycleId: string,
  reason?: string,
): Promise<CycleResult<{ id: string }>> {
  const auth = await guard();
  if (!auth.ok) return auth;

  const supabase = await createClient();

  const { data: cycle } = await supabase
    .from("evaluation_cycles")
    .select("id, name, status, deleted_at")
    .eq("id", cycleId)
    .maybeSingle();

  if (!cycle) return cycleError("CYCLE_NOT_FOUND", "That cycle no longer exists.");
  if (cycle.deleted_at) return cycleError("ALREADY_BINNED", "That cycle is already in the recycle bin.");

  const { error } = await supabase
    .from("evaluation_cycles")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: auth.session.profile.id,
      delete_reason: reason?.trim() || null,
    })
    .eq("id", cycleId);

  if (error) return fromPostgres("QUERY_FAILED", error.message);

  await supabase.rpc("log_admin_action", {
    p_entity: "cycle",
    p_entity_id: cycleId,
    p_action: "cycle.binned",
    p_diff: { name: cycle.name, status: cycle.status, reason: reason?.trim() || null } as Json,
  });

  revalidateCycles(cycleId);
  return { ok: true, data: { id: cycleId } };
}

/** Put it back. The mark goes to null and the cycle returns to every list. */
export async function restoreCycleFromBin(cycleId: string): Promise<CycleResult<{ id: string }>> {
  const auth = await guard();
  if (!auth.ok) return auth;

  const supabase = await createClient();

  const { data: cycle } = await supabase
    .from("evaluation_cycles")
    .select("id, name, deleted_at")
    .eq("id", cycleId)
    .maybeSingle();

  if (!cycle) return cycleError("CYCLE_NOT_FOUND", "That cycle no longer exists.");
  if (!cycle.deleted_at) return cycleError("NOT_BINNED", "That cycle is not in the recycle bin.");

  const { error } = await supabase
    .from("evaluation_cycles")
    .update({ deleted_at: null, deleted_by: null, delete_reason: null })
    .eq("id", cycleId);

  if (error) return fromPostgres("QUERY_FAILED", error.message);

  await supabase.rpc("log_admin_action", {
    p_entity: "cycle",
    p_entity_id: cycleId,
    p_action: "cycle.restored",
    p_diff: { name: cycle.name } as Json,
  });

  revalidateCycles(cycleId);
  return { ok: true, data: { id: cycleId } };
}

/**
 * Delete a binned cycle for good.
 *
 * THE DATABASE DECIDES WHAT THIS IS ALLOWED TO TOUCH, NOT THIS FUNCTION.
 *
 * 0009's `guard_cycle_delete` trigger refuses any DELETE where the status is
 * not DRAFT, because `evaluation_cycles` cascades to `evaluations` and from
 * there to `evaluation_questions` — a launched cycle's frozen question sets
 * would go with it, which §5 exists to prevent. That trigger is the enforcement
 * and it is untouched.
 *
 * So "delete forever" means exactly one thing: a cycle that was never launched
 * and therefore has nothing frozen inside it. Its DRAFT evaluation rows cascade
 * away with it and that is correct — a participant list is what they are (P10-1),
 * and nobody has answered anything.
 *
 * The pre-check below exists to give HR a sentence instead of a constraint
 * violation. The trigger is still what makes it true.
 */
export async function deleteCycleForever(cycleId: string): Promise<CycleResult<{ id: string }>> {
  const auth = await guard();
  if (!auth.ok) return auth;

  const supabase = await createClient();

  const { data: cycle } = await supabase
    .from("evaluation_cycles")
    .select("id, name, period_label, status, deleted_at, launched_at")
    .eq("id", cycleId)
    .maybeSingle();

  if (!cycle) return cycleError("CYCLE_NOT_FOUND", "That cycle no longer exists.");

  // Two deliberate acts, not one. Deleting straight from the list would make an
  // irreversible thing a single click away from an ordinary one.
  if (!cycle.deleted_at) {
    return cycleError(
      "NOT_BINNED",
      "Move it to the recycle bin first. Deleting for good is a second, separate step.",
    );
  }

  if (cycle.status !== "DRAFT") {
    return cycleError(
      "LAUNCHED",
      `${cycle.name} was launched, so it holds the frozen question set and the answers of everyone in it. Those cannot be destroyed — it stays in the recycle bin, where it takes up nothing and can be restored.`,
    );
  }

  // Logged BEFORE the row goes. audit_log.entity_id carries no foreign key, so
  // the record outlives what it describes — the only remaining evidence that
  // this cycle ever existed.
  await supabase.rpc("log_admin_action", {
    p_entity: "cycle",
    p_entity_id: cycleId,
    p_action: "cycle.deleted_forever",
    p_diff: { name: cycle.name, period_label: cycle.period_label, status: cycle.status } as Json,
  });

  const { error } = await supabase.from("evaluation_cycles").delete().eq("id", cycleId);

  // The trigger's own message is written for HR, so it is passed through rather
  // than replaced with a guess about what went wrong.
  if (error) return fromPostgres("DELETE_REFUSED", error.message);

  revalidateCycles(cycleId);
  return { ok: true, data: { id: cycleId } };
}

/* ==================================================== post-launch edits === */

/**
 * P10 edge case: reassigning a lead is "allowed while status is CYCLE_ACTIVE or
 * SELF_SUBMITTED, blocked afterwards, always audit-logged, and it notifies both
 * the old and new lead."
 *
 * The status gate and the audit row live in the database function, so they hold
 * even if this action is bypassed. The notification is here, because §10 keeps
 * every outbound message server-side and logged — a database function is the
 * wrong place to make an HTTP call.
 */
/**
 * P10-REV item 19. §8's OPEN → PENDING_HR_REVIEW, taken deliberately by HR
 * because one side never came in.
 *
 * The missing layer is MARKED SKIPPED rather than left looking unanswered:
 * §8 requires it, and a report that cannot tell "nobody rated this" from
 * "somebody rated it blank" is a report that misleads about a pay decision.
 */
export async function advanceWithoutOneSide(
  evaluationId: string,
  reason: string,
): Promise<CycleResult<{ evaluationId: string }>> {
  const auth = await guard();
  if (!auth.ok) return auth;

  const supabase = await createClient();
  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id, self_submitted_at, lead_submitted_at, status")
    .eq("id", evaluationId)
    .maybeSingle();

  if (!evaluation) return cycleError("NOT_FOUND", "That evaluation no longer exists.");
  if (evaluation.status !== "OPEN") {
    return cycleError("WRONG_STATUS", "This evaluation has already moved on.");
  }
  if (evaluation.self_submitted_at && evaluation.lead_submitted_at) {
    return cycleError(
      "NOTHING_MISSING",
      "Both sides are in. This will move to your review on its own.",
    );
  }

  const moved = await transition(evaluationId, "PENDING_HR_REVIEW", {
    profileId: auth.session.profile.id,
    roles: auth.session.roles,
  }, {
    reason,
    // Whichever side is absent is the one marked skipped.
    skip: {
      self: !evaluation.self_submitted_at,
      lead: !evaluation.lead_submitted_at,
    },
  });

  if (!moved.ok) return cycleError(moved.error.code, moved.error.message);

  revalidateCycles();
  return { ok: true, data: { evaluationId } };
}

export async function reassignLead(
  evaluationId: string,
  newLeadId: string,
  reason: string,
): Promise<CycleResult<{ oldLeadId: string | null; newLeadId: string }>> {
  const auth = await guard();
  if (!auth.ok) return auth;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reassign_evaluation_lead", {
    p_evaluation_id: evaluationId,
    p_new_lead_id: newLeadId,
    p_reason: reason,
  });

  if (error) return fromPostgres("REASSIGN_FAILED", error.message);

  const result = (data ?? {}) as { old_lead_id?: string | null; new_lead_id?: string };

  // ⚠ NOT SENT YET, AND NOT FAKED.
  //
  // P10 wants both leads notified — the new one because they have work to do,
  // the old one because they no longer do and would otherwise keep the
  // evaluation on their list. §5 puts every send in notifications_log with its
  // provider response, and that table does not exist yet: it lands with the
  // Maytapi/email dispatcher in P11.
  //
  // Writing to a table that is not there would fail; inventing it here would
  // breach §0.4. So the reassignment is committed and audited now, the two ids
  // come back so the screen can tell HR exactly who to inform by hand, and the
  // automatic send is wired up in P11 against the real log.
  revalidatePath("/admin/cycles");
  return { ok: true, data: { oldLeadId: result.old_lead_id ?? null, newLeadId } };
}

/**
 * P10 edge case: "An employee leaves mid-cycle: HR can exclude them, which
 * archives the evaluation rather than deleting it, with a reason."
 */
export async function excludeParticipant(
  evaluationId: string,
  reason: string,
): Promise<CycleResult<{ evaluationId: string }>> {
  const auth = await guard();
  if (!auth.ok) return auth;

  const supabase = await createClient();
  const { error } = await supabase.rpc("exclude_evaluation", {
    p_evaluation_id: evaluationId,
    p_reason: reason,
  });

  if (error) return fromPostgres("EXCLUDE_FAILED", error.message);

  revalidatePath("/admin/cycles");
  return { ok: true, data: { evaluationId } };
}

/**
 * Reopening a submitted layer.
 *
 * ⚠ CLAUDE.md §8 CONFLICT — DELIBERATELY NOT IMPLEMENTED AS A WRITE.
 *
 * P10's row menu lists "Reopen (HR only, requires a reason, audit-logged)".
 * §8's transition table gives the two return transitions to different actors:
 *
 *     SELF_SUBMITTED -> CYCLE_ACTIVE    lead (return)
 *     LEAD_REVIEWED  -> SELF_SUBMITTED  MD (return)
 *
 * HR appears on neither row, and §0 says the Constitution wins and to stop and
 * ask rather than deviate. apply_evaluation_transition enforces the same table
 * in the database, so an HR-initiated reopen would be refused there regardless
 * of what this action did.
 *
 * So this returns the explanation instead of attempting the write, and the row
 * menu renders the item disabled with the same sentence. Building a button that
 * always fails would be worse than building none.
 *
 * To enable it: amend §8 to add HR_ADMIN as a permitted actor on the two return
 * transitions, then add HR to the CASE in apply_evaluation_transition. That is
 * a Constitution change and belongs in a prompt, not in this file.
 */
export async function reopenEvaluation(
  _evaluationId: string,
  _reason: string,
): Promise<CycleResult<never>> {
  const auth = await guard();
  if (!auth.ok) return auth;

  return cycleError(
    "NOT_PERMITTED_BY_STATE_MACHINE",
    "The state machine gives the return to the lead (before review) or to the MD (after it), not to HR. Ask them to return it, or amend §8 first.",
  );
}

/** The salary review's reads (P21). HR and the MD only (§5, §9). */

import "server-only";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { median, monthsSince } from "@/lib/increment/calc";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

export type IncrementReview = Tables<"increment_reviews">;

export type PastIncrement = {
  effectiveFrom: string;
  previousCtc: number | null;
  newCtc: number;
  hikeAmount: number | null;
  hikePct: number | null;
  reason: string;
};

export type SalaryBand = {
  /** Absent when there is no employment record — the band says so and blocks. */
  currentCtc: number | null;
  joiningCtc: number | null;
  lastIncrementDate: string | null;
  monthsSinceLastIncrement: number | null;
  employeeName: string;
  profileId: string;

  review: IncrementReview | null;
  /** This person's own last three, newest first. */
  history: PastIncrement[];
  /** The median hike percent across their department in this cycle. */
  departmentMedianPct: number | null;
  departmentSampleSize: number;
  /** Configurable quick-set percentages. */
  hikeBands: number[];
};

/**
 * Everything the salary band needs, in one read.
 *
 * `months_since_last_increment` is computed here rather than read from the
 * review row when the review does not exist yet — the row is created the first
 * time HR saves, and the band has to render before that.
 */
export async function getSalaryBand(
  evaluationId: string,
): Promise<CycleResult<SalaryBand>> {
  const supabase = await createClient();

  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id, cycle_id, evaluatee_id, department_id")
    .eq("id", evaluationId)
    .maybeSingle();

  if (!evaluation) return cycleError("NOT_FOUND", "That evaluation is not available.");

  const [{ data: profile }, { data: employment }, { data: review }, { data: settings }] =
    await Promise.all([
      supabase.from("profiles").select("id, full_name").eq("id", evaluation.evaluatee_id).maybeSingle(),
      supabase
        .from("employment_records")
        .select("current_ctc, joining_ctc, last_increment_date")
        .eq("profile_id", evaluation.evaluatee_id)
        .maybeSingle(),
      supabase.from("increment_reviews").select("*").eq("evaluation_id", evaluationId).maybeSingle(),
      supabase.from("increment_settings").select("hike_bands").eq("id", true).maybeSingle(),
    ]);

  /* -- This person's own last three. Context that stops a number being set in a
        vacuum, and HR-and-MD-only data (§5). -- */
  const { data: past } = await supabase
    .from("salary_history")
    .select("effective_from, previous_ctc, new_ctc, hike_amount, hike_pct, reason")
    .eq("profile_id", evaluation.evaluatee_id)
    .order("effective_from", { ascending: false })
    .limit(3);

  /* -- The department median for this cycle. Computed from the reviews that
        have a final or approved figure, because a proposal nobody has agreed to
        is not yet a comparator. -- */
  let departmentMedianPct: number | null = null;
  let departmentSampleSize = 0;

  if (evaluation.department_id) {
    const { data: peers } = await supabase
      .from("evaluations")
      .select("id")
      .eq("cycle_id", evaluation.cycle_id)
      .eq("department_id", evaluation.department_id)
      .is("excluded_at", null);

    const peerIds = (peers ?? []).map((p) => p.id).filter((id) => id !== evaluationId);
    if (peerIds.length > 0) {
      const { data: peerReviews } = await supabase
        .from("increment_reviews")
        .select("final_hike_pct, md_approved_hike_pct")
        .in("evaluation_id", peerIds);

      const values = (peerReviews ?? [])
        .map((r) => r.final_hike_pct ?? r.md_approved_hike_pct)
        .filter((v): v is number => v !== null && Number.isFinite(v));

      departmentSampleSize = values.length;
      departmentMedianPct = median(values);
    }
  }

  return {
    ok: true,
    data: {
      currentCtc: employment?.current_ctc ?? null,
      joiningCtc: employment?.joining_ctc ?? null,
      lastIncrementDate: employment?.last_increment_date ?? null,
      monthsSinceLastIncrement: monthsSince(employment?.last_increment_date ?? null, new Date()),
      employeeName: profile?.full_name ?? "this employee",
      profileId: evaluation.evaluatee_id,
      review: review ?? null,
      history: (past ?? []).map((row) => ({
        effectiveFrom: row.effective_from,
        previousCtc: row.previous_ctc,
        newCtc: row.new_ctc,
        hikeAmount: row.hike_amount,
        hikePct: row.hike_pct,
        reason: row.reason,
      })),
      departmentMedianPct,
      departmentSampleSize,
      hikeBands: (settings?.hike_bands ?? [5, 10, 15]).map(Number),
    },
  };
}

/**
 * What the employee is told once their evaluation closes.
 *
 * §9 and the cycle's disclosure policy, and NO MORE: never the lead's ratings,
 * never the gap, never HR's or the MD's remarks, never the department median.
 * The shape carries only what they may see, so there is nothing for a screen to
 * accidentally render — the same reasoning as P19-2's salary-free view.
 */
export type EmployeeOutcome = {
  completed: boolean;
  /** Present only on an INCREMENT cycle, at CLOSED, and above NONE disclosure. */
  newCtc?: number;
  effectiveFrom?: string;
};

export async function getEmployeeOutcome(
  evaluationId: string,
): Promise<CycleResult<EmployeeOutcome>> {
  const supabase = await createClient();

  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id, cycle_id, status")
    .eq("id", evaluationId)
    .maybeSingle();

  if (!evaluation) return cycleError("NOT_FOUND", "That evaluation is not available.");

  const closed = evaluation.status === "CLOSED";
  if (!closed) return { ok: true, data: { completed: false } };

  const { data: cycle } = await supabase
    .from("evaluation_cycles")
    .select("cycle_type, disclosure")
    .eq("id", evaluation.cycle_id)
    .maybeSingle();

  // NONE means completion only. The keys are simply not added — omitted rather
  // than blanked, so a serialised response carries no evidence of a figure
  // (P20-3, and §5 again).
  if (!cycle || cycle.disclosure === "NONE" || cycle.cycle_type !== "INCREMENT") {
    return { ok: true, data: { completed: true } };
  }

  // Read from `salary_history`, not from `increment_reviews`: the employee may
  // not read that table at all, and the pay record is the thing that is true.
  const { data: row } = await supabase
    .from("salary_history")
    .select("new_ctc, effective_from")
    .eq("evaluation_id", evaluationId)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) return { ok: true, data: { completed: true } };

  return {
    ok: true,
    data: { completed: true, newCtc: row.new_ctc, effectiveFrom: row.effective_from },
  };
}

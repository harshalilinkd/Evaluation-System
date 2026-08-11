/** The salary review's reads (P21). HR and the MD only (§5, §9). */

import "server-only";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { median, monthsSince } from "@/lib/increment/calc";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

/* -- The two question ids from 0062 and 0017, derived the same way the
      migrations derive them: md5('linkd.q.' || key). Written out rather than
      computed at runtime, because there is no `key` column to look them up by
      — P2-3 keeps the seed keys in the migration and out of the schema. These
      are md5('linkd.q.mgr.hike_percent') and md5('linkd.q.mgr.promotion'),
      formatted 8-4-4-4-12, which is exactly what `md5(...)::uuid` yields in
      Postgres: the cast reinterprets the digest and sets no version bits. -- */
const MANAGER_HIKE_QUESTION_ID = "3ac71f32-a17a-3ec1-b745-a4c7656a05c8";
const MANAGER_PROMOTION_QUESTION_ID = "9c7ed575-296f-0f06-7566-5784eae0e25d";

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

  /**
   * What the manager recommended, from their own answer layer (0062).
   *
   * Read here rather than copied onto `increment_reviews`: the value belongs to
   * the rater who wrote it, and duplicating it into the salary table would make
   * two records of one opinion that can disagree the moment a return unlocks
   * the manager's layer and they change their mind.
   *
   * Null covers three different things and the screen must say which: no
   * manager answer yet, a manager who left it blank, or a promotion answer that
   * never revealed the field.
   */
  managerHikePct: number | null;
  /** Their promotion answer, so a blank percentage can be explained. */
  managerPromotion: string | null;
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

  /* -- THE MANAGER'S RECOMMENDATION, out of their own layer.
        §5 as amended by 0062: a rater RECORDS a percentage, and only HR and the
        MD read it back. This read runs on HR's or the MD's session, so RLS is
        what permits it — the manager can never reach this function.

        Both values come from the LEAD answers blob keyed by question id, which
        is why neither needed a column. -- */
  const { data: leadAnswers } = await supabase
    .from("evaluation_responses")
    .select("answers")
    .eq("evaluation_id", evaluationId)
    .eq("layer", "LEAD")
    .maybeSingle();

  const leadBlob = (leadAnswers?.answers ?? {}) as Record<string, unknown>;
  const rawHike = leadBlob[MANAGER_HIKE_QUESTION_ID];
  const parsedHike = rawHike === null || rawHike === undefined || rawHike === "" ? null : Number(rawHike);
  // A non-numeric or out-of-range answer scores as absent rather than being
  // clamped — P4-10's rule, and the figure here feeds a pay proposal.
  const managerHikePct =
    parsedHike !== null && Number.isFinite(parsedHike) && parsedHike >= 0 && parsedHike <= 100
      ? parsedHike
      : null;

  const rawPromotion = leadBlob[MANAGER_PROMOTION_QUESTION_ID];
  const managerPromotion =
    typeof rawPromotion === "string" && rawPromotion.trim() !== "" ? rawPromotion : null;

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
      managerHikePct,
      managerPromotion,
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

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
  /** Dates the baseline row of the pay history. 0024: the ONE joining date. */
  dateOfJoining: string | null;
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
  /**
   * The SECOND manager's recommendation, where the person has two (0083).
   *
   * Null for almost everybody, and null also when they have a second reviewer
   * who has not answered — the screen tells those apart by whether
   * `coManagerName` is set.
   */
  coManagerHikePct: number | null;
  coManagerPromotion: string | null;
  coManagerName: string | null;
  /** Their designation, which is what every surface actually shows. */
  coManagerDesignation: string | null;
  /**
   * WHAT THE MANAGERS TOGETHER RECOMMEND — the figure the quick-set offers.
   *
   * The MEAN of the two where both have answered, at the owner's instruction:
   * "the final Hike % is the average of the two managers' percentages". With
   * one manager it IS that manager's figure, so nothing about the ordinary case
   * changes — which is what makes this safe to put behind the existing button.
   *
   * Where a person has two managers and only one has answered, this is that
   * one's figure and the screen says so. Averaging a submitted recommendation
   * with a silence would invent a number: half of somebody's opinion is not the
   * other half's, and the mean of 10 and nothing is not 5.
   */
  recommendedHikePct: number | null;
  /** True only when the mean of two answers actually produced it. */
  recommendedIsAverage: boolean;
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
    .select("id, cycle_id, evaluatee_id, department_id, co_lead_id")
    .eq("id", evaluationId)
    .maybeSingle();

  if (!evaluation) return cycleError("NOT_FOUND", "That evaluation is not available.");

  const [{ data: profile }, { data: employment }, { data: review }, { data: settings }] =
    await Promise.all([
      supabase
        .from("profiles")
        // 0024 made this the ONE joining date. It dates the baseline row at the
        // foot of the pay history.
        .select("id, full_name, date_of_joining")
        .eq("id", evaluation.evaluatee_id)
        .maybeSingle(),
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
  // BOTH manager layers. `.in` rather than two queries: one round trip, and
  // one place the two can be seen to be read the same way.
  const { data: managerAnswers } = await supabase
    .from("evaluation_responses")
    .select("layer, answers")
    .eq("evaluation_id", evaluationId)
    .in("layer", ["LEAD", "LEAD_2"]);

  const blobFor = (layer: "LEAD" | "LEAD_2") =>
    ((managerAnswers ?? []).find((r) => r.layer === layer)?.answers ?? {}) as Record<
      string,
      unknown
    >;

  /* A non-numeric or out-of-range answer counts as ABSENT rather than being
     clamped — P4-10's rule, and it matters more here than anywhere: this figure
     feeds a pay proposal, and clamping would launder a typo into a real
     recommendation. */
  const hikeIn = (blob: Record<string, unknown>): number | null => {
    const raw = blob[MANAGER_HIKE_QUESTION_ID];
    const parsed = raw === null || raw === undefined || raw === "" ? null : Number(raw);
    return parsed !== null && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
      ? parsed
      : null;
  };
  const promotionIn = (blob: Record<string, unknown>): string | null => {
    const raw = blob[MANAGER_PROMOTION_QUESTION_ID];
    return typeof raw === "string" && raw.trim() !== "" ? raw : null;
  };

  const leadBlob = blobFor("LEAD");
  const managerHikePct = hikeIn(leadBlob);
  const managerPromotion = promotionIn(leadBlob);

  /* -- The second manager's NAME, so the card can attribute two figures.
        Two recommendations with no names beside them are two numbers nobody can
        act on: HR chasing a missing one needs to know which manager to ask. Only
        fetched where there is one, which is almost never. -- */
  let coManagerName: string | null = null;
  let coManagerDesignation: string | null = null;
  if (evaluation.co_lead_id) {
    const { data: coManager } = await supabase
      .from("profiles")
      .select("full_name, designation")
      .eq("id", evaluation.co_lead_id)
      .maybeSingle();
    coManagerName = coManager?.full_name ?? null;
    /* -- THEIR DESIGNATION, at the owner's instruction: "instead of
          Harshali bhopale mention their designations". A name says
          nothing about why a second percentage is on the page; "Design
          Coordinator" says it in two words. The NAME is still fetched
          because it is the fallback where a profile carries no
          designation (see lib/reports/reviewer.ts). -- */
    coManagerDesignation = coManager?.designation ?? null;
  }

  const coLeadBlob = blobFor("LEAD_2");
  const coManagerHikePct = evaluation.co_lead_id ? hikeIn(coLeadBlob) : null;
  const coManagerPromotion = evaluation.co_lead_id ? promotionIn(coLeadBlob) : null;

  /* -- The settled recommendation. Two answers average; one stands alone.
        Rounded to two decimals like every other stored percentage (§11), so the
        quick-set button and the figure it writes cannot differ in the last
        digit. -- */
  const bothAnswered = managerHikePct !== null && coManagerHikePct !== null;
  const recommendedHikePct = bothAnswered
    ? Math.round(((managerHikePct + coManagerHikePct) / 2) * 100) / 100
    : (managerHikePct ?? coManagerHikePct);

  /* -- THEIR WHOLE PAY HISTORY, oldest first, at the owner's instruction: "show
        all the increments, from joining salary till current".

        It was the last three, newest first. Three is enough context to stop a
        figure being set in a vacuum and not enough to see a career: somebody
        with five years of service had the start of it cut off, which is exactly
        the part that shows whether a 25% ask is a correction or a pattern.

        JOINING ROWS ARE EXCLUDED HERE and the baseline is rendered from
        `employment_records.joining_ctc` instead — P19E-1 made that column the
        start of the ledger precisely so it could not be read as a rise, and
        including both would show the joining figure twice.

        Still HR-and-MD-only data (§5); this panel is guarded to those two. -- */
  const { data: past } = await supabase
    .from("salary_history")
    .select("effective_from, previous_ctc, new_ctc, hike_amount, hike_pct, reason")
    .eq("profile_id", evaluation.evaluatee_id)
    .neq("reason", "JOINING")
    .order("effective_from", { ascending: true });

  /* ---------- WHEN WERE THEY LAST GIVEN A RISE ----------
     Reported as their JOINING DATE for a new joiner, which is wrong in the way
     that matters most on this panel: the field says "Last raise", and a date
     under it asserts that one happened. It also feeds the annualised-percent
     context, so a first increment was being annualised over the months since
     they JOINED rather than being shown as a first.

     `employment_records.last_increment_date` is not always trustworthy for this
     question, and 0068 says why in its own words: it made the ledger
     authoritative — "where there is a ledger of rises, its latest entry is the
     answer" — and then deliberately left the bootstrap case alone, "anybody
     with NO recorded rise keeps whatever was typed". Somebody imported with
     their joining date in that column therefore keeps it for ever.

     So the ledger decides, on exactly 0068's three reasons:

       · a recorded rise      → its date, which also self-heals a stale column
       · no rise, and the stored date IS their joining date
                              → null. A joining date is not an increment.
       · no rise, some other date
                              → kept. That is a real increment predating the
                                ledger, and blanking it would lose a fact
                                nothing else records.

     CORRECTION is not a rise and is excluded, as 0068 excludes it: fixing a
     figure that was typed wrong does not restart anybody's increment clock. */
  const RISE_REASONS = ["ANNUAL_INCREMENT", "PROMOTION", "MARKET_ADJUSTMENT"];
  const risesOnRecord = (past ?? []).filter((row) => RISE_REASONS.includes(row.reason));
  const storedLastIncrement = employment?.last_increment_date ?? null;

  const lastIncrementDate =
    risesOnRecord.length > 0
      ? // Ordered ascending above, so the last is the newest — the same MAX
        // 0068 takes in SQL.
        (risesOnRecord.at(-1)?.effective_from ?? null)
      : storedLastIncrement && storedLastIncrement === (profile?.date_of_joining ?? null)
        ? null
        : storedLastIncrement;

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
      dateOfJoining: profile?.date_of_joining ?? null,
      lastIncrementDate,
      // Follows the corrected date, or the annualised-percent line would still
      // count from the day they joined.
      monthsSinceLastIncrement: monthsSince(lastIncrementDate, new Date()),
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
      coManagerHikePct,
      coManagerPromotion,
      coManagerName,
      coManagerDesignation,
      recommendedHikePct,
      recommendedIsAverage: bothAnswered,
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

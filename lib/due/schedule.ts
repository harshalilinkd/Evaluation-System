"use server";

/** The evaluation schedule (0076). Reading it, and HR changing it. */

import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export type EvaluationSchedule = {
  joinerEvaluationMonths: number[];
  joinerIncrementMonths: number;
  cycleEvaluationMonths: number[];
  cycleIncrementMonths: number;
  noticeDays: number;
};

/**
 * What the schedule is today.
 *
 * FALLS BACK TO THE SHIPPED DEFAULTS rather than throwing. The screens that
 * read this — the settings tab, and anywhere a due date is explained — should
 * render with the values the product ships with if the row cannot be read,
 * exactly as `SECTION_LABELS` does for section names (P25-5). A settings page
 * that will not open because it could not read a setting is worse than one
 * showing the default.
 */
export async function getEvaluationSchedule(): Promise<EvaluationSchedule> {
  const fallback: EvaluationSchedule = {
    joinerEvaluationMonths: [1, 6],
    joinerIncrementMonths: 12,
    cycleEvaluationMonths: [3, 9],
    cycleIncrementMonths: 12,
    noticeDays: 30,
  };

  try {
    const supabase = await createClient();
    const { data } = await supabase.from("evaluation_schedule").select("*").maybeSingle();
    if (!data) return fallback;
    return {
      joinerEvaluationMonths: data.joiner_evaluation_months ?? fallback.joinerEvaluationMonths,
      joinerIncrementMonths: data.joiner_increment_months ?? fallback.joinerIncrementMonths,
      cycleEvaluationMonths: data.cycle_evaluation_months ?? fallback.cycleEvaluationMonths,
      cycleIncrementMonths: data.cycle_increment_months ?? fallback.cycleIncrementMonths,
      noticeDays: data.notice_days ?? fallback.noticeDays,
    };
  } catch {
    return fallback;
  }
}

export type ScheduleResult =
  | { ok: true; swept: number }
  | { ok: false; message: string };

/**
 * Change it, and recalculate everybody.
 *
 * THE RECALCULATION IS IN THE FUNCTION, not here. `save_evaluation_schedule`
 * withdraws the pending items the new schedule no longer produces and sweeps
 * for the ones it does, in the same transaction as the write — so there is no
 * moment where the setting says one thing and the due list shows another. Doing
 * it in two calls from here would leave exactly that window, and a crash
 * between them would leave it permanently.
 */
export async function saveEvaluationSchedule(input: {
  joinerEvaluationMonths: number[];
  joinerIncrementMonths: number;
  cycleEvaluationMonths: number[];
  cycleIncrementMonths: number;
  noticeDays: number;
}): Promise<ScheduleResult> {
  const auth = await checkRole(["HR_ADMIN"]);
  if (!auth.ok) return { ok: false, message: auth.error.message };

  /* -- Sorted and deduplicated before it is stored.
        HR types "9, 3" as readily as "3, 9" and means the same schedule; the
        sweep reads them in order, and a duplicate would try to create the same
        milestone twice and be swallowed by the unique index — a silent
        no-op rather than a visible refusal. Cheaper to normalise than to
        explain. -- */
  const clean = (months: number[]) =>
    [...new Set(months.filter((m) => Number.isFinite(m) && m > 0).map(Math.round))].sort(
      (a, b) => a - b,
    );

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_evaluation_schedule", {
    p_joiner_evaluation_months: clean(input.joinerEvaluationMonths),
    p_joiner_increment_months: Math.round(input.joinerIncrementMonths),
    p_cycle_evaluation_months: clean(input.cycleEvaluationMonths),
    p_cycle_increment_months: Math.round(input.cycleIncrementMonths),
    p_notice_days: Math.round(input.noticeDays),
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/settings");
  revalidatePath("/admin/due");
  revalidatePath("/admin/increments");
  return { ok: true, swept: (data as number | null) ?? 0 };
}

/** The whole company's salary history as ONE sheet — HR and the MD (§5). */

import "server-only";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { createClient } from "@/lib/supabase/server";

export type HistoryGridIncrement = {
  id: string;
  effectiveFrom: string;
  newCtc: number;
};

export type HistoryGridRow = {
  profileId: string;
  name: string;
  employeeCode: string | null;
  track: string;
  dateOfJoining: string | null;
  joiningCtc: number | null;
  hasEmploymentRecord: boolean;
  /** Every real rise, oldest first — "Increment 1" is `increments[0]`, and so
   *  on. Never padded here; the CALLER decides how many columns to draw from
   *  the longest row, so a person with two rises simply has nothing past
   *  "Increment 2" rather than the query inventing blanks. */
  increments: HistoryGridIncrement[];
};

/**
 * ONE ROW PER PERSON, EVERY RISE ITS OWN COLUMN PAIR.
 *
 * Asked for directly: the roster (Settings › Users) shows one "Current
 * salary" figure per person because that is what a roster is for, and the
 * moment somebody wants to SEE the whole ledger at a glance — not open each
 * person one at a time — a fixed set of columns cannot hold a history that
 * keeps growing. This mirrors the shape the employee CSV import already
 * uses for exactly the same reason (F56's `increment_N_date` /
 * `increment_N_amount` pairs) — a format HR has already met once.
 */
export async function getEmploymentHistoryGrid(): Promise<CycleResult<{ rows: HistoryGridRow[] }>> {
  const supabase = await createClient();

  const [{ data: profiles }, { data: records }, { data: history }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, employee_code, track, date_of_joining")
      .eq("is_active", true)
      .order("full_name"),
    supabase.from("employment_records").select("profile_id, joining_ctc"),
    supabase
      .from("salary_history")
      .select("id, profile_id, effective_from, new_ctc, reason")
      .neq("reason", "JOINING")
      .order("effective_from", { ascending: true })
      .order("recorded_at", { ascending: true }),
  ]);

  if (!profiles) return cycleError("QUERY_FAILED", "Could not read the roster.");

  const joiningByProfile = new Map((records ?? []).map((r) => [r.profile_id, r.joining_ctc] as const));
  const employmentByProfile = new Set((records ?? []).map((r) => r.profile_id));

  const incrementsByProfile = new Map<string, HistoryGridIncrement[]>();
  for (const row of history ?? []) {
    const list = incrementsByProfile.get(row.profile_id) ?? [];
    list.push({ id: row.id, effectiveFrom: row.effective_from, newCtc: row.new_ctc });
    incrementsByProfile.set(row.profile_id, list);
  }

  const rows: HistoryGridRow[] = profiles.map((p) => ({
    profileId: p.id,
    name: p.full_name,
    employeeCode: p.employee_code,
    track: p.track,
    dateOfJoining: p.date_of_joining,
    joiningCtc: joiningByProfile.get(p.id) ?? null,
    hasEmploymentRecord: employmentByProfile.has(p.id),
    increments: incrementsByProfile.get(p.id) ?? [],
  }));

  return { ok: true, data: { rows } };
}

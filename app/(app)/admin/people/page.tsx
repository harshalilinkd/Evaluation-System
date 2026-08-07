/** /admin/people — "Team review": the staff roster, and the way into a scorecard. */

import type { Metadata } from "next";

import { PeopleClient, type PersonRow } from "@/app/(app)/admin/people/people-client";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Team review" };

export default async function PeoplePage() {
  // §9: the guard is the first statement. A user without the role is
  // redirected before any markup is produced, never shown and then hidden.
  await requireRole(ADMIN_ROLES);

  const supabase = await createClient();

  /* -- The current cycle frames the whole screen. "Where does this person
        stand" is meaningless without saying which cycle, and showing every
        cycle at once would put three rows on screen for one person. -- */
  const { data: cycle } = await supabase
    .from("evaluation_cycles")
    .select("id, name, period_label, status")
    .in("status", ["ACTIVE", "CLOSED"])
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle();

  const [{ data: people, error }, { data: departments }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, employee_code, designation, department_id, reports_to, is_active")
      .eq("track", "STAFF")
      .order("full_name"),
    supabase.from("departments").select("id, name").order("name"),
  ]);

  if (error) return <ErrorState title="Could not load the roster" body={error.message} />;

  /* -- Every read here goes through the AUTHENTICATED client, so RLS decides
        what this person may see (§9). The role guard above is the clean exit,
        not the protection — P16-9 made the same call for the scorecard. -- */
  const { data: evaluations } = cycle
    ? await supabase
        .from("evaluations")
        .select("evaluatee_id, status, self_overall, lead_overall, final_overall, excluded_at")
        .eq("cycle_id", cycle.id)
    : { data: [] };

  const departmentName = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const leadName = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const byPerson = new Map((evaluations ?? []).map((e) => [e.evaluatee_id, e]));

  const rows: PersonRow[] = (people ?? []).map((p) => {
    const evaluation = byPerson.get(p.id) ?? null;
    return {
      id: p.id,
      fullName: p.full_name,
      employeeCode: p.employee_code,
      designation: p.designation,
      departmentName: p.department_id ? (departmentName.get(p.department_id) ?? null) : null,
      leadName: p.reports_to ? (leadName.get(p.reports_to) ?? null) : null,
      isActive: p.is_active,
      // A withdrawn participant (P10-6) is not "in progress" — the organisation
      // stopped asking. Reporting it as a status would put them in the chase
      // list for a form nobody is waiting on.
      status: evaluation?.excluded_at ? null : (evaluation?.status ?? null),
      excluded: Boolean(evaluation?.excluded_at),
      self: evaluation?.self_overall ?? null,
      lead: evaluation?.lead_overall ?? null,
      final: evaluation?.final_overall ?? null,
    };
  });

  return (
    <PeopleClient
      rows={rows}
      departments={(departments ?? []).map((d) => d.name)}
      cycleLabel={cycle ? `${cycle.name} · ${cycle.period_label}` : null}
    />
  );
}

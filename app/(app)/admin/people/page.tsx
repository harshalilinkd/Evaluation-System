/** /admin/people — "Team review": the staff roster, and the way into a scorecard. */

import type { Metadata } from "next";

import { PeopleClient, type PersonRow } from "@/app/(app)/admin/people/people-client";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Team review" };

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>;
}) {
  // §9: the guard is the first statement. A user without the role is
  // redirected before any markup is produced, never shown and then hidden.
  await requireRole(ADMIN_ROLES);

  const supabase = await createClient();
  const { cycle: requestedCycle } = await searchParams;

  /* -- ONE CYCLE FRAMES THE SCREEN, AND THE READER CHOOSES WHICH.
        "Where does this person stand" is meaningless without saying which
        cycle, and showing every cycle at once would put three rows on screen
        for one person — so it stays one at a time.

        WHAT WAS WRONG was not that one is shown. It is that one was shown with
        NO WAY TO REACH THE OTHERS: this took the newest and stopped, so with an
        Evaluation round and an Increment round both open, half the company's
        scores were simply unreachable from here and the four counters above the
        table described one exercise while reading as though they described the
        company. Exactly the fault F16-1 fixed on the dashboard, on the screen
        that never got the same treatment.

        THEY ARE NOT MERGED, and that is the other half of the decision.
        Averaging an Evaluation cycle with an Increment one produces a figure
        that describes neither exercise, and §11 keeps a score inside the cycle
        it was given in. So this SWITCHES rather than combines.

        `deleted_at is null` because 0032's recycle bin is a timestamp and not a
        status — a binned cycle is still ACTIVE, and being the newest it could
        otherwise have been the one the whole screen described (F16-3). -- */
  const { data: allCycles } = await supabase
    .from("evaluation_cycles")
    .select("id, name, period_label, status")
    .in("status", ["ACTIVE", "CLOSED"])
    .is("deleted_at", null)
    .order("starts_on", { ascending: false });

  const cycles = allCycles ?? [];
  /* A `?cycle=` naming something that is not open falls back to the newest
     rather than emptying the screen — a stale bookmark should not look like a
     company with nobody in it. */
  const cycle = (requestedCycle ? cycles.find((c) => c.id === requestedCycle) : null) ?? cycles[0] ?? null;

  const [{ data: people, error }, { data: departments }] = await Promise.all([
    supabase
      .from("profiles")
      /* -- BOTH TEAMS, and this is the fix for a real gap rather than a
            widening of §7.

            The roster was `track = 'STAFF'`, so a production worker appeared
            nowhere in it — and the Employment tab is reached from this table
            and from nothing else. So there was no way at all for HR to record a
            worker's salary, joining date or increment schedule, which is
            exactly why the production appraisal's Current salary box says "Not
            on their employment record". The panel asked for a figure the app
            gave nobody a way to enter.

            §7's isolation rule is about FUNCTIONS — never refactor a staff
            evaluation path to serve the worker module. `profiles`,
            `departments` and `employment_records` are the shared
            infrastructure §7 explicitly lists, and this is a list of people
            against a list of people. The staff EVALUATION columns stay staff:
            the query below is unchanged and a worker simply has no row in it,
            so nothing from one module is fed into the other's figures. -- */
      .select("id, full_name, employee_code, designation, department_id, reports_to, is_active, track")
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
      track: p.track,
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
      cycles={cycles.map((c) => ({ id: c.id, name: c.name, periodLabel: c.period_label }))}
      cycleId={cycle?.id ?? null}
    />
  );
}

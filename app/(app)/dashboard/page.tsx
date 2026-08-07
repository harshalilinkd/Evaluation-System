/** /dashboard — role-aware, built on P16's views. */

import type { Metadata } from "next";

import { DashboardClient } from "@/app/(app)/dashboard/dashboard-client";
import { ErrorState } from "@/components/appraise/states";
import { requireAuth } from "@/lib/auth/guards";
import { getAnalytics } from "@/lib/analytics/queries";
import { getDueList } from "@/lib/due/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Page() {
  // §9: the guard is the first statement, so nothing renders before it.
  const { profile, roles } = await requireAuth();

  /* -- P16's six views, at last.
        The old dashboard counted rows through the authenticated client and
        showed everybody the same four tiles. `getAnalytics` picks the audience
        from the roles and every view is `security_invoker`, so RLS is what
        decides the numbers — an employee's dashboard is their own slice by
        construction rather than by a filter somebody has to remember. -- */
  const analytics = await getAnalytics(profile.id, roles);
  if (!analytics.ok) {
    return <ErrorState title="Could not load your dashboard" body={analytics.error.message} />;
  }

  /* -- P22: "This screen is how HR runs the year. It should be the first thing
        on their dashboard." Only fetched for the roles that can act on it — an
        employee has no business seeing who is due an increment (§5). -- */
  const isAdmin = roles.includes("HR_ADMIN") || roles.includes("MD");
  const due = isAdmin ? await getDueList() : null;

  /* -- Their own open work, whatever their role. Everybody has an appraisal to
        fill in, HR and the MD included (§9's simultaneous-roles case). -- */
  const supabase = await createClient();
  const { data: mine } = await supabase
    .from("evaluations")
    .select("id, status, due_self_on, self_submitted_at")
    .eq("evaluatee_id", profile.id)
    .eq("status", "OPEN")
    .is("excluded_at", null)
    .is("self_submitted_at", null)
    .limit(1)
    .maybeSingle();

  /* -- A lead's own queue: how many of their reports they have still to rate.
        Counted from the LEAD layer only — reading the employee's side to build
        a dashboard number would be the blindness leak by another route (A3-10). -- */
  const isLead = roles.includes("HOD") || roles.includes("SUPERVISOR");
  const { count: toRate } = isLead
    ? await supabase
        .from("evaluations")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", profile.id)
        .eq("status", "OPEN")
        .is("lead_submitted_at", null)
        .is("excluded_at", null)
    : { count: 0 };

  return (
    <DashboardClient
      analytics={analytics.data}
      firstName={profile.full_name.trim().split(/\s+/)[0] ?? "there"}
      myEvaluationId={mine?.id ?? null}
      myDueOn={mine?.due_self_on ?? null}
      toRate={toRate ?? 0}
      due={
        due?.ok
          ? {
              total: due.data.rows.length,
              thisMonth: due.data.thisMonth,
              overdue: due.data.overdue,
              increments: due.data.incrementsDue,
            }
          : null
      }
    />
  );
}

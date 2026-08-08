/** /dashboard — role-aware, built on P16's views. */

import type { Metadata } from "next";

import { DashboardClient } from "@/app/(app)/dashboard/dashboard-client";
import { ErrorState } from "@/components/appraise/states";
import { requireAuth } from "@/lib/auth/guards";
import { getAnalytics } from "@/lib/analytics/queries";
import { getDueList } from "@/lib/due/queries";
import { createClient } from "@/lib/supabase/server";
import { greetingFor } from "@/lib/utils/date";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Page() {
  // §9: the guard is the first statement, so nothing renders before it.
  const { profile, roles } = await requireAuth();

  const isAdmin = roles.includes("HR_ADMIN") || roles.includes("MD");
  const isLead = roles.includes("HOD") || roles.includes("SUPERVISOR");
  const supabase = await createClient();

  /* -- Four independent reads, ISSUED TOGETHER.
        They ran one after another, and each waited a full round trip to the
        database before the next was sent — on the landing page, which is the
        first thing anybody sees after signing in. Nothing here needs anything
        another returns: the analytics, the due list and both personal counts
        are keyed by the profile and the roles, and the guard has already
        established both.

        RLS still judges every query on its own — each carries the same session
        and meets the same policies. Only the waiting is shared.

        P16's six views: `getAnalytics` picks the audience from the roles and
        every view is `security_invoker`, so RLS decides the numbers — an
        employee's dashboard is their own slice by construction rather than by
        a filter somebody has to remember.

        P22: the due list is fetched only for the roles that can act on it. An
        employee has no business seeing who is due an increment (§5), so the
        query does not run rather than running and being hidden. -- */
  const [analytics, due, { data: mine }, { count: toRate }] = await Promise.all([
    getAnalytics(profile.id, roles),

    isAdmin ? getDueList() : Promise.resolve(null),

    // Their own open work, whatever their role. Everybody has an appraisal to
    // fill in, HR and the MD included (§9's simultaneous-roles case).
    supabase
      .from("evaluations")
      /* -- `!inner` on the cycle so a BINNED one is excluded.
            0032 gave cycles a `deleted_at` and nothing that reads evaluations
            ever filtered on it — so binning a cycle removed it from the cycles
            list and left its evaluations in every queue, count and dashboard.
            A recycle bin that only hides the folder is not a recycle bin. -- */
      .select("id, status, due_self_on, self_submitted_at, evaluation_cycles!inner(deleted_at)")
      .eq("evaluatee_id", profile.id)
      .eq("status", "OPEN")
      .is("excluded_at", null)
      .is("self_submitted_at", null)
      .is("evaluation_cycles.deleted_at", null)
      .limit(1)
      .maybeSingle(),

    /* -- A lead's own queue: how many of their reports they have still to rate.
          Counted from the LEAD layer only — reading the employee's side to
          build a dashboard number would be the blindness leak by another route
          (A3-10). -- */
    isLead
      ? supabase
          .from("evaluations")
          // Same binned-cycle exclusion as above — this is the count that was
          // reported as "2 to rate" against a single live cycle.
          .select("id, evaluation_cycles!inner(deleted_at)", { count: "exact", head: true })
          .eq("lead_id", profile.id)
          .eq("status", "OPEN")
          .is("lead_submitted_at", null)
          .is("excluded_at", null)
          .is("evaluation_cycles.deleted_at", null)
      : Promise.resolve({ count: 0 }),
  ]);

  if (!analytics.ok) {
    return <ErrorState title="Could not load your dashboard" body={analytics.error.message} />;
  }

  return (
    <DashboardClient
      analytics={analytics.data}
      firstName={profile.full_name.trim().split(/\s+/)[0] ?? "there"}
      greeting={greetingFor()}
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

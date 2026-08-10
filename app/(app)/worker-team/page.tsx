/** The supervisor's shop-floor round: hand the device over, then rate. */

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, HardHat } from "lucide-react";

import { EmptyState } from "@/components/appraise/states";
import { Button } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/date";

export const metadata: Metadata = { title: "Shop floor" };

export default async function Page() {
  const session = await requireAuth();
  const supabase = await createClient();

  /* -- Their own reports, in the open round. RLS admits exactly these rows
        anyway; the filter is what makes the query small, not what makes it
        safe. -- */
  const { data: rows } = await supabase
    .from("worker_evaluations")
    .select("id, worker_id, status, self_submitted_at, supervisor_submitted_at, cycle_id")
    .eq("supervisor_id", session.profile.id)
    .eq("status", "OPEN")
    .is("excluded_at", null);

  const list = rows ?? [];

  if (list.length === 0) {
    return (
      <EmptyState
        title="Nothing on the shop floor right now"
        body="When HR starts an appraisal round for your team, everybody in it appears here."
      />
    );
  }

  const [{ data: people }, { data: cycle }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, employee_code")
      .in("id", list.map((r) => r.worker_id)),
    supabase
      .from("worker_cycles")
      .select("name, period_label, supervisor_due_on")
      .eq("id", list[0]!.cycle_id)
      .maybeSingle(),
  ]);

  const byId = new Map((people ?? []).map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-display-sm font-semibold text-ink">
          <HardHat className="size-5 text-ink-muted" aria-hidden />
          Shop floor
        </h1>
        <p className="mt-1 font-sans text-body-sm text-ink-muted">
          {cycle?.name} · {cycle?.period_label}
          {cycle?.supervisor_due_on ? ` · your ratings due ${formatDate(cycle.supervisor_due_on)}` : ""}
        </p>
      </header>

      {/* -- How the flow works, said once and in order.
            The two buttons on each row are not interchangeable and the order
            matters: the worker answers first, in private, and the supervisor
            rates afterwards. Somebody who rates first and hands over second has
            told the worker what they think, which is what blind rating is for. -- */}
      <div className="rounded-card bg-accent px-4 py-3 font-sans text-body-sm text-accent-foreground">
        <p className="font-medium">Two steps for each person, in this order.</p>
        <p className="mt-1">
          First hand them the device so they tick their own sheet — step away while they do it.
          Then rate them yourself. You will not see their answers and they will not see yours;
          only HR and management see both.
        </p>
      </div>

      <ul className="space-y-3">
        {list.map((row) => {
          const worker = byId.get(row.worker_id);
          const theirsIn = Boolean(row.self_submitted_at);
          const yoursIn = Boolean(row.supervisor_submitted_at);

          return (
            <li key={row.id} className="card-surface p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-sans text-body-lg text-ink">{worker?.full_name ?? "Worker"}</p>
                  <p className="tabular font-sans text-body-sm text-ink-muted">
                    {worker?.employee_code ?? "—"}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {/* -- STEP 1. Disabled once done, with the reason beside it
                        rather than in a tooltip — there is no hover on a
                        tablet, and this whole flow happens on one (§13.4). -- */}
                  {theirsIn ? (
                    <span className="inline-flex min-h-11 items-center rounded-control bg-surface-mute px-4 font-sans text-body-sm text-ink-muted">
                      They have answered
                    </span>
                  ) : (
                    <Button asChild variant="outline" className="min-h-11">
                      <Link href={`/worker-team/${row.id}/handover`}>
                        Hand them the form
                        <ArrowRight className="ml-1.5 size-4" aria-hidden />
                      </Link>
                    </Button>
                  )}

                  {/* -- STEP 2. The supervisor's own sheet, which is the one
                        route they may write. -- */}
                  {yoursIn ? (
                    <span className="inline-flex min-h-11 items-center rounded-control bg-success-tint px-4 font-sans text-body-sm text-ink">
                      Your rating is in
                    </span>
                  ) : (
                    <Button asChild className="min-h-11">
                      <Link href={`/worker-appraisal/${row.id}`}>Rate them</Link>
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

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

  /* -- ONE ROUND AT A TIME.
        This selected every OPEN appraisal assigned to the supervisor across
        ALL rounds and listed them together, so a few test rounds produced five
        rows for what is one worker — and the header above still named a single
        round and a single due date, so the page contradicted itself.

        Newest round only. The rest are not lost: they are still OPEN and appear
        the moment this one closes, and HR's board is the screen that shows the
        whole picture. A supervisor is working one round at a time by the nature
        of the job. -- */
  const all = rows ?? [];

  /* -- The round is chosen from `worker_cycles`, not by sorting the evaluation
        rows. A uuid has no chronological order, so picking "the newest
        cycle_id" would be picking one at random and calling it the latest. -- */
  const { data: openCycles } = await supabase
    .from("worker_cycles")
    .select("id, name, period_label, supervisor_due_on, created_at")
    .in("id", [...new Set(all.map((r) => r.cycle_id))])
    .order("created_at", { ascending: false })
    .limit(1);

  const round = openCycles?.[0] ?? null;
  const list = round ? all.filter((r) => r.cycle_id === round.id) : [];

  if (list.length === 0) {
    return (
      <EmptyState
        title="Nothing on the shop floor right now"
        body="When HR starts an appraisal round for your team, everybody in it appears here."
      />
    );
  }

  /* `round` above already IS this cycle — it was selected to decide which
     round to show. Fetching it a second time would be another round trip for a
     row we are holding. */
  const cycle = round;

  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, employee_code")
    .in("id", list.map((r) => r.worker_id));

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

      {/* -- ONE STEP NOW, at the owner's instruction. The hand-over is gone,
            so the two-step explainer went with it: an instruction describing a
            button that is not there is worse than none. -- */}
      <div className="rounded-card bg-accent px-4 py-3 font-sans text-body-sm text-accent-foreground">
        Rate each person on the eight qualities, add the salary block, and submit. It goes to HR
        for review as soon as you do.
      </div>

      <ul className="space-y-3">
        {list.map((row) => {
          const worker = byId.get(row.worker_id);
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
                  {/* -- The one action. Once it is in, the row says so rather
                        than offering a button that would reopen a locked sheet
                        — there is no hover on a tablet, and this whole flow
                        happens on one, so the state is written out (§13.4). -- */}
                  {yoursIn ? (
                    <span className="inline-flex min-h-11 items-center rounded-control bg-success-tint px-4 font-sans text-body-sm text-ink">
                      Rated — with HR
                    </span>
                  ) : (
                    <Button asChild className="min-h-11">
                      <Link href={`/worker-appraisal/${row.id}`}>
                        Rate them
                        <ArrowRight className="ml-1.5 size-4" aria-hidden />
                      </Link>
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

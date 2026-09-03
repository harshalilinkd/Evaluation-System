/** The supervisor's shop-floor round: hand the device over, then rate. */

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, HardHat } from "lucide-react";

import { EmptyState } from "@/components/appraise/states";
import { Button } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/date";

export const metadata: Metadata = { title: "Production Team" };

export default async function Page() {
  const session = await requireAuth();
  const supabase = await createClient();

  /* -- Their own reports, in the open round. RLS admits exactly these rows
        anyway; the filter is what makes the query small, not what makes it
        safe. -- */
  const [{ data: rows }, { data: reviewRows }] = await Promise.all([
    supabase
      .from("worker_evaluations")
      .select("id, worker_id, status, supervisor_submitted_at, cycle_id")
      .eq("supervisor_id", session.profile.id)
      .eq("status", "OPEN")
      .is("excluded_at", null),
    /* -- 0100: appraisals somebody has rated and handed to THIS person to
          review. Across every round, deliberately — unlike the rating queue
          below, these are finished pieces of work waiting on one decision, and
          holding one back because it belongs to an older round would leave it
          waiting for ever with nothing on screen to say so. Each row carries
          its own round name instead. -- */
    supabase
      .from("worker_evaluations")
      .select("id, worker_id, cycle_id, supervisor_submitted_at")
      .eq("reviewer_id", session.profile.id)
      .eq("status", "PENDING_SUPERVISOR")
      .is("excluded_at", null)
      .order("supervisor_submitted_at", { ascending: true }),
  ]);

  const toReview = reviewRows ?? [];

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

  if (list.length === 0 && toReview.length === 0) {
    return (
      <EmptyState
        title="Nothing for your team right now"
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
    .select("id, full_name, employee_code, designation, date_of_joining, departments(name)")
    .in("id", [...new Set([...list, ...toReview].map((r) => r.worker_id))]);

  const byId = new Map((people ?? []).map((p) => [p.id, p]));

  /* -- The round each review belongs to. Named on the row rather than in a
        header, because these span rounds. -- */
  const { data: reviewCycles } = toReview.length
    ? await supabase
        .from("worker_cycles")
        .select("id, name, period_label")
        .in("id", [...new Set(toReview.map((r) => r.cycle_id))])
    : { data: [] };

  const cycleById = new Map((reviewCycles ?? []).map((c) => [c.id, c]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-display-sm font-semibold text-ink">
          <HardHat className="size-5 text-ink-muted" aria-hidden />
          Production Team
        </h1>
        <p className="mt-1 font-sans text-body-sm text-ink-muted">
          {cycle
            ? `${cycle.name} · ${cycle.period_label}${
                cycle.supervisor_due_on
                  ? ` · your ratings due ${formatDate(cycle.supervisor_due_on)}`
                  : ""
              }`
            : "Appraisals waiting on your review."}
        </p>
      </header>

      {/* ---------- Waiting on your review (0100) ----------
            First, because it is the older work: somebody has finished rating
            and this is the one step between them and HR. A section that only
            appears when it has something in it, so the page does not carry an
            empty heading for a job this person may never do. */}
      {toReview.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="font-sans text-body-lg text-ink">Waiting on your review</h2>
            <p className="mt-0.5 font-sans text-body-sm text-ink-muted">
              The team leader has rated them. Read the ratings, then record your comment, whether
              training is required, and the increment you recommend.
            </p>
          </div>

          <ul className="space-y-3">
            {toReview.map((row) => {
              const worker = byId.get(row.worker_id);
              const round = cycleById.get(row.cycle_id);

              return (
                <li key={row.id} className="card-surface p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-sans text-body-lg text-ink">
                        {worker?.full_name ?? "Worker"}
                      </p>
                      <p className="font-sans text-body-sm text-ink-muted">
                        {[
                          worker?.employee_code,
                          worker?.designation,
                          worker?.departments?.name,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No employee ID or designation on their profile"}
                      </p>
                      <p className="font-sans text-body-sm text-ink-muted">
                        {[
                          round ? `${round.name} · ${round.period_label}` : null,
                          row.supervisor_submitted_at
                            ? `rated ${formatDate(row.supervisor_submitted_at)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>

                    <Button asChild className="min-h-11">
                      <Link href={`/worker-review/${row.id}`}>
                        Review
                        <ArrowRight className="ml-1.5 size-4" aria-hidden />
                      </Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* -- ONE STEP NOW, at the owner's instruction. The hand-over is gone,
            so the two-step explainer went with it: an instruction describing a
            button that is not there is worse than none. -- */}
      {list.length > 0 ? (
        <>
          <div className="rounded-card bg-accent px-4 py-3 font-sans text-body-sm text-accent-foreground">
            {/* -- Deliberately does not name where it goes: a reviewer is set
                  per worker, so on one round some of these go to a supervisor
                  and some straight to HR. A sentence that is true of half the
                  list is worse than one that is true of all of it. -- */}
            Rate each person on the eight qualities and submit. Each one moves on for review as
            soon as you do.
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
                  {/* -- WHO, WHERE AND BY WHEN.
                        The card was a name and an em dash — the dash being an
                        employee code nobody had filled in — which is not enough
                        to rate somebody from, and on a floor with two people of
                        similar names it is not even enough to identify them.
                        Every field is dropped rather than shown empty, so the
                        line carries only what is actually known. -- */}
                  <p className="font-sans text-body-sm text-ink-muted">
                    {[
                      worker?.employee_code,
                      worker?.designation,
                      worker?.departments?.name,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No employee ID or designation on their profile"}
                  </p>
                  <p className="font-sans text-body-sm text-ink-muted">
                    {[
                      cycle ? `${cycle.name} · ${cycle.period_label}` : null,
                      worker?.date_of_joining
                        ? `joined ${formatDate(worker.date_of_joining)}`
                        : null,
                      cycle?.supervisor_due_on
                        ? `due ${formatDate(cycle.supervisor_due_on)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
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
        </>
      ) : null}
    </div>
  );
}

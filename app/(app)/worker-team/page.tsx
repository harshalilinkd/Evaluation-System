/** A team leader's and supervisor's production appraisals: to rate, to review, done. */

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, HardHat } from "lucide-react";

import { EmptyState } from "@/components/appraise/states";
import { Button } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/date";
import { roundLabel } from "@/lib/utils/round-label";

export const metadata: Metadata = { title: "Production Team" };

export default async function Page() {
  const session = await requireAuth();
  const supabase = await createClient();

  /* -- EVERYTHING ASSIGNED TO THEM, not only what is still open.
        This read `status = 'OPEN'` alone, so a sheet vanished from this list
        the moment it was submitted: a team leader rated six people and was left
        looking at two, with no record of the six and no idea where they had
        gone. The "Rated — with HR" chip in the old code could never render for
        the same reason — an OPEN row is by definition not yet rated. RLS admits
        exactly these rows anyway; the filter keeps the query small, it is not
        what makes it safe. -- */
  const [{ data: mineRows }, { data: reviewRows }] = await Promise.all([
    supabase
      .from("worker_evaluations")
      .select("id, worker_id, status, supervisor_submitted_at, cycle_id, reviewer_id")
      .eq("supervisor_id", session.profile.id)
      .is("excluded_at", null),
    /* -- 0100: appraisals somebody else rated and handed to THIS person to
          review — waiting, and already reviewed. Excludes the combined case
          (they rated it themselves), which is already in the list above. -- */
    supabase
      .from("worker_evaluations")
      .select("id, worker_id, status, supervisor_id, supervisor_submitted_at, reviewer_submitted_at, cycle_id")
      .eq("reviewer_id", session.profile.id)
      .neq("supervisor_id", session.profile.id)
      .is("excluded_at", null),
  ]);

  /* -- EVERY ROUND, each with its own heading and due date.
        This used to show the newest round only, and said why: a few test rounds
        had put one worker on the list five times under a header naming a single
        due date, so the page contradicted itself. That cause is gone — the
        launch dialog now refuses to put a worker into a second open round
        (openRoundName) — and what remained was the cost: a sheet in an older
        round was invisible here until the newer one closed, with nothing to say
        it existed. One section per round keeps the header honest, which was the
        whole of the original objection.

        Binned rounds are dropped (FIX-17): a sheet in the recycle bin is not
        work anybody is waiting on. -- */
  const cycleIds = [
    ...new Set([...(mineRows ?? []), ...(reviewRows ?? [])].map((r) => r.cycle_id)),
  ];
  const { data: cycles } = cycleIds.length
    ? await supabase
        .from("worker_cycles")
        .select("id, name, period_label, supervisor_due_on, created_at")
        .in("id", cycleIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
    : { data: [] };

  const cycleById = new Map((cycles ?? []).map((c) => [c.id, c]));
  const live = <T extends { cycle_id: string }>(r: T) => cycleById.has(r.cycle_id);

  const mine = (mineRows ?? []).filter(live);
  const reviewing = (reviewRows ?? []).filter(live);

  const toRate = mine.filter((r) => r.status === "OPEN" && !r.supervisor_submitted_at);
  const toReview = reviewing
    .filter((r) => r.status === "PENDING_SUPERVISOR")
    .sort((a, b) => (a.supervisor_submitted_at ?? "").localeCompare(b.supervisor_submitted_at ?? ""));

  /* -- DONE: rated by them, or reviewed by them, newest first. Capped, because
        this is a reminder of recent work and not an archive — HR's board is the
        full record. -- */
  const done = [
    ...mine
      .filter((r) => r.supervisor_submitted_at)
      .map((r) => ({ ...r, at: r.supervisor_submitted_at as string, role: "rated" as const })),
    ...reviewing
      .filter((r) => r.reviewer_submitted_at)
      .map((r) => ({ ...r, at: r.reviewer_submitted_at as string, role: "reviewed" as const })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 30);

  if (toRate.length === 0 && toReview.length === 0 && done.length === 0) {
    return (
      <EmptyState
        title="Nothing for your team right now"
        body="When HR starts an appraisal round for your team, everybody in it appears here."
      />
    );
  }

  const workerIds = [...new Set([...toRate, ...toReview, ...done].map((r) => r.worker_id))];
  const reviewerIds = [
    ...new Set(done.map((r) => ("reviewer_id" in r ? r.reviewer_id : null)).filter((v): v is string => Boolean(v))),
  ];
  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, employee_code, designation, date_of_joining, departments(name)")
    .in("id", [...new Set([...workerIds, ...reviewerIds])]);

  const byId = new Map((people ?? []).map((p) => [p.id, p]));

  /* One section per round that still has something for them to rate, newest
     round first. Progress counts every sheet assigned to them in that round,
     so "3 of 5 rated" means what it says. */
  const rateRounds = (cycles ?? [])
    .filter((c) => toRate.some((r) => r.cycle_id === c.id))
    .map((c) => {
      const inRound = mine.filter((r) => r.cycle_id === c.id);
      return {
        cycle: c,
        rows: toRate.filter((r) => r.cycle_id === c.id),
        total: inRound.length,
        rated: inRound.filter((r) => r.supervisor_submitted_at).length,
      };
    });

  /* Where a finished sheet is now, in the words a team leader uses. */
  const whereNow = (row: (typeof done)[number]): string => {
    switch (row.status) {
      case "PENDING_SUPERVISOR": {
        const reviewerId = "reviewer_id" in row ? row.reviewer_id : null;
        const name = reviewerId ? byId.get(reviewerId)?.full_name : null;
        return `With ${name ?? "their supervisor"} for review`;
      }
      case "PENDING_REVIEW":
        return "With HR";
      case "REVIEWED":
        return "With management";
      case "CLOSED":
        return "Finished";
      default:
        return "In progress";
    }
  };

  const workerLine = (id: string) => {
    const w = byId.get(id);
    return [w?.employee_code, w?.designation, w?.departments?.name].filter(Boolean).join(" · ");
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="flex items-center gap-2 text-display-sm font-semibold text-ink">
          <HardHat className="size-5 text-ink-muted" aria-hidden />
          Production Team
        </h1>
        {/* -- WHAT IS WAITING ON THEM, in one line, before any list. The header
              named a single round and its due date; with every round shown,
              the useful summary is the count of work, and each round carries
              its own date below. -- */}
        <p className="mt-1 font-sans text-body text-ink-muted">
          {toRate.length === 0 && toReview.length === 0
            ? "Nothing is waiting on you. Everything you have done is listed below."
            : [
                toReview.length > 0 ? `${toReview.length} to review` : null,
                toRate.length > 0 ? `${toRate.length} to rate` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
        </p>
      </header>

      {/* ---------- To review ---------- */}
      {toReview.length > 0 ? (
        <section className="space-y-3" aria-labelledby="to-review">
          <div>
            <h2 id="to-review" className="font-sans text-body-lg font-medium text-ink">
              Waiting on your review
            </h2>
            <p className="mt-0.5 font-sans text-body-sm text-ink-muted">
              The team leader has rated them. Read the ratings, then record your comment, whether
              training is needed, and the rise you recommend.
            </p>
          </div>

          <ul className="space-y-3">
            {toReview.map((row) => {
              const worker = byId.get(row.worker_id);
              const round = cycleById.get(row.cycle_id);
              return (
                <li key={row.id} className="card-surface p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-sans text-body-lg text-ink">{worker?.full_name ?? "Worker"}</p>
                      <p className="font-sans text-body-sm text-ink-muted">
                        {workerLine(row.worker_id) || "No employee ID or designation on their profile"}
                      </p>
                      <p className="font-sans text-body-sm text-ink-muted">
                        {[
                          round ? roundLabel(round.name, round.period_label) : null,
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

      {/* ---------- To rate, one section per round ---------- */}
      {rateRounds.map(({ cycle, rows, total, rated }) => (
        <section key={cycle.id} className="space-y-3" aria-labelledby={`round-${cycle.id}`}>
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id={`round-${cycle.id}`} className="font-sans text-body-lg font-medium text-ink">
                To rate · {roundLabel(cycle.name, cycle.period_label)}
              </h2>
              {cycle.supervisor_due_on ? (
                <p className="font-sans text-body-sm text-ink-muted">
                  Due {formatDate(cycle.supervisor_due_on)}
                </p>
              ) : null}
            </div>
            {/* -- HOW FAR THROUGH, as a count AND a bar. A team leader with a
                  dozen people to rate had no sense of how many were left except
                  by counting cards. The bar is the primary colour, not a tier:
                  it is progress, not anybody's rating (P30-4). §13.8 — the words
                  carry it; the bar only shows it at a glance. -- */}
            <div className="flex items-center gap-3">
              <div
                className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-mute"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={rated}
                aria-label={`${rated} of ${total} rated`}
              >
                <div
                  className="h-full rounded-pill bg-primary"
                  style={{ width: `${total ? Math.round((rated / total) * 100) : 0}%` }}
                />
              </div>
              <p className="tabular shrink-0 font-sans text-body-sm text-ink-muted">
                {rated} of {total} rated
              </p>
            </div>
          </div>

          <ul className="space-y-3">
            {rows.map((row) => {
              const worker = byId.get(row.worker_id);
              return (
                <li key={row.id} className="card-surface p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-sans text-body-lg text-ink">{worker?.full_name ?? "Worker"}</p>
                      <p className="font-sans text-body-sm text-ink-muted">
                        {[
                          workerLine(row.worker_id) || null,
                          worker?.date_of_joining ? `joined ${formatDate(worker.date_of_joining)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No employee ID or designation on their profile"}
                      </p>
                    </div>
                    <Button asChild className="min-h-11">
                      <Link href={`/worker-appraisal/${row.id}`}>
                        Rate them
                        <ArrowRight className="ml-1.5 size-4" aria-hidden />
                      </Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {/* ---------- Done ----------
            Kept, with where each one is NOW. A sheet used to vanish from this
            page the moment it was submitted, so the team leader had no record
            of what they had done and no way to answer "did that go through?"
            without asking HR. Each row opens the sheet read-only. */}
      {done.length > 0 ? (
        <section className="space-y-3" aria-labelledby="done">
          <h2 id="done" className="font-sans text-body-lg font-medium text-ink">
            Done
          </h2>
          <ul className="card-surface divide-y divide-rule">
            {done.map((row) => {
              const worker = byId.get(row.worker_id);
              const round = cycleById.get(row.cycle_id);
              const where = whereNow(row);
              return (
                <li key={`${row.role}-${row.id}`}>
                  <Link
                    href={row.role === "reviewed" ? `/worker-review/${row.id}` : `/worker-appraisal/${row.id}`}
                    className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-surface-mute sm:px-5"
                  >
                    <span className="min-w-0">
                      <span className="block font-sans text-body text-ink">
                        {worker?.full_name ?? "Worker"}
                      </span>
                      <span className="block font-sans text-body-sm text-ink-muted">
                        {[
                          row.role === "reviewed" ? "You reviewed" : "You rated",
                          formatDate(row.at),
                          round ? roundLabel(round.name, round.period_label) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span
                      className={
                        where === "Finished"
                          ? "font-sans text-body-sm text-ink-muted"
                          : "font-sans text-body-sm font-medium text-ink"
                      }
                    >
                      {where}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

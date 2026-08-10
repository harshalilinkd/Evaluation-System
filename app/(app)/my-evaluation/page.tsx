/** /my-evaluation — the employee's own list. P12 screen 1. */

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { HeroCard } from "@/components/appraise/stat-tile";
import { EmptyState } from "@/components/appraise/states";
import { StatusChip } from "@/components/appraise/status-chip";
import { Button } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatScore } from "@/lib/utils/date";

export const metadata: Metadata = { title: "My Evaluation" };

/**
 * Anything the employee can still act on, or is waiting on.
 *
 * AMEND-3 renamed all four of the statuses this used to list, so it matched
 * NOTHING — an employee's own page showed no open evaluation and no past one
 * either, because a live record is neither in this list nor CLOSED.
 */
const OPEN_STATUSES = [
  "OPEN",
  "PENDING_HR_REVIEW",
  "HR_APPROVED",
  "MD_REVIEWED",
  "INTERVIEW_DONE",
];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // §9: the guard is the first statement, so nothing renders before it.
  const session = await requireAuth();
  const { error: bouncedWith } = await searchParams;

  const supabase = await createClient();

  /* -- A SHOP-FLOOR WORKER BELONGS ON THE OTHER FORM.
        This page reads `evaluations`, which is STAFF only (§5's module
        boundary), so a worker signing in saw "no evaluations are open for you"
        while their appraisal sat waiting in `worker_evaluations` — and the line
        beneath it promised a WhatsApp that the worker flow does not send.

        Routed rather than merged. §7 forbids refactoring a staff function to
        serve the worker module, and nothing here is refactored: the staff query
        below is untouched and simply never runs for a worker. A redirect is a
        routing decision, the same call P6-8 and N2-1 made.

        THE HAND-OVER PATH STILL EXISTS AND IS UNCHANGED. It is for workers with
        no login at all; this is for the ones who have one, and having one should
        be enough to reach your own form. -- */
  if (session.profile.track === "WORKER") {
    const { data: mine } = await supabase
      .from("worker_evaluations")
      .select("id, status")
      .eq("worker_id", session.profile.id)
      .eq("status", "OPEN")
      .is("excluded_at", null)
      .is("self_submitted_at", null)
      .limit(1)
      .maybeSingle();

    if (mine) redirect(`/worker-appraisal/${mine.id}`);

    return (
      <EmptyState
        title="Nothing to fill in right now"
        body="When your supervisor starts an appraisal round, your sheet appears here. They may also hand you a tablet to tick it on."
      />
    );
  }

  /* -- Both reads, issued together. The cycles query is not filtered by the
        evaluations, so it never needed to wait for them — and serialising them
        cost a full round trip on the screen most of the company sees first. -- */
  const [{ data: evaluations }, { data: cycles }] = await Promise.all([
    /* -- `.eq("evaluatee_id", …)` IS LOAD-BEARING, and its absence was a bug.
          This read used to have none, on the reasoning that RLS already scopes
          the rows and a filter would imply the policy might not hold. RLS does
          scope them — to every evaluation this person may READ, which is not
          the same set. `can_see_evaluation()` admits a HOD to their reports'
          rows and HR and the MD to everybody's.

          So on a page headed "Your evaluations", a HOD was being shown their
          report's appraisal as their own — and where it had closed, that
          report's final score with it. It also caused a redirect loop; see the
          `only` block below.

          "Which of these may I see" and "which of these are MINE" are two
          different questions, and RLS only answers the first. -- */
    supabase
      .from("evaluations")
      .select("id, status, cycle_id, final_overall, self_submitted_at, excluded_at")
      .eq("evaluatee_id", session.profile.id)
      .is("excluded_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("evaluation_cycles")
      .select("id, name, period_label, self_due_on, disclosure"),
  ]);

  const rows = evaluations ?? [];

  const byCycle = new Map((cycles ?? []).map((c) => [c.id, c]));

  const open = rows.filter((r) => OPEN_STATUSES.includes(r.status));
  const past = rows.filter((r) => r.status === "CLOSED");

  /* -- The third bucket, and the reason this page could render blank.
        §8's first status is DRAFT: a cycle in setup creates every participant's
        evaluation before it is launched. A DRAFT is in neither list above, so
        with one of them and nothing else, `open` and `past` were both empty,
        both sections rendered null, and the page was a heading over nothing —
        §13.4's dead end, on the screen most of the company sees first. -- */
  const upcoming = rows.filter((r) => r.status === "DRAFT");

  /* -- P12-15: "if the user has exactly one open evaluation, redirect straight
        into it." Most people arrive from a WhatsApp link with one thing to do,
        and a list of one is a page that exists only to be clicked through.

        NOT WHEN WE HAVE JUST BEEN SENT BACK HERE.

        `requireEvaluationAccess` refuses by redirecting to
        `landingPathFor(roles) + "?error=…"`, and for anybody who is not HR or
        the MD that path is this page. An auto-redirect out of a page that is
        also a refusal target is a loop: bounce in, get refused, bounce back,
        redirect in again — the browser spins, the dev server recompiles on
        every hop, and the whole app crawls.

        The filter above removes the case that actually triggered it. This is
        the guard for the class: `?error=` means we arrived by refusal, so the
        page STAYS and lets `AccessNotice` say why (§13.4 — a bounce with no
        explanation reads as the app losing your click). -- */
  const only = open[0];
  if (!bouncedWith && open.length === 1 && past.length === 0 && only) {
    redirect(`/my-evaluation/${only.id}`);
  }

  const current = open[0];
  const currentCycle = current ? byCycle.get(current.cycle_id) : undefined;

  /* -- One exit for every case with nothing to show, rather than falling
        through to a heading with no content under it.

        `current && !currentCycle` is the second way this page went blank: the
        evaluation is readable but its cycle row is not, so the hero had nothing
        to title itself with and rendered null. Rare, but it produced exactly
        the same silent dead end. -- */
  const hasSomethingToShow = (current && currentCycle) || past.length > 0;

  if (!hasSomethingToShow) {
    return (
      <EmptyState
        title={
          upcoming.length > 0
            ? "Your evaluation has not opened yet"
            : "No evaluations are open for you right now"
        }
        body={
          upcoming.length > 0
            ? "You are on the list for the next cycle. You will get a message when it opens and it will appear here."
            : "You will get a WhatsApp message when the next cycle starts."
        }
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-[780px] space-y-6">
      <h1 className="text-display-md text-ink">Your evaluations</h1>

      {current && currentCycle ? (
        <HeroCard
          label="Current cycle"
          value={currentCycle.name}
          caption={`${currentCycle.period_label} · due ${formatDate(currentCycle.self_due_on)}`}
          action={
            <Button asChild className="min-h-11">
              <Link href={`/my-evaluation/${current.id}`}>
                {/* They can still edit only while the record is OPEN and their own
                    layer is unsubmitted — the button says which. */}
                {current.status === "OPEN" && !current.self_submitted_at ? "Continue" : "View"}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          }
          enterIndex={0}
        >
          {/* §8 / §13: an employee never sees a raw status enum. StatusChip's
              employee vocabulary collapses the middle of the pipeline into
              "Under review" — whether the MD has finalised is not their
              business until the result is disclosed. */}
          <StatusChip status={current.status} audience="employee" />
        </HeroCard>
      ) : null}

      {past.length > 0 ? (
        <section className="card-surface p-5">
          <h2 className="text-display-sm text-ink">Previous evaluations</h2>
          <ul className="mt-3 divide-y divide-rule">
            {past.map((row) => {
              const cycle = byCycle.get(row.cycle_id);
              // §9: the employee sees their final score only when the cycle's
              // disclosure policy allows it. NONE means the result is recorded
              // and never shown, so no number appears here either.
              const showsScore = cycle?.disclosure !== "NONE";

              return (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-body text-ink">{cycle?.name ?? "Cycle"}</p>
                    <p className="text-body-sm text-ink-muted">{cycle?.period_label ?? ""}</p>
                  </div>

                  <div className="flex items-center gap-4">
                    {showsScore ? (
                      <span className="tabular rounded-pill bg-final-tint px-3 py-1 text-body-sm font-medium text-final">
                        {formatScore(row.final_overall)}
                      </span>
                    ) : null}
                    <Link
                      href={`/my-evaluation/${row.id}`}
                      className="inline-flex min-h-11 items-center text-body-sm font-medium text-primary underline underline-offset-2"
                    >
                      View
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

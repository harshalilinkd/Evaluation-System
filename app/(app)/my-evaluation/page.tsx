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

  /* -- A SHOP-FLOOR WORKER FILLS NOTHING.
        Their supervisor completes the tick sheet and HR reads it; there is no
        worker-facing form in this module at all. This page reads `evaluations`,
        which is STAFF only (§5), so without this they would see the staff empty
        state promising a WhatsApp that is never sent to them.

        Routed rather than merged: §7 forbids refactoring a staff function to
        serve the worker module, and the query below is untouched — it simply
        never runs for a worker. -- */
  if (session.profile.track === "WORKER") {
    return (
      <EmptyState
        title="Nothing to fill in"
        body="Your supervisor completes your appraisal and HR reviews it. There is nothing here for you to do."
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
    /* -- `!inner` ON THE CYCLE, so a BINNED one is excluded.
          0032 gave cycles a `deleted_at` and this page never filtered on it —
          so binning a cycle removed it from HR's list, the dashboard and the
          HOD's queue, and left it sitting on the employee's own screen. A
          recycle bin that only hides the folder is not a recycle bin, and this
          was the one place it leaked to the people least able to explain it.
          The dashboard and /team already carried this filter; this did not. -- */
    supabase
      .from("evaluations")
      .select(
        "id, status, cycle_id, final_overall, self_submitted_at, excluded_at, evaluation_cycles!inner(deleted_at)",
      )
      .eq("evaluatee_id", session.profile.id)
      .is("excluded_at", null)
      .is("evaluation_cycles.deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("evaluation_cycles")
      .select("id, name, period_label, self_due_on, disclosure")
      .is("deleted_at", null),
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

  /* -- EVERY open evaluation, not the first one.

        This page used to read `const current = open[0]` and render a single
        hero from it. With two cycles open at once — which the product has
        supported since AMEND-2 gave a cycle a TYPE, and EVALUATION and
        INCREMENT differ only in how they end — the second was fetched, passed
        RLS, and was then dropped on the floor by the interface. There was no
        link to it anywhere: the employee could not reach their own appraisal.

        Reported from a real device: an Evaluation cycle and an Increment cycle
        were both launched, and only the Increment appeared.

        `open` is already ordered newest-first by the query above, so the most
        recent sits at the top without a second sort. A row whose cycle cannot
        be read is dropped rather than rendered as a card with no title —
        that is the blank-hero case the old comment describes, now handled per
        row instead of only for the first one. -- */
  const openCards = open.flatMap((row) => {
    const cycle = byCycle.get(row.cycle_id);
    return cycle ? [{ row, cycle }] : [];
  });

  /* -- One exit for every case with nothing to show, rather than falling
        through to a heading with no content under it. -- */
  const hasSomethingToShow = openCards.length > 0 || past.length > 0;

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

      {/* One card per open evaluation. With a single one this is exactly what
          the page rendered before; with two it is the fix. The label stops
          claiming there is one "current" cycle when there are two — a heading
          that says Current cycle above two cards is worse than no heading. */}
      {openCards.map(({ row, cycle }, index) => (
        <HeroCard
          key={row.id}
          label={openCards.length > 1 ? "Open for you" : "Current cycle"}
          value={cycle.name}
          caption={`${cycle.period_label} · due ${formatDate(cycle.self_due_on)}`}
          action={
            <Button asChild className="min-h-11">
              <Link href={`/my-evaluation/${row.id}`}>
                {/* They can still edit only while the record is OPEN and their own
                    layer is unsubmitted — the button says which. */}
                {row.status === "OPEN" && !row.self_submitted_at ? "Continue" : "View"}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          }
          enterIndex={index}
        >
          {/* §8 / §13: an employee never sees a raw status enum. StatusChip's
              employee vocabulary collapses the middle of the pipeline into
              "Under review" — whether the MD has finalised is not their
              business until the result is disclosed. */}
          <StatusChip status={row.status} audience="employee" />
        </HeroCard>
      ))}

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

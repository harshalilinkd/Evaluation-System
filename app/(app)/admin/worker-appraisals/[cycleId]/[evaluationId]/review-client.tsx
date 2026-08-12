"use client";

/** The supervisor's completed sheet, and the one action that finishes it. */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { returnWorkerToHr, reviewWorkerAppraisal, type WorkerReview } from "@/lib/worker/review";
import { cn } from "@/lib/utils";
import { MoneyInput, moneyMonthly } from "@/components/appraise/money-input";
import { saveWorkerSalaryAsHr } from "@/lib/worker/review";
import type { WorkerActivity } from "@/lib/worker/review";
import { formatDateTime } from "@/lib/utils/date";

const TICK_WORD: Record<string, string> = {
  EXCELLENT: "Excellent",
  SATISFACTORY: "Satisfactory",
  NEEDS_IMPROVEMENT: "Needs improvement",
};

/* -- The LEAD tier, because the supervisor is who said it (§13.1).
      One column now, so there is no other colour to be distinguished FROM — but
      a tier still means what it means everywhere else, and reaching for a
      different hue because this screen happens to have one column is how a
      reserved colour stops being reserved. -- */
function Tick({ value }: { value: string | null }) {
  if (!value) return <span className="font-sans text-body-sm text-ink-faint">Not answered</span>;
  return (
    <span className="inline-flex rounded-pill bg-lead-tint px-2.5 py-0.5 font-sans text-body-sm text-lead">
      {TICK_WORD[value] ?? value}
    </span>
  );
}

export function WorkerReviewClient({
  review,
  cycleId,
  isMd,
  activity,
}: {
  review: WorkerReview;
  cycleId: string;
  /** What has happened to this appraisal, newest first. */
  activity: WorkerActivity[];
  /** Decides which single ending this person is offered. The SERVER decides
      whether they may take it — a screen is not a guard (§9). */
  isMd: boolean;
}) {
  const router = useRouter();
  const [remarks, setRemarks] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [returning, setReturning] = React.useState(false);
  const [returnReason, setReturnReason] = React.useState("");
  /* -- Set when the server says the record moved under us. The panel then stops
        offering actions, instead of leaving a live button beside a message that
        says the screen is out of date — which is exactly what was reported: the
        warning appeared, "Approve and close" stayed active, and nothing had
        moved. -- */
  const [stale, setStale] = React.useState(false);

  const closed = review.status === "CLOSED";
  const withMd = review.status === "REVIEWED";
  const done = closed;

  async function finish(outcome: "CLOSE" | "SEND_TO_MD") {
    setBusy(true);
    setError(null);
    try {
      const result = await reviewWorkerAppraisal(review.evaluationId, remarks, outcome);
      if (!result.ok) {
        setError(result.error.message);
        /* -- A LOST RACE FIXES ITSELF.
              The guard was right — somebody moved the record between this page
              loading and the button being pressed — but telling a person to
              reload is asking them to do what the app can do. A refresh
              re-renders from the server, and `stale` hides the actions until it
              lands so nothing can be pressed against a status that no longer
              exists. -- */
        if (result.error.code === "ALREADY_MOVED" || result.error.code === "NOT_CLOSED") {
          setStale(true);
          router.refresh();
        }
        return;
      }
      router.push(`/admin/worker-appraisals/${cycleId}`);
      router.refresh();
    } catch (cause) {
      // Every await inside the try, and the raw message shown — a failure
      // nobody can see is worse than an ugly one (§0.7, FIX-12).
      setError(cause instanceof Error ? cause.message : "That did not go through.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href={`/admin/worker-appraisals/${cycleId}`}
          className="inline-flex items-center gap-1.5 font-sans text-body-sm text-ink-muted"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to the round
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-sans text-h2 text-ink">{review.workerName}</h1>
          {/* -- Available at every stage, not only once closed.
                A signed-off copy is the common case, but HR printing one to
                carry into a conversation is exactly as legitimate — and the
                sheet says which state it is in at its foot, so a draft cannot
                be mistaken for a final one. -- */}
          <Button asChild variant="outline" className="min-h-11">
            <a href={`/print/worker/${review.evaluationId}`} target="_blank" rel="noreferrer">
              <Printer className="size-4" aria-hidden />
              Print / PDF
            </a>
          </Button>
        </div>
        <p className="font-sans text-body-sm text-ink-muted">
          {[review.designation, review.department].filter(Boolean).join(" · ") || "—"} ·{" "}
          {review.cycleName} {review.periodLabel}
        </p>
      </div>

      {closed ? (
        <p className="flex items-center gap-2 rounded-card bg-success-tint px-4 py-3 font-sans text-body-sm text-ink">
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
          Closed. Nothing further is needed.
        </p>
      ) : withMd ? (
        <p className="flex items-center gap-2 rounded-card bg-accent px-4 py-3 font-sans text-body-sm text-accent-foreground">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          HR has reviewed this and sent it to management. It closes when they sign it off.
        </p>
      ) : null}

      {/* ---------- The sheet ----------
            ONE COLUMN. The supervisor fills it and the worker does not, so
            there is nothing to compare and no second opinion to set beside it.
            The two-column layout this replaced was drawn for a blind two-sided
            round, which is not what this module does. */}
      {/* -- `overflow-hidden` CLIPPED it, which is worse than overflowing: the
            supervisor's tick column was cut off with no way to reach it. Two
            columns — a quality name and a tick — need about 22rem before the
            text starts wrapping to one word a line, so below that the table
            scrolls inside the card and the page does not. -- */}
      <div className="overflow-x-auto rounded-card border border-rule">
        <table className="w-full min-w-[22rem]">
          <thead>
            <tr className="border-b border-rule bg-surface-mute">
              <th scope="col" className="type-label px-4 py-2.5 text-left text-ink">
                Quality
              </th>
              <th scope="col" className="type-label px-4 py-2.5 text-left text-ink">
                {review.supervisorName ?? "Supervisor"} ticked
              </th>
            </tr>
          </thead>
          <tbody>
            {review.rows.map((row) => (
              <tr
                key={row.questionId}
                className={cn(
                  "border-b border-rule last:border-b-0",
                  // §11: the overall is what the whole sheet resolves to, so it
                  // is marked rather than sitting as an eighth identical row.
                  row.isOverall && "bg-surface-mute/60 font-medium",
                )}
              >
                <td className="px-4 py-3 font-sans text-body-sm text-ink">{row.text}</td>
                <td className="px-4 py-3">
                  <Tick value={row.supervisor} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>


      {/* ---------- What the supervisor added ---------- */}
      <div className="card-surface space-y-4 p-5">
        <div>
          <p className="type-label text-ink-muted">Overall performance</p>
          <p className="font-sans text-body-lg text-ink">
            {review.overallTick ? (TICK_WORD[review.overallTick] ?? review.overallTick) : "—"}
          </p>
        </div>
        <div>
          <p className="type-label text-ink-muted">Supervisor comment</p>
          <p className="font-sans text-body text-ink">{review.supervisorComment || "—"}</p>
        </div>
        <div>
          <p className="type-label text-ink-muted">Training required</p>
          <p className="font-sans text-body text-ink">
            {review.trainingRequired === null ? "Not answered" : review.trainingRequired ? "Yes" : "No"}
          </p>
        </div>
      </div>

      {/* ---------- Salary ----------
          HR PRICES THE SUPERVISOR'S RECOMMENDATION. The supervisor records a
          percentage and is shown no amount at all (0064); this is where it
          becomes money, against a salary they could not see.
      
          The current figure is pre-filled from the employment record — the
          auto-fill the supervisor was never able to do, because that table
          admits only HR and the MD, so their copy of the query has always
          returned nothing. Where there is no record, HR types it and the panel
          says which of the two it is rather than showing an unexplained blank. */}
      {/* -- ALWAYS RENDERED, because its absence was itself the report.
            It used to be conditional on a decisions row existing — so an
            appraisal the supervisor left unpriced showed no salary section at
            all, which is indistinguishable from the section having disappeared.
            The panel says which of the two it is. -- */}
      <WorkerSalaryPanel
        evaluationId={review.evaluationId}
        salary={
          review.salary ?? {
            salaryChanged: false,
            oldCtc: null,
            incrementPct: null,
            newCtc: null,
          }
        }
        currentCtcOnRecord={review.currentCtcOnRecord}
        readOnly={closed || review.status === "REVIEWED"}
        supervisorName={review.supervisorName}
        mdApproval={review.mdApproval}
        stages={review.stages}
      />

      {/* ---------- Finish ---------- */}
      {!done ? (
        <div className="card-surface space-y-4 p-5">
          <div className="space-y-2">
            <Label htmlFor="review_remarks">Your remarks</Label>
            <Textarea
              id="review_remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              placeholder="Optional. Seen by HR and management only."
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-control bg-critical-tint px-4 py-3 font-sans text-body-sm text-critical"
            >
              {error}
            </p>
          ) : null}

          {/* -- §13.3 is one PRIMARY action, not one action. Closing is the
                primary; sending to management is the other ending the paper
                form's three signatures imply, and it is secondary because most
                sheets do not need it. -- */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-sans text-body-sm text-ink-muted">
              {withMd
                ? "Signing this off closes it. Nothing can be changed afterwards."
                : "Closing is final. Send it to management instead if the MD should sign it."}
            </p>
            <div className="flex flex-wrap gap-2">
              {/* Nothing is pressable against a status that has already moved.
                  The refresh is in flight; when it lands this panel re-renders
                  with whatever is now true. */}
              {stale ? (
                <p className="font-sans text-body-sm text-ink-muted">
                  Bringing the page up to date…
                </p>
              ) : (
                <>
              {/* -- ONE BUTTON EACH, and neither sees the other's.
                    Management's approval is required to close now, so HR's
                    only move is to send it up and the MD's only move is to
                    close. Offering HR a Close that the server refuses is the
                    dead end §13.4 is about. -- */}
              {/* -- WHOSE MOVE IT IS, decided by role AND status.

                    It was decided by status alone, so the MD looking at a sheet
                    still with HR was offered "Send to management" — an invitation
                    to send it to themselves. And once it reached them their only
                    option was to approve: `returnWorkerToHr` did not exist, so
                    the second pair of eyes could agree or do nothing, which is
                    not a decision (AMEND-2). -- */}
              {!withMd ? (
                isMd ? (
                  <p className="font-sans text-body-sm text-ink-muted">
                    Still with HR. It reaches you when they send it up.
                  </p>
                ) : (
                  <Button onClick={() => void finish("SEND_TO_MD")} disabled={busy} className="min-h-11">
                    {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                    Send to management
                  </Button>
                )
              ) : isMd ? (
                <>
                  {/* Secondary, and to the left: sending it back is the lesser
                      of the two acts, and §13.3 gives the primary slot to one. */}
                  <Button
                    variant="outline"
                    onClick={() => setReturning(true)}
                    disabled={busy}
                    className="min-h-11"
                  >
                    Send back to HR
                  </Button>
                  <Button onClick={() => void finish("CLOSE")} disabled={busy} className="min-h-11">
                    {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                    Approve and close
                  </Button>
                </>
              ) : (
                <p className="font-sans text-body-sm text-ink-muted">
                  With management. They approve and close it, or send it back.
                </p>
              )}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {/* ---------- What has happened ----------
          The rows were already being written — 0064 logs every salary change
          by trigger, and every transition writes its own (§12) — and NOTHING
          RENDERED THEM. A trail nobody can read is not a trail, for the purpose
          it was asked for.

          Newest first, because the question somebody opens this with is "what
          changed since I last looked", not "how did it begin". */}
      {activity.length > 0 ? (
        <div className="card-surface space-y-3 p-5">
          <p className="font-sans text-body-lg text-ink">Activity</p>
          <ol className="divide-y divide-rule">
            {activity.map((a, i) => (
              <li key={`${a.at}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2.5">
                <span className="font-sans text-body-sm text-ink">
                  <span className="font-medium">{a.who}</span> {a.what}
                </span>
                {/* -- The detail is a CLAUSE, not a dash and a fragment. It
                      printed "— " before whatever came back, so a first
                      percentage rendered "— —% → 8%": two em dashes and a stray
                      sign, which reads as a rendering fault. Brackets make it an
                      aside rather than a broken sentence. -- */}
                {a.detail ? (
                  <span className="font-sans text-body-sm text-ink-muted">({a.detail})</span>
                ) : null}
                {/* A folded run. §12's rows are untouched — this is the count of
                    identical consecutive entries, so three autosaves read as one
                    change made three times rather than as three events. */}
                {a.times && a.times > 1 ? (
                  <span className="tabular rounded-pill bg-surface-mute px-1.5 font-sans text-body-sm text-ink-muted">
                    ×{a.times}
                  </span>
                ) : null}
                <span className="tabular ml-auto font-sans text-body-sm text-ink-muted">
                  {formatDateTime(a.at)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {/* -- SENDING IT BACK, with a reason.

            §8 requires one on every return in the staff module and the argument
            is identical here: a form that comes back with no explanation sends
            HR looking for the one person who knows why, and by then the reason
            is somebody's recollection. It is stored verbatim in the audit trail
            and appears on the activity list above. -- */}
      <Dialog open={returning} onOpenChange={(open) => (open ? null : setReturning(false))}>
        <DialogContent className="w-[min(96vw,480px)] border-rule">
          <DialogHeader>
            <DialogTitle className="text-display-sm text-ink">Send this back to HR?</DialogTitle>
            <DialogDescription className="font-sans text-body-sm text-ink-muted">
              It goes back to HR to change. Nothing already recorded is lost — the
              supervisor&rsquo;s ticks and the salary figures stay exactly as they are.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="w_return_reason">Why is it going back?</Label>
            <Textarea
              id="w_return_reason"
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              rows={3}
              placeholder="What should HR change before sending it up again?"
            />
          </div>

          {error ? (
            <p role="alert" className="font-sans text-body-sm text-critical">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" className="min-h-11" onClick={() => setReturning(false)}>
              Keep it here
            </Button>
            <Button
              className="min-h-11"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const result = await returnWorkerToHr(review.evaluationId, returnReason);
                setBusy(false);
                if (!result.ok) {
                  setError(result.error.message);
                  if (result.error.code === "ALREADY_MOVED") {
                    setReturning(false);
                    setStale(true);
                    router.refresh();
                  }
                  return;
                }
                setReturning(false);
                router.push(`/admin/worker-appraisals/${cycleId}`);
                router.refresh();
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Send back to HR
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * One step in the pay decision: what happened, who did it, when, and to what.
 *
 * A pending step is stated as pending rather than shown as a blank — §13.4, and
 * a blank beside two filled rows reads as a value that failed to load.
 */
function SalaryStage({
  step,
  who,
  at,
  value,
  note,
  pending,
}: {
  step: string;
  who: string | null;
  at: string | null;
  value: string;
  note?: string | null;
  pending?: boolean;
}) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <p className="font-sans text-body-sm text-ink">{step}</p>
        <p className="font-sans text-body-sm text-ink-muted">
          {[who, at ? formatDateTime(at) : null].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      <div className="text-right">
        <p
          className={cn(
            "tabular font-sans text-body",
            pending ? "text-ink-faint" : "text-ink",
          )}
        >
          {value}
        </p>
        {note ? <p className="font-sans text-body-sm text-ink-muted">{note}</p> : null}
      </div>
    </li>
  );
}

/* ============================================== HR prices the recommendation = */

/**
 * The supervisor recommended a percentage. This is where it becomes money.
 *
 * They are shown no amount at all (0064), so the two figures here — what the
 * worker is on, and what they go to — are HR's alone. The current salary is
 * pre-filled from the employment record, which is the auto-fill the supervisor
 * could never do: that table admits only HR and the MD, so their copy of the
 * query has always returned nothing and the old salary they used to type was
 * recalled from memory.
 *
 * Monthly, like every salary in the product. `MoneyInput` owns the unit
 * boundary and hands back the annual figure to store.
 */
function WorkerSalaryPanel({
  evaluationId,
  salary,
  currentCtcOnRecord,
  readOnly,
  supervisorName,
  mdApproval,
  stages,
}: {
  evaluationId: string;
  salary: { salaryChanged: boolean; oldCtc: number | null; incrementPct: number | null; newCtc: number | null };
  currentCtcOnRecord: number | null;
  readOnly: boolean;
  supervisorName: string | null;
  mdApproval: WorkerReview["mdApproval"];
  stages: WorkerReview["stages"];
}) {
  const router = useRouter();

  /* -- NOT PRE-FILLED FROM THE EMPLOYMENT RECORD, at the owner's instruction.

        It used to fall back to `currentCtcOnRecord`, which made an unsaved
        screen look identical to a saved one: HR saw a figure in the box, had no
        way to tell it was a suggestion rather than a stored value, and pressing
        nothing left the appraisal with no salary on it at all. Only what HR has
        actually saved is shown; the record's figure is offered BESIDE the field
        as something to copy, so nothing is lost and nothing is assumed. -- */
  const [oldCtc, setOldCtc] = React.useState<number | null>(salary.oldCtc);
  const [newCtc, setNewCtc] = React.useState<number | null>(salary.newCtc);
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const pct = salary.incrementPct;

  /* -- The figure the supervisor's percentage comes to, computed rather than
        typed. HR may still override it — the percentage advises, which is the
        owner's decision for the staff module and holds here for the same
        reason: the person recommending it cannot see the salary it applies
        to. -- */
  /* -- The percentage is priced against whatever figure is actually KNOWN — what
        HR has typed, or failing that the employment record. The field itself is
        no longer pre-filled (the owner's instruction), and computing this from
        the empty field alone would have made "Which comes to" go blank on every
        appraisal that had not been priced yet — trading one confusing screen for
        another. What is stored still comes only from what HR typed. -- */
  const basis = oldCtc ?? currentCtcOnRecord;
  const suggested = basis !== null && pct !== null ? Math.round(basis * (1 + pct / 100)) : null;

  /* -- Stated, not left to be worked out from two figures on adjacent lines.
        Only where both are known — a difference against a missing figure is not
        a rise, it is an assumption. -- */
  const rise = oldCtc !== null && newCtc !== null ? newCtc - oldCtc : null;

  async function save() {
    setBusy(true);
    setError(null);
    const result = await saveWorkerSalaryAsHr(evaluationId, { oldCtc, newCtc });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  /* -- "NO CHANGE RECOMMENDED" IS NOT "NOTHING TO SHOW", and treating them as
        the same thing is what made the block appear to vanish.

        `salary_changed` is written by the SUPERVISOR's sheet. `old_ctc` and
        `new_ctc` are written by HR. So a sheet where the supervisor recorded no
        percentage, and HR then priced it anyway, stored two real figures and
        rendered a card saying there was nothing to price — the stored values
        gone from the one screen that reads them back.

        The recommendation now governs the RECOMMENDATION row only. Figures are
        shown whenever figures exist, at every stage, which is the whole of what
        was asked for. -- */
  const hasFigures = oldCtc !== null || newCtc !== null || salary.newCtc !== null;
  if (!salary.salaryChanged && !hasFigures && readOnly) {
    return (
      <div className="card-surface space-y-2 p-5">
        <p className="font-sans text-body-lg text-ink">Salary</p>
        <p className="font-sans text-body-sm text-ink-muted">
          No pay change was recorded on this appraisal.
        </p>
      </div>
    );
  }

  return (
    <div className="card-surface space-y-4 p-5">
      <div>
        <p className="font-sans text-body-lg text-ink">Salary</p>
        <p className="font-sans text-body-sm text-ink-muted">
          The supervisor recommends the percentage. You set the figures — they are
          not shown any salary.
        </p>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="type-label text-ink-muted">Supervisor&rsquo;s recommendation</dt>
          <dd className="tabular font-sans text-display-sm text-ink">
            {pct === null ? "—" : `${pct}%`}
          </dd>
        </div>
        <div>
          <dt className="type-label text-ink-muted">Which comes to</dt>
          <dd className="tabular font-sans text-display-sm text-ink">{moneyMonthly(suggested)}</dd>
          <dd className="font-sans text-body-sm text-ink-muted">
            {suggested === null
              ? "Needs a current salary and a percentage."
              : "You can set a different figure below."}
          </dd>
        </div>
      </dl>

      {readOnly ? (
        /* -- THE STAGES, NAMED — not two figures with no account of themselves.
              Each row states who set it and when, so a closed appraisal reads as
              a record of three decisions rather than as a screen that has
              stopped working. The management row is the one that was missing
              entirely: an approved figure that never said it was approved. -- */
        <ol className="space-y-3 border-t border-rule pt-4">
          <SalaryStage
            step="Supervisor recommended"
            who={supervisorName}
            at={stages.supervisorSubmittedAt}
            value={pct === null ? "No change" : `${pct}%`}
          />
          <SalaryStage
            step="HR priced it"
            who={null}
            at={null}
            value={
              oldCtc === null && newCtc === null
                ? "Not priced"
                : `${moneyMonthly(oldCtc)} → ${moneyMonthly(newCtc)}`
            }
            note={rise === null ? null : `A rise of ${moneyMonthly(rise)} a month`}
          />
          <SalaryStage
            step="Management approved"
            who={mdApproval?.name ?? null}
            at={mdApproval?.at ?? stages.mdReviewedAt}
            value={
              mdApproval
                ? newCtc === null
                  ? "Approved"
                  : moneyMonthly(newCtc)
                : "Not yet approved"
            }
            pending={!mdApproval}
          />
        </ol>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="w_old_hr">Current salary</Label>
              <MoneyInput
                id="w_old_hr"
                value={oldCtc}
                onValueChange={setOldCtc}
              />
              {/* -- The record's figure is OFFERED, never assumed.
                    It used to be pre-filled, which made an unsaved screen look
                    exactly like a saved one. As a button it does the same work
                    in one tap and leaves HR in no doubt about which figure is
                    stored. A blank box with no explanation still reads as a
                    missing feature, so the empty case says why (§13.4). -- */}
              {currentCtcOnRecord === null ? (
                <p className="font-sans text-body-sm text-ink-muted">
                  Not on their employment record — type it here.
                </p>
              ) : oldCtc === currentCtcOnRecord ? (
                <p className="font-sans text-body-sm text-ink-muted">
                  Matches their employment record.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => setOldCtc(currentCtcOnRecord)}
                  className="font-sans text-body-sm text-primary underline underline-offset-2"
                >
                  Use their recorded salary — {moneyMonthly(currentCtcOnRecord)}
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w_new_hr">New salary</Label>
              <MoneyInput id="w_new_hr" value={newCtc} onValueChange={setNewCtc} />
              {suggested !== null && newCtc !== suggested ? (
                <button
                  type="button"
                  onClick={() => setNewCtc(suggested)}
                  className="font-sans text-body-sm text-primary underline underline-offset-2"
                >
                  Use the supervisor&rsquo;s {pct}% — {moneyMonthly(suggested)}
                </button>
              ) : null}
            </div>
          </div>

          {error ? (
            <p role="alert" className="font-sans text-body-sm text-critical">
              {error}
            </p>
          ) : null}

          <Button onClick={() => void save()} disabled={busy} variant="secondary" className="min-h-11">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {saved ? "Saved" : "Save salary"}
          </Button>
        </>
      )}
    </div>
  );
}

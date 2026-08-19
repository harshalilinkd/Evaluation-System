"use client";

/** The supervisor's completed sheet, and the one action that finishes it. */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Download, Loader2, Printer } from "lucide-react";

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
import { SALARY_TINT } from "@/components/appraise/salary-tones";
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
/* -- THREE RATINGS THAT LOOK DIFFERENT, because they are.
      Every tick rendered in the SAME pink pill — so a sheet with one "Needs
      improvement" among seven "Satisfactory" read as eight identical badges,
      and the one row worth finding was the hardest to find. Colour that means
      nothing is worse than no colour: it implies a distinction and then
      withholds it.

      It was also `bg-lead-tint` / `text-lead`, which is §13.1's HOD hue used
      decoratively on something that is not a layer at all — the rule the
      notification bell's placeholder dot broke in the same way (N1-16).

      AN ORDINAL RAMP IN INK, plus one status accent. Excellent is the strongest
      weight, Satisfactory the quiet middle, and Needs improvement takes
      `critical` because it IS the attention case and is the only one anybody
      acts on. No tier hue, no new token, and it reads as a document rather than
      a dashboard — which is what this page is.

      §13.8: never colour alone. The word is the signal; the treatment only
      makes it findable, and "Not answered" stays plain text so an absence
      cannot be mistaken for a rating. §6.2 holds too — no numeral appears here,
      the 5/3/1 analytics mapping stays off a worker's own sheet. -- */
const TICK_STYLE: Record<string, string> = {
  EXCELLENT: "bg-surface-mute font-medium text-ink",
  SATISFACTORY: "bg-surface-mute text-ink-muted",
  NEEDS_IMPROVEMENT: "bg-critical-tint font-medium text-critical",
};

function Tick({ value }: { value: string | null }) {
  if (!value) return <span className="font-sans text-body-sm text-ink-faint">Not answered</span>;
  return (
    <span
      className={cn(
        "inline-flex rounded-pill px-2.5 py-1 font-sans text-body-sm",
        TICK_STYLE[value] ?? "bg-surface-mute text-ink",
      )}
    >
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

  /* -- Whether this sheet is ready to go up. Mirrors the server's own rule
        rather than approximating it: a sheet recommending no change has nothing
        to price, and one that does needs both figures. Two copies of a
        threshold is how a form starts accepting what the server then rejects
        (P13-6), so the wording of the refusal is the same on both sides. -- */
  const recommendsAChange =
    review.salary?.salaryChanged === true || review.salary?.incrementPct != null;
  const priced =
    !recommendsAChange ||
    (review.salary?.oldCtc != null && review.salary?.newCtc != null);

  /* -- THE SALARY DRAFT LIVES HERE, not inside the panel, and that is the fix
        for the second half of the report.

        HR was sent the appraisal back, typed 17,000, and pressed Send to
        management WITHOUT pressing Save. The figure never left the browser, so
        the MD opened it and saw the old 16,500. FIX-41's guard did not catch it
        because it asks whether the appraisal is priced AT ALL — and it was,
        with the previous figures. Stale is not the same as absent.

        The panel cannot answer "are there unsaved edits" for a button that
        lives outside it, so the two values move up and the panel is handed
        them. No effect, no callback: `dirty` is derived by comparing the draft
        against the props, and a successful save refreshes the props to match,
        which clears it on its own. -- */
  const savedOldCtc = review.salary?.oldCtc ?? null;
  const savedNewCtc = review.salary?.newCtc ?? null;
  /* -- CURRENT SALARY PREFILLS FROM THE EMPLOYMENT RECORD, at the owner's
        instruction — and it reverses F22-2, which removed exactly this.

        That removal was right about the NEW salary and wrong to take the
        current one with it. The objection was that an appraisal with nothing
        stored opened showing a figure, so HR could not tell a suggestion from a
        saved value, and pressing nothing left the appraisal with no salary at
        all. The second half no longer applies: FIX-44 blocks the hand-up while
        `salaryDirty`, so a prefill that is never saved cannot reach management
        — it holds the Send button and says why. And the first half was always
        weaker here than for the new salary: this field is a FACT off the
        employment record, not a proposal, and HR retyping a number the system
        already holds is the work this screen exists to save.

        NEW SALARY IS DELIBERATELY NOT PREFILLED. That one is the decision, and
        showing a figure nobody chose on the number a wage is paid from is
        exactly what F22-2 was reported for. -- */
  const [oldCtc, setOldCtc] = React.useState<number | null>(
    savedOldCtc ?? review.currentCtcOnRecord,
  );
  const [newCtc, setNewCtc] = React.useState<number | null>(savedNewCtc);
  const salaryDirty = oldCtc !== savedOldCtc || newCtc !== savedNewCtc;

  /* -- HR AND THE MD ON ONE RECORD, kept in step.
        Asked for as "changes made in one screen should be visible to the
        other". Two people work this sheet in sequence and often at the same
        time, and until now each saw whatever was true when they opened the
        page — which is how somebody approves a figure the other has already
        changed.

        POLLING, NOT REALTIME. Supabase Realtime needs replication switched on
        per table from the dashboard, which NOTIFY-1 declined for the bell for
        the same reason: it is a setting somebody has to remember, not something
        a migration can carry. `router.refresh()` re-runs the server components
        on a connection that already exists.

        THIRTY SECONDS, and only while the tab is visible — the bell's rule
        (45s) tightened a little because this screen is two people acting on one
        row rather than a badge. A hidden tab polls nothing, and returning to
        the tab refreshes immediately, which is when somebody actually looks.

        NEVER WHILE THEY ARE EDITING. A refresh re-renders with server props,
        and `savedOldCtc` / `savedNewCtc` feed the initial state — so
        refreshing mid-edit is how a half-typed salary gets taken back out of
        the field. Paused on `salaryDirty`, on `busy`, and while a dialog is
        open, which is PC-4's rule: a refetch must never overwrite what somebody
        is still typing. -- */
  // Not held on `stale`: that flag means somebody else has already moved the
  // record, and a refresh is precisely what resolves it.
  const holdRefresh = salaryDirty || busy || returning;

  React.useEffect(() => {
    if (holdRefresh) return;

    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [holdRefresh, router]);

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
          {/* Download and view are two endings of one gesture, so they are two
              controls rather than one that has to be pressed twice. */}
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" className="min-h-11">
              <a
                href={`/print/worker/${review.evaluationId}?download=1`}
                target="_blank"
                rel="noreferrer"
              >
                <Download className="size-4" aria-hidden />
                Download report
              </a>
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <a href={`/print/worker/${review.evaluationId}`} target="_blank" rel="noreferrer">
                <Printer className="size-4" aria-hidden />
                Print / View
              </a>
            </Button>
          </div>
        </div>
        {/* -- THE PERIOD WAS PRINTED TWICE — "Appraisal · August 2026 August
              2026" — because the round's NAME already ends in its period and
              the label was appended anyway. Shown only when it adds something,
              and joined with the same separator as everything else rather than
              a bare space. -- */}
        <p className="mt-1 font-sans text-body-sm text-ink-muted">
          {[
            review.designation,
            review.department,
            review.cycleName,
            review.periodLabel && !review.cycleName.includes(review.periodLabel)
              ? review.periodLabel
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || "—"}
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
      {/* -- A CARD, NOT A BOXED TABLE. UI-4: every actual card is borderless,
            and a hard rule round a grid is what made this read as an exported
            spreadsheet rather than a document — the same thing P27-2 had to
            take off the printed sheet. Hairlines between rows do the work.

            The tick is RIGHT-ALIGNED so eight of them share an edge; a ragged
            column of pills is most of what looks untidy at a glance. -- */}
      <div className="card-surface overflow-x-auto">
        <table className="w-full min-w-[22rem]">
          <thead>
            <tr className="border-b border-rule">
              <th scope="col" className="type-label px-5 py-3 text-left text-ink-muted">
                Quality
              </th>
              <th scope="col" className="type-label px-5 py-3 text-right text-ink-muted">
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
                  row.isOverall && "bg-surface-mute/60",
                )}
              >
                <td
                  className={cn(
                    "px-5 py-3 font-sans text-body-sm text-ink",
                    row.isOverall && "font-medium",
                  )}
                >
                  {row.text}
                </td>
                <td className="px-5 py-3 text-right">
                  <Tick value={row.supervisor} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>


      {/* ---------- What the supervisor added ---------- */}
      {/* -- THREE FACTS ON A ROW, not stacked down a column. Two of them are a
            word each, so a full-width block per fact left most of the card
            empty and pushed the salary panel a screen further down. The
            comment is prose and can run long, so it takes the wider half and
            keeps `whitespace-pre-wrap` — the old version dropped a
            supervisor's line breaks. -- */}
      <div className="card-surface grid gap-5 p-5 sm:grid-cols-3">
        <div>
          <p className="type-label text-ink-muted">Overall performance</p>
          <p className="mt-1 font-sans text-display-sm text-ink">
            {review.overallTick ? (TICK_WORD[review.overallTick] ?? review.overallTick) : "—"}
          </p>
        </div>
        <div>
          <p className="type-label text-ink-muted">Training required</p>
          <p className="mt-1 font-sans text-display-sm text-ink">
            {review.trainingRequired === null ? "Not answered" : review.trainingRequired ? "Yes" : "No"}
          </p>
        </div>
        <div className="sm:col-span-3">
          <p className="type-label text-ink-muted">Supervisor comment</p>
          <p className="mt-1 whitespace-pre-wrap font-sans text-body text-ink">
            {review.supervisorComment || "Nothing written."}
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
        /* -- THE MD MAY NOW SET THE FIGURE, at the owner's instruction, and it
              reverses F41-6.

              That decision said the MD is told to send it back rather than type
              an amount, because HR proposing and the MD approving collapsed
              into one person is the control AMEND-2 restored. The concern was
              put to the owner and they asked for it: in practice the MD is who
              decides the number, and bouncing a sheet back to HR to type a
              figure the MD has already chosen is a round trip that records
              nothing extra.

              The trail still distinguishes them — `log_worker_salary_change`
              names whoever wrote each figure, and the three stages below still
              read "HR priced it" or the MD's own name. What is gone is the
              REQUIREMENT that they be two people.

              CLOSED stays read-only for everybody: §8 has no path back from it
              and §17 forbids editing a closed record. -- */
        readOnly={closed || (review.status === "REVIEWED" && !isMd)}
        supervisorName={review.supervisorName}
        mdApproval={review.mdApproval}
        stages={review.stages}
        oldCtc={oldCtc}
        newCtc={newCtc}
        setOldCtc={setOldCtc}
        setNewCtc={setNewCtc}
        dirty={salaryDirty}
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
                  /* -- SAID BEFORE THE PRESS, not as an error after it.
                        The server refuses an unpriced hand-up, and a button that
                        is going to be refused should say so beside itself rather
                        than looking available (§13.4). This is the reported bug
                        from the other end: HR sent an 8% recommendation up with
                        no figures, and the MD approved an amount nobody had
                        written down. -- */
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => void finish("SEND_TO_MD")}
                      disabled={busy || !priced || salaryDirty}
                      className="min-h-11"
                    >
                      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                      Send to management
                    </Button>
                    {!priced ? (
                      <p className="font-sans text-body-sm text-critical">
                        Set the current and new salary above first — management approves an amount.
                      </p>
                    ) : salaryDirty ? (
                      /* -- THE REPORTED BUG, from the other end. HR was sent it
                            back, typed 17,000, and pressed this without saving.
                            The MD opened it and saw the old figure — the new one
                            had never left the browser. FIX-41's guard passed
                            because the appraisal WAS priced, just not with what
                            was on screen. Stale is not absent. -- */
                      <p className="font-sans text-body-sm text-critical">
                        Save the salary above first — management would otherwise be sent the previous figure.
                      </p>
                    ) : null}
                  </div>
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
                  <Button
                    onClick={() => void finish("CLOSE")}
                    disabled={busy || salaryDirty}
                    className="min-h-11"
                  >
                    {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                    Approve and close
                  </Button>
                  {/* -- The same guard HR's hand-up carries, for the same
                         reason and now on the more expensive side of it.
                         Approving is irreversible (§8 has no path back from
                         CLOSED), so signing off a figure that never left the
                         browser would write the PREVIOUS amount to the worker's
                         pay record with nothing on screen to show for it.
                         FIX-44 found this from HR's end; the MD's end is worse
                         because it cannot be undone. -- */}
                  {salaryDirty ? (
                    <p className="font-sans text-body-sm text-critical">
                      Save the salary above first — approving now would sign off the previous figure.
                    </p>
                  ) : null}
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
 * A THREE-COLUMN GRID, NOT A FLEX ROW WITH A GAP IN THE MIDDLE.
 *
 * It was `flex justify-between items-baseline`, and the three rows do not hold
 * the same amount of text: two have a name and a date on the left with one
 * figure on the right, while HR's has NO actor at all — pricing is not a
 * transition and stamps neither (F44-7) — and three lines of figure. Baseline
 * alignment then lines up only the first line of each side, so the blocks
 * drifted apart and nothing shared an edge down the card.
 *
 * The fix is to give every row the SAME SHAPE and let a grid do the aligning:
 *
 *   · a step number, so three decisions read as a sequence rather than as
 *     three unrelated lines — the same device the report's bands use;
 *   · one line of title and one line of context on the left, where "from
 *     ₹16,000 a month" now sits. It is context for the figure exactly as "who ·
 *     when" is, so it belongs in the same slot rather than stacked above the
 *     amount and pushing it out of line with its neighbours;
 *   · one figure and one optional note on the right, all sharing a right edge.
 *
 * `items-start` rather than baseline, so the three amounts sit at the same
 * offset from their row's top whatever is beneath them.
 *
 * A pending step is stated as pending rather than shown as a blank — §13.4, and
 * a blank beside two filled rows reads as a value that failed to load.
 */
function SalaryStage({
  index,
  step,
  who,
  at,
  value,
  note,
  pending,
  lead,
  was,
}: {
  /** 1, 2, 3 — the order the money actually moves through. */
  index: number;
  step: string;
  who: string | null;
  at: string | null;
  value: string;
  note?: string | null;
  pending?: boolean;
  /** A figure the decision rests on. Weight, not size — the display-size
      treatment belongs to the cards above, and two sizes in one list is what
      made the rows fail to line up. */
  lead?: boolean;
  /** What it was before. Context for the figure, so it sits with the other
      context rather than above the amount. */
  was?: string | null;
}) {
  /* -- NOTHING, rather than an em dash. A dash under a step with a real figure
        beside it reads as a value that failed to load; the HR row genuinely has
        no actor or date, because pricing is not a transition. Saying nothing is
        the truthful rendering of nothing. -- */
  const meta =
    [who, at ? formatDateTime(at) : null, was].filter(Boolean).join(" · ") || null;

  return (
    <li className="grid grid-cols-[1.25rem_1fr_auto] items-start gap-x-3 border-b border-rule py-2.5 first:pt-0 last:border-b-0 last:pb-0">
      <span
        aria-hidden
        className={cn(
          "tabular mt-0.5 text-center font-sans text-body-sm",
          pending ? "text-ink-faint" : "text-ink-muted",
        )}
      >
        {index}
      </span>

      <div className="min-w-0">
        <p className="font-sans text-body-sm text-ink">{step}</p>
        {meta ? <p className="font-sans text-body-sm text-ink-muted">{meta}</p> : null}
      </div>

      <div className="text-right">
        <p
          className={cn(
            "tabular font-sans text-body-lg leading-tight",
            lead && !pending && "font-medium",
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
  oldCtc,
  newCtc,
  setOldCtc,
  setNewCtc,
  dirty,
}: {
  evaluationId: string;
  salary: { salaryChanged: boolean; oldCtc: number | null; incrementPct: number | null; newCtc: number | null };
  currentCtcOnRecord: number | null;
  readOnly: boolean;
  supervisorName: string | null;
  mdApproval: WorkerReview["mdApproval"];
  stages: WorkerReview["stages"];
  /** The draft, owned above so the hand-up can refuse while it is unsaved. */
  oldCtc: number | null;
  newCtc: number | null;
  setOldCtc: (v: number | null) => void;
  setNewCtc: (v: number | null) => void;
  dirty: boolean;
}) {
  const router = useRouter();

  /* -- NOT PRE-FILLED FROM THE EMPLOYMENT RECORD, at the owner's instruction.

        It used to fall back to `currentCtcOnRecord`, which made an unsaved
        screen look identical to a saved one: HR saw a figure in the box, had no
        way to tell it was a suggestion rather than a stored value, and pressing
        nothing left the appraisal with no salary on it at all. Only what HR has
        actually saved is shown; the record's figure is offered BESIDE the field
        as something to copy, so nothing is lost and nothing is assumed. -- */
  const [busy, setBusy] = React.useState(false);
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
        the empty field alone would have made "Which would make it" go blank on every
        appraisal that had not been priced yet — trading one confusing screen for
        another. What is stored still comes only from what HR typed. -- */
  const basis = oldCtc ?? currentCtcOnRecord;
  const suggested = basis !== null && pct !== null ? Math.round(basis * (1 + pct / 100)) : null;

  /* -- Stated, not left to be worked out from two figures on adjacent lines.
        Only where both are known — a difference against a missing figure is not
        a rise, it is an assumption. -- */
  const rise = oldCtc !== null && newCtc !== null ? newCtc - oldCtc : null;

  /* -- The approved figure, or nothing. There is no separate approved COLUMN in
        this module — management approves the figure HR set — so what makes it
        an approval is `mdApproval`, and without that there is nothing to show.
        Derived once so the card and the stage row read the same value. -- */
  const approved = mdApproval ? salary.newCtc : null;

  async function save() {
    setBusy(true);
    setError(null);
    const result = await saveWorkerSalaryAsHr(evaluationId, { oldCtc, newCtc });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
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
        {/* -- Whose screen this is. It read "You set the figures" to everybody,
              including the MD, who does not — they approve what HR set, and an
              instruction somebody cannot act on is worse than none (§13.4). -- */}
        <p className="font-sans text-body-sm text-ink-muted">
          {readOnly
            ? "The supervisor recommends the percentage and HR sets the figures. The supervisor is never shown an amount."
            : "The supervisor recommends the percentage. You set the figures — they are not shown any salary."}
        </p>
      </div>

      {/* -- THREE FIGURES, AND NAMES THAT SAY WHICH IS WHICH.

            It was two cards — "Supervisor's recommendation" (8%) and "Which
            comes to" (₹16,200) — and they were reported as confusing, fairly:
            they are two views of ONE thing, the suggestion, and neither name
            says so. "Which comes to" in particular reads as a conclusion when
            it is a hypothetical.

            Three now, left to right in the order the decision is actually made:
            what the supervisor suggested, what that percentage would come to,
            and what HR actually set. The third is the one that was missing from
            the top of the panel entirely — it sat only in the stage list below,
            so the divergence between ₹16,200 and ₹16,000 was two glances apart
            when it is the whole point of the row. -- */}
      {/* -- TINTED, at the owner's instruction, from the same map the increment
            report's salary cards use — so a reader who has seen one recognises
            the other rather than learning two conventions.

            SHARING THE PALETTE DOES NOT CROSS §7's MODULE BOUNDARY. That rule
            forbids refactoring a staff FUNCTION to serve the worker module; a
            set of colour tokens is shared infrastructure, the same distinction
            P24-5 drew when this module was given the staff `FormRenderer`.
            Nothing about worker DATA moves.

            WHY THESE THREE HUES. The first two are one person's single
            statement — a percentage, and what that percentage comes to — so
            they share the rater's tint; giving the priced figure a colour of
            its own would say a second person had proposed it. The third is a
            different decision by a different person, so it takes the settled
            tint. Same reasoning the staff panel uses, and the same tokens.

            No dot on any of them: `SALARY_DOT` answers "which of the three
            layers", and the worker module has no layers — the supervisor rates
            and HR prices. -- */}
      <dl className="grid gap-4 sm:grid-cols-3">
        <div className={cn("rounded-card p-4", SALARY_TINT[pct === null ? "none" : "proposed"])}>
          <dt className="type-label text-ink-muted">Supervisor suggested %</dt>
          <dd className="tabular font-sans text-display-sm text-ink">
            {pct === null ? "—" : `${pct}%`}
          </dd>
          <dd className="font-sans text-body-sm text-ink-muted">
            {pct === null
              ? "They recorded no percentage."
              : "From their sheet. A suggestion, not the figure."}
          </dd>
        </div>
        {/* -- Its own hue now, not the supervisor's. The two cards shared pink
              on the reasoning that a percentage and what it comes to are one
              person's single statement — true, and the owner has chosen to read
              the row as three steps instead: what was suggested, what that
              proposes, what management approves. Same three-step shape the
              increment report uses. -- */}
        <div className={cn("rounded-card p-4", SALARY_TINT[suggested === null ? "none" : "today"])}>
          <dt className="type-label text-ink-muted">Proposed Salary</dt>
          <dd className="tabular font-sans text-display-sm text-ink">{moneyMonthly(suggested)}</dd>
          {/* -- Three audiences, three sentences. "Needs a current salary" is an
                instruction, and the MD cannot act on it — they send it back to
                HR instead, which is what the wording now says. -- */}
          <dd className="font-sans text-body-sm text-ink-muted">
            {suggested !== null
              ? readOnly
                ? "If their percentage were used as it is."
                : "You can set a different figure below."
              : readOnly
                ? "HR did not record a current salary, so the percentage cannot be priced. Send it back to have it added."
                : "Needs a current salary and a percentage."}
          </dd>
        </div>
        {/* -- WHAT HR ACTUALLY SET, at the owner's instruction.

              Blank until it is saved — never falling back to the suggestion,
              which would show a figure nobody chose on the number a wage is
              paid from. Where it differs from the suggestion the card says by
              how much, because that difference IS the decision HR made and it
              is what management is being asked to approve. -- */}
        {/* -- BLANK UNTIL MANAGEMENT HAS ACTUALLY APPROVED, at the owner's
              instruction — and it was showing HR's own figure before anybody
              had signed it off, under a heading reading "Management Approved".

              `mdApproval` is the signal, NOT `closed`: it is the record of who
              approved and when, and it is already what the stage row below
              keys on, so the card and the row cannot disagree. HR can close a
              sheet themselves on some paths, and that is not a management
              approval — the card should stay empty there and say so.

              The same rule the staff report's approval card follows (F36-2):
              never defaulting to the proposal, because a figure standing in for
              an approval nobody gave is the one number a wage is paid from. -- */}
        <div
          className={cn(
            "rounded-card p-4",
            SALARY_TINT[approved === null ? "none" : "approved"],
          )}
        >
          {/* -- RENAMED at the owner's instruction. The figure is HR's, and
                management approves it by closing — so the LABEL is the right
                name for the slot and the CAPTION has to carry the stage, or a
                card reading "Management Approved · ₹17,600 · Set it below"
                would say two contradictory things at once. Approved only where
                the appraisal is actually closed. -- */}
          <dt className="type-label text-ink-muted">Management Approved</dt>
          <dd className="tabular font-sans text-display-sm text-ink">
            {approved === null ? "—" : moneyMonthly(approved)}
          </dd>
          {/* -- FOUR STATES, each true and each different, because a blank card
                has to say WHICH kind of blank it is (§13.4). Nothing priced ·
                priced and still with HR · priced and sitting with management ·
                approved. -- */}
          <dd className="font-sans text-body-sm text-ink-muted">
            {approved !== null
              ? suggested === null || approved === suggested
                ? "Approved. The same as the suggestion."
                : `Approved. ${moneyMonthly(Math.abs(approved - suggested))} ${
                    approved > suggested ? "more" : "less"
                  } than the suggestion.`
              : salary.newCtc === null
                ? readOnly
                  ? "HR did not record a figure before this went up."
                  : "Not approved yet. Set it below and press Save salary."
                : readOnly
                  ? "With management. It fills in when they approve it."
                  : "Not approved yet. Send it to management when the figures are right."}
          </dd>
        </div>
      </dl>

      {readOnly ? (
        /* -- THE STAGES, NAMED — not two figures with no account of themselves.
              Each row states who set it and when, so a closed appraisal reads as
              a record of three decisions rather than as a screen that has
              stopped working. The management row is the one that was missing
              entirely: an approved figure that never said it was approved. -- */
        <ol className="border-t border-rule pt-3">
          <SalaryStage
            index={1}
            step="Supervisor recommended"
            who={supervisorName}
            at={stages.supervisorSubmittedAt}
            value={pct === null ? "No change" : `${pct}%`}
          />
          <SalaryStage
            index={2}
            step="HR priced it"
            who={null}
            at={null}
            /* -- THE FIGURE THE MD APPROVES, marked as such.
                  It was one line of body text with the whole transition crammed
                  into it — "₹15,000.00 a month → ₹16,000.00 a month" — and the
                  rise beneath it in the smallest type on the card. The new
                  salary leads and the current one is context.
                  WEIGHT, not size: the display-size treatment now belongs to
                  the three cards above, and two type sizes inside this list is
                  what stopped the rows lining up. -- */
            lead
            value={rise === null ? "Not priced" : moneyMonthly(newCtc)}
            was={rise === null ? null : `from ${moneyMonthly(oldCtc)}`}
            /* -- An unpriced row is a GAP, not a neutral blank. It can only
                  exist on a sheet handed up before the guard above was added,
                  and whoever reads it needs to know the approval has no amount
                  behind it rather than assume the figure failed to load. -- */
            /* `moneyMonthly` already ends in "a month" — appending another
               rendered "A rise of ₹1,500.00 a month a month". */
            note={
              rise === null
                ? "No figure was recorded before this went up"
                : `A rise of ${moneyMonthly(rise)}`
            }
            pending={rise === null}
          />
          <SalaryStage
            index={3}
            step="Management approved"
            who={mdApproval?.name ?? null}
            at={mdApproval?.at ?? stages.mdReviewedAt}
            // Once approved this is the figure that gets paid, so it is marked
            // the same way as the one it approves.
            lead
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
              {/* -- NO PLACEHOLDER. `MoneyInput` defaults to "50,000", and a
                    grey figure sitting in a money box reads as a stored value
                    to most people — which is the exact ambiguity F22-2 was
                    reported for, arriving by a different route. The ₹ prefix
                    and the label already say what the field is; a specimen
                    number adds nothing and can be misread as data.

                    Left alone on the increment screens, which nobody has
                    raised and which are a separate surface. -- */}
              <MoneyInput
                id="w_old_hr"
                value={oldCtc}
                onValueChange={setOldCtc}
                placeholder=""
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
              {/* -- No hint under this one, at the owner's instruction. The
                    column already carries the quick-set link, and with Current
                    salary now pre-filled its own caption is a real readout —
                    so "A monthly figure." was the only line here saying
                    nothing. The annual readout still appears the moment a
                    figure is typed. -- */}
              <MoneyInput
                id="w_new_hr"
                value={newCtc}
                onValueChange={setNewCtc}
                emptyHint={null}
                placeholder=""
              />
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

          {/* -- COMPULSORY, AND IMPOSSIBLE TO MISS.
                It was `variant="secondary"` reading "Save salary", and reported
                as being sent past: HR typed a figure, went straight to Send to
                management, and the MD received the previous one. A control that
                MUST be pressed for the next step to be honest is a primary
                action (§13.3), not a quiet one.

                Three states, each true: nothing typed yet, unsaved edits, and
                saved. The old button said "Saved" and then went on saying it
                while somebody typed a new figure over the top — which is the
                single most misleading thing it could have said. -- */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void save()}
              disabled={busy || !dirty}
              className="min-h-11"
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {dirty ? "Save salary" : "Saved"}
            </Button>
            {dirty ? (
              <p className="font-sans text-body-sm text-critical">
                Not saved yet. Management sees the saved figure, not what is typed here.
              </p>
            ) : oldCtc !== null || newCtc !== null ? (
              <p className="font-sans text-body-sm text-ink-muted">
                Saved. Management will see these figures.
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

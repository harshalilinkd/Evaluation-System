"use client";

/** The supervisor's completed sheet, and the one action that finishes it. */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reviewWorkerAppraisal, type WorkerReview } from "@/lib/worker/review";
import { formatInr } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

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
}: {
  review: WorkerReview;
  cycleId: string;
}) {
  const router = useRouter();
  const [remarks, setRemarks] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const done = review.status === "REVIEWED" || review.status === "CLOSED";

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const result = await reviewWorkerAppraisal(review.evaluationId, remarks);
      if (!result.ok) {
        setError(result.error.message);
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
        <h1 className="mt-2 font-sans text-h2 text-ink">{review.workerName}</h1>
        <p className="font-sans text-body-sm text-ink-muted">
          {[review.designation, review.department].filter(Boolean).join(" · ") || "—"} ·{" "}
          {review.cycleName} {review.periodLabel}
        </p>
      </div>

      {done ? (
        <p className="flex items-center gap-2 rounded-card bg-success-tint px-4 py-3 font-sans text-body-sm text-ink">
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
          Reviewed. Nothing further is needed.
        </p>
      ) : null}

      {/* ---------- The sheet ----------
            ONE COLUMN. The supervisor fills it and the worker does not, so
            there is nothing to compare and no second opinion to set beside it.
            The two-column layout this replaced was drawn for a blind two-sided
            round, which is not what this module does. */}
      <div className="overflow-hidden rounded-card border border-rule">
        <table className="w-full">
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

      {/* ---------- Salary ---------- */}
      {review.salary ? (
        <div className="card-surface space-y-3 p-5">
          <p className="font-sans text-body-lg text-ink">Salary</p>
          {review.salary.salaryChanged ? (
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="type-label text-ink-muted">Old</dt>
                <dd className="tabular font-sans text-body text-ink">
                  {formatInr(review.salary.oldCtc)}
                </dd>
              </div>
              <div>
                <dt className="type-label text-ink-muted">Increment</dt>
                <dd className="tabular font-sans text-body text-ink">
                  {review.salary.incrementPct === null ? "—" : `${review.salary.incrementPct}%`}
                </dd>
              </div>
              <div>
                <dt className="type-label text-ink-muted">New</dt>
                <dd className="tabular font-sans text-body text-ink">
                  {formatInr(review.salary.newCtc)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="font-sans text-body-sm text-ink-muted">No change proposed.</p>
          )}
        </div>
      ) : null}

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

          {/* §13.3: one primary action. */}
          <div className="flex items-center justify-between gap-3">
            <p className="font-sans text-body-sm text-ink-muted">
              This closes the appraisal. Nothing can be changed afterwards.
            </p>
            <Button onClick={() => void finish()} disabled={busy} className="min-h-11">
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Mark reviewed
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

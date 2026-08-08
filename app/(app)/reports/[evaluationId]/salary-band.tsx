"use client";

/**
 * Band 6 — the salary review (P21). INCREMENT cycles only, HR and MD only.
 *
 * NOTHING IS CALCULATED IN THIS FILE. Every figure comes from
 * `lib/increment/calc.ts`, which is also what the server stores — so the number
 * on screen and the number in the database are produced by the same code. A
 * percent worked out in an onChange is a percent nobody can reproduce.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { BandHeading } from "@/app/(app)/reports/[evaluationId]/report-bands";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  annualisedPct,
  expectationGap,
  firstOfNextMonth,
  hikeAmount,
  hikePct,
  monthlyFromAnnual,
  newCtcFromPct,
} from "@/lib/increment/calc";
import { confirmIncrement, saveApproval, saveProposal } from "@/lib/increment/actions";
import type { SalaryBand as SalaryBandData } from "@/lib/increment/queries";
import { formatDate, formatInr } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <figure className="rounded-control border border-rule bg-surface-mute p-4">
      <figcaption className="type-label text-ink-muted">{label}</figcaption>
      <p className="tabular text-display-md text-ink">{value}</p>
      {hint ? <p className="font-sans text-body-sm text-ink-muted">{hint}</p> : null}
    </figure>
  );
}

function Notice({ tone, children }: { tone: "error" | "ok"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-control border px-3 py-2 font-sans text-body-sm",
        tone === "error"
          ? "border-critical/40 bg-critical-tint text-critical"
          : "border-final/40 bg-final-tint text-final",
      )}
    >
      {children}
    </p>
  );
}

const money = (v: number | null) => (v === null ? "—" : formatInr(v));
const pctText = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);

export function SalaryBand({
  data,
  evaluationId,
  status,
  isHr,
  index,
}: {
  data: SalaryBandData;
  evaluationId: string;
  status: string;
  isHr: boolean;
  /** Counted by the page, so the sequence closes up when a band is absent. */
  index: number;
}) {
  const router = useRouter();
  const review = data.review;
  const firstName = data.employeeName.trim().split(/\s+/)[0] ?? "they";

  /* -- The blocking case, first. Everything below divides by the current CTC. -- */
  if (data.currentCtc === null || data.currentCtc <= 0) {
    return (
      <section className="space-y-4">
        <h2 className="font-sans text-display-sm text-ink">Salary</h2>
        <div className="rounded-card border border-critical/40 bg-critical-tint p-6">
          <p className="flex items-start gap-2 font-sans text-body text-critical">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            No current salary on record for {data.employeeName}. Add it in People to continue.
          </p>
          <Button asChild variant="secondary" size="sm" className="mt-3">
            <Link href={`/admin/people/${data.profileId}/employment`}>
              Open their Employment tab
            </Link>
          </Button>
        </div>
      </section>
    );
  }

  const currentCtc = data.currentCtc;

  return (
    <section className="space-y-4">
      {/* Numbered like the other five, so the document reads as one thing. It
          is band 6 on an increment cycle and does not exist otherwise. */}
      <BandHeading
        index={index}
        title="Salary"
        hint="Every figure here is for HR and the MD only."
      />

      {/* ---------- Row 1 ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Joining CTC" value={money(data.joiningCtc)} />
        <Figure
          label="Current CTC"
          value={money(currentCtc)}
          hint={`${money(monthlyFromAnnual(currentCtc))} a month`}
        />
        <Figure
          label="Months since last increment"
          value={data.monthsSinceLastIncrement === null ? "—" : String(data.monthsSinceLastIncrement)}
        />
        <Figure
          label="Last increment"
          value={data.lastIncrementDate ? formatDate(data.lastIncrementDate) : "—"}
        />
      </div>

      {isHr ? (
        <HrProposal data={data} evaluationId={evaluationId} currentCtc={currentCtc} firstName={firstName} />
      ) : (
        <MdApproval data={data} evaluationId={evaluationId} currentCtc={currentCtc} firstName={firstName} />
      )}

      {/* ---------- Row 4: context ---------- */}
      <div className="grid gap-4 md:grid-cols-2">
        <article className="card-surface p-4">
          <h3 className="type-label text-ink-muted">Their last three increments</h3>
          {data.history.length === 0 ? (
            <p className="mt-2 font-sans text-body-sm text-ink-muted">Nothing on record yet.</p>
          ) : (
            <table className="mt-2 w-full border-collapse">
              <thead>
                <tr className="border-b border-rule">
                  {["From", "Previous", "New", "Hike"].map((h) => (
                    <th key={h} className="type-label py-1 text-left font-bold text-ink">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.history.map((row) => (
                  <tr key={row.effectiveFrom} className="border-b border-rule last:border-b-0">
                    <td className="py-1.5 tabular text-body-sm text-ink-muted">{formatDate(row.effectiveFrom)}</td>
                    <td className="py-1.5 tabular text-body-sm text-ink-muted">{money(row.previousCtc)}</td>
                    <td className="py-1.5 tabular text-body-sm text-ink">{money(row.newCtc)}</td>
                    <td className="py-1.5 tabular text-body-sm text-ink">{pctText(row.hikePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>

        <article className="card-surface p-4">
          <h3 className="type-label text-ink-muted">This department, this cycle</h3>
          {data.departmentSampleSize === 0 ? (
            <p className="mt-2 font-sans text-body-sm text-ink-muted">
              Nobody else in this department has an agreed figure yet.
            </p>
          ) : (
            <>
              <p className="mt-2 tabular text-display-md text-ink">{pctText(data.departmentMedianPct)}</p>
              <p className="font-sans text-body-sm text-ink-muted">
                Median across {data.departmentSampleSize}{" "}
                {data.departmentSampleSize === 1 ? "person" : "people"} with an approved or final
                figure. Context, not a target.
              </p>
            </>
          )}
        </article>
      </div>

      {/* ---------- The interview ---------- */}
      {status === "MD_REVIEWED" && review?.md_approved_ctc ? (
        <InterviewCard
          evaluationId={evaluationId}
          employeeName={data.employeeName}
          currentCtc={currentCtc}
          approvedCtc={review.md_approved_ctc}
          approvedPct={review.md_approved_hike_pct}
          onDone={() => router.refresh()}
        />
      ) : null}

      {review?.final_ctc ? (
        <div className="rounded-card border border-final/40 bg-final-tint p-6">
          <p className="font-sans text-body text-final">
            Confirmed: {money(review.current_ctc)} → {money(review.final_ctc)} (
            {pctText(review.final_hike_pct)}), effective{" "}
            {review.effective_from ? formatDate(review.effective_from) : "—"}.
          </p>
        </div>
      ) : null}
    </section>
  );
}

/* ---------- Row 2 and 3, HR ---------- */

function HrProposal({
  data,
  evaluationId,
  currentCtc,
  firstName,
}: {
  data: SalaryBandData;
  evaluationId: string;
  currentCtc: number;
  firstName: string;
}) {
  const router = useRouter();
  const review = data.review;

  const [ctcText, setCtcText] = React.useState(review?.hr_proposed_ctc ? String(review.hr_proposed_ctc) : "");
  const [pctInput, setPctInput] = React.useState(
    review?.hr_proposed_hike_pct !== null && review?.hr_proposed_hike_pct !== undefined
      ? String(review.hr_proposed_hike_pct)
      : "",
  );
  const [justification, setJustification] = React.useState(review?.hr_justification ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const proposed = ctcText === "" ? null : Number(ctcText.replace(/[₹,\s]/g, ""));

  /* -- The two inputs are LINKED, and neither is the master.
        Editing one recomputes the other through calc.ts — the same functions the
        server uses to store the figure, so the screen cannot show a percent the
        database would disagree with. -- */
  function onCtcChange(value: string) {
    setCtcText(value);
    const amount = value === "" ? null : Number(value.replace(/[₹,\s]/g, ""));
    const pct = hikePct(currentCtc, amount);
    setPctInput(pct === null ? "" : String(pct));
  }

  function onPctChange(value: string) {
    setPctInput(value);
    const pct = value === "" ? null : Number(value);
    const amount = newCtcFromPct(currentCtc, pct);
    setCtcText(amount === null ? "" : String(amount));
  }

  const pct = hikePct(currentCtc, proposed);
  const amount = hikeAmount(currentCtc, proposed);
  const annualised = annualisedPct(pct, data.monthsSinceLastIncrement);
  const gap = expectationGap(review?.employee_expectation_ctc ?? null, proposed);

  async function onSave() {
    if (proposed === null) return;
    setBusy(true);
    setError(null);
    const result = await saveProposal({ evaluationId, proposedCtc: proposed, justification });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <>
      {/* ---------- Row 2 ---------- */}
      <div className="grid gap-4 md:grid-cols-2">
        <article className="card-surface p-4">
          <h3 className="type-label text-ink-muted">What {firstName} asked for</h3>
          {review?.employee_expectation_ctc ? (
            <>
              <p className="mt-1 tabular text-display-md text-ink">
                {money(review.employee_expectation_ctc)}
              </p>
              {review.employee_expectation_note ? (
                <p className="mt-1 whitespace-pre-wrap font-sans text-body-sm text-ink-muted">
                  {review.employee_expectation_note}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-1 font-sans text-body text-ink-muted">Not stated.</p>
          )}
        </article>

        <article className="card-surface p-4">
          <h3 className="type-label text-ink-muted">Against your proposal</h3>
          {gap.amount === null ? (
            <p className="mt-1 font-sans text-body text-ink-muted">
              {review?.employee_expectation_ctc ? "Enter a proposal to compare." : "Nothing to compare."}
            </p>
          ) : (
            <>
              <p className={cn("mt-1 tabular text-display-md", gap.amount < 0 ? "text-critical" : "text-ink")}>
                {gap.amount > 0 ? "+" : ""}
                {money(gap.amount)}
              </p>
              <p className="font-sans text-body-sm text-ink-muted">
                {pctText(gap.pct)} against what they asked for.
              </p>
            </>
          )}
        </article>
      </div>

      {/* ---------- Row 3 ---------- */}
      <article className="card-surface space-y-4 p-6">
        <h3 className="font-sans text-body font-medium text-ink">Your proposal</h3>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {saved && !error ? <Notice tone="ok">Saved.</Notice> : null}

        <div className="flex flex-wrap gap-2">
          {data.hikeBands.map((band) => (
            <Button
              key={band}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onPctChange(String(band))}
            >
              {band}%
            </Button>
          ))}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="hike_pct" className="type-label text-ink-muted">Hike percent</Label>
            <Input
              id="hike_pct"
              value={pctInput}
              onChange={(e) => onPctChange(e.target.value)}
              inputMode="decimal"
              className="min-h-11 tabular"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new_ctc" className="type-label text-ink-muted">New CTC</Label>
            <Input
              id="new_ctc"
              value={ctcText}
              onChange={(e) => onCtcChange(e.target.value)}
              inputMode="numeric"
              className="min-h-11 tabular"
            />
          </div>
        </div>

        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="type-label text-ink-muted">Hike amount</dt>
            <dd className="tabular text-body text-ink">{money(amount)}</dd>
          </div>
          <div>
            <dt className="type-label text-ink-muted">Annualised</dt>
            <dd className="tabular text-body text-ink">{pctText(annualised)}</dd>
            <dd className="font-sans text-body-sm text-ink-muted">
              {data.monthsSinceLastIncrement
                ? `What ${pctText(pct)} over ${data.monthsSinceLastIncrement} months is worth per year. Context only — the money paid is ${pctText(pct)}.`
                : "No last-increment date to annualise against."}
            </dd>
          </div>
          <div>
            <dt className="type-label text-ink-muted">New monthly</dt>
            <dd className="tabular text-body text-ink">{money(monthlyFromAnnual(proposed))}</dd>
          </div>
        </dl>

        <div className="space-y-2">
          <Label htmlFor="justification" className="type-label text-ink-muted">Justification</Label>
          <Textarea
            id="justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={4}
            placeholder="Why is this the right figure?"
          />
          <p className="font-sans text-body-sm text-ink-muted">
            Required. It goes to the MD with the number.
          </p>
        </div>

        <Button
          type="button"
          className="min-h-11"
          disabled={busy || proposed === null || proposed <= 0 || justification.trim() === ""}
          onClick={onSave}
        >
          {busy ? "Saving…" : "Save the proposal"}
        </Button>
      </article>
    </>
  );
}

/* ---------- The MD's view ---------- */

function MdApproval({
  data,
  evaluationId,
  currentCtc,
  firstName,
}: {
  data: SalaryBandData;
  evaluationId: string;
  currentCtc: number;
  firstName: string;
}) {
  const router = useRouter();
  const review = data.review;

  const [ctcText, setCtcText] = React.useState(
    review?.md_approved_ctc
      ? String(review.md_approved_ctc)
      : review?.hr_proposed_ctc
        ? String(review.hr_proposed_ctc)
        : "",
  );
  const [remarks, setRemarks] = React.useState(review?.md_remarks ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const approved = ctcText === "" ? null : Number(ctcText.replace(/[₹,\s]/g, ""));
  const pct = hikePct(currentCtc, approved);

  async function onApprove() {
    if (approved === null) return;
    setBusy(true);
    setError(null);
    const result = await saveApproval({ evaluationId, approvedCtc: approved, remarks });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else router.refresh();
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <article className="card-surface p-4">
          <h3 className="type-label text-ink-muted">What {firstName} asked for</h3>
          {review?.employee_expectation_ctc ? (
            <>
              <p className="mt-1 tabular text-display-md text-ink">{money(review.employee_expectation_ctc)}</p>
              {review.employee_expectation_note ? (
                <p className="mt-1 whitespace-pre-wrap font-sans text-body-sm text-ink-muted">
                  {review.employee_expectation_note}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-1 font-sans text-body text-ink-muted">Not stated.</p>
          )}
        </article>

        {/* HR's figures, read-only for the MD — the trigger refuses a write. */}
        <article className="card-surface p-4">
          <h3 className="type-label text-ink-muted">HR proposed</h3>
          <p className="mt-1 tabular text-display-md text-ink">{money(review?.hr_proposed_ctc ?? null)}</p>
          <p className="font-sans text-body-sm text-ink-muted">
            {pctText(review?.hr_proposed_hike_pct ?? null)}
          </p>
          {review?.hr_justification ? (
            <p className="mt-2 whitespace-pre-wrap font-sans text-body-sm text-ink-muted">
              {review.hr_justification}
            </p>
          ) : null}
        </article>
      </div>

      <article className="card-surface space-y-4 p-6">
        <h3 className="font-sans text-body font-medium text-ink">Your approval</h3>
        {error ? <Notice tone="error">{error}</Notice> : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="approved_ctc" className="type-label text-ink-muted">Approved CTC</Label>
            <Input
              id="approved_ctc"
              value={ctcText}
              onChange={(e) => setCtcText(e.target.value)}
              inputMode="numeric"
              className="min-h-11 tabular"
            />
            <p className="font-sans text-body-sm text-ink-muted">
              Defaults to HR&rsquo;s proposal. {pctText(pct)} on the current salary.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="md_salary_remarks" className="type-label text-ink-muted">Remarks</Label>
            <Textarea
              id="md_salary_remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={4}
            />
          </div>
        </div>

        <Button
          type="button"
          className="min-h-11"
          disabled={busy || approved === null || approved <= 0 || remarks.trim() === ""}
          onClick={onApprove}
        >
          {busy ? "Saving…" : "Approve this figure"}
        </Button>
      </article>
    </>
  );
}

/* ---------- The interview ---------- */

function InterviewCard({
  evaluationId,
  employeeName,
  currentCtc,
  approvedCtc,
  approvedPct,
  onDone,
}: {
  evaluationId: string;
  employeeName: string;
  currentCtc: number;
  approvedCtc: number;
  approvedPct: number | null;
  onDone: () => void;
}) {
  /* -- NO SEPARATE INTERVIEW STEP, at the owner's instruction.
        "When HR reviews and sends to the MD it means the interview is
        scheduled" — so the call is not a thing the system asks about
        afterwards, and asking for its date, its attendees and its notes was
        three fields nobody was going to fill in truthfully.

        §8's INTERVIEW_DONE has NOT been removed and no migration was written.
        `confirm_increment` (0030) already runs MD_REVIEWED -> INTERVIEW_DONE ->
        CLOSED inside ONE transaction, so that status has never been somewhere a
        record rests — it is a step inside an atomic call. Editing an applied
        migration to delete it would be forbidden (§0.8) and would buy nothing;
        what was worth removing was the data entry, and that is what has gone.

        The three interview columns stay and are left null, which reads honestly
        as "not separately recorded" rather than as a date somebody invented. -- */
  const today = new Date();
  const [finalText, setFinalText] = React.useState(String(approvedCtc));
  const [effectiveFrom, setEffectiveFrom] = React.useState(firstOfNextMonth(today));
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const finalCtc = finalText === "" ? null : Number(finalText.replace(/[₹,\s]/g, ""));
  const finalPct = hikePct(currentCtc, finalCtc);

  async function onConfirm() {
    if (finalCtc === null) return;
    setBusy(true);
    setError(null);
    const result = await confirmIncrement({ evaluationId, finalCtc, effectiveFrom });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else {
      setOpen(false);
      onDone();
    }
  }

  return (
    <article className="card-surface space-y-4 p-6">
      <div>
        <h3 className="font-sans text-body font-medium text-ink">Confirm and close</h3>
        <p className="font-sans text-body-sm text-ink-muted">
          The MD approved {money(approvedCtc)} ({pctText(approvedPct)}). Confirming writes it to
          {" "}
          {employeeName}&rsquo;s pay record and closes the evaluation.
        </p>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="final_ctc" className="type-label text-ink-muted">Final CTC</Label>
          <Input id="final_ctc" value={finalText} onChange={(e) => setFinalText(e.target.value)}
            inputMode="numeric" className="min-h-11 tabular" />
          <p className="font-sans text-body-sm text-ink-muted">{pctText(finalPct)} on the current salary.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="effective_from" className="type-label text-ink-muted">Effective from</Label>
          <Input id="effective_from" type="date" value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)} className="min-h-11 tabular" />
        </div>
      </div>

      <Button
        type="button"
        className="min-h-11"
        disabled={finalCtc === null || finalCtc <= 0 || effectiveFrom === ""}
        onClick={() => setOpen(true)}
      >
        Confirm and close
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm this increment</DialogTitle>
            {/* The outcome in words, not just figures in fields. This writes to a
                pay record and closes the evaluation — §13.4. */}
            <DialogDescription>
              Confirm {employeeName}&rsquo;s increment from {money(currentCtc)} to {money(finalCtc)},
              a {pctText(finalPct)} rise effective {effectiveFrom ? formatDate(effectiveFrom) : "—"}?
              This updates their salary record and cannot be undone from this screen.
            </DialogDescription>
          </DialogHeader>

          {error ? <Notice tone="error">{error}</Notice> : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={onConfirm} disabled={busy}>
              {busy ? "Confirming…" : "Confirm it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

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
import { approveAndClose, confirmIncrement, saveProposal } from "@/lib/increment/actions";
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
  selfOverall,
  leadOverall,
}: {
  data: SalaryBandData;
  evaluationId: string;
  status: string;
  isHr: boolean;
  /** Counted by the page, so the sequence closes up when a band is absent. */
  index: number;
  /* -- The two stored layer averages. Passed in rather than re-derived here:
        the report has already computed them from the frozen snapshot, and a
        second reading on this screen could disagree with the one the database
        is about to store. -- */
  selfOverall: number | null;
  leadOverall: number | null;
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

      {/* -- BOTH, FOR HR. It was an if/else: HR got the proposal and the MD got
            the approval, so the close button — which lives in the approval —
            was on a panel HR never rendered. 0056 gave HR the permission and
            this branch went on hiding the control, which is the whole of "HR
            still don't get close option".

            The MD still sees only the approval: proposing is HR's, and that
            half of AMEND-2's split is untouched. -- */}
      {isHr ? (
        <HrProposal data={data} evaluationId={evaluationId} currentCtc={currentCtc} firstName={firstName} />
      ) : null}

      <MdApproval
        data={data}
        evaluationId={evaluationId}
        currentCtc={currentCtc}
        firstName={firstName}
        isHr={isHr}
      />

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
          selfOverall={selfOverall}
          leadOverall={leadOverall}
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

  /* -- GREY WHEN THERE IS NOTHING LEFT TO SAVE.
        It stayed lit and said "Save the proposal" after saving, with only a
        transient "Saved." above it — so the screen looked identical before and
        after, and pressing it again rewrote the same row. Compared against the
        STORED values rather than a flag, so it is still right after a reload
        and re-arms the moment either the figure or the note is edited. -- */
  const storedCtc =
    data.review?.hr_proposed_ctc == null ? null : Number(data.review.hr_proposed_ctc);
  const storedNote = (data.review?.hr_justification ?? "").trim();
  const dirty = proposed !== storedCtc || justification.trim() !== storedNote;

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
          <h3 className="type-label text-ink-muted">Your proposal against their ask</h3>
          {gap.amount === null ? (
            <p className="mt-1 font-sans text-body text-ink-muted">
              {review?.employee_expectation_ctc ? "Enter a proposal to compare." : "Nothing to compare."}
            </p>
          ) : (
            <>
              {/* -- A SIGNED FIGURE WITH NO VERB IS A PUZZLE.
                    It read "+₹1,85,000.00" under the heading "Against your
                    proposal", then "740.00% against what they asked for" — three
                    ambiguities at once: which way the sign points, whether the
                    percent describes the proposal or the difference, and paise
                    on a rounded difference nobody quotes to the paisa.

                    Now the number is the size of the gap and the words carry the
                    direction. -- */}
              <p
                className={cn(
                  "mt-1 tabular text-display-md",
                  gap.amount < 0 ? "text-critical" : "text-ink",
                )}
              >
                {gap.amount === 0 ? money(0) : money(Math.abs(gap.amount))}
              </p>
              <p className="font-sans text-body-sm text-ink-muted">
                {gap.amount === 0
                  ? "Exactly what they asked for."
                  : gap.amount > 0
                    ? `more than they asked for${gap.pct === null ? "" : ` — ${pctText(gap.pct)} above their figure`}.`
                    : `less than they asked for${gap.pct === null ? "" : ` — ${pctText(Math.abs(gap.pct))} below their figure`}.`}
              </p>

              {/* -- A UNITS CHECK, phrased as a question rather than a verdict.
                    An employee who types a MONTHLY figure into an annual field
                    produces exactly this shape — a proposal several times their
                    stated ask — and the arithmetic above is then meaningless
                    while looking perfectly precise. 0055 makes the question ask
                    for an annual figure in as many words, but answers already
                    given cannot be re-asked, and a pay decision should not rest
                    on a number whose units are in doubt. -- */}
              {gap.pct !== null && gap.pct >= 200 ? (
                <p className="mt-2 rounded-control bg-warning-tint px-2.5 py-1.5 font-sans text-body-sm text-ink">
                  That is a long way apart. Worth checking they gave an annual figure rather than a
                  monthly one before this anchors anything.
                </p>
              ) : null}
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
          <Label
            htmlFor="justification"
            className="flex items-baseline gap-1.5 type-label text-ink-muted"
          >
            Justification
            <span className="font-normal normal-case tracking-normal">optional</span>
          </Label>
          <Textarea
            id="justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={4}
            placeholder="Why is this the right figure?"
          />
          <p className="font-sans text-body-sm text-ink-muted">
            Optional. It goes to the MD with the number.
          </p>
        </div>

        <Button
          type="button"
          className="min-h-11"
          /* Same stale gate as the MD's, and the same fix — the server made
             this optional and the client went on refusing. */
          disabled={busy || proposed === null || proposed <= 0 || !dirty}
          onClick={onSave}
        >
          {busy
            ? "Saving…"
            : !dirty && proposed !== null
              ? "Proposal saved"
              : "Save the proposal"}
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
  isHr,
}: {
  data: SalaryBandData;
  evaluationId: string;
  currentCtc: number;
  firstName: string;
  /** Changes the wording only. Both roles may act here since 0056. */
  isHr: boolean;
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
  /* -- Approving showed NOTHING. It saved, called `router.refresh()`, and the
        card came back looking identical — the figure was already in the box,
        because it defaults to HR's proposal. So the one irreversible-feeling
        act on this screen gave the MD no acknowledgement at all, which reads as
        a button that did not work. HR's half of this component has had a Saved
        notice since P21; the MD's never got one. -- */
  const [saved, setSaved] = React.useState(false);
  /* -- The one thing the close needs that an approval does not: when the new
        salary starts being paid. Defaulted to the first of next month, which is
        what payroll does unless somebody says otherwise — so the common case is
        one press and no typing. -- */
  const [effectiveFrom, setEffectiveFrom] = React.useState(firstOfNextMonth(new Date()));


  const approved = ctcText === "" ? null : Number(ctcText.replace(/[₹,\s]/g, ""));
  const pct = hikePct(currentCtc, approved);

  async function onApprove() {
    if (approved === null) return;
    setBusy(true);
    setError(null);
    const result = await approveAndClose({
      evaluationId,
      approvedCtc: approved,
      remarks,
      effectiveFrom,
    });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else {
      setSaved(true);
      router.refresh();
    }
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
        <h3 className="font-sans text-body font-medium text-ink">
          {isHr ? "Approve and close" : "Your approval"}
        </h3>
        {/* -- HR needs to know whether the MD has already set a figure, because
              theirs is the same control. Without this they would be typing over
              an approval they could not see. -- */}
        <p className="font-sans text-body-sm text-ink-muted">
          {review?.md_approved_ctc
            ? `The MD approved ${money(review.md_approved_ctc)}${
                review.md_approved_hike_pct === null
                  ? ""
                  : ` (${pctText(review.md_approved_hike_pct)})`
              }.`
            : isHr
              ? "The MD has not set a figure. You may approve and close this yourself."
              : "HR proposes; you approve. Both figures are kept."}
        </p>
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

            {/* -- The close needs a start date; the approval did not. Defaulted
                  to the first of next month, which is what payroll does unless
                  somebody says otherwise, so the common case is one press and
                  no typing. -- */}
            <div className="space-y-2 pt-2">
              <Label htmlFor="md_effective_from" className="type-label text-ink-muted">
                Effective from
              </Label>
              <Input
                id="md_effective_from"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="min-h-11 tabular"
              />
              <p className="font-sans text-body-sm text-ink-muted">
                When the new salary starts being paid.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="md_salary_remarks"
              className="flex items-baseline gap-1.5 type-label text-ink-muted"
            >
              Remarks
              <span className="font-normal normal-case tracking-normal">optional</span>
            </Label>
            <Textarea
              id="md_salary_remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={4}
              placeholder="Anything the record should carry."
            />
            <p className="font-sans text-body-sm text-ink-muted">
              Approving without a note is fine — the figure is still dated and attributed to you.
            </p>
          </div>
        </div>

        <Button
          type="button"
          className="min-h-11"
          /* -- Remarks no longer gate this, at the owner's instruction.
                The SERVER stopped requiring them when `approvalSchema` was made
                optional; this client check outlived it, so the button stayed
                grey and the screen still behaved as though a note were
                mandatory. A control disabled by a rule that no longer exists is
                the worst kind: nothing explains it, because there is nothing
                left to explain. The figure is still required — an approval with
                no amount approves nothing. -- */
          disabled={busy || approved === null || approved <= 0 || effectiveFrom === ""}
          onClick={onApprove}
        >
          {busy ? "Approving and closing…" : "Approve this figure and close"}
        </Button>

        {/* -- SAID AFTER THE FACT, and it says what happens next.
              "Saved." would have been enough to stop the button reading as
              broken, but it is not the whole answer: approving a figure does
              NOT close the increment. §8 runs MD_REVIEWED -> INTERVIEW_DONE ->
              CLOSED, and the control that does it is Confirm and close, further
              down this same page. An acknowledgement that stops at "saved"
              leaves the MD believing they have finished. -- */}
        {saved && !error ? (
          <Notice tone="ok">
            Approved at {money(approved)}
            {pct === null ? "" : ` — ${pctText(pct)} on the current salary`}, effective{" "}
            {formatDate(effectiveFrom)}. It is on {firstName}&rsquo;s pay record and the
            increment is closed.
          </Notice>
        ) : null}
      </article>
    </>
  );
}

/* ---------- The interview ---------- */

function InterviewCard({
  selfOverall,
  leadOverall,
  evaluationId,
  employeeName,
  currentCtc,
  approvedCtc,
  approvedPct,
  onDone,
}: {
  evaluationId: string;
  selfOverall: number | null;
  leadOverall: number | null;
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

  /* -- Mirrors 0046's SQL exactly: the mean of whichever layers have a stored
        average, to two decimals. A layer HR skipped has no score and is left
        out rather than counted as zero — averaging a missing side as 0 would
        halve a real appraisal. Computed here only to SHOW; the database
        recomputes it at the moment of the write, so this can never be the
        number of record. -- */
  const layerScores = [selfOverall, leadOverall].filter((v): v is number => v !== null);
  const finalOverall =
    layerScores.length === 0
      ? null
      : Math.round((layerScores.reduce((a, b) => a + b, 0) / layerScores.length) * 100) / 100;

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

      {/* -- THE FINAL SCORE, SHOWN BEFORE IT IS COMMITTED.
            0046 computes it inside `confirm_increment` — the mean of the two
            stored layer averages — so it is not typed and cannot be overridden
            (§17). But a number that appears on the record only AFTER the button
            is pressed is a number nobody confirmed, and "HR or the MD confirms
            it" is the whole point. So it is stated here, with its arithmetic,
            and the same mean is recomputed in SQL at the moment of the write. -- */}
      <div className="rounded-card bg-surface-mute p-4">
        <p className="type-label text-ink-muted">Final score to be recorded</p>
        <p className="tabular mt-1 font-sans text-display-sm leading-none text-ink">
          {finalOverall === null ? "—" : finalOverall.toFixed(2)}
          <span className="ml-2 font-sans text-body-sm font-normal text-ink-muted">out of 5</span>
        </p>
        <p className="mt-1 font-sans text-body-sm text-ink-muted">
          {finalOverall === null
            ? "Neither side has a stored average, so no score can be derived."
            : `The mean of the employee's ${selfOverall?.toFixed(2) ?? "—"} and their manager's ${leadOverall?.toFixed(2) ?? "—"}. Confirming below records it.`}
        </p>
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

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
import { toast } from "sonner";

import { BandHeading } from "@/app/(app)/reports/[evaluationId]/report-bands";
import { SALARY_DOT, SALARY_TINT, type SalaryTone } from "@/components/appraise/salary-tones";
import { Button } from "@/components/ui/button";
import { coLeadRole } from "@/lib/reports/reviewer";
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
import { MoneyInput, moneyMonthly } from "@/components/appraise/money-input";import { DatePopoverInput } from "@/components/appraise/date-popover";


/* -- COLOUR ON THESE CARDS, at the owner's instruction, drawn from the KPI
      palette so the two agree by construction rather than by coincidence.

      WHICH HUE IS NOT A DECORATIVE CHOICE, and that is what makes it safe.
      §13.1 reserves cyan, pink and indigo for Self, Lead and Final and says
      they are "never used decoratively for anything else" — so the usual reason
      to hesitate is real. It does not apply here, because these three cards ARE
      the three layers: what the employee asked for, what their manager
      proposed, what management approved. The tint says who is speaking, which
      is precisely what §13.1 says it must always say. A reader who has learned
      the legend on the dashboard reads this row without being taught anything.

      The record above them — joining, current, last increment — is NOT a layer
      and deliberately takes no tier hue. Tinting "Joining Salary" cyan would
      say the employee said it, which is false, and that IS the decorative use
      the rule forbids. Joining and last-increment wear two tints the owner
      chose for them; today's figure wears `accent`, the one non-tier,
      non-status tone in the palette, because it is the baseline every
      percentage on this screen is measured from. -- */
function Figure({
  label,
  value,
  hint,
  tone = "none",
  dot = false,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: SalaryTone;
  /** A tier mark beside the label, for a card that IS one of the three layers. */
  dot?: boolean;
}) {
  return (
    /* -- Borderless and tinted, exactly as `KpiCard` is built. UI-4: every
          actual card is borderless, and a hairline round a tint is the NOTICE
          pattern, which would make a salary figure read as a warning. -- */
    <figure className={cn("rounded-card p-4", SALARY_TINT[tone])}>
      <figcaption className="type-label flex items-center gap-1.5 text-ink-muted">
        {dot ? (
          <span aria-hidden className={cn("size-2 shrink-0 rounded-pill", SALARY_DOT[tone])} />
        ) : null}
        {label}
      </figcaption>
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
  isMd,
  index,
  selfOverall,
  leadOverall,
}: {
  data: SalaryBandData;
  evaluationId: string;
  status: string;
  isHr: boolean;
  /** Holds the MD role. Somebody holding BOTH approves as the MD. */
  isMd: boolean;
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

      {/* ---------- Where they are today ----------
          THREE FACTS, NOT FOUR. "Months since last increment" and "Last
          increment" were two cards answering one question, and the first of
          them rendered a bare "0" — a number with no unit, under a label most
          readers have to parse twice. They are one card now: the date, with how
          long ago underneath.

          Plain words throughout, at the owner's instruction: not everybody
          reading this screen reads English comfortably, and "increment" is
          payroll vocabulary where "raise" is not. -- */}
      <p className="type-label mt-1 text-ink-muted">Where they are today</p>
      <div className="mt-2 grid gap-4 sm:grid-cols-3">
        <Figure
          tone="joining"
          label="Joining Salary"
          value={moneyMonthly(data.joiningCtc)}
          hint={data.joiningCtc === null ? "Not on their record." : `${money(data.joiningCtc)} a year`}
        />
        {/* The baseline every percentage on this screen is measured from.
            Its tint was chosen by the owner alongside the two beside it; like
            them it takes no tier hue, because a salary on the record is not
            something anybody SAID and tinting it cyan would claim the employee
            did. */}
        <Figure
          tone="today"
          label="Current Salary"
          value={moneyMonthly(currentCtc)}
          hint={`${money(currentCtc)} a year`}
        />
        <Figure
          tone="increment"
          label="Last Increment"
          value={data.lastIncrementDate ? formatDate(data.lastIncrementDate) : "None yet"}
          hint={
            /* -- WHY it is empty, not merely that it is (§13.4, FIX-30). A blank
                  beside a filled Joining and Current reads as a figure that
                  failed to load; "this would be their first" is the fact HR is
                  actually deciding against, and it is the commonest case on a
                  new joiner's first review. -- */
            data.monthsSinceLastIncrement === null
              ? data.dateOfJoining
                ? `None yet — this would be their first. They joined ${formatDate(data.dateOfJoining)}.`
                : "No raise on record."
              : data.monthsSinceLastIncrement === 0
                ? "This month."
                : `${data.monthsSinceLastIncrement} month${
                    data.monthsSinceLastIncrement === 1 ? "" : "s"
                  } ago.`
          }
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
        /* -- READ-ONLY FOR HR *WITHOUT* MD, not for anybody holding HR.
              The card took `isHr` alone, so somebody holding HR AND MD got
              HR's read-only view — "This step is the Managing Director's"
              — and could not approve, although they are the MD and the
              server (requireMd, 0090's is_md arm) accepts them. Reported as
              "Harshali has all the MD and HR access and still is not able
              to approve salary". The same mistake the production review
              screen had: asking "are you HR?" where the question is "are
              you the MD?". -- */
        isHr={isHr && !isMd}
        status={status}
      />

      {/* ---------- Row 4: context ---------- */}
      <div className="grid gap-4 md:grid-cols-2">
        <article className="card-surface p-4">
          {/* The heading has to stop promising three once it shows everything —
              a title that undercounts what is beneath it is its own small lie. */}
          <h3 className="type-label text-ink-muted">Their pay history</h3>
          {data.history.length === 0 && data.joiningCtc === null ? (
            <p className="mt-2 font-sans text-body-sm text-ink-muted">Nothing on record yet.</p>
          ) : (
            <div className="-mx-1 mt-2 overflow-x-auto px-1">
            <table className="w-full min-w-[19rem] border-collapse">
              <thead>
                <tr className="border-b border-rule">
                  {["From", "Previous", "New", "Hike"].map((h) => (
                    <th key={h} className="type-label py-1 text-left font-bold text-ink">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* -- THE BASELINE, first, and rendered rather than stored.
                      It comes from `employment_records.joining_ctc`, not from a
                      history row — P19E-1 made it a column precisely so that
                      filling it in months later could not be read as a rise over
                      today's salary, which is how a 620% hike once got written.

                      No previous and no percentage: it is what the ledger starts
                      FROM, and a baseline with a rise against it would describe
                      an increment that never happened. -- */}
                {data.joiningCtc !== null ? (
                  <tr className="border-b border-rule bg-surface-mute/60">
                    <td className="py-1.5 tabular text-body-sm text-ink-muted">
                      {data.dateOfJoining ? formatDate(data.dateOfJoining) : "On joining"}
                    </td>
                    <td className="py-1.5 tabular text-body-sm text-ink-muted">—</td>
                    <td className="py-1.5 tabular text-body-sm text-ink">
                      {moneyMonthly(data.joiningCtc)}
                    </td>
                    <td className="py-1.5 font-sans text-body-sm text-ink-muted">Joining</td>
                  </tr>
                ) : null}
                {data.history.map((row) => (
                  <tr key={row.effectiveFrom} className="border-b border-rule last:border-b-0">
                    <td className="py-1.5 tabular text-body-sm text-ink-muted">{formatDate(row.effectiveFrom)}</td>
                    {/* Monthly, so this table is in the same unit as every
                        headline above it. */}
                    <td className="py-1.5 tabular text-body-sm text-ink-muted">
                      {moneyMonthly(row.previousCtc)}
                    </td>
                    <td className="py-1.5 tabular text-body-sm text-ink">
                      {moneyMonthly(row.newCtc)}
                    </td>
                    <td className="py-1.5 tabular text-body-sm text-ink">{pctText(row.hikePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
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
          {/* -- MONTHLY, like every other salary on this panel.
                It was the last annual pair left here, and the worst place for
                one: it sits directly under three cards reading "₹19,800 a
                month", so the same increment appeared to be two different
                numbers depending on which line you read. The annual pair
                follows as context, labelled, because that is what goes on the
                letter (0061 — monthly at the edges, annual in the core). -- */}
          <p className="font-sans text-body text-final">
            Confirmed: {moneyMonthly(review.current_ctc)} → {moneyMonthly(review.final_ctc)} (
            {pctText(review.final_hike_pct)}), effective{" "}
            {review.effective_from ? formatDate(review.effective_from) : "—"}.
          </p>
          <p className="font-sans text-body-sm text-final/80">
            {money(review.current_ctc)} → {money(review.final_ctc)} a year.
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

  /* -- HR NO LONGER TYPES A FIGURE FROM NOTHING.
        The manager's recommended percentage (0062) seeds both fields, so the
        proposal arrives computed and HR reviews it rather than composing it.

        SEEDED, NOT LOCKED, and that is the owner's decision recorded: the
        percentage ADVISES. HR and the MD remain free to propose anything, so
        the fields stay editable — a recommendation that could not be departed
        from would be a decision, and §9 does not give it to the manager.

        A figure HR has already saved wins over the recommendation. Otherwise
        reopening the screen would quietly discard their considered number and
        put the manager's back. -- */
  /* -- The SETTLED recommendation, which is the mean of the two where the
        person has two managers (0083) and simply the manager's figure where
        they have one. Using the lead's alone would quietly ignore half of a
        designer's review on the one screen where the number is acted on. -- */
  const managerPct = data.recommendedHikePct;
  const managerProposed = newCtcFromPct(data.currentCtc, managerPct);

  const [ctcText, setCtcText] = React.useState(
    review?.hr_proposed_ctc
      ? String(review.hr_proposed_ctc)
      : managerProposed !== null
        ? String(managerProposed)
        : "",
  );
  const [pctInput, setPctInput] = React.useState(
    review?.hr_proposed_hike_pct !== null && review?.hr_proposed_hike_pct !== undefined
      ? String(review.hr_proposed_hike_pct)
      : managerPct !== null
        ? String(managerPct)
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
  /* -- What the ASK itself represents, as a rise over today's salary.
        Reported as confusing: the card led with a bare difference before the
        reader had even seen the figure it was a difference FROM, and never
        said what the ask meant relative to what the person earns now — the
        one thing that tells HR whether ₹35,000 is a stretch or a formality. -- */
  const expectedPct = hikePct(currentCtc, review?.employee_expectation_ctc ?? null);
  const coLabel = data.coManagerName !== null ? coLeadRole(data.coManagerDesignation, data.coManagerName) : null;
  /* Whether the figure on screen right now IS the recommendation, or HR/the MD
     has since typed something else — the same test Row 3 already makes, reused
     so this card cannot claim an average that is no longer what is proposed. */
  const isRecommended = managerPct !== null && (pctInput.trim() === "" || Number(pctInput) === managerPct);

  async function onSave() {
    if (proposed === null) return;
    setBusy(true);
    setError(null);
    const result = await saveProposal({ evaluationId, proposedCtc: proposed, justification });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else {
      setSaved(true);
      /* -- A TOAST AS WELL AS THE INLINE NOTICE, at the owner's instruction:
            "user should get confirmation ... to confirm their action performed
            successfully". The notice beside the button is easy to miss on a
            long panel — it is below the fold as often as not — and the toast
            appears in the same corner for every action in the product, so
            there is one place to learn to look. -- */
      toast.success("Manager recommendation saved.");
      router.refresh();
    }
  }

  return (
    <>
      {/* ---------- Row 2 ----------
          ONE CARD, NOT TWO. "What {firstName} asked for" was here AND in the
          three-card decision row further down, so HR — the only role that sees
          both panels — read the same figure twice on one screen while the MD
          saw it once. Reported as exactly that.

          The DECISION row keeps it, because that row is the set: ask, proposal,
          approval, side by side. What is left here is the gap, which is a
          different number and appears nowhere else — and it now names the ask
          in its own supporting line, so the context HR needs while typing a
          proposal is still on screen. */}
      <div className="grid gap-4">
        <article className="card-surface p-4">
          {/* -- REWRITTEN AT THE OWNER'S INSTRUCTION as a straight, ordered
                story rather than a difference shown before its own operands:
                what they asked for, what each manager recommended, what that
                comes to, and how it compares — one line each, in that order.
                Reported as "too much wording" and confusing to read; nothing
                below is a new figure, every one was already computed on this
                screen (or, for `expectedPct`, one line up), just never told in
                a sequence a reader could follow without piecing two cards
                together. -- */}
          <h3 className="type-label text-ink-muted">Compared with their expected salary</h3>

          {!review?.employee_expectation_ctc ? (
            <p className="mt-1 font-sans text-body text-ink-muted">
              {firstName} did not state a figure, so there is nothing to compare.
            </p>
          ) : (
            <div className="mt-1.5 space-y-1 font-sans text-body-sm text-ink">
              {/* Line 1 — the ask, and what it represents. */}
              <p>
                {firstName} expected salary{" "}
                <span className="font-medium">{moneyMonthly(review.employee_expectation_ctc)}</span>
                {expectedPct !== null ? ` — ${pctText(expectedPct)} more than their current salary` : ""}.
              </p>

              {/* Line 2 — each manager's own recommendation, named apart so
                  neither figure is buried inside the other's sentence. */}
              {managerPct !== null ? (
                <p>
                  {data.managerHikePct !== null
                    ? `Manager recommended ${pctText(data.managerHikePct)}.`
                    : "Manager has not answered yet."}
                  {coLabel
                    ? ` ${
                        data.coManagerHikePct !== null
                          ? `${coLabel} recommended ${pctText(data.coManagerHikePct)}.`
                          : `${coLabel} has not answered yet.`
                      }`
                    : ""}
                </p>
              ) : null}

              {/* Line 3 — what that comes to, right now. Says "averages" only
                  while the figure on screen still IS the average — the moment
                  HR or the MD types something else, this says so instead of
                  quietly repeating a number that no longer applies. */}
              {gap.amount !== null ? (
                <p>
                  {data.recommendedIsAverage && isRecommended
                    ? `Their averages ${pctText(managerPct)}, taking their pay to `
                    : isRecommended
                      ? `That takes their pay to `
                      : `The figure entered now is ${pctText(pct)}, taking their pay to `}
                  <span className="font-medium">{moneyMonthly(proposed)}</span>.
                </p>
              ) : null}

              {/* Line 4 — the comparison this whole card exists to answer. */}
              {gap.amount !== null ? (
                <p className={cn("font-medium", gap.amount < 0 ? "text-critical" : "text-ink")}>
                  That is{" "}
                  {gap.amount === 0
                    ? "exactly what they asked for."
                    : `${moneyMonthly(Math.abs(gap.amount))}${
                        gap.pct === null ? "" : ` (${pctText(Math.abs(gap.pct))})`
                      } ${gap.amount > 0 ? "more than" : "short of"} what they asked for.`}
                </p>
              ) : (
                <p className="text-ink-muted">Enter a proposal below to compare.</p>
              )}

              {/* -- A UNITS CHECK, phrased as a question rather than a verdict.
                    An employee who types a MONTHLY figure into an annual field
                    produces exactly this shape — a proposal several times their
                    stated ask — and the arithmetic above is then meaningless
                    while looking perfectly precise. 0055 makes the question ask
                    for an annual figure in as many words, but answers already
                    given cannot be re-asked, and a pay decision should not rest
                    on a number whose units are in doubt. -- */}
              {gap.pct !== null && gap.pct >= 200 ? (
                <p className="mt-2 rounded-control bg-warning-tint px-2.5 py-1.5 text-ink">
                  That is a long way apart. Worth checking they gave an annual figure rather than a
                  monthly one before this anchors anything.
                </p>
              ) : null}
            </div>
          )}
        </article>
      </div>

      {/* ---------- Row 3 ---------- */}
      <article className="card-surface space-y-4 p-6">
        {/* -- ATTRIBUTED TO THE MANAGER, at the owner's instruction: "only HOD
              and MD will decide salary", so nothing on this screen should read
              as HR's own proposal. HR is recording the manager's figure and
              passing it up.

              THE ONE RISK, handled rather than argued: the field stays editable,
              so HR CAN type something other than the manager's recommendation —
              and then a heading reading "Manager proposed" would be untrue. The
              line beneath says which it is, so the label can never claim an
              authorship the number does not have. -- */}
        <h3 className="font-sans text-display-sm text-ink">Manager recommended hike</h3>
        {managerPct !== null ? (
          <p className="font-sans text-body-sm text-ink-muted">
            {pctInput.trim() !== "" && Number(pctInput) !== managerPct
              ? `Changed from ${data.recommendedIsAverage ? "the managers'" : "the manager's"} ${managerPct}%. The MD sees both.`
              : `${data.recommendedIsAverage ? "The managers'" : "The manager's"} recommendation of ${managerPct}%.`}
          </p>
        ) : null}
        {/* -- BOTH figures, named, wherever two managers were asked.
               An average printed on its own is a number nobody can check, and
               the two it came from are the reason a second opinion was
               collected at all. Shown even when only one has answered, because
               "waiting on the Design Coordinator" is exactly what HR needs to
               know before proposing a figure. -- */}
        {data.coManagerName !== null ? (
          <p className="font-sans text-body-sm text-ink-muted">
            {data.managerHikePct !== null
              ? `Manager ${data.managerHikePct}%`
              : "Manager — not answered"}
            {" · "}
            {data.coManagerHikePct !== null
              ? `${coLeadRole(data.coManagerDesignation, data.coManagerName)} ${data.coManagerHikePct}%`
              : `${coLeadRole(data.coManagerDesignation, data.coManagerName)} — not answered`}
            {data.recommendedIsAverage
              ? `. The average is ${data.recommendedHikePct}%.`
              : ". Waiting on the second reviewer before an average can be taken."}
          </p>
        ) : null}

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
            <Label htmlFor="hike_pct" className="font-sans text-body font-medium text-ink">
              Hike percent
            </Label>
            <Input
              id="hike_pct"
              value={pctInput}
              onChange={(e) => onPctChange(e.target.value)}
              inputMode="decimal"
              className="min-h-11 tabular"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new_ctc" className="font-sans text-body font-medium text-ink">
              New salary
            </Label>
            <MoneyInput
              id="new_ctc"
              value={ctcText === "" ? null : Number(ctcText)}
              onValueChange={(annual) => onCtcChange(annual === null ? "" : String(annual))}
            />
          </div>
        </div>

        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="type-label text-ink-muted">Hike amount</dt>
            {/* Monthly, because it sits directly beside "New monthly". An
                annual rise next to a monthly salary is the reader doing
                arithmetic to compare two cells of one list. */}
            <dd className="tabular text-body text-ink">{moneyMonthly(amount)}</dd>
            <dd className="font-sans text-body-sm text-ink-muted">{money(amount)} a year</dd>
          </div>
          <div>
            <dt className="type-label text-ink-muted">Annualised</dt>
            <dd className="tabular text-body text-ink">{pctText(annualised)}</dd>
            <dd className="font-sans text-body-sm text-ink-muted">
              {data.monthsSinceLastIncrement
                ? `Over ${data.monthsSinceLastIncrement} months. The money paid is ${pctText(pct)}.`
                : "No previous rise to compare against."}
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
            className="flex items-baseline gap-2 font-sans text-body font-medium text-ink"
          >
            Why this figure
            <span className="font-normal text-ink-muted">optional</span>
          </Label>
          <Textarea
            id="justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={4}
            placeholder="Why is this the right figure?"
          />
          <p className="font-sans text-body-sm text-ink-muted">
            Sent to management with the figure.
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
              : "Save manager recommendation"}
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
  /* -- MISSING FROM THIS LIST AND TYPECHECKED CLEAN, which is worth recording.
        `status` is a DOM GLOBAL — `window.status`, typed `string` in lib.dom —
        so every use of it below resolved to that instead of to the prop, and
        tsc had nothing to complain about. It failed only at runtime, on the
        server, where `window` does not exist: "status is not defined".

        A prop name that collides with a browser global gets no help from the
        compiler. `name`, `length`, `origin`, `top` and `self` are the same
        trap. -- */
  status,
}: {
  data: SalaryBandData;
  evaluationId: string;
  currentCtc: number;
  firstName: string;
  /** MD-only again (0090). For HR this renders read-only, with the reason shown. */
  isHr: boolean;
  /* -- Tells "approved" from "approved and closed". Approving now closes, so a
        record with a figure on it and a status short of CLOSED means the close
        did not run — and saying "closed" there would be a lie the reader would
        act on. -- */
  status: string;
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

  /* -- Finished. The figure is on `salary_history`, which refuses UPDATE and
        DELETE for EVERYONE by trigger — not merely by policy (P19-3) — so there
        is nothing here left to change, and a live button would be offering
        something the database will not do. -- */
  const [justClosed, setJustClosed] = React.useState(false);
  const settled = justClosed || status === "CLOSED" || status === "INTERVIEW_DONE";

  /* -- WHETHER APPROVE AND CLOSE CAN POSSIBLY WORK FROM HERE.
        This card was rendered with NO status gate, so it was fully live on a
        record still with HR — and the close CANNOT succeed there. The chain is:
        `saveApproval` writes the figure, then `confirm_increment` drives
        MD_REVIEWED -> INTERVIEW_DONE through §8's function. At
        PENDING_HR_REVIEW that from-status does not match, the whole transaction
        rolls back, and nothing is written: no pay row, no employment update,
        nothing closed.

        What made it look like a product fault rather than a sequence one is
        that STEP ONE SUCCEEDS. `increment_reviews` has its own policies and no
        status guard, so the approved figure saved and the panel then read "MD
        approved ₹2,16,000. Not closed yet — approving again will close it."
        It could not, and pressing again wrote the same figure and failed the
        same way.

        Two statuses work. HR_APPROVED, where the MD's review runs first and
        then the close; and MD_REVIEWED, where the close runs on its own.
        PENDING_HR_REVIEW is not one of them and there is no path from it —
        §8's PENDING_HR_REVIEW -> CLOSED row refuses an INCREMENT outright,
        deliberately, because HR proposing and HR approving the same increment
        is what the second pair of eyes exists to prevent.

        AND NOW `!isHr` AS WELL (0090). 0056 gave HR this control and the
        status gate above was the only thing keeping it in check; reported back
        as "hr dont have access to approve and close" and confirmed directly:
        MD-only. `saveApproval` and `approveAndClose` refuse HR server-side
        (§9 — client code is never the only guard), so this is what stops HR
        pressing a button that would fail anyway, and what turns the panel
        below into a read-only view rather than a dead end with no
        explanation. -- */
  const canApprove = !isHr && (status === "HR_APPROVED" || status === "MD_REVIEWED");


  const approved = ctcText === "" ? null : Number(ctcText.replace(/[₹,\s]/g, ""));
  const pct = hikePct(currentCtc, approved);

  async function onApprove() {
    if (approved === null || busy) return;
    setBusy(true);
    setError(null);

    /* -- THE AWAIT IS GUARDED. A server action that THROWS — a dropped
          connection, a 500, a redeploy mid-request — skips every line after it,
          so `setBusy(false)` never ran and the button sat on "Approving and
          closing…" for the life of the page with no way to retry. `finally` is
          what makes the flag honest; FIX-12 fixed the identical shape on the
          worker sheet. -- */
    try {
      const result = await approveAndClose({
        evaluationId,
        approvedCtc: approved,
        remarks,
        effectiveFrom,
      });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      /* -- LOCKED IMMEDIATELY, not when the server says so.
            `settled` is derived from the `status` prop, which only changes once
            `router.refresh()` has been to the server and back. Between the
            close committing and that arriving, the panel went on saying "Not
            closed yet" beside a live button — inviting a second press at
            exactly the moment the first had already succeeded. The refresh
            still runs and still corrects everything else; this just stops the
            gap being a window somebody can act in. -- */
      setJustClosed(true);
      setSaved(true);
      toast.success("Approved and closed. The new salary is on their pay record.");
      router.refresh();
    } catch {
      setError(
        "The connection dropped before we heard back. Reload the report before trying again — the increment may already have closed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Three cards now, so three columns: asked for · proposed · approved.
          Two-up would have paired the ask with the proposal and orphaned the
          approval on a row of its own, which reads as an afterthought rather
          than as the last step. Still one column on a phone (§13.2). */}
      {/* -- TINTED BY WHOSE FIGURE IT IS, at the owner's instruction, from the
            KPI palette so the row matches the counters elsewhere.

            The hue is not decoration and that is what makes it safe under
            §13.1: these three cards ARE the three layers — the employee's ask,
            their manager's proposal, management's approval — so cyan, pink and
            indigo carry exactly the meaning the rule reserves them for. Someone
            who learned the legend on the dashboard reads this row untaught.

            EMPTY STAYS GREY, preserving the reasoning the third card already
            carried: a card wearing management's indigo before management has
            decided anything draws the eye to a decision nobody has made. The
            tint appears when the figure does. -- */}
      <div className="grid gap-4 md:grid-cols-3">
        <article
          className={cn(
            "rounded-card p-4",
            SALARY_TINT[review?.employee_expectation_ctc ? "asked" : "none"],
          )}
        >
          <h3 className="type-label flex items-center gap-1.5 text-ink-muted">
            {review?.employee_expectation_ctc ? (
              <span aria-hidden className={cn("size-2 shrink-0 rounded-pill", SALARY_DOT.asked)} />
            ) : null}
            Expected salary
          </h3>
          {review?.employee_expectation_ctc ? (
            <>
              {/* Monthly, because that is the unit the employee TYPED it in
                  (0061). Showing their monthly ask as an annual figure invited
                  exactly the misreading this whole change removed. */}
              <p className="mt-1 tabular text-display-md text-ink">
                {moneyMonthly(review.employee_expectation_ctc)}
              </p>
              <p className="font-sans text-body-sm text-ink-muted">
                {money(review.employee_expectation_ctc)} a year
              </p>
              {/* -- WHAT THEY ARE ACTUALLY ASKING FOR, as a rise.
                    Two salaries side by side leave the MD to do the arithmetic,
                    on the one screen where the whole decision is a comparison of
                    percentages — every other card on this row states one. The
                    figure goes through `hikePct`, which is the single
                    implementation of it (P21-2): a percentage worked out in a
                    component is one nobody can reproduce, and it would disagree
                    with the summary report the first time either moved.

                    Worded exactly as the summary words it, because FIX-42 had
                    to close five separate drifts between these two files. -- */}
              {hikePct(data.currentCtc, review.employee_expectation_ctc) === null ? (
                <p className="mt-1 font-sans text-body-sm text-ink-muted">
                  No current salary on record to compare against.
                </p>
              ) : (
                <p className="mt-1 font-sans text-body-sm text-ink-muted">
                  A rise of {pctText(hikePct(data.currentCtc, review.employee_expectation_ctc))} on{" "}
                  {moneyMonthly(data.currentCtc)}.
                </p>
              )}
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
        <article
          className={cn("rounded-card p-4", SALARY_TINT[review?.hr_proposed_ctc ? "proposed" : "none"])}
        >
          {/* -- The SAME figure the previous card calls the manager's, so it
                carries the same name. Leaving this as "HR proposed" while HR's
                own screen said "Manager proposed" would have one number with two
                authors depending on who was reading it. -- */}
          <h3 className="type-label flex items-center gap-1.5 text-ink-muted">
            {review?.hr_proposed_ctc ? (
              <span aria-hidden className={cn("size-2 shrink-0 rounded-pill", SALARY_DOT.proposed)} />
            ) : null}
            Manager recommended
          </h3>
          {/* -- AN EMPTY CARD HAS TO SAY WHY IT IS EMPTY (§13.4).
                This read "—" over "— a year · —": three dashes and no sentence,
                which is indistinguishable from a figure that failed to load. It
                was reported as exactly that question — "why is this field
                blank?"

                The sibling card above already tells three different absences
                apart. This one has two: nothing has been proposed, or something
                has. -- */}
          {review?.hr_proposed_ctc ? (
            <>
              <p className="mt-1 tabular text-display-md text-ink">
                {moneyMonthly(review.hr_proposed_ctc)}
              </p>
              <p className="font-sans text-body-sm text-ink-muted">
                {money(review.hr_proposed_ctc)} a year ·{" "}
                {pctText(review.hr_proposed_hike_pct ?? null)}
              </p>
              {/* -- WHAT THEY RECOMMENDED, now a line rather than a card.
                    It had its own "Manager Suggested Hike %" card above, and
                    the owner reported the two as duplicates. They were: one
                    person, two statements, two cards, two figures that differ
                    — which is the confusion FIX-46 tried to fix by RENAMING
                    when the answer was to fold one into the other.

                    Under a saved proposal the recommendation is provenance:
                    where this figure came from, and whether it was followed.
                    Worth a line, not a card. -- */}
              {data.recommendedHikePct === null ? null : (
                <p className="mt-1 font-sans text-body-sm text-ink-muted">
                  {/* -- TWO FACTS, TWO SENTENCES, and neither of them passive.

                        It read "Their two managers averaged 8%, and 10.00% was
                        set instead." — reported as confusing, and it was, for a
                        reason sharper than the wording: the card is HEADED
                        "Manager recommended", and this line then said the
                        managers had recommended something else. One sentence
                        carrying a heading's contradiction.

                        Split, so the MD reads what was recommended and what is
                        being proposed as two separate figures. "was set
                        instead" also named nobody — and naming HR is not
                        available, because FIX-28 renamed this figure to the
                        manager's at the owner's instruction (§0.2). "Proposed"
                        is what the card is, and needs no actor. -- */}
                  {review.hr_proposed_hike_pct !== null &&
                  Math.abs(review.hr_proposed_hike_pct - data.recommendedHikePct) < 0.005
                    ? `Proposed as the ${data.recommendedIsAverage ? "managers" : "manager"} recommended.`
                    : `${data.recommendedIsAverage ? "Managers" : "Manager"} recommended ${data.recommendedHikePct}%.` +
                      (review.hr_proposed_hike_pct === null
                        ? ""
                        : ` Proposed at ${pctText(review.hr_proposed_hike_pct)}.`)}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="mt-1 tabular text-display-md text-ink-muted">—</p>
              {/* -- THE THREE ABSENCES, KEPT APART. They lived on the card that
                    has gone, and collapsing them into one dash would have HR
                    chasing a manager who has already answered. With no proposal
                    saved, the recommendation is the useful figure — so it leads
                    here, priced, with what to do next. -- */}
              <p className="font-sans text-body-sm text-ink-muted">
                {data.managerHikePct === null
                  ? data.managerPromotion === null
                    ? "Nothing proposed yet, and their manager's review is not in."
                    : data.managerPromotion === "NO"
                      ? "Nothing proposed yet. Their manager did not recommend a promotion, so they were not asked for a percentage."
                      : "Nothing proposed yet. Their manager was asked for a percentage and left it blank."
                  : `Nothing proposed yet. Their manager recommended ${data.managerHikePct}% — ${moneyMonthly(
                      newCtcFromPct(currentCtc, data.managerHikePct),
                    )} — which is set in the panel above.`}
              </p>
            </>
          )}
          {review?.hr_justification ? (
            <p className="mt-2 whitespace-pre-wrap font-sans text-body-sm text-ink-muted">
              {review.hr_justification}
            </p>
          ) : null}
        </article>

        {/* -- WHAT MANAGEMENT APPROVED, beside what was proposed.

              Asked for directly, and the three cards now read as the three steps
              the money actually goes through: what the employee asked for, what
              their manager proposed, and what management settled on. The
              difference between the second and the third IS the decision the MD
              was brought in to make — AMEND-2's second pair of eyes, made
              visible on the sheet rather than only in the workflow.

              BLANK UNTIL IT IS TRUE. `md_approved_ctc` is written only when the
              MD sets a figure, so until then this is a dash and a sentence
              saying what is being waited for — never the manager's figure
              standing in, which would show an approval nobody gave. §13.4, and
              the same rule the card beside it needed. -- */}
        {/* -- THE OUTCOME, and the second of the two figures that matter.
              Tinted only once there IS one: an empty card wearing the accent
              would draw the eye to a decision nobody has made, which is worse
              than the flat row it replaces. -- */}
        <article
          className={cn("rounded-card p-4", SALARY_TINT[review?.md_approved_ctc ? "approved" : "none"])}
        >
          {/* -- Indigo now, not the neutral accent it wore before. This is the
                FINAL layer and §13.1 gives that layer indigo everywhere else in
                the product; the accent tint said "emphasised" where the palette
                already had a word for "settled". -- */}
          <h3 className="type-label flex items-center gap-1.5 text-ink-muted">
            {review?.md_approved_ctc ? (
              <span aria-hidden className={cn("size-2 shrink-0 rounded-pill", SALARY_DOT.approved)} />
            ) : null}
            Management approved
          </h3>
          {review?.md_approved_ctc ? (
            <>
              <p className="mt-1 tabular text-display-md text-ink">
                {moneyMonthly(review.md_approved_ctc)}
              </p>
              <p className="font-sans text-body-sm text-ink-muted">
                {money(review.md_approved_ctc)} a year ·{" "}
                {pctText(review.md_approved_hike_pct ?? null)}
              </p>
              {review.md_remarks ? (
                <p className="mt-2 whitespace-pre-wrap font-sans text-body-sm text-ink-muted">
                  {review.md_remarks}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-1 tabular text-display-md text-ink-muted">—</p>
              <p className="font-sans text-body-sm text-ink-muted">
                {review?.hr_proposed_ctc
                  ? "Waiting on management. It fills in when they approve and close."
                  : "Nothing to approve yet. Save the manager's recommendation first."}
              </p>
            </>
          )}
        </article>
      </div>

      {/* -- READABLE, AT THE OWNER'S INSTRUCTION. Reported as "not readable
            and feels confusing", "too many explanation lines", "wording is too
            heavy", "physically hard to read" and "not looking professional like
            MD level report".

            Every label and every note in this panel was `text-body-sm`, which
            is 12px, and three of the five notes said something the field beside
            them already said. So: labels at 14px in ink rather than 12px
            uppercase in muted, the three redundant notes deleted outright, and
            the two that carry real information kept and shortened. -- */}
      <article className="card-surface space-y-6 p-6 sm:p-8">
        {/* -- MD-ONLY AGAIN (0090). The heading no longer offers HR an action
              they cannot take — "Approve and close" read as an instruction on
              a control that was about to refuse them, which is exactly what
              was reported back as wrong. -- */}
        <h3 className="font-sans text-display-sm text-ink">
          {isHr ? "Management's approval" : "Your approval"}
        </h3>
        {/* -- KEPT. HR needs to know whether the MD has already set a figure —
              that much is still theirs to read, only not theirs to write. -- */}
        <p className="font-sans text-body text-ink-muted">
          {review?.md_approved_ctc
            ? `Management approved ${money(review.md_approved_ctc)}${
                review.md_approved_hike_pct === null
                  ? ""
                  : ` (${pctText(review.md_approved_hike_pct)})`
              }${
                settled
                  ? " and closed this increment."
                  : ". Not closed yet — approving again closes it."
              }`
            : isHr
              ? "Waiting on management to approve and close this."
              : "The manager recommends, you approve. Both figures are kept."}
        </p>
        {error ? <Notice tone="error">{error}</Notice> : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="approved_ctc" className="font-sans text-body font-medium text-ink">
              Approved salary
            </Label>
            <MoneyInput
              id="approved_ctc"
              value={ctcText === "" ? null : Number(ctcText)}
              onValueChange={(annual) => setCtcText(annual === null ? "" : String(annual))}
              disabled={settled || !canApprove}
            />
            {/* -- ONE CLAUSE, and only where there is a figure to state. It used
                  to say "Defaults to the manager's proposal, once one has been
                  saved." even with a proposal already on the record — telling
                  the reader how to reach a state they were already in. -- */}
            {pct === null ? null : (
              <p className="font-sans text-body text-ink-muted">
                {pctText(pct)} on the current salary.
              </p>
            )}

            {/* -- The close needs a start date; the approval did not. Defaulted
                  to the first of next month, which is what payroll does unless
                  somebody says otherwise, so the common case is one press and
                  no typing. -- */}
            <div className="space-y-2 pt-2">
              <Label
                htmlFor="md_effective_from"
                className="font-sans text-body font-medium text-ink"
              >
                Effective from
              </Label>
              <DatePopoverInput
                tone="field"
                label="Effective from"
                value={effectiveFrom}
                onChange={setEffectiveFrom}
                disabled={settled || !canApprove}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="md_salary_remarks"
              className="flex items-baseline gap-2 font-sans text-body font-medium text-ink"
            >
              Remarks
              <span className="font-normal text-ink-muted">optional</span>
            </Label>
            <Textarea
              id="md_salary_remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={4}
              disabled={settled || !canApprove}
              placeholder="Anything the record should carry."
            />

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
          disabled={
            settled || busy || !canApprove || approved === null || approved <= 0 || effectiveFrom === ""
          }
          onClick={onApprove}
        >
          {settled ? "Closed" : busy ? "Approving and closing…" : "Approve and close"}
        </Button>

        {/* -- WHY IT IS DISABLED, beside the control and not in a tooltip.
              §13.4: a disabled button with no explanation is a dead end, and a
              tooltip is not an explanation on a touch screen. It names the step
              that is missing rather than the status, because "PENDING_HR_REVIEW"
              is not something anybody can act on.

              ROLE COMES FIRST. For HR the real reason is always who they are,
              never where the record has got to — a status-only message would
              have told HR the record is ready to approve and then refused
              them anyway, which is a worse dead end than a grey button. -- */}
        {!settled && !canApprove ? (
          <p className="font-sans text-body text-ink-muted">
            {isHr
              ? "This step is the Managing Director's. You can review the figures above; approving and closing needs their sign-in."
              : status === "PENDING_HR_REVIEW"
                ? "Still with HR. It can be approved once they send it on. Anything typed here is kept."
                : status === "OPEN"
                  ? "Both sides are still filling in the form. The salary is settled after HR reviews it."
                  : "This record has not reached the approval step yet."}
          </p>
        ) : null}

        {/* -- SAID AFTER THE FACT, and it says what happens next.
              "Saved." would have been enough to stop the button reading as
              broken, but it is not the whole answer: approving a figure does
              NOT close the increment. §8 runs MD_REVIEWED -> INTERVIEW_DONE ->
              CLOSED, and the control that does it is Confirm and close, further
              down this same page. An acknowledgement that stops at "saved"
              leaves the MD believing they have finished. -- */}
        {/* -- "EDIT" IS NOT AVAILABLE, AND SAYING SO IS THE FEATURE.
              Asked for as an edit option if somebody needs a correction. There
              is no edit: `salary_history` refuses UPDATE and DELETE for
              everyone by trigger, and §8 has no path out of CLOSED. That is not
              an oversight to work around — it is what makes a pay record
              evidence rather than a current opinion, and P19-3 built it
              deliberately.

              What a correction actually is, is a NEW row: `addSalaryChange`
              takes a CORRECTION reason, computes the previous figure from what
              is on record, and appends. The old figure stays visible, which is
              the point — somebody asking "why did this change twice" gets an
              answer instead of a mystery.

              So this offers the real thing and names it accurately, rather than
              an Edit button that would have to refuse. -- */}
        {settled ? (
          <div className="rounded-control border border-rule bg-surface-mute px-3 py-2.5">
            <p className="font-sans text-body-sm text-ink">Need to correct this?</p>
            <p className="mt-0.5 font-sans text-body-sm text-ink-muted">
              A closed increment cannot be edited — the pay record is append-only, so the figure
              stands and a correction is recorded as its own dated entry beside it.
            </p>
            <Button asChild variant="secondary" size="sm" className="mt-2">
              <Link href={`/admin/people/${data.profileId}/employment`}>
                Record a correction on their Employment tab
              </Link>
            </Button>
          </div>
        ) : null}

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
      toast.success("Confirmed. The increment is closed.");
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
          <Label htmlFor="final_ctc" className="font-sans text-body font-medium text-ink">
            Final salary
          </Label>
          <MoneyInput
            id="final_ctc"
            value={finalText === "" ? null : Number(finalText)}
            onValueChange={(annual) => setFinalText(annual === null ? "" : String(annual))}
          />
          <p className="font-sans text-body-sm text-ink-muted">{pctText(finalPct)} on the current salary.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="effective_from" className="font-sans text-body font-medium text-ink">
            Effective from
          </Label>
          <DatePopoverInput
            tone="field"
            label="Effective from"
            value={effectiveFrom}
            onChange={setEffectiveFrom}
          />
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

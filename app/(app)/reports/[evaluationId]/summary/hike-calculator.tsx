"use client";

/** The interactive hike calculator on the executive summary. */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  annualisedPct,
  hikeAmount,
  hikePct,
  firstOfNextMonth,
  monthlyFromAnnual,
  newCtcFromPct,
} from "@/lib/increment/calc";
import { approveAndClose, saveApproval, saveProposal } from "@/lib/increment/actions";
import type { SalaryBand } from "@/lib/increment/queries";
import { formatInr } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

/**
 * EVERY FIGURE COMES FROM `calc.ts`. There is no arithmetic in this file.
 *
 * P21-2 forbids working a hike out in a component, and the reason is sharper
 * than tidiness: a percent computed in an `onChange` is a percent nobody can
 * reproduce, and it will not match what the database stores. The server
 * recomputes from the two salaries on save (P21-4), so a figure typed here and
 * a figure stored there are produced by the same function.
 *
 * THE TWO INPUTS ARE LINKED AND NEITHER IS THE MASTER (P21-4). Typing a percent
 * sets the amount; typing the amount sets the percent. Whichever field the
 * reader is looking at during a negotiation is the one they trust.
 */
export function HikeCalculator({
  evaluationId,
  band,
  role,
  settled = false,
}: {
  evaluationId: string;
  band: SalaryBand;
  role: "HR_ADMIN" | "MD";
  /** The increment is confirmed and on the pay record. Read-only from here. */
  settled?: boolean;
}) {
  const router = useRouter();
  const current = band.currentCtc;
  const isHr = role === "HR_ADMIN";

  /* -- The proposal already on record is the starting point, so reopening the
        screen mid-negotiation does not lose where the conversation had got to.
        The MD starts from HR's proposal, which is the figure they are being
        asked to approve. -- */
  const existing = isHr
    ? (band.review?.hr_proposed_ctc ?? null)
    : (band.review?.md_approved_ctc ?? band.review?.hr_proposed_ctc ?? null);

  const [target, setTarget] = useState<number | null>(
    existing === null ? null : Number(existing),
  );
  const [pctText, setPctText] = useState<string>(() => {
    const p = hikePct(current, existing === null ? null : Number(existing));
    return p === null ? "" : String(p);
  });
  const [note, setNote] = useState<string>(
    (isHr ? band.review?.hr_justification : band.review?.md_remarks) ?? "",
  );
  const [saving, setSaving] = useState(false);
  /* -- The one thing a close needs that a save does not. First of next month,
        which is what payroll does unless somebody says otherwise, so the common
        case is one press and no typing. -- */
  const [effectiveFrom, setEffectiveFrom] = useState(firstOfNextMonth(new Date()));
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /* -- Derived, never stored in state. Keeping `newCtc` and `pct` as two pieces
        of state is how they drift apart: one setter gets forgotten and the
        screen shows a percent that does not match the amount beside it. -- */
  const pct = hikePct(current, target);
  const amount = hikeAmount(current, target);
  const annualised = annualisedPct(pct, band.monthsSinceLastIncrement);
  const monthlyNow = monthlyFromAnnual(current);
  const monthlyNew = monthlyFromAnnual(target);

  /** A figure has been chosen. Drives the output panel's live treatment. */
  const live = target !== null && target > 0;

  /* ---------- Is there anything left to save? ----------

     GREYED WHEN CLEAN, NOT GREYED FOREVER AFTER THE FIRST SAVE.

     "Disable it once saved" is the obvious reading and it is the wrong rule: HR
     revises a proposal during a negotiation, and a button that dies on the
     first press would strand them with a figure they had already moved past.
     What should be dead is a press that would write exactly what is already
     stored — so the test is whether anything has CHANGED since the last save,
     which also covers the reload case, because `existing` is read from the
     stored row.

     `savedNote` compares against the stored note, so editing only the wording
     re-arms the button too — the justification is part of the record. */
  const savedCtc = existing === null ? null : Number(existing);
  const savedNote = ((isHr ? band.review?.hr_justification : band.review?.md_remarks) ?? "").trim();

  const dirty = target !== savedCtc || note.trim() !== savedNote;
  const canSave = live && dirty && !settled && !saving;

  function applyPct(next: string) {
    setPctText(next);
    setSaved(false);
    const parsed = next.trim() === "" ? null : Number(next);
    if (parsed === null || !Number.isFinite(parsed)) {
      setTarget(null);
      return;
    }
    setTarget(newCtcFromPct(current, parsed));
  }

  function applyCtc(next: string) {
    setSaved(false);
    const parsed = next.trim() === "" ? null : Number(next.replace(/[^0-9.]/g, ""));
    if (parsed === null || !Number.isFinite(parsed)) {
      setTarget(null);
      setPctText("");
      return;
    }
    setTarget(parsed);
    const p = hikePct(current, parsed);
    setPctText(p === null ? "" : String(p));
  }

  async function submit() {
    setError(null);

    if (target === null || target <= 0) {
      setError("Enter a percentage or a new CTC first.");
      return;
    }
    setSaving(true);
    const result = isHr
      ? await saveProposal({ evaluationId, proposedCtc: target, justification: note.trim() })
      : await saveApproval({ evaluationId, approvedCtc: target, remarks: note.trim() });
    setSaving(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setSaved(true);
  }

  /* -- APPROVE AND CLOSE, on the summary too.
        This screen is where the MD sits during the interview, so finishing the
        increment from the full report and nowhere else meant leaving the
        conversation to go and find another page. Same server action as the
        salary band — nothing here reimplements a transition or a salary write,
        and HR and the MD are both admitted by it since 0056. -- */
  async function closeIt() {
    setError(null);

    if (target === null || target <= 0) {
      setError("Enter a percentage or a new CTC first.");
      return;
    }
    if (!effectiveFrom) {
      setError("Set the date the new salary starts being paid.");
      return;
    }

    setClosing(true);
    const result = await approveAndClose({
      evaluationId,
      approvedCtc: target,
      remarks: note.trim(),
      effectiveFrom,
    });
    setClosing(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setSaved(true);
    /* `settled` is decided by the server from the evaluation's status, so
       without this the panel would go on offering to close a closed record. */
    router.refresh();
  }

  if (current === null || current <= 0) {
    return (
      <p className="font-sans text-body-sm text-ink-muted">
        {band.employeeName} has no current salary on record, so a hike cannot be worked out. Add
        their employment record first.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---------- Presets ---------- */}
      <div>
        <span className="type-label text-ink-muted">Quick set</span>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {band.hikeBands.map((p) => {
            const active = pctText !== "" && Number(pctText) === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => applyPct(String(p))}
                disabled={settled}
                aria-pressed={active}
                className={cn(
                  "tabular min-h-9 rounded-control px-3 font-sans text-body transition-colors",
                  active
                    ? "bg-primary text-ink-invert"
                    : "bg-surface-mute text-ink hover:bg-rule/60",
                )}
              >
                {p}%
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------- The two linked inputs ---------- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="hike-pct">Custom percentage</Label>
          <Input
            id="hike-pct"
            inputMode="decimal"
            value={pctText}
            onChange={(e) => applyPct(e.target.value)}
            disabled={settled}
            placeholder="e.g. 12.5"
            className="tabular mt-1"
          />
        </div>
        <div>
          <Label htmlFor="hike-ctc">or a new CTC</Label>
          <Input
            id="hike-ctc"
            inputMode="numeric"
            value={target === null ? "" : String(target)}
            onChange={(e) => applyCtc(e.target.value)}
            disabled={settled}
            placeholder="e.g. 210000"
            className="tabular mt-1"
          />
        </div>
      </div>

      {/* ---------- What it comes to ----------
            AN EMPTY OUTPUT READS ₹0.00, NOT AN EM DASH.

            The dash is the product's convention for "not on record" (P7-9) and
            it is the wrong word here: nothing is missing, the reader simply has
            not chosen a figure yet. A zeroed baseline also makes the transition
            legible — pressing 10% animates four numbers up from zero rather than
            replacing four dashes, so it is obvious the panel is live.

            `live` dims the whole block until a figure is chosen, so a zero is
            never mistaken for a real proposal of nothing. -- */}
      {/* -- The panel is ONE surface, always. It used to gain an indigo wash and
            a ring the moment a figure was entered, which was a sixth colour on
            a screen that already had five and said nothing the numbers going
            from grey to black does not already say. The state change lives in
            the type, not in the container. -- */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-card bg-surface-mute p-4 sm:grid-cols-4">
        <Out label="New CTC" value={formatInr(target ?? 0)} strong live={live} />
        <Out label="Hike amount" value={formatInr(amount ?? 0)} live={live} />
        <Out
          label="New monthly"
          value={formatInr(monthlyNew ?? 0)}
          caption={monthlyNow === null ? undefined : `now ${formatInr(monthlyNow)}`}
          live={live}
        />
        <Out
          label="Annualised"
          value={`${(annualised ?? 0).toFixed(2)}%`}
          /* -- P21-5: a 15% rise after 18 months is a different decision from
                15% after 12, but the money actually paid is the real percent.
                So the card says which is which rather than letting the larger
                number be mistaken for the decision. -- */
          caption={
            pct === null ? "Context only." : `Context only · paid is ${pct.toFixed(2)}%.`
          }
          live={live}
        />
      </dl>

      {/* ---------- The note ---------- */}
      <div>
        <Label htmlFor="hike-note" className="flex items-baseline gap-1.5">
          {isHr ? "Justification" : "Remarks"}
          <span className="font-normal text-ink-muted">optional</span>
        </Label>
        <p className="mt-0.5 font-sans text-body-sm text-ink-muted">
          {isHr
            ? "Travels with the figure to the MD. Saving without it is fine."
            : "Kept with the record. Approving without it is fine — the approval is still dated and attributed to you."}
        </p>
        <Textarea
          id="hike-note"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setSaved(false);
          }}
          disabled={settled}
          rows={3}
          className="mt-1.5"
          placeholder={
            isHr
              ? "Why this figure — performance, market, retention, budget."
              : "Anything the record should carry."
          }
        />
      </div>

      {/* -- Only shown while the increment can still be closed. On a settled one
            it is a date nobody can change and the pay record already carries
            it. -- */}
      {settled ? null : (
        <div className="sm:max-w-xs">
          <Label htmlFor="hike-effective">Effective from</Label>
          <Input
            id="hike-effective"
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className="tabular mt-1"
          />
          <p className="mt-0.5 font-sans text-body-sm text-ink-muted">
            When the new salary starts being paid. Used by Approve and close.
          </p>
        </div>
      )}

      {error ? (
        <p role="alert" className="font-sans text-body-sm text-critical">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="font-sans text-body-sm text-success">
          {isHr ? "Proposal saved and ready for the MD." : "Approved figure saved."}
        </p>
      ) : null}

      {/* -- The label says WHY it is disabled, rather than leaving a dead
            control with no explanation (§13.4). Three states: nothing to save,
            already settled, or ready. -- */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={!canSave} className="w-full sm:w-auto">
          {saving
            ? "Saving…"
            : settled
              ? "Closed"
              : !dirty && live
                ? isHr
                  ? "Proposal saved"
                  : "Figure approved"
                : isHr
                  ? "Save proposal"
                  : "Approve this figure"}
        </Button>

        {/* -- APPROVE AND CLOSE, for HR and the MD alike (0056).
              Beside the save rather than instead of it: HR often wants to
              record a proposal and leave it, and the MD may want to store a
              figure before the conversation is finished. This is the button
              that ends the increment, so it is the one that says so.

              `variant="secondary"` for HR because saving the proposal is their
              ordinary act and closing is the exceptional one; for the MD it is
              the primary, because approving IS their job here. -- */}
        {settled ? null : (
          <Button
            onClick={closeIt}
            disabled={!live || closing || saving || effectiveFrom === ""}
            variant={isHr ? "secondary" : "default"}
            className="w-full sm:w-auto"
          >
            {closing ? "Approving and closing…" : "Approve and close"}
          </Button>
        )}

        {!settled && !dirty && live ? (
          <p className="w-full font-sans text-body-sm text-ink-muted">
            Saved. Approve and close finishes the increment and writes it to their pay record.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Out({
  label,
  value,
  caption,
  strong,
  live,
}: {
  label: string;
  value: string;
  caption?: string;
  strong?: boolean;
  /** False until a figure is chosen — the zero is a baseline, not a proposal. */
  live?: boolean;
}) {
  return (
    <div>
      <dt className="type-label leading-tight text-ink-muted">{label}</dt>
      <dd
        className={cn(
          "tabular mt-0.5 font-sans leading-tight transition-colors duration-hover",
          strong ? "text-display-sm" : "text-body-lg",
          live ? "text-ink" : "text-ink-muted/70",
        )}
      >
        {value}
      </dd>
      {caption ? (
        <p className="mt-0.5 font-sans text-body-sm leading-tight text-ink-muted">{caption}</p>
      ) : null}
    </div>
  );
}

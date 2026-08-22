"use client";

/**
 * One person's employment record and pay history.
 *
 * EVERY FIGURE ON THIS SCREEN IS RESTRICTED. §5's salary confinement: HR_ADMIN
 * and MD only. The route guards, 0023's policies enforce, and nothing here is
 * reachable from a HOD-facing or employee-facing surface.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, BellRing, Loader2, Pencil, Plus } from "lucide-react";

import { DashboardCard } from "@/components/appraise/metric-widget";
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
  addJoiningSalary,
  addSalaryChange,
  correctSalaryHistoryEntry,
  saveEmployment,
} from "@/lib/employment/actions";
import type { EmploymentDetail } from "@/lib/employment/queries";
import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils";
import { MoneyInput, moneyMonthly } from "@/components/appraise/money-input";

const EMPLOYMENT_TYPES = [
  { value: "PERMANENT", label: "Permanent" },
  { value: "PROBATION", label: "Probation" },
  { value: "CONTRACT", label: "Contract" },
  { value: "TRAINEE", label: "Trainee" },
] as const;

/** Plain language, never the stored token. */
const REASONS = [
  { value: "ANNUAL_INCREMENT", label: "Annual increment" },
  { value: "PROMOTION", label: "Promotion" },
  { value: "MARKET_ADJUSTMENT", label: "Market adjustment" },
  { value: "CORRECTION", label: "Correction of an earlier entry" },
] as const;

const REASON_LABEL: Record<string, string> = Object.fromEntries(
  REASONS.map((r) => [r.value, r.label]),
);

export function EmploymentClient({
  person,
  detail,
  canEditRecord,
}: {
  person: {
    id: string;
    name: string;
    employeeCode: string | null;
    designation: string | null;
    departmentName: string | null;
  };
  detail: EmploymentDetail;
  canEditRecord: boolean;
}) {
  const router = useRouter();
  const r = detail.record;

  const [form, setForm] = React.useState({
    dateOfJoining: detail.dateOfJoining ?? "",
    confirmationDate: r?.confirmation_date ?? "",
    lastIncrementDate: r?.last_increment_date ?? "",
    incrementFrequencyMonths: String(r?.increment_frequency_months ?? 12),
    employmentType: r?.employment_type ?? "PERMANENT",
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /* -- One dialog, three ways in. `null` is closed.
        Held as the MODE rather than a boolean plus a second state, so the two
        cannot disagree about which dialog is open. -- */
  /* -- Two dialogs, not one with a mode.
        A joining salary and a revision are different transactions: one is the
        baseline of the ledger, the other is a change to it, and they share no
        field but the amount. One component with a `mode` meant the revision
        form opened for both — with an effective date and a reason dropdown on
        a screen that has neither — and it filed the first salary a person was
        ever paid as a rise over the salary they are on today. -- */
  const [salaryMode, setSalaryMode] = React.useState<"change" | "correct" | null>(null);
  const openSalary = (mode: "change" | "correct") => setSalaryMode(mode);
  const [joiningOpen, setJoiningOpen] = React.useState(false);
  /* -- Editing the ALREADY-SET baseline, not adding a first one. Same dialog,
        pre-filled with the stored figure rather than blank — "Add joining
        salary" only ever showed when there was none yet. -- */
  const [joiningEditAmount, setJoiningEditAmount] = React.useState<string | null>(null);

  /* -- THE ROW BEING CORRECTED, held as the row itself rather than an id, so
        the dialog can pre-fill from it directly without a second lookup.
        `null` is closed — same one-state-not-two shape as the dialogs above. -- */
  const [correctingRow, setCorrectingRow] = React.useState<EmploymentDetail["history"][number] | null>(
    null,
  );

  /* -- REVISIONS ONLY.
        A legacy `reason = 'JOINING'` row is the baseline recorded the old way,
        and 0043 has copied its amount into `joining_ctc`. Rendering both would
        show the same figure twice — once as the baseline and once as a rise. -- */
  const revisions = detail.history.filter((h) => h.reason !== "JOINING");
  const salaryOpen = salaryMode !== null;

  async function onSave() {
    setBusy(true);
    setError(null);
    const result = await saveEmployment({
      profileId: person.id,
      dateOfJoining: form.dateOfJoining,
      confirmationDate: form.confirmationDate || null,
      lastIncrementDate: form.lastIncrementDate || null,
      incrementFrequencyMonths: form.incrementFrequencyMonths,
      employmentType: form.employmentType as (typeof EMPLOYMENT_TYPES)[number]["value"],
    });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-content space-y-5">
      <div>
        <Link
          href="/admin/people"
          className="inline-flex items-center gap-1.5 text-body-sm font-medium text-primary"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          Team review
        </Link>
        <h1 className="mt-1 text-display-md text-ink">{person.name}</h1>
        <p className="text-body text-ink-muted">
          {[person.designation, person.departmentName, person.employeeCode].filter(Boolean).join(" · ")}
        </p>
      </div>

      {error ? (
        <p className="flex items-start gap-2 rounded-card border border-critical/40 bg-critical-tint px-4 py-3 text-body-sm text-critical">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {/* ---------- Dates and terms ---------- */}
      <DashboardCard title="Employment">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date of joining" required>
            <Input
              type="date"
              value={form.dateOfJoining}
              disabled={!canEditRecord}
              onChange={(e) => setForm({ ...form, dateOfJoining: e.target.value })}
            />
          </Field>
          {/*
            The COLUMN is still `confirmation_date` and stays that way — §0.2
            freezes a name once created, and `v_my_employment` and the audit
            diffs both read it. Only the label moved, which is the P8P-1 split:
            what the database calls a thing and what a person calls it are
            allowed to differ, and only one of the two is safe to change.

            "Confirmation date" is the correct Indian HR term and it is on the
            offer letter, so the hint keeps it findable for anybody looking for
            that phrase — the label just no longer makes a reader guess what is
            being confirmed.
          */}
          <Field label="Employment type">
            <select
              value={form.employmentType}
              disabled={!canEditRecord}
              onChange={(e) => setForm({ ...form, employmentType: e.target.value })}
              className="h-10 w-full rounded-control border border-border bg-surface px-3 text-body-sm text-ink disabled:opacity-60"
            >
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
          {/* -- THE SCHEDULE, IN THE ORDER IT IS READ: when they were last paid
                more, how often that happens, and therefore when the next one
                falls. "Increment every" sat FIRST, which put the cause after
                the effect and orphaned "Next increment" on a row of its own. -- */}
          <Field label="Last increment">
            <Input
              type="date"
              value={form.lastIncrementDate}
              disabled={!canEditRecord}
              onChange={(e) => setForm({ ...form, lastIncrementDate: e.target.value })}
            />
          </Field>
          <Field label="Increment every (months)">
            <Input
              type="number"
              min={1}
              max={60}
              value={form.incrementFrequencyMonths}
              disabled={!canEditRecord}
              onChange={(e) => setForm({ ...form, incrementFrequencyMonths: e.target.value })}
            />
          </Field>

          {/* Read-only and DERIVED. A field here would be a second
              implementation of a rule the database already owns, and the two
              would disagree the first time somebody changed the frequency. */}
          <Field label="Next increment" hint="Worked out from the last increment and the frequency.">
            <p className="tabular flex h-10 items-center rounded-control bg-surface-mute px-3 text-body text-ink">
              {formatDate(r?.next_increment_date ?? null)}
            </p>
            {detail.remindOn ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-body-sm text-ink-muted">
                <BellRing aria-hidden className="size-3.5" />
                HR will be reminded on {formatDate(detail.remindOn)}.
              </p>
            ) : null}
          </Field>

          {/* -- LAST, because it is the only optional field here.
                It sat second, so hiding it for a permanent employee left a hole
                at the top right and the form read as though something had
                failed to render. An optional field at the END simply shortens
                the form when it is absent, which is what a form is expected to
                do — and no slot has to be reserved, so nothing jumps when it
                appears.

                ONLY WHERE IT MEANS SOMETHING. Reported as "if employment type
                is permanent, why are we showing a probation date?" — for
                somebody permanent with nothing recorded it asks for a date that
                does not exist.

                NOT hidden whenever permanent, though: a recorded date on a
                permanent employee is the day they BECAME permanent, which is a
                real fact and this screen is the only place it is kept.

                `form.employmentType`, not the stored value, so switching the
                select reveals it at once rather than after a save. -- */}
          {form.employmentType === "PROBATION" || form.confirmationDate ? (
            <Field
              label={form.employmentType === "PROBATION" ? "Probation ends" : "Confirmed on"}
              hint={
                form.employmentType === "PROBATION"
                  ? "Optional. Also called the confirmation date — the day probation ends and they become permanent. Nothing is worked out from it."
                  : "The day they became permanent. Kept as a record; nothing is worked out from it."
              }
            >
              <Input
                type="date"
                value={form.confirmationDate}
                disabled={!canEditRecord}
                onChange={(e) => setForm({ ...form, confirmationDate: e.target.value })}
              />
            </Field>
          ) : null}
        </div>

        {canEditRecord ? (
          <div className="mt-5 flex justify-end">
            <Button className="min-h-11" onClick={() => void onSave()} disabled={busy}>
              {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
              Save employment details
            </Button>
          </div>
        ) : (
          // §13.4: a disabled form with no explanation is a dead end.
          <p className="mt-4 text-body-sm text-ink-muted">
            You can read these details and record a pay change. Editing the joining and increment
            dates is HR&rsquo;s.
          </p>
        )}
      </DashboardCard>

      {/* ---------- Current pay ----------
          "EDIT" IS A CORRECTION, AND THAT IS NOT PEDANTRY.

          `current_ctc` is not an independent field — it is whatever the newest
          `salary_history` row says. Writing it directly would leave the card
          reading ₹6,00,000 above a history whose last line says ₹25,000, and
          the history is the half that no policy permits anybody to change
          (P19-3: append-only by trigger AND by the absence of an UPDATE policy,
          for HR and superuser alike).

          So Correct does what the owner asked for — change the number on record
          in one step — through the mechanism that keeps the two halves
          agreeing. The superseded entry stays visible, which is the point: a
          pay record that can be quietly rewritten is not a record. */}
      <DashboardCard
        title="Current pay"
        action={
          <div className="flex flex-wrap gap-2">
            {r?.current_ctc != null ? (
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => openSalary("correct")}
              >
                <Pencil aria-hidden className="size-4" />
                Correct
              </Button>
            ) : null}
            <Button variant="outline" className="min-h-11" onClick={() => openSalary("change")}>
              <Plus aria-hidden className="size-4" />
              Add salary change
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Readout label="Current salary" value={moneyMonthly(r?.current_ctc ?? null)} emphasis />
          <Readout label="Effective from" value={formatDate(r?.salary_effective_from ?? null)} />

          {/* -- The joining figure was an em dash with nothing to click, and no
                screen said where it comes from: it is a `salary_history` row
                with reason "Joining salary", which was already in the dropdown
                and impossible to find. An empty readout that names its own way
                of being filled is the difference between a gap and a dead
                end (§13.4). -- */}
          <div>
            <Readout label="Joining salary" value={moneyMonthly(r?.joining_ctc ?? null)} />
            {r && r.joining_ctc == null ? (
              <Button
                variant="ghost"
                className="mt-1 h-auto px-0 py-1 text-body-sm text-primary"
                onClick={() => setJoiningOpen(true)}
              >
                Add joining salary
              </Button>
            ) : null}
          </div>
        </div>
      </DashboardCard>

      {/* ---------- History ---------- */}
      <DashboardCard title="Salary history">
        {revisions.length === 0 && r?.joining_ctc == null ? (
          <p className="text-body-sm text-ink-muted">
            Nothing recorded yet. Every entry stays on record — a mistake is fixed on the row itself,
            through Edit, rather than by adding a second one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/60">
                  {["Effective", "Previous", "New", "Hike", "%", "Reason", "Recorded by", "Note", ""].map(
                    (h) => (
                      <th key={h} scope="col" className="type-label px-3 py-2 text-left font-bold text-ink">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {/* -- ROW 1 IS THE BASELINE, rendered rather than stored.
                        It comes from `employment_records.joining_ctc`, so
                        filling it in months later cannot alter a single row
                        below it or any percentage already computed. That is the
                        whole reason it is a column and not a history row.

                        No previous, no hike, no percentage — it is what the
                        ledger starts from, and a baseline with a rise against
                        it would be describing a raise that never happened.

                        EDITABLE IN PLACE, unlike every row beneath it — it is
                        not a `salary_history` row at all, so 0023's append-only
                        trigger has no say over it, and `set_joining_salary`
                        (0075) already lets it be corrected. The "Edit" button
                        here is the first time that path has a control on THIS
                        table rather than only on the Current pay card above. -- */}
                {r?.joining_ctc != null ? (
                  <tr className="border-b border-rule bg-surface-mute/60 last:border-b-0">
                    <td className="tabular px-3 py-2.5 text-body-sm text-ink">
                      {formatDate(detail.dateOfJoining)}
                    </td>
                    <td className="px-3 py-2.5 text-body-sm text-ink-muted">—</td>
                    {/* -- MONTHLY, like every row beneath it.
                          This was the one cell in the table still rendering the
                          stored ANNUAL figure: somebody entered ₹15,000 a month
                          and the baseline read ₹1,80,000.00 while the rise below
                          it read "₹20,000.00 a month". Both figures were right,
                          and the column was silently comparing two different
                          units — the one thing a column of money must never do.
                          The STORE is unchanged and stays annual (0061). -- */}
                    <td className="tabular px-3 py-2.5 text-body-sm font-medium text-ink">
                      {moneyMonthly(r.joining_ctc)}
                    </td>
                    <td className="px-3 py-2.5 text-body-sm text-ink-muted">—</td>
                    <td className="px-3 py-2.5 text-body-sm text-ink-muted">—</td>
                    <td className="px-3 py-2.5 text-body-sm text-ink-muted">Joining salary</td>
                    {/* -- Provenance, same as every other row (0044).
                          A column carries no author the way a history row does,
                          so it is stored alongside the figure. Blank where the
                          baseline predates that column or came from an import
                          with nobody to attribute it to — an honest "unknown"
                          rather than a name that would be a guess. -- */}
                    <td className="px-3 py-2.5 text-body-sm text-ink-muted">
                      {detail.joiningRecordedByName ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-body-sm text-ink-muted">Baseline</td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        variant="ghost"
                        className="h-auto min-h-11 px-2 py-1 text-body-sm text-primary sm:min-h-0"
                        onClick={() => setJoiningEditAmount(String(r.joining_ctc))}
                      >
                        <Pencil aria-hidden className="size-3.5" />
                        <span className="sr-only">Edit the joining salary</span>
                      </Button>
                    </td>
                  </tr>
                ) : null}

                {revisions.map((row) => (
                  <tr key={row.id} className="border-b border-rule last:border-b-0">
                    <td className="tabular px-3 py-2.5 text-body-sm text-ink">
                      {formatDate(row.effective_from)}
                    </td>
                    <td className="tabular px-3 py-2.5 text-body-sm text-ink-muted">
                      {moneyMonthly(row.previous_ctc)}
                    </td>
                    <td className="tabular px-3 py-2.5 text-body-sm font-medium text-ink">
                      {moneyMonthly(row.new_ctc)}
                    </td>
                    <td className="tabular px-3 py-2.5 text-body-sm text-ink">
                      {moneyMonthly(row.hike_amount)}
                    </td>
                    <td className="tabular px-3 py-2.5 text-body-sm text-ink">
                      {row.hike_pct === null ? "—" : `${row.hike_pct}%`}
                    </td>
                    <td className="px-3 py-2.5 text-body-sm text-ink-muted">
                      {REASON_LABEL[row.reason] ?? row.reason}
                      {/* -- A quiet marker, not a second Provenance column.
                            `corrected_at` (0093) is null until the row has
                            actually been edited, so a normal, never-touched
                            entry looks exactly as it always has. -- */}
                      {row.corrected_at ? (
                        <span className="ml-1.5 text-body-xs text-ink-muted">
                          (corrected {formatDate(row.corrected_at)})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-body-sm text-ink-muted">
                      {row.recordedByName ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-body-sm text-ink-muted">{row.note ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right">
                      {/* -- IN PLACE, AT THE OWNER'S EXPLICIT INSTRUCTION (0093).
                            Every other write in this file appends; this one
                            changes the row itself, and nothing else on this
                            page does that — which is why it earns a comment
                            here rather than only on the action and the
                            migration. -- */}
                      <Button
                        variant="ghost"
                        className="h-auto min-h-11 px-2 py-1 text-body-sm text-primary sm:min-h-0"
                        onClick={() => setCorrectingRow(row)}
                      >
                        <Pencil aria-hidden className="size-3.5" />
                        <span className="sr-only">Edit this entry</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashboardCard>

      {/* -- Keyed on the MODE, so opening Correct after Add gives a form built
            for correcting rather than the previous one with its reason swapped.
            A reset effect would render once with the stale values first, which
            is visible as the fields changing under the pointer (P10-11). -- */}
      <SalaryDialog
        key={salaryMode ?? "closed"}
        open={salaryOpen}
        mode={salaryMode ?? "change"}
        profileId={person.id}
        currentCtc={r?.current_ctc ?? null}
        hasRecord={Boolean(r)}
        /* Correct is about the figure that is already in force, so it opens on
           that date and that amount — the common case is changing one digit,
           not retyping both fields. Joining opens on their joining date, which
           is the only date it can honestly carry. */
        initialEffectiveFrom={
          salaryMode === "correct" ? (r?.salary_effective_from ?? "") : ""
        }
        initialCtc={
          salaryMode === "correct" && r?.current_ctc != null ? String(r.current_ctc) : ""
        }
        onClose={() => setSalaryMode(null)}
        onDone={() => {
          setSalaryMode(null);
          router.refresh();
        }}
      />

      {/* -- ONE DIALOG, TWO ENTRY POINTS, keyed on which is open so it never
            shows the OTHER call's stale amount in its field. Add starts blank;
            Edit (the row's own pencil button) starts on the stored figure. -- */}
      <JoiningSalaryDialog
        key={joiningEditAmount !== null ? "edit" : "add"}
        open={joiningOpen || joiningEditAmount !== null}
        onOpenChange={(v) => {
          if (!v) {
            setJoiningOpen(false);
            setJoiningEditAmount(null);
          }
        }}
        profileId={person.id}
        dateOfJoining={detail.dateOfJoining ?? null}
        hasRecord={Boolean(r)}
        initialAmount={joiningEditAmount ?? ""}
        isEdit={joiningEditAmount !== null}
      />

      <CorrectRowDialog
        row={correctingRow}
        profileId={person.id}
        onClose={() => setCorrectingRow(null)}
        onDone={() => {
          setCorrectingRow(null);
          router.refresh();
        }}
      />
    </div>
  );
}

/* ---------- Small parts ---------- */

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-body-sm font-medium text-ink">
        {label}
        {required ? <span className="text-critical"> *</span> : null}
      </Label>
      {children}
      {hint ? <p className="mt-1 text-body-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

function Readout({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <p className="type-label text-ink-muted">{label}</p>
      <p className={cn("tabular mt-1 text-body", emphasis ? "text-display-sm font-semibold text-ink" : "text-ink")}>
        {value}
      </p>
    </div>
  );
}

/**
 * Recording a pay change.
 *
 * The previous figure, the hike and the percentage are NOT fields — the action
 * computes all three from the stored record. A form that let somebody type the
 * previous salary could write a history that disagrees with the record it came
 * from, and this table's only job is to be evidence.
 */
function SalaryDialog({
  open,
  profileId,
  currentCtc,
  hasRecord,
  onClose,
  onDone,
  mode = "change",
  initialEffectiveFrom = "",
  initialCtc = "",
}: {
  open: boolean;
  profileId: string;
  currentCtc: number | null;
  hasRecord: boolean;
  onClose: () => void;
  onDone: () => void;
  /**
   * WHICH JOB THIS DIALOG IS DOING. One dialog, three entry points.
   *
   *   change     the ordinary case — a raise, from the card's own button.
   *   correct    "edit current pay". See the note on the Current pay card for
   *              why correcting is an APPEND rather than an edit.
   *   joining    the starting salary, for somebody entered without one.
   *
   * It only ever pre-selects the reason and pre-fills the fields; the reason
   * stays editable, because somebody who opened the wrong one should be able to
   * carry on rather than cancel and start again.
   */
  mode?: "change" | "correct";
  initialEffectiveFrom?: string;
  initialCtc?: string;
}) {
  const [effectiveFrom, setEffectiveFrom] = React.useState(initialEffectiveFrom);
  const [newCtc, setNewCtc] = React.useState(initialCtc);
  const [reason, setReason] = React.useState<string>(
    mode === "correct" ? "CORRECTION" : "ANNUAL_INCREMENT",
  );
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const parsed = Number(newCtc);

  /* -- The preview obeys the same rule the server does.
        It compared against `currentCtc` unconditionally, so recording a JOINING
        salary showed "₹25,000 → ₹1,80,000 · hike ₹1,55,000 · 620%" before
        anything was saved — the dialog confidently describing a raise that
        never happened, against the figure the person is paid TODAY rather than
        anything that preceded their joining date.

        A joining salary has nothing before it, so there is nothing to compare
        and no hike to show. The server is the authority (it looks up whatever
        actually preceded the effective date); this only has to stop showing a
        number it cannot know. -- */
  const comparable = reason === "JOINING" ? null : currentCtc;

  const preview =
    comparable !== null && Number.isFinite(parsed) && parsed > 0
      ? {
          hike: parsed - comparable,
          pct: comparable === 0 ? null : Math.round(((parsed - comparable) / comparable) * 10000) / 100,
        }
      : null;

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await addSalaryChange({
      profileId,
      effectiveFrom,
      newCtc,
      reason: reason as (typeof REASONS)[number]["value"],
      note,
    });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else onDone();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "correct" ? "Correct the current pay" : "Record a salary change"}
          </DialogTitle>
          <DialogDescription>
            {mode === "correct"
              ? "The figure on record is replaced by the one you enter. The entry it replaces stays in the history — a pay record that can be quietly rewritten is not a record, so a mistake is superseded rather than erased."
              : "This is appended to the history and can never be edited or removed. If you need to fix an earlier entry, add a correction rather than trying to change it."}
          </DialogDescription>
        </DialogHeader>

        {!hasRecord ? (
          <p className="rounded-card border border-warning/40 bg-warning-tint px-4 py-3 text-body-sm text-ink">
            This person has no employment record yet. Save their joining details first.
          </p>
        ) : (
          <div className="space-y-4">
            <Field label="Effective from" required>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </Field>
            {/* MONTHLY, like every other salary field. `MoneyInput` takes and
                returns the ANNUAL figure, so `newCtc` still holds what it
                always held and the action is untouched — the unit crosses in
                one component rather than at a dozen call sites. */}
            <Field label="New salary (monthly)" required>
              <MoneyInput
                value={newCtc === "" ? null : Number(newCtc)}
                onValueChange={(annual) => setNewCtc(annual === null ? "" : String(annual))}
              />
              {preview ? (
                <p className="tabular mt-1.5 text-body-sm text-ink-muted">
                  {moneyMonthly(currentCtc)} → {moneyMonthly(parsed)} · hike {moneyMonthly(preview.hike)}
                  {preview.pct === null ? "" : ` · ${preview.pct}%`}
                </p>
              ) : null}
            </Field>
            <Field label="Reason" required>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-10 w-full rounded-control border border-border bg-surface px-3 text-body-sm text-ink"
              >
                {REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </Field>
            {/* Optional at the owner's instruction — see the note on
                `salarySchema`. The hint still asks for one, because the reason
                code says "promotion" and only this says which promotion. */}
            <Field label="Note" hint="Optional. Why this changed — somebody will read it in two years.">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        )}

        {error ? <p className="text-body-sm font-medium text-critical">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onClose}>
            Cancel
          </Button>
          <Button className="min-h-11" onClick={() => void submit()} disabled={busy || !hasRecord}>
            {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
            Record it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/* ---------- The joining salary ---------- */

/**
 * ONE FIELD. Deliberately.
 *
 * This used to be the revision dialog opened with a different title, so it
 * carried an effective date and a reason dropdown — and the server treated what
 * it submitted as a rise over the salary the person is on today. Recording
 * ₹1,80,000 as somebody's starting pay came back as a 620% increase.
 *
 * A joining salary has no date to choose (it is their joining date, which
 * `profiles.date_of_joining` already owns — and a salary form that could move
 * it would silently reschedule their increments), no reason to pick, and
 * nothing to compare against. What is left is the amount, so that is what the
 * form is.
 *
 * The date is SHOWN and not editable. A field somebody cannot change is still
 * worth displaying: it is the thing that makes the figure mean something, and
 * a form that silently omits it invites the question of which date it used.
 */
function JoiningSalaryDialog({
  open,
  onOpenChange,
  profileId,
  dateOfJoining,
  hasRecord,
  initialAmount = "",
  isEdit = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string;
  dateOfJoining: string | null;
  hasRecord: boolean;
  /** The stored figure, when this is opened from the row's own Edit button
   *  rather than from "Add joining salary" — blank means there is nothing
   *  to pre-fill yet. */
  initialAmount?: string;
  /** Changes only the wording; `set_joining_salary` (0075) behaves the same
   *  either way — it has allowed a correction, not only a first entry,
   *  since that migration. */
  isEdit?: boolean;
}) {
  const router = useRouter();
  const [amount, setAmount] = React.useState(initialAmount);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await addJoiningSalary({ profileId, amount });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onOpenChange(false);
    setAmount("");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Correct the joining salary" : "Record the joining salary"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "This changes the figure on this same record — nothing new is added. If nobody has had a rise yet, today's salary moves with it, because they are still on what they joined on."
              : "What they were paid when they joined. This is the baseline their first rise is measured against — it is not a salary change and does not count as one."}
          </DialogDescription>
        </DialogHeader>

        {!hasRecord ? (
          <p className="rounded-control bg-warning-tint px-4 py-3 text-body-sm text-ink">
            This person has no employment record yet. Save their joining details first.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-control bg-surface-mute px-4 py-3">
              <p className="type-label text-ink-muted">Joined</p>
              <p className="tabular text-body text-ink">
                {dateOfJoining ? formatDate(dateOfJoining) : "Not recorded"}
              </p>
              <p className="mt-1 text-body-sm text-ink-muted">
                From their profile. Change it there if it is wrong — their increment
                dates are worked out from it.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="joining_amount">
                Joining salary (monthly) <span className="text-critical">*</span>
              </Label>
              <MoneyInput
                id="joining_amount"
                value={amount === "" ? null : Number(amount)}
                onValueChange={(annual) => setAmount(annual === null ? "" : String(annual))}
              />
              {/* -- Where somebody already has a recorded rise, correcting this
                    can leave that rise's own stored "previous" figure reading
                    something else — a reading to interpret, not corrupted data
                    (0075's own note on the trade). Said here rather than
                    assumed, since this is the one moment it is decided. -- */}
              <p className="text-body-sm text-ink-muted">
                {isEdit
                  ? "Every percentage already recorded on a later rise is stored on that row and stays exactly as it was — only this figure changes."
                  : "Can be corrected later if it is typed wrong."}
              </p>
            </div>

            {error ? (
              <p role="alert" className="rounded-control bg-critical-tint px-4 py-3 text-body-sm text-critical">
                {error}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="min-h-11">
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !hasRecord} className="min-h-11">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {isEdit ? "Save the correction" : "Record it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Correcting a history row in place (0093) ---------- */

/**
 * Edits an EXISTING `salary_history` row's own figures. AT THE OWNER'S
 * EXPLICIT INSTRUCTION — the ordinary way to fix a wrong entry in this system
 * is to append a new row with reason CORRECTION and leave the wrong one
 * visible underneath (still true, still available from the "Correct" button
 * on the Current pay card above). This dialog does the other thing: the row
 * itself changes, and nothing new is added.
 *
 * `previous_ctc`, `hike_amount` and `hike_pct` are not fields here, same as
 * `SalaryDialog` above and for the same reason (P19-7) — the server
 * recomputes them for the whole chain, because correcting this row's figure
 * or date can change what a LATER row should have found as its own
 * predecessor.
 */
function CorrectRowDialog({
  row,
  profileId,
  onClose,
  onDone,
}: {
  row: EmploymentDetail["history"][number] | null;
  profileId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [effectiveFrom, setEffectiveFrom] = React.useState(row?.effective_from ?? "");
  const [newCtc, setNewCtc] = React.useState(row?.new_ctc != null ? String(row.new_ctc) : "");
  const [reason, setReason] = React.useState(row?.reason ?? "ANNUAL_INCREMENT");
  const [note, setNote] = React.useState(row?.note ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    if (!row) return;
    setBusy(true);
    setError(null);
    const result = await correctSalaryHistoryEntry({
      id: row.id,
      profileId,
      effectiveFrom,
      newCtc,
      reason: reason as (typeof REASONS)[number]["value"],
      note,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onDone();
  }

  return (
    // Keyed on the row's own id, so opening a second row's Edit while this
    // one is still mid-edit — or reopening after Cancel — always starts from
    // THAT row's own stored values rather than whatever was last typed
    // (P10-11's device: a reset effect would render once with the stale
    // fields first, visible as them changing under the pointer).
    <Dialog key={row?.id ?? "closed"} open={row !== null} onOpenChange={(v) => (v ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit this entry</DialogTitle>
          <DialogDescription>
            Changes the figure on this same row — nothing new is added, and it is not counted as a
            fresh rise. Every later entry&rsquo;s own previous-figure and hike are updated to match, so
            the ledger stays consistent with itself.
          </DialogDescription>
        </DialogHeader>

        {row ? (
          <div className="space-y-4">
            <Field label="Effective from" required>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </Field>
            <Field label="Salary (monthly)" required>
              <MoneyInput
                value={newCtc === "" ? null : Number(newCtc)}
                onValueChange={(annual) => setNewCtc(annual === null ? "" : String(annual))}
              />
            </Field>
            <Field label="Reason" required>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-10 w-full rounded-control border border-border bg-surface px-3 text-body-sm text-ink"
              >
                {REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Note" hint="Optional. Why this changed — somebody will read it in two years.">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        ) : null}

        {error ? <p role="alert" className="text-body-sm font-medium text-critical">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onClose}>
            Cancel
          </Button>
          <Button className="min-h-11" onClick={() => void submit()} disabled={busy || !row}>
            {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
            Save the correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

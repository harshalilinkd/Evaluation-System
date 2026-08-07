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
import { AlertTriangle, ArrowLeft, BellRing, Loader2, Plus } from "lucide-react";

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
import { addSalaryChange, saveEmployment } from "@/lib/employment/actions";
import type { EmploymentDetail } from "@/lib/employment/queries";
import { formatDate, formatInr } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

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
  { value: "JOINING", label: "Joining salary" },
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
  const [salaryOpen, setSalaryOpen] = React.useState(false);

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
          <Field
            label="Probation ends"
            hint="Optional. Also called the confirmation date — the day probation ends and they become permanent. Nothing is worked out from it."
          >
            <Input
              type="date"
              value={form.confirmationDate}
              disabled={!canEditRecord}
              onChange={(e) => setForm({ ...form, confirmationDate: e.target.value })}
            />
          </Field>
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
          <Field label="Last increment">
            <Input
              type="date"
              value={form.lastIncrementDate}
              disabled={!canEditRecord}
              onChange={(e) => setForm({ ...form, lastIncrementDate: e.target.value })}
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

      {/* ---------- Current pay ---------- */}
      <DashboardCard
        title="Current pay"
        action={
          <Button variant="outline" className="min-h-11" onClick={() => setSalaryOpen(true)}>
            <Plus aria-hidden className="size-4" />
            Add salary change
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Readout label="Current CTC" value={formatInr(r?.current_ctc ?? null)} emphasis />
          <Readout label="Effective from" value={formatDate(r?.salary_effective_from ?? null)} />
          <Readout label="Joining CTC" value={formatInr(r?.joining_ctc ?? null)} />
        </div>
      </DashboardCard>

      {/* ---------- History ---------- */}
      <DashboardCard title="Salary history">
        {detail.history.length === 0 ? (
          <p className="text-body-sm text-ink-muted">
            Nothing recorded yet. Every change is appended here and can never be edited or removed —
            a mistake is fixed by adding a correction.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/60">
                  {["Effective", "Previous", "New", "Hike", "%", "Reason", "Recorded by", "Note"].map(
                    (h) => (
                      <th key={h} scope="col" className="type-label px-3 py-2 text-left font-bold text-ink">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {detail.history.map((row) => (
                  <tr key={row.id} className="border-b border-rule last:border-b-0">
                    <td className="tabular px-3 py-2.5 text-body-sm text-ink">
                      {formatDate(row.effective_from)}
                    </td>
                    <td className="tabular px-3 py-2.5 text-body-sm text-ink-muted">
                      {formatInr(row.previous_ctc)}
                    </td>
                    <td className="tabular px-3 py-2.5 text-body-sm font-medium text-ink">
                      {formatInr(row.new_ctc)}
                    </td>
                    <td className="tabular px-3 py-2.5 text-body-sm text-ink">
                      {formatInr(row.hike_amount)}
                    </td>
                    <td className="tabular px-3 py-2.5 text-body-sm text-ink">
                      {row.hike_pct === null ? "—" : `${row.hike_pct}%`}
                    </td>
                    <td className="px-3 py-2.5 text-body-sm text-ink-muted">
                      {REASON_LABEL[row.reason] ?? row.reason}
                    </td>
                    <td className="px-3 py-2.5 text-body-sm text-ink-muted">
                      {row.recordedByName ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-body-sm text-ink-muted">{row.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashboardCard>

      <SalaryDialog
        key={salaryOpen ? "open" : "closed"}
        open={salaryOpen}
        profileId={person.id}
        currentCtc={r?.current_ctc ?? null}
        hasRecord={Boolean(r)}
        onClose={() => setSalaryOpen(false)}
        onDone={() => {
          setSalaryOpen(false);
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
      {hint ? <p className="mt-1 text-[11px] text-ink-muted">{hint}</p> : null}
    </div>
  );
}

function Readout({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <p className="type-label text-ink-faint">{label}</p>
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
}: {
  open: boolean;
  profileId: string;
  currentCtc: number | null;
  hasRecord: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [effectiveFrom, setEffectiveFrom] = React.useState("");
  const [newCtc, setNewCtc] = React.useState("");
  const [reason, setReason] = React.useState<string>("ANNUAL_INCREMENT");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const parsed = Number(newCtc);
  const preview =
    currentCtc !== null && Number.isFinite(parsed) && parsed > 0
      ? {
          hike: parsed - currentCtc,
          pct: currentCtc === 0 ? null : Math.round(((parsed - currentCtc) / currentCtc) * 10000) / 100,
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
          <DialogTitle>Record a salary change</DialogTitle>
          <DialogDescription>
            This is appended to the history and can never be edited or removed. If you need to fix
            an earlier entry, add a correction rather than trying to change it.
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
            <Field label="New CTC (annual)" required>
              <Input
                type="number"
                min={1}
                value={newCtc}
                onChange={(e) => setNewCtc(e.target.value)}
                placeholder="600000"
              />
              {preview ? (
                <p className="tabular mt-1.5 text-body-sm text-ink-muted">
                  {formatInr(currentCtc)} → {formatInr(parsed)} · hike {formatInr(preview.hike)}
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
            <Field label="Note" required hint="Why this changed. Somebody will read it in two years.">
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

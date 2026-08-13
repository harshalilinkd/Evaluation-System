"use client";

/** Settings → Users. HR creates people and decides their access level. */

import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Pencil, Plus, Table2, Trash2, Upload, UserCheck, UserX } from "lucide-react";

import {
  createUser,
  deletePerson,
  getImportTemplate,
  importUsers,
  setUserActive,
  updatePerson,
  type ImportState,
  type ProvisionState,
} from "@/lib/auth/provisioning";
import { IMPORT_COLUMNS } from "@/lib/auth/csv";
import { bulkUpdatePeople } from "@/lib/employment/bulk";
import { DateCell, MoneyCell, NumberCell, SelectCell, TextCell } from "@/components/appraise/editable-cell";
import { ACCESS_LEVELS } from "@/lib/auth/schemas";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataGrid, GridCell } from "@/components/appraise/data-grid";
import { EmptyState } from "@/components/appraise/states";
import { ROLE_LABELS } from "@/components/appraise/nav-config";
import { cn } from "@/lib/utils";
// formatInr is gone from this file and that ABSENCE IS THE GUARANTEE: every
// salary here now goes through moneyMonthly, so no cell can render an annual
// figure without the compiler noticing. Same device F20-2 used.
import { formatDate } from "@/lib/utils/date";
import { moneyMonthly } from "@/components/appraise/money-input";
import type { Enums } from "@/types/database";
import { TRACK_FORM_LABELS, TRACK_LABELS } from "@/lib/forms/labels";
import { byEmployeeCode } from "@/lib/utils/employee-code";

export type PersonRow = {
  id: string;
  full_name: string;
  /* -- Null for a production worker (0071). They never sign in, so their
        profile carries no address — and a screen that typed this as `string`
        would render "null" rather than the em dash it means. -- */
  email: string | null;
  employee_code: string | null;
  /** §7: which module they are in. Decides which appraisal form they receive. */
  track: string | null;
  phone_e164: string | null;
  designation: string | null;
  date_of_joining: string | null;
  department: string | null;
  department_id: string | null;
  reports_to: string | null;
  reports_to_name: string | null;
  employment_type: string | null;
  /** §5: HR and the MD only. This screen is guarded to exactly those two. */
  current_ctc: number | null;
  /** The baseline every stored percentage was measured from (P19E-1). */
  joining_ctc: number | null;
  last_increment_date: string | null;
  next_increment_date: string | null;
  increment_frequency_months: number | null;
  roles: Enums<"app_role">[];
  is_active: boolean;
};

export type DepartmentOption = { id: string; name: string };

/**
 * What a table edit may change, and nothing else.
 *
 * A patch of exactly the touched cells — never a copy of the row. A full copy
 * would send every field of every person on save, so a row loaded before
 * somebody else's edit would silently overwrite it on the way back. A patch
 * cannot: what was not touched is not sent.
 *
 * `current_ctc` is ANNUAL, as stored. The cell types monthly and converts, so
 * the unit crosses the boundary exactly once (0061, and the confusion FIX-20
 * was reported for).
 */
export type PersonPatch = {
  employee_code?: string;
  designation?: string;
  department_id?: string | null;
  reports_to?: string | null;
  employment_type?: "PERMANENT" | "CONTRACT" | "PROBATION" | "INTERN";
  current_ctc?: number;
  /* -- The rest of what the CSV import writes, so a mistake made in a
        spreadsheet can be corrected on the screen that shows it.

        `last_increment_date` is deliberately ABSENT. 0068 made the pay ledger
        authoritative for it, so a hand-typed date would be overruled by the
        next recorded rise — a cell that does not hold its value. It moves when
        a salary change is recorded, and its column is read-only. -- */
  track?: "STAFF" | "WORKER";
  /** ISO. 0024's ONE joining date; moving it recomputes the whole schedule. */
  date_of_joining?: string;
  increment_frequency_months?: number;
  /** Written through 0069, which refuses to overwrite an existing baseline. */
  joining_ctc?: number;
};

type SalaryReason = "ANNUAL_INCREMENT" | "PROMOTION" | "CORRECTION" | "MARKET_ADJUSTMENT";

const SALARY_REASONS: Array<{ value: SalaryReason; label: string }> = [
  { value: "ANNUAL_INCREMENT", label: "Annual increment" },
  { value: "PROMOTION", label: "Promotion" },
  { value: "MARKET_ADJUSTMENT", label: "Market adjustment" },
  { value: "CORRECTION", label: "Correction to an earlier entry" },
];

/** §11 / P7-9: absent is an em dash, never an empty cell and never a zero. */
function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}

const EMPLOYMENT_LABELS: Record<string, string> = {
  PERMANENT: "Permanent",
  PROBATION: "Probation",
  CONTRACT: "Contract",
  INTERN: "Intern",
};

/** §8's rule applied to any enum: never show the stored value to a person. */
function employmentLabel(value: string | null): string {
  if (!value) return "—";
  return EMPLOYMENT_LABELS[value] ?? value;
}

/**
 * The per-row menu.
 *
 * A three-dot trigger rather than three inline buttons: with fourteen columns
 * the row has no width to spare, and Deactivate / Edit / Delete are all things
 * somebody does occasionally and deliberately.
 */
function RowMenu({
  person,
  isSelf,
  activeAction,
  onEdit,
  onDelete,
}: {
  person: PersonRow;
  isSelf: boolean;
  activeAction: (formData: FormData) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-ink-muted hover:text-ink"
          aria-label={`Actions for ${person.full_name}`}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52 border-rule">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className="size-4" aria-hidden />
          Edit details
        </DropdownMenuItem>

        {/* §P8.4: HR cannot switch themselves off — locking the last
            administrator out is a support call the database cannot undo. */}
        {isSelf ? (
          <DropdownMenuItem disabled>
            <UserX className="size-4" aria-hidden />
            You cannot deactivate yourself
          </DropdownMenuItem>
        ) : (
          <form action={activeAction}>
            <input type="hidden" name="profile_id" value={person.id} />
            <input type="hidden" name="is_active" value={person.is_active ? "false" : "true"} />
            <DropdownMenuItem asChild>
              <button type="submit" className="w-full cursor-pointer">
                {person.is_active ? (
                  <>
                    <UserX className="size-4" aria-hidden />
                    Deactivate
                  </>
                ) : (
                  <>
                    <UserCheck className="size-4" aria-hidden />
                    Reactivate
                  </>
                )}
              </button>
            </DropdownMenuItem>
          </form>
        )}

        <DropdownMenuSeparator className="bg-rule" />

        <DropdownMenuItem
          disabled={isSelf}
          onSelect={onDelete}
          className="text-critical focus:text-critical"
        >
          <Trash2 className="size-4" aria-hidden />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Submit({ children, pendingLabel }: { children: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="min-h-11" disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

/**
 * One band of the form: its name and purpose on the left, its fields on the
 * right.
 *
 * The old form was a single `max-w-form` column pinned to the left edge, which
 * is what left the right half of a 1180px page empty and made twelve unrelated
 * fields read as one undifferentiated list. Naming the groups is what turns it
 * into a structure somebody can scan: a person filling this in knows whether
 * they are on identity, team, or money without reading every label.
 *
 * Collapses to a single column below `md` — §13.2, and the label column would
 * otherwise eat half the width of a phone.
 */
function FormSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-x-10 gap-y-4 border-t border-rule pt-6 md:grid-cols-[13rem_1fr] md:pt-7">
      <div className="space-y-1">
        <h3 className="font-sans text-body font-medium text-ink">{title}</h3>
        <p className="font-sans text-body-sm text-ink-muted">{hint}</p>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

/** A labelled field with its hint and error in one place, so none is forgotten. */
function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="type-label flex items-baseline gap-2 text-ink-muted">
        {label}
        {optional ? (
          <span className="font-sans text-body-sm normal-case tracking-normal text-ink-muted">
            optional
          </span>
        ) : null}
      </Label>
      {children}
      {hint ? <p className="font-sans text-body-sm text-ink-muted">{hint}</p> : null}
      {error ? <p className="font-sans text-body-sm text-critical">{error}</p> : null}
    </div>
  );
}

/** The native select, styled to match the shadcn Input it sits beside. */
const SELECT_CLASS =
  "min-h-11 w-full rounded-input border border-rule bg-surface px-3 font-sans text-body text-ink";

/**
 * Bulk import.
 *
 * The report is the feature. Creating an auth account is an Admin API call, not
 * a database write, so a run cannot be wrapped in a transaction and rolled back
 * — which means the only honest design is one that tells you exactly which rows
 * landed. Every row is validated BEFORE any row is created, so the common case
 * (a file with three bad dates in it) fails with nothing created and a list to
 * fix, rather than leaving HR to work out which forty of sixty already exist.
 */
function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, action] = useActionState<ImportState, FormData>(importUsers, {});
  const [fileName, setFileName] = useState<string | null>(null);

  async function downloadTemplate() {
    const csv = await getImportTemplate();
    if (!csv) return;
    // A data URL rather than a route: the file is 16 headers and one example
    // line, and an endpoint for it would be a third place the column list lives.
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "linkd-prints-employees.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const failed = state.rows?.filter((r) => !r.ok) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // The run report is the whole point of this screen and it arrives after
        // the action returns — closing on a stray backdrop click would throw
        // away the only record of which rows landed.
        onInteractOutside={(event) => event.preventDefault()}
        className="flex max-h-[92vh] w-[min(96vw,760px)] max-w-none flex-col gap-0 overflow-hidden rounded-card-lg border-rule bg-background p-0"
      >
        <DialogHeader className="shrink-0 space-y-1 border-b border-rule bg-surface px-6 py-4 pr-14 text-left">
          <DialogTitle className="text-display-sm text-ink">Import from a spreadsheet</DialogTitle>
          <DialogDescription className="text-body-sm text-ink-muted">
            Add everybody in one go. Start from the template — its header row is what the importer
            reads.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {state.error ? (
          <p
            role="alert"
            className="rounded-control border border-critical/40 bg-critical-tint px-3 py-2 font-sans text-body-sm text-critical"
          >
            {state.error}
          </p>
        ) : null}

        {state.ran && !state.error ? (
          <p
            role="status"
            className="rounded-control border border-final/40 bg-final-tint px-3 py-2 font-sans text-body-sm text-final"
          >
            {/* Created and updated are counted apart, because they are different
                things to have happened to a file HR is about to upload again.
                A row for somebody already here now AMENDS them rather than
                failing, and saying so is what makes a re-upload legible. */}
            {state.created} {state.created === 1 ? "person" : "people"} created
            {state.updated ? `, ${state.updated} updated` : ""}
            {state.failed ? `, ${state.failed} not imported — see below.` : "."}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" className="min-h-11" onClick={downloadTemplate}>
            Download the template
          </Button>

          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-rule bg-surface px-4 font-sans text-body text-ink hover:bg-surface-mute">
            <input
              type="file"
              name="file"
              accept=".csv,text/csv"
              required
              className="sr-only"
              onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
            />
            {fileName ?? "Choose a CSV file"}
          </label>

          <Submit pendingLabel="Importing…">Import</Submit>
        </div>

        <details className="rounded-control border border-rule bg-surface-mute p-4">
          <summary className="cursor-pointer font-sans text-body text-ink">
            What the columns mean
          </summary>
          <ul className="mt-3 space-y-1.5">
            {IMPORT_COLUMNS.map((column) => (
              <li key={column.key} className="font-sans text-body-sm text-ink-muted">
                <span className="tabular text-ink">{column.header}</span>
                {column.required ? (
                  <span className="ml-2 type-label text-critical">required</span>
                ) : null}
                <span className="ml-2 text-ink-muted">{column.hint}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 font-sans text-body-sm text-ink-muted">
            Dates are DD-MM-YYYY. Department is matched by name or code. Reports-to is the Manager&rsquo;s
            email address, so import heads of department before their teams — or leave it blank and
            set it afterwards.
          </p>
        </details>

        {failed.length > 0 ? (
          <div className="overflow-hidden rounded-control border border-critical/40">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-critical/30 bg-critical-tint">
                  {["Row", "Name", "What is wrong"].map((h) => (
                    <th key={h} className="type-label px-4 py-2 text-left text-critical">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {failed.map((row) => (
                  <tr key={row.line} className="border-b border-rule last:border-b-0">
                    <td className="px-4 py-2 tabular text-body-sm text-ink-muted">{row.line}</td>
                    <td className="px-4 py-2 font-sans text-body-sm text-ink">{row.name || "—"}</td>
                    <td className="px-4 py-2 font-sans text-body-sm text-ink-muted">{row.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The access-level checkboxes.
 *
 * Its state lives HERE rather than in UsersTab so that keying the form on a
 * successful save resets it along with the fields. Held in the parent, the
 * picker would survive the remount and the next person would inherit the last
 * one's roles — which is worse than a stale text field, because nothing on
 * screen would look wrong.
 */
function RolePicker({ initial }: { initial?: readonly string[] }) {
  // Everyone is an employee; these are the levels granted on top.
  const [selected, setSelected] = useState<string[]>([...new Set(["EMPLOYEE", ...(initial ?? [])])]);

  function toggle(role: string, on: boolean) {
    setSelected((prev) => (on ? [...new Set([...prev, role])] : prev.filter((r) => r !== role)));
  }

  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">Access level</legend>
      {ACCESS_LEVELS.map((level) => {
        const isEmployee = level.always === true;
        const checked = selected.includes(level.value) || isEmployee;

        return (
          <label
            key={level.value}
            className={cn(
              "flex min-h-11 cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors",
              checked ? "border-primary/40 bg-accent" : "border-rule bg-surface hover:bg-surface-mute",
              isEmployee && "cursor-default opacity-90",
            )}
          >
            <Checkbox
              checked={checked}
              // Everyone fills in their own appraisal; there is no user of this
              // system who does not.
              disabled={isEmployee}
              onCheckedChange={(value) => toggle(level.value, value === true)}
              className="mt-0.5"
            />
            {/* Rendered only when ticked. It used to submit "" for every level
                left unticked, and an empty string is not an `app_role` — one
                of them failed the entire role insert, which is what "the
                access level was not applied" was reporting. */}
            {checked ? <input type="hidden" name="roles" value={level.value} /> : null}
            <span className="space-y-0.5">
              <span className="block font-sans text-body text-ink">{level.label}</span>
              <span className="block font-sans text-body-sm text-ink-muted">
                {level.description}
              </span>
            </span>
          </label>
        );
      })}
      <p className="font-sans text-body-sm text-ink-muted">
        A head of department is also an employee — they fill in their own appraisal first, then
        review their team.
      </p>
    </fieldset>
  );
}

function Notice({ state }: { state: ProvisionState }) {
  if (!state.error && !state.message) return null;
  const isError = Boolean(state.error);

  return (
    <p
      role={isError ? "alert" : "status"}
      className={cn(
        "rounded-control border px-3 py-2 font-sans text-body-sm",
        isError
          ? "border-critical/40 bg-critical-tint text-critical"
          : "border-final/40 bg-final-tint text-final",
      )}
    >
      {state.error ?? state.message}
    </p>
  );
}

/**
 * The add-a-person dialog.
 *
 * It owns its own action state so the effect that closes it on success calls a
 * PROP rather than setting state in this component — the pattern the React
 * compiler requires, and the one DeleteDialog already uses.
 */
function AddPersonDialog({
  open,
  onOpenChange,
  people,
  departments,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: PersonRow[];
  departments: DepartmentOption[];
}) {
  const [createState, createAction] = useActionState<ProvisionState, FormData>(createUser, {});

  /* -- Has this person had a rise before today?
        The last-increment date is the only honest signal, and it is a field HR
        is filling in anyway. A new joiner leaves it blank and is asked for one
        salary; somebody being backfilled sets it and is asked for two, because
        for them the joining figure and today's figure are genuinely different
        numbers.

        Controlled purely so this can be read. Everything else on the form stays
        uncontrolled and is submitted through FormData. -- */
  const [lastIncrementDate, setLastIncrementDate] = useState("");
  const hasPriorIncrement = lastIncrementDate.trim() !== "";

  // Close on success, so the new row is visible in the table behind. A failure
  // stays open holding its message next to the field it is about.
  useEffect(() => {
    if (createState.createdId) onOpenChange(false);
  }, [createState.createdId, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Nothing here closes on an outside click: this form holds a dozen
        // unsaved fields and a stray backdrop click throwing them away is the
        // kind of loss people do not report, they just stop trusting the screen.
        onInteractOutside={(event) => event.preventDefault()}
        className="flex max-h-[92vh] w-[min(96vw,900px)] max-w-none flex-col gap-0 overflow-hidden rounded-card-lg border-rule bg-background p-0"
      >
        <DialogHeader className="shrink-0 space-y-1 border-b border-rule bg-surface px-6 py-4 pr-14 text-left">
          <DialogTitle className="text-display-sm text-ink">Add someone</DialogTitle>
          <DialogDescription className="text-body-sm text-ink-muted">
            They can sign in as soon as you save. Tell them their password yourself — it is not
            emailed.
          </DialogDescription>
        </DialogHeader>

        {/* -- The action bar is a SIBLING of the scroll region, not inside it.
              `sticky bottom-0` within a scroller floats the bar OVER the
              content — which is why the Access options were half-covered by
              "Create account". Making the form the flex column and giving the
              fields their own overflow area puts the bar in a panel of its own
              underneath, where nothing can pass beneath it. -- */}
        <div className="flex min-h-0 flex-1 flex-col">
          <Notice state={createState} />

          {/*
            Keyed on the id of the person just created, so a successful save
            remounts the form with empty fields.

            This is the bug that made a working save look like a failure: the
            inputs are uncontrolled, so React left every value in place after the
            action returned. A full form and a green message read as "nothing
            happened", the natural next move is to press Save again, and the
            second attempt reports "somebody already has that email address" —
            about the person it created a second earlier.

            A keyed remount rather than a reset effect, for the reason P10-11 and
            PC-4 both give: it states the intent (this is a new form, not the old
            one wiped) and it resets the role picker's state along with the
            fields, which an imperative form.reset() would leave untouched.
          */}
          <form
            key={createState.createdId ?? "new"}
            action={createAction}
            className="flex min-h-0 flex-1 flex-col"
          >
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-5">

          {/* ---------- Identity ---------- */}
          <FormSection
            title="Identity"
            hint="Who they are and how they sign in. The password is not emailed — read it out to them."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="full_name" label="Full name" error={createState.fieldErrors?.full_name}>
                <Input id="full_name" name="full_name" required className="min-h-11" />
              </Field>

              <Field id="email" label="Work email" error={createState.fieldErrors?.email}>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  className="min-h-11"
                  placeholder="name@linkdprints.com"
                />
              </Field>

              <Field
                id="employee_code"
                label="Employee code"
                optional
                hint="HR looks people up by this as often as by name."
                error={createState.fieldErrors?.employee_code}
              >
                <Input id="employee_code" name="employee_code" className="min-h-11 tabular" />
              </Field>

              <Field
                id="password"
                label="Password"
                hint="At least 10 characters. Shown in plain text so you can read it out."
                error={createState.fieldErrors?.password}
              >
                <Input
                  id="password"
                  name="password"
                  type="text"
                  required
                  minLength={10}
                  className="min-h-11 tabular"
                  autoComplete="new-password"
                />
              </Field>
            </div>
          </FormSection>

          {/* ---------- Where they sit ---------- */}
          <FormSection
            title="Where they sit"
            hint="Their team, their title, and who rates them."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                id="department_id"
                label="Department"
                hint="Decides which Job Specific Skills questions they are asked."
              >
                <Select name="department_id">
                  <SelectTrigger id="department_id" className="min-h-11 border-rule bg-surface">
                    <SelectValue placeholder="Choose a department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field
                id="track"
                label="Which form do they fill?"
                hint={`${TRACK_LABELS.STAFF} answer the 0-5 evaluation. ${TRACK_LABELS.WORKER} answer the three-tick sheet. This is not their department, because both kinds of people work in the same teams.`}
              >
                <select
                  id="track"
                  name="track"
                  defaultValue="STAFF"
                  className={SELECT_CLASS}
                >
                  {/* The VALUES are the enum and never move (§0.2) — they are
                      stored on every profile and frozen into every launched
                      evaluation. Only the labels change. */}
                  <option value="STAFF">{TRACK_FORM_LABELS.STAFF}</option>
                  <option value="WORKER">{TRACK_FORM_LABELS.WORKER}</option>
                </select>
              </Field>

              <Field
                id="designation"
                label="Designation"
                optional
                hint="Their job title, as it should appear on a printed evaluation."
              >
                <Input id="designation" name="designation" className="min-h-11" />
              </Field>

              <Field
                id="reports_to"
                label="Reports to"
                hint="Assigning a manager determines evaluation workflow routing. A cycle cannot launch until every participant has one."
              >
                <select id="reports_to" name="reports_to" className={SELECT_CLASS}>
                  <option value="">Nobody yet</option>
                  {people
                    .filter((p) => p.is_active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                </select>
              </Field>

              <Field
                id="phone"
                label="Work mobile"
                hint="Where their form link is sent. Indian numbers may be typed without +91."
                error={createState.fieldErrors?.phone}
              >
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="+91 98765 43210"
                  className="min-h-11 tabular"
                />
              </Field>
            </div>
          </FormSection>

          {/* ---------- Employment ---------- */}
          <FormSection
            title="Employment"
            hint="The dates the increment reminder is worked out from."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                id="date_of_joining"
                label="Date of joining"
                optional
                hint="Used as the starting date for increment cycle calculations."
              >
                <Input
                  id="date_of_joining"
                  name="date_of_joining"
                  type="date"
                  className="min-h-11 tabular"
                />
              </Field>

              <Field
                id="employment_type"
                label="Employment type"
              >
                <select
                  id="employment_type"
                  name="employment_type"
                  defaultValue="PERMANENT"
                  className={SELECT_CLASS}
                >
                  <option value="PERMANENT">Permanent</option>
                  <option value="PROBATION">Probation</option>
                  <option value="CONTRACT">Contract</option>
                  <option value="TRAINEE">Trainee</option>
                </select>
              </Field>

              <Field
                id="last_increment_date"
                label="Last increment"
                optional
                hint="Leave blank for a new joiner."
              >
                <Input
                  id="last_increment_date"
                  name="last_increment_date"
                  type="date"
                  value={lastIncrementDate}
                  onChange={(e) => setLastIncrementDate(e.target.value)}
                  className="min-h-11 tabular"
                />
              </Field>

              <Field id="increment_frequency_months" label="Increment every (months)">
                <Input
                  id="increment_frequency_months"
                  name="increment_frequency_months"
                  type="number"
                  min={1}
                  max={60}
                  defaultValue={12}
                  className="min-h-11 tabular"
                />
              </Field>
            </div>
          </FormSection>

          {/* ---------- Compensation ----------
              Every figure here is confined to HR and the MD (§5). It is written
              as `salary_history` rows, not as a bare number on the record, so
              the append-only history is right from the first save — and no
              figure reaches an audit diff (P19-10). */}
          <FormSection
            title="Compensation"
            hint="Optional, and visible only to HR and the MD. Recorded as their opening pay history."
          >
            {/* -- ONE FIELD FOR A NEW JOINER, TWO FOR SOMEBODY BEING BACKFILLED.
                  A person with no prior increment is on what they joined on, so
                  asking for a current salary as well is asking them to type the
                  same number twice — and inviting the two to disagree. The
                  second field appears only once a last-increment date says
                  there has been a rise, which is the fact that makes them
                  different figures.

                  `Last increment amount` is gone entirely. It was a manual
                  input for something the ledger derives: the rise IS current
                  minus the baseline, and a typed figure that disagrees with
                  that arithmetic is a third version of the truth in a table
                  whose job is to be evidence. -- */}
            <div className={`grid gap-5 ${hasPriorIncrement ? "sm:grid-cols-2" : ""}`}>
              <Field
                id="joining_ctc"
                label="Joining salary (optional)"
                error={createState.fieldErrors?.joining_ctc}
              >
                <Input
                  id="joining_ctc"
                  name="joining_ctc"
                  inputMode="numeric"
                  placeholder="₹ 4,00,000"
                  className="min-h-11 tabular"
                />
              </Field>

              {hasPriorIncrement ? (
                <Field
                  id="current_ctc"
                  label="Current salary (optional)"
                  error={createState.fieldErrors?.current_ctc}
                >
                  <Input
                    id="current_ctc"
                    name="current_ctc"
                    inputMode="numeric"
                    placeholder="₹ 4,80,000"
                    className="min-h-11 tabular"
                  />
                </Field>
              ) : null}
            </div>
            <p className="font-sans text-body-sm text-ink-muted">
              {hasPriorIncrement
                ? "Figures may be typed with ₹ and commas. The joining salary is the baseline of their pay ledger; the current salary is filed against their last increment date, and the rise between the two is calculated for you."
                : "Figures may be typed with ₹ and commas. Their current salary is set to this automatically — with no increment recorded, the two are the same figure."}
            </p>
          </FormSection>

          {/* ---------- Access ---------- */}
          <FormSection
            title="Access"
            hint="Everyone fills in their own appraisal. These are the powers granted on top."
          >
            <RolePicker />
          </FormSection>

          </div>

          {/* §13.3: one primary action, in its own panel below the scroll area. */}
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-rule bg-surface px-6 py-4">
            <p className="mr-auto font-sans text-body-sm text-ink-muted">
              They can sign in as soon as you save.
            </p>
            <Submit pendingLabel="Creating…">Create account</Submit>
          </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Amend somebody's details.
 *
 * THE SAME FIVE BANDS AS THE ADD FORM, in the same order, with the same names
 * and the same hints — Identity · Where they sit · Employment · Compensation ·
 * Access. It was a flat grid plus two afterthought blocks, and the two forms
 * looked like different forms about different things, which is what "fields are
 * missing" was actually reporting: some genuinely were, and the rest were there
 * but unrecognisable.
 *
 * Two bands still hold no inputs, and each now SAYS SO rather than being absent:
 *
 *   Identity      the email and the password live on the auth account, not the
 *                 profile. `updatePerson` writes neither.
 *   Compensation  a pay change needs a reason and has to append to
 *                 `salary_history` or that table stops being evidence (§19-8,
 *                 P19C-2). A bare field here would write neither.
 *
 * §13.4: a missing control with no explanation is a dead end. Both bands name
 * where the thing IS done.
 */
function EditPersonDialog({
  person,
  people,
  departments,
  onClose,
}: {
  person: PersonRow | null;
  people: PersonRow[];
  departments: DepartmentOption[];
  onClose: () => void;
}) {
  const [state, action] = useActionState<ProvisionState, FormData>(updatePerson, {});

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  if (!person) return null;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        onInteractOutside={(event) => event.preventDefault()}
        // 900px, the add form's width. The bands need the label column, and two
        // dialogs about the same person at two different widths read as two
        // different screens.
        className="flex max-h-[92vh] w-[min(96vw,900px)] max-w-none flex-col gap-0 overflow-hidden rounded-card-lg border-rule bg-background p-0"
      >
        <DialogHeader className="shrink-0 space-y-1 border-b border-rule bg-surface px-6 py-4 pr-14 text-left">
          <DialogTitle className="text-display-sm text-ink">Edit {person.full_name}</DialogTitle>
          <DialogDescription className="text-body-sm text-ink-muted">
            {/* -- This said pay was NOT in this form. It is — the Compensation
                  band is the last section, and it appends a row to their pay
                  history rather than overwriting a figure. Somebody reading the
                  old sentence stopped scrolling and reported the fields as
                  missing, which is exactly what it told them to expect. -- */}
            Everything the add form asks for, including their pay. Scroll down for salary,
            department and increment dates.
          </DialogDescription>
        </DialogHeader>

        {/* Same structure as the add dialog: the fields scroll, the action bar
            does not, and neither can cover the other. */}
        <form action={action} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-5">
          <input type="hidden" name="profile_id" value={person.id} />
          <Notice state={state} />

          {/* ---------- Identity ---------- */}
          <FormSection
            title="Identity"
            hint="Who they are and how they sign in. Changing the email or the password changes the account itself."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="e_full_name" label="Full name" error={state.fieldErrors?.full_name}>
                <Input
                  id="e_full_name"
                  name="full_name"
                  required
                  defaultValue={person.full_name}
                  className="min-h-11"
                />
              </Field>

              <Field
                id="e_email"
                label="Work email"
                error={state.fieldErrors?.email}
                hint="What they sign in with, and where their mail goes. Changing it takes effect at once."
              >
                <Input
                  id="e_email"
                  name="email"
                  type="email"
                  defaultValue={person.email ?? ""}
                  className="min-h-11"
                />
              </Field>

              <Field
                id="e_employee_code"
                label="Employee code"
                optional
                hint="HR looks people up by this as often as by name."
              >
                <Input
                  id="e_employee_code"
                  name="employee_code"
                  defaultValue={person.employee_code ?? ""}
                  className="min-h-11 tabular"
                />
              </Field>

              {/* Blank-by-default and blank-means-keep, so saving any other
                  field cannot reset somebody's password by accident. Plain
                  text for the same reason the add form uses it: HR has to read
                  it out, and a masked field they cannot check is how somebody
                  is handed a password with a typo in it. */}
              <Field
                id="e_new_password"
                label="Set a new password"
                optional
                error={state.fieldErrors?.new_password}
                hint="Leave blank to keep their current one. At least 10 characters, shown so you can read it out."
              >
                <Input
                  id="e_new_password"
                  name="new_password"
                  type="text"
                  minLength={10}
                  autoComplete="new-password"
                  placeholder="Leave blank to keep it"
                  className="min-h-11 tabular"
                />
              </Field>
            </div>

            <p className="rounded-control border border-warning/40 bg-warning-tint px-3 py-2 font-sans text-body-sm text-ink-muted">
              A new password takes effect immediately and is not emailed — tell them yourself, or
              they are locked out.
            </p>
          </FormSection>

          {/* ---------- Where they sit ---------- */}
          <FormSection title="Where they sit" hint="Their team, their title, and who rates them.">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                id="e_department"
                label="Department"
                optional
                hint="Decides which Job Specific Skills questions they are asked."
              >
                <select
                  id="e_department"
                  name="department_id"
                  defaultValue={person.department_id ?? ""}
                  className={SELECT_CLASS}
                >
                  <option value="">No department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                id="e_track"
                label="Which form do they fill?"
                hint={`${TRACK_LABELS.STAFF} answer the 0-5 evaluation. ${TRACK_LABELS.WORKER} answer the three-tick sheet. This is not their department, because both kinds of people work in the same teams.`}
              >
                <select
                  id="e_track"
                  name="track"
                  defaultValue={person.track ?? "STAFF"}
                  className={SELECT_CLASS}
                >
                  {/* The VALUES are the enum and never move (§0.2) — they are
                      stored on every profile and frozen into every launched
                      evaluation. Only the labels change. */}
                  <option value="STAFF">{TRACK_FORM_LABELS.STAFF}</option>
                  <option value="WORKER">{TRACK_FORM_LABELS.WORKER}</option>
                </select>
              </Field>

              <Field
                id="e_designation"
                label="Designation"
                optional
                hint="Their job title, as it should appear on a printed evaluation."
              >
                <Input
                  id="e_designation"
                  name="designation"
                  defaultValue={person.designation ?? ""}
                  className="min-h-11"
                />
              </Field>

              <Field
                id="e_reports_to"
                label="Reports to"
                optional
                error={state.fieldErrors?.reports_to}
                hint="Assigning a manager determines evaluation workflow routing."
              >
                <select
                  id="e_reports_to"
                  name="reports_to"
                  defaultValue={person.reports_to ?? ""}
                  className={SELECT_CLASS}
                >
                  <option value="">Nobody yet</option>
                  {people
                    // Their own lead is a cycle nobody can resolve, so it is not
                    // offered — an option that always fails is not a choice.
                    .filter((p) => p.id !== person.id && p.is_active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                </select>
              </Field>

              <Field
                id="e_phone"
                label="Work mobile"
                optional
                error={state.fieldErrors?.phone}
                hint="Where their form link is sent. Indian numbers may be typed without +91."
              >
                <Input
                  id="e_phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  defaultValue={person.phone_e164 ?? ""}
                  className="min-h-11 tabular"
                  placeholder="+91 98765 43210"
                />
              </Field>
            </div>
          </FormSection>

          {/* ---------- Employment ----------
              Type, joining date, last increment and frequency are ordinary
              personnel data. The NEXT increment date is not a field: 0023's
              trigger derives it from these, and a second place to type it is a
              second place to disagree (P19-5). */}
          <FormSection
            title="Employment"
            hint="The dates the increment reminder is worked out from."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                id="e_doj"
                label="Date of joining"
                optional
                hint="Used as the starting date for increment cycle calculations."
              >
                <Input
                  id="e_doj"
                  name="date_of_joining"
                  type="date"
                  defaultValue={person.date_of_joining ?? ""}
                  className="min-h-11 tabular"
                />
              </Field>

              <Field id="e_emp_type" label="Employment type">
                <select
                  id="e_emp_type"
                  name="employment_type"
                  defaultValue={person.employment_type ?? "PERMANENT"}
                  className={SELECT_CLASS}
                >
                  <option value="PERMANENT">Permanent</option>
                  <option value="PROBATION">Probation</option>
                  <option value="CONTRACT">Contract</option>
                  <option value="TRAINEE">Trainee</option>
                </select>
              </Field>

              <Field
                id="e_last_inc"
                label="Last increment"
                optional
                hint="Leave blank for a new joiner."
              >
                <Input
                  id="e_last_inc"
                  name="last_increment_date"
                  type="date"
                  defaultValue={person.last_increment_date ?? ""}
                  className="min-h-11 tabular"
                />
              </Field>

              <Field
                id="e_freq"
                label="Increment every (months)"
                hint="Their next increment and HR's reminder are worked out from this."
              >
                <Input
                  id="e_freq"
                  name="increment_frequency_months"
                  type="number"
                  min={1}
                  max={60}
                  defaultValue={String(person.increment_frequency_months ?? 12)}
                  className="min-h-11 tabular"
                />
              </Field>
            </div>

            {/* Derived, not typed — shown so the consequence of the two dates
                above is visible while they are being changed. */}
            <p className="font-sans text-body-sm text-ink-muted">
              Next increment:{" "}
              <span className="tabular text-ink-muted">
                {person.next_increment_date ? formatDate(person.next_increment_date) : "—"}
              </span>{" "}
              · worked out for you, and not a field.
            </p>
          </FormSection>

          {/* ---------- Compensation ----------

              A pay change, not a field. §19-8 requires a reason and a note, and
              it has to append a `salary_history` row or that table stops being
              evidence — so the four inputs travel together and the server hands
              them to `addSalaryChange`, the same function the Employment & pay
              screen calls. There is one definition of a pay change, and this is
              a caller of it, not a copy.

              Every figure here is HR-and-MD only (§5), which this whole screen
              already is. */}
          <FormSection
            title="Compensation"
            hint="Visible only to HR and the MD. A change is filed against their pay history, so it carries a reason."
          >
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-rule bg-surface-mute px-4 py-3">
              <div>
                <p className="type-label text-ink-muted">Current salary</p>
                <p className="tabular text-body-lg font-medium text-ink">
                  {person.current_ctc === null ? "Not recorded" : moneyMonthly(person.current_ctc)}
                </p>
              </div>
              <Link
                href={`/admin/people/${person.id}/employment`}
                className="font-sans text-body-sm font-medium text-primary underline underline-offset-2"
              >
                See their pay history
              </Link>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              {/* Blank means "not changing it", never "set it to nothing" —
                  the rule the bulk import follows (P19D-4). Nothing below is
                  read unless this carries a figure. */}
              <Field
                id="e_new_ctc"
                label="New salary"
                optional
                hint="Leave blank to leave their pay alone. ₹ and commas are fine."
              >
                <Input
                  id="e_new_ctc"
                  name="new_ctc"
                  inputMode="numeric"
                  placeholder="Leave blank to keep it"
                  className="min-h-11 tabular"
                />
              </Field>

              <Field
                id="e_salary_from"
                label="Effective from"
                hint="A date before their current one is a correction to the past and will not move today's figure."
              >
                <Input
                  id="e_salary_from"
                  name="salary_effective_from"
                  type="date"
                  className="min-h-11 tabular"
                />
              </Field>

              <Field id="e_salary_reason" label="Reason">
                <select
                  id="e_salary_reason"
                  name="salary_reason"
                  defaultValue="ANNUAL_INCREMENT"
                  className={SELECT_CLASS}
                >
                  <option value="ANNUAL_INCREMENT">Annual increment</option>
                  <option value="PROMOTION">Promotion</option>
                  <option value="MARKET_ADJUSTMENT">Market adjustment</option>
                  <option value="CORRECTION">Correction</option>
                  
                </select>
              </Field>

              {/* Optional since the owner's instruction reversed P19-8 — the
                  comment here said "required by the server, never optional",
                  which stopped being true when `salarySchema` changed and would
                  have sent the next reader looking for a validation rule that
                  no longer exists. The hint still asks for one. */}
              <Field
                id="e_salary_note"
                label="Note"
                hint="Optional. One line is enough — it is filed against the change and cannot be edited afterwards."
              >
                <Input
                  id="e_salary_note"
                  name="salary_note"
                  placeholder="Why this changed"
                  className="min-h-11"
                />
              </Field>
            </div>
          </FormSection>

          {/* ---------- Access ---------- */}
          <FormSection
            title="Access"
            hint="Everyone fills in their own appraisal. These are the powers granted on top."
          >
            <RolePicker initial={person.roles} />
          </FormSection>

          </div>

          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-rule bg-surface px-6 py-4">
            <Button type="button" variant="ghost" className="min-h-11" onClick={onClose}>
              Cancel
            </Button>
            <Submit pendingLabel="Saving…">Save changes</Submit>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Delete somebody.
 *
 * §17 and §12 both say people are switched off, not erased, and that stands —
 * so this only ever succeeds for somebody who has done nothing yet. The server
 * counts what depends on them and names it; the dialog says so up front rather
 * than making HR click to discover a refusal.
 */
function DeletePersonDialog({
  person,
  onClose,
}: {
  person: PersonRow | null;
  onClose: () => void;
}) {
  const [state, action] = useActionState<ProvisionState, FormData>(deletePerson, {});

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  if (!person) return null;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {person.full_name}?</DialogTitle>
          <DialogDescription>
            This removes their account and they can no longer sign in. It cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-control border border-warning/40 bg-warning-tint p-3 text-body-sm text-ink">
          Deleting only works for somebody who has done nothing yet. Once they appear in an
          evaluation, hold pay history, or have acted anywhere in the system, the record is kept —
          deactivate them instead and they stop being able to sign in.
        </p>

        {state.error ? (
          <p
            role="alert"
            className="rounded-control border border-critical/40 bg-critical-tint px-3 py-2 text-body-sm text-critical"
          >
            {state.error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onClose}>
            Keep the account
          </Button>
          <form action={action}>
            <input type="hidden" name="profile_id" value={person.id} />
            <DeleteSubmit />
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" className="min-h-11" disabled={pending}>
      {pending ? "Deleting…" : "Delete account"}
    </Button>
  );
}

/* ---------- The screen ---------- */

export function UsersTab({
  people,
  departments,
  currentProfileId,
}: {
  people: PersonRow[];
  departments: DepartmentOption[];
  currentProfileId: string;
}) {
  const router = useRouter();
  const [activeState, activeAction] = useActionState<ProvisionState, FormData>(setUserActive, {});
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const [deleting, setDeleting] = useState<PersonRow | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");

  /* -- TABLE EDIT MODE.
        Editing twelve salaries one dialog at a time is the wrong shape for a
        pay round, which is a single decision applied to a list of people. In
        edit mode the cells themselves are typed into and one Save writes the
        lot.

        `drafts` holds ONLY the cells somebody has touched, keyed by profile.
        Not a copy of the rows: a full copy would send every field of every
        person on save, so a stale row loaded before somebody else's edit would
        silently overwrite it. A patch of exactly what changed cannot. -- */
  const [tableEdit, setTableEdit] = useState(false);
  const [drafts, setDrafts] = useState<Map<string, PersonPatch>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payReason, setPayReason] = useState<SalaryReason>("ANNUAL_INCREMENT");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payNote, setPayNote] = useState("");

  const setCell = useCallback(<K extends keyof PersonPatch>(id: string, key: K, value: PersonPatch[K]) => {
    setDrafts((prev) => {
      const next = new Map(prev);
      const row = { ...(next.get(id) ?? {}) };
      row[key] = value;
      next.set(id, row);
      return next;
    });
  }, []);

  /** What a cell should show: the draft if it has one, otherwise the record. */
  const cellValue = useCallback(
    <K extends keyof PersonPatch>(row: PersonRow, key: K, fallback: PersonPatch[K]): PersonPatch[K] => {
      const draft = drafts.get(row.id);
      return draft && key in draft ? (draft[key] as PersonPatch[K]) : fallback;
    },
    [drafts],
  );

  const isDirty = useCallback(
    (id: string, key: keyof PersonPatch) => {
      const draft = drafts.get(id);
      return Boolean(draft && key in draft);
    },
    [drafts],
  );

  const changedCount = drafts.size;
  const salaryChanged = useMemo(
    () => [...drafts.values()].some((d) => d.current_ctc !== undefined),
    [drafts],
  );

  function leaveEditMode() {
    setTableEdit(false);
    setDrafts(new Map());
    setPayOpen(false);
  }

  async function saveTable() {
    // A pay change has to say why and from when — `salary_history` is the
    // evidence, and P19-8's reasoning holds however many people are in the
    // batch. Asked ONCE for the batch rather than once per person.
    if (salaryChanged && !payOpen) {
      setPayOpen(true);
      return;
    }

    setSaving(true);
    setSaveResult(null);
    const result = await bulkUpdatePeople({
      patches: [...drafts.entries()].map(([profileId, patch]) => ({ profileId, ...patch })),
      salaryReason: salaryChanged ? payReason : undefined,
      salaryEffectiveFrom: salaryChanged ? payDate : undefined,
      salaryNote: salaryChanged ? payNote : undefined,
    });
    setSaving(false);
    setPayOpen(false);

    if (!result.ok) {
      setSaveResult({ tone: "error", text: result.error.message });
      return;
    }

    const failed = result.data.rows.filter((r) => !r.ok);
    setSaveResult({
      tone: failed.length > 0 ? "error" : "ok",
      text:
        failed.length > 0
          ? `${result.data.updated} saved, ${failed.length} could not be: ${failed[0]?.error ?? ""}`
          : `${result.data.updated} ${result.data.updated === 1 ? "person" : "people"} updated${
              result.data.salaryChanges > 0
                ? `, ${result.data.salaryChanges} pay ${result.data.salaryChanges === 1 ? "change" : "changes"} recorded`
                : ""
            }.`,
    });

    if (failed.length === 0) leaveEditMode();
    router.refresh();
  }

  const rows = useMemo(
    () =>
      people.filter((person) => {
        if (status === "ACTIVE" && !person.is_active) return false;
        if (status === "INACTIVE" && person.is_active) return false;
        if (!search.trim()) return true;
        const needle = search.trim().toLowerCase();
        return (
          person.full_name.toLowerCase().includes(needle) ||
          (person.email ?? "").toLowerCase().includes(needle) ||
          (person.department ?? "").toLowerCase().includes(needle)
        );
      }).sort(byEmployeeCode),
    [people, search, status],
  );

  const columns = useMemo<ColumnDef<PersonRow>[]>(
    () => [
      {
        accessorKey: "full_name",
        header: "Name",
        size: 220,
        meta: { frozen: true },
        cell: ({ row }) => (
          <GridCell value={row.original.full_name} className="font-medium" />
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        size: 260,
        /* An em dash, not "null" and not a fabricated address: a production
           worker genuinely has none (0071). */
        cell: ({ row }) => <GridCell value={row.original.email ?? "—"} className="tabular" />,
      },
      {
        accessorKey: "designation",
        header: "Designation",
        size: 180,
        cell: ({ row }) =>
          tableEdit ? (
            <TextCell
              value={cellValue(row.original, "designation", row.original.designation ?? "") ?? ""}
              onChange={(v) => setCell(row.original.id, "designation", v)}
              label={`Designation for ${row.original.full_name}`}
              dirty={isDirty(row.original.id, "designation")}
            />
          ) : (
            <GridCell value={dash(row.original.designation)} />
          ),
      },
      {
        accessorKey: "department",
        header: "Department",
        size: 150,
        // §11 / P7-9: missing is not the same as empty, and never zero.
        cell: ({ row }) =>
          tableEdit ? (
            <SelectCell
              value={cellValue(row.original, "department_id", row.original.department_id) ?? ""}
              onChange={(v) => setCell(row.original.id, "department_id", v === "" ? null : v)}
              label={`Department for ${row.original.full_name}`}
              dirty={isDirty(row.original.id, "department_id")}
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
            />
          ) : (
            <GridCell value={dash(row.original.department)} />
          ),
      },
      {
        id: "reports_to",
        header: "Reports to",
        size: 170,
        cell: ({ row }) =>
          tableEdit ? (
            <SelectCell
              value={cellValue(row.original, "reports_to", row.original.reports_to) ?? ""}
              onChange={(v) => setCell(row.original.id, "reports_to", v === "" ? null : v)}
              label={`Who ${row.original.full_name} reports to`}
              dirty={isDirty(row.original.id, "reports_to")}
              blankLabel="Nobody"
              options={people
                .filter((p) => p.id !== row.original.id && p.is_active)
                .map((p) => ({ value: p.id, label: p.full_name }))}
            />
          ) : (
            <GridCell value={dash(row.original.reports_to_name)} />
          ),
      },
      {
        accessorKey: "phone_e164",
        header: "Work mobile",
        size: 150,
        cell: ({ row }) => <GridCell value={dash(row.original.phone_e164)} className="tabular" />,
      },
      {
        accessorKey: "date_of_joining",
        header: "Joined",
        size: 140,
        cell: ({ row }) =>
          tableEdit ? (
            /* 0024: the ONE joining date. Moving it recomputes the whole
               increment schedule through P19B-2's trigger, which is why it is
               worth being able to correct here rather than only in a dialog. */
            <DateCell
              value={cellValue(row.original, "date_of_joining", row.original.date_of_joining ?? "") ?? ""}
              onChange={(v) => setCell(row.original.id, "date_of_joining", v)}
              label={`Joining date for ${row.original.full_name}`}
              dirty={isDirty(row.original.id, "date_of_joining")}
            />
          ) : (
            // §0.10: DD-MM-YYYY throughout.
            <GridCell value={row.original.date_of_joining ? formatDate(row.original.date_of_joining) : "—"} className="tabular" />
          ),
      },
      {
        accessorKey: "track",
        header: "Team",
        size: 150,
        /* §7's module: which appraisal they receive. Editable because getting
           it wrong on import is exactly what HR needs to fix, and history is
           safe either way — a launched evaluation holds its own frozen
           questions (§5). */
        cell: ({ row }) =>
          tableEdit ? (
            <SelectCell
              value={cellValue(row.original, "track", (row.original.track ?? "STAFF") as "STAFF" | "WORKER") ?? "STAFF"}
              onChange={(v) => setCell(row.original.id, "track", v as "STAFF" | "WORKER")}
              label={`Team for ${row.original.full_name}`}
              dirty={isDirty(row.original.id, "track")}
              options={[
                { value: "STAFF", label: TRACK_LABELS.STAFF },
                { value: "WORKER", label: TRACK_LABELS.WORKER },
              ]}
            />
          ) : (
            <GridCell value={row.original.track === "WORKER" ? TRACK_LABELS.WORKER : TRACK_LABELS.STAFF} />
          ),
      },
      {
        accessorKey: "employment_type",
        header: "Employment",
        size: 130,
        cell: ({ row }) =>
          tableEdit ? (
            <SelectCell
              value={cellValue(row.original, "employment_type", row.original.employment_type as PersonPatch["employment_type"]) ?? ""}
              onChange={(v) => setCell(row.original.id, "employment_type", (v || undefined) as PersonPatch["employment_type"])}
              label={`Employment type for ${row.original.full_name}`}
              dirty={isDirty(row.original.id, "employment_type")}
              options={Object.entries(EMPLOYMENT_LABELS).map(([value, label]) => ({ value, label }))}
            />
          ) : (
            <GridCell value={employmentLabel(row.original.employment_type)} />
          ),
      },
      {
        id: "joining_ctc",
        header: "Joining salary",
        size: 165,
        meta: { align: "right" },
        /* -- THE BASELINE, AND HR MAY CORRECT IT (0074, at the owner's
              instruction — it reverses 0069's once-only rule).

              Safe because the ledger does not depend on it: `previous_ctc`,
              `hike_amount` and `hike_pct` are STORED on each pay row when it is
              written and are never recomputed, so fixing a typo here cannot
              rewrite a single percentage.

              Where somebody already has a rise on record the baseline and that
              rise's stored `previous_ctc` can then read differently — a
              disagreement for a person to interpret, not corrupted data. Before
              any rise, which is the common case, there is no such effect at
              all: today's salary moves with it. -- */
        cell: ({ row }) =>
          tableEdit ? (
            <MoneyCell
              annual={cellValue(row.original, "joining_ctc", row.original.joining_ctc ?? undefined) ?? null}
              onChangeAnnual={(v) => setCell(row.original.id, "joining_ctc", v ?? undefined)}
              label={`Joining salary for ${row.original.full_name}`}
              dirty={isDirty(row.original.id, "joining_ctc")}
            />
          ) : (
            /* -- MONTHLY, because the cell beside it is typed monthly.
                  This column read annual while `MoneyCell` two lines up takes a
                  monthly figure, so one cell showed ₹1,80,000 until you clicked
                  it and then showed ₹15,000. `moneyMonthly`'s own docstring
                  names that as the bug it exists to remove, and this table was
                  missed when the rest of the product moved (0061). -- */
            <GridCell
              value={moneyMonthly(row.original.joining_ctc)}
              className="tabular"
            />
          ),
      },
      {
        id: "current_ctc",
        /* -- "CTC" is an annual word — Cost To Company — and cannot head a
              column of monthly figures without saying something untrue. The
              noun changes; the column, its data and its edit behaviour do
              not. -- */
        header: "Current salary",
        size: 165,
        meta: { align: "right" },
        // §5: salary is readable by HR_ADMIN and MD only, and this screen is
        // guarded to exactly those two. It appears here and nowhere a HOD or an
        // employee can reach.
        cell: ({ row }) =>
          tableEdit ? (
            // Typed MONTHLY, stored annual — the conversion happens in the cell
            // so the unit crosses the boundary exactly once (0061).
            <MoneyCell
              annual={cellValue(row.original, "current_ctc", row.original.current_ctc ?? undefined) ?? null}
              onChangeAnnual={(v) => setCell(row.original.id, "current_ctc", v ?? undefined)}
              label={`Salary for ${row.original.full_name}`}
              dirty={isDirty(row.original.id, "current_ctc")}
            />
          ) : (
            // Monthly, matching the editable cell above and every other
            // salary readout in the product.
            <GridCell value={moneyMonthly(row.original.current_ctc)} className="tabular" />
          ),
      },
      {
        accessorKey: "last_increment_date",
        header: "Last increment",
        size: 140,
        /* -- READ-ONLY, DELIBERATELY. 0068 made the pay ledger authoritative
              for this: "once there is a recorded rise, that is when they were
              last given one". A hand-typed date would be silently overruled by
              the next pay change, and a cell that does not hold its value is
              worse than no cell. It moves when a salary change is recorded. -- */
        cell: ({ row }) => (
          <GridCell value={row.original.last_increment_date ? formatDate(row.original.last_increment_date) : "—"} className="tabular" />
        ),
      },
      {
        accessorKey: "increment_frequency_months",
        header: "Review every",
        size: 130,
        meta: { align: "right" },
        cell: ({ row }) =>
          tableEdit ? (
            <NumberCell
              value={
                cellValue(
                  row.original,
                  "increment_frequency_months",
                  row.original.increment_frequency_months ?? undefined,
                ) ?? null
              }
              onChange={(v) => setCell(row.original.id, "increment_frequency_months", v ?? undefined)}
              label={`Months between salary reviews for ${row.original.full_name}`}
              dirty={isDirty(row.original.id, "increment_frequency_months")}
              min={1}
              max={60}
            />
          ) : (
            <GridCell
              value={row.original.increment_frequency_months === null ? "—" : `${row.original.increment_frequency_months} months`}
              className="tabular"
            />
          ),
      },
      {
        accessorKey: "next_increment_date",
        header: "Next increment",
        size: 150,
        cell: ({ row }) => (
          <GridCell value={row.original.next_increment_date ? formatDate(row.original.next_increment_date) : "—"} className="tabular" />
        ),
      },
      {
        id: "access",
        header: "Access",
        size: 160,
        cell: ({ row }) => (
          <GridCell
            value={
              row.original.roles
                .filter((r) => r !== "EMPLOYEE")
                .map((r) => ROLE_LABELS[r])
                .join(" · ") || "Employee"
            }
          />
        ),
      },
      {
        id: "status",
        header: "Status",
        size: 110,
        meta: { align: "center" },
        cell: ({ row }) => (
          <span
            className={cn(
              "type-label inline-block whitespace-nowrap rounded-pill border px-2 py-0.5",
              row.original.is_active
                ? "border-final/40 bg-final-tint text-final"
                : "border-rule bg-surface-mute text-ink-muted",
            )}
          >
            {row.original.is_active ? "Active" : "Inactive"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        size: 64,
        enableResizing: false,
        meta: { align: "center" },
        cell: ({ row }) => (
          <RowMenu
            person={row.original}
            isSelf={row.original.id === currentProfileId}
            activeAction={activeAction}
            onEdit={() => setEditing(row.original)}
            onDelete={() => setDeleting(row.original)}
          />
        ),
      },
    ],
    /* -- `tableEdit` IS LOAD-BEARING HERE, not a lint appeasement. The cell
          renderers close over it, so leaving it out would memoise a set of
          columns that read `tableEdit === false` for ever and the table would
          never become editable at all. The rest are the same story: `drafts`
          reaches these through `cellValue`/`isDirty`, so without them a typed
          character would not appear in its own cell. -- */
    [activeAction, currentProfileId, tableEdit, cellValue, isDirty, setCell, departments, people],
  );

  return (
    // Fourteen columns need the whole screen, so this tab takes it.
    // `data-full-bleed` drops the shell's 1180px cap AND its gutters (the
    // :has() rule in globals.css) — so no negative margins here, which would
    // pull the grid off the left edge of a page that already has no padding.
    // The tab strip goes flush too, which is what the question bank does.
    //
    // The toolbar is a fixed band; the grid owns everything left over and
    // scrolls inside itself.
    <div
      data-full-bleed
      className="flex h-[calc(100dvh-theme(spacing.topbar)-5rem)] min-h-[24rem] flex-col overflow-hidden border-t border-rule bg-surface"
    >
      {activeState.error || activeState.message ? (
        <div className="shrink-0 border-b border-rule px-3 py-2">
          <Notice state={activeState} />
        </div>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule bg-surface-mute px-3 py-2">
        {/* Full width on a phone: a fixed 280px is wider than a 375px screen
            once the padding is taken off, so it forced the toolbar to scroll. */}
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email or department"
          className="min-h-11 w-full border-rule bg-surface sm:w-[280px]"
          aria-label="Search people"
        />

        <div className="flex items-center gap-1.5">
          <span className="type-label whitespace-nowrap text-ink-muted">Status</span>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger
              aria-label="Status"
              className="min-h-11 w-[132px] border-rule bg-surface font-sans text-body-sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="INACTIVE">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Both ways in live here, in the header, rather than as two long forms
            stacked above the list somebody actually came to read.

            On a phone they share the row and their labels shorten — "Import
            from a spreadsheet" is six words for a button, and at 375px the two
            of them together are wider than the screen. */}
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          {/* -- EDIT MODE replaces the other two rather than sitting beside
                them. Import and Add are ways to change the list; while somebody
                is part-way through editing it, offering either is offering to
                navigate away from unsaved work. §13.3 — one job at a time. -- */}
          {tableEdit ? (
            <>
              <Button
                variant="ghost"
                className="min-h-11"
                onClick={leaveEditMode}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                className="min-h-11 flex-1 sm:flex-none"
                onClick={() => void saveTable()}
                disabled={saving || changedCount === 0}
              >
                {saving
                  ? "Saving…"
                  : changedCount === 0
                    ? "Nothing changed yet"
                    : `Save ${changedCount} ${changedCount === 1 ? "person" : "people"}`}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                className="min-h-11 flex-1 sm:flex-none"
                onClick={() => setTableEdit(true)}
              >
                <Table2 className="size-4" aria-hidden />
                <span className="hidden sm:inline">Edit the table</span>
                <span className="sm:hidden">Edit</span>
              </Button>
              <Button
                variant="outline"
                className="min-h-11 flex-1 sm:flex-none"
                onClick={() => setImportOpen(true)}
              >
                <Upload className="size-4" aria-hidden />
                <span className="hidden sm:inline">Import from a spreadsheet</span>
                <span className="sm:hidden">Import</span>
              </Button>
              <Button className="min-h-11 flex-1 sm:flex-none" onClick={() => setAddOpen(true)}>
                <Plus className="size-4" aria-hidden />
                <span className="hidden sm:inline">Add new user</span>
                <span className="sm:hidden">Add</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* -- What edit mode is, said once, where somebody is standing when they
            enter it. The salary sentence is the load-bearing half: a pay change
            is an entry in a permanent ledger, not a corrected typo, and knowing
            that BEFORE typing is what stops somebody using this screen to fix a
            figure they meant to correct on the Employment tab. -- */}
      {tableEdit ? (
        <p className="rounded-control border border-primary/40 bg-primary/10 px-4 py-3 font-sans text-body-sm text-ink">
          <span className="font-medium">Editing the table.</span> Change any cell and press Save.
          Salaries are typed as a <span className="font-medium">monthly</span> figure, and saving one
          records a pay change in the salary history — you will be asked why and from when.
        </p>
      ) : null}

      {saveResult ? (
        <p
          role="status"
          className={cn(
            "rounded-control px-4 py-3 font-sans text-body-sm",
            saveResult.tone === "ok"
              ? "border border-final/40 bg-final-tint text-final"
              : "border border-critical/40 bg-critical-tint text-critical",
          )}
        >
          {saveResult.text}
        </p>
      ) : null}

      <DataGrid
        data={rows}
        columns={columns}
        storageKey="appraise.people.column-widths"
        minWidth={1480}
        /* -- The employee code IS the row number here (F58-style), so it takes
              the gutter rather than sitting in a column beside a counter saying
              the same thing. In EDIT MODE the gutter renders the field instead
              of the open-button — safe because the row's ⋯ menu carries the
              same action and is what a keyboard user reaches anyway. -- */
        rowLabel={{
          header: "Employee ID",
          value: (p) => p.employee_code || "—",
          cell: tableEdit
            ? (p) => (
                <TextCell
                  value={cellValue(p, "employee_code", p.employee_code ?? "") ?? ""}
                  onChange={(v) => setCell(p.id, "employee_code", v)}
                  label={`Employee ID for ${p.full_name}`}
                  dirty={isDirty(p.id, "employee_code")}
                />
              )
            : undefined,
        }}
        // Clicking anywhere on a row opens that person's record. The ⋯ menu's
        // "Edit details" is the same action and stays — it is what a keyboard
        // or screen-reader user reaches, since a clickable <tr> is neither
        // focusable nor announced.
        onRowClick={(person) => setEditing(person)}
        empty={
          people.length === 0 ? (
            <EmptyState
              title="Nobody has been added yet"
              body="Add the first person. Start with yourself, so you do not lock yourself out."
            />
          ) : (
            <EmptyState
              title="Nobody matches those filters"
              body="Widen the search, or clear the status filter."
            />
          )
        }
        status={
          <span className="tabular text-body-sm text-ink">
            {rows.length} of {people.length} {people.length === 1 ? "person" : "people"}
          </span>
        }
      />

      <AddPersonDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        people={people}
        departments={departments}
      />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />

      {/* Keyed on the id, so opening a second person starts with a clean action
          state rather than inheriting the previous one's error (P10-11). */}
      <EditPersonDialog
        key={`edit-${editing?.id ?? "none"}`}
        person={editing}
        people={people}
        departments={departments}
        onClose={() => setEditing(null)}
      />
      <DeletePersonDialog
        key={`delete-${deleting?.id ?? "none"}`}
        person={deleting}
        onClose={() => setDeleting(null)}
      />

      {/* -- WHY A PAY CHANGE STOPS TO ASK.
            Every other cell on this grid is a fact and correcting one is a
            correction. A salary is an EVENT: it appends to `salary_history`,
            which is append-only for every caller (P19-3), and 0068 takes the
            increment clock from that ledger's latest entry. P19-8 required a
            reason for exactly this — "a pay change with no explanation is the
            thing somebody has to reconstruct from memory two years later".

            Asked ONCE for the batch, not once per person: twelve rises on the
            same date for the same reason is the case this screen exists for,
            and asking twelve times would send people back to the dialog they
            were trying to escape. -- */}
      <Dialog open={payOpen} onOpenChange={(open) => (open ? null : setPayOpen(false))}>
        <DialogContent className="w-[min(96vw,520px)] border-rule">
          <DialogHeader>
            <DialogTitle className="text-display-sm text-ink">
              Why are these salaries changing?
            </DialogTitle>
            <DialogDescription className="font-sans text-body-sm text-ink-muted">
              {[...drafts.values()].filter((d) => d.current_ctc !== undefined).length} pay{" "}
              {[...drafts.values()].filter((d) => d.current_ctc !== undefined).length === 1
                ? "change goes"
                : "changes go"}{" "}
              into the salary history with this reason and date. The history cannot be edited
              afterwards — a mistake is fixed by adding a correction.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pay_reason">Reason</Label>
              <select
                id="pay_reason"
                value={payReason}
                onChange={(e) => setPayReason(e.target.value as SalaryReason)}
                className="min-h-11 w-full min-w-0 rounded-input border border-rule bg-surface px-3 font-sans text-body-sm text-ink"
              >
                {SALARY_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pay_date">Effective from</Label>
              <Input
                id="pay_date"
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className="min-h-11 tabular"
              />
              <p className="font-sans text-body-sm text-ink-muted">
                When the new salary starts being paid. An annual increment dated here also moves
                their next increment date.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pay_note">Note</Label>
              <Textarea
                id="pay_note"
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="Optional. Anything the record should carry."
                className="min-h-20"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" className="min-h-11" onClick={() => setPayOpen(false)}>
              Back to the table
            </Button>
            <Button className="min-h-11" onClick={() => void saveTable()} disabled={saving}>
              {saving ? "Saving…" : "Record and save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

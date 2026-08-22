"use client";

/**
 * THE WHOLE COMPANY'S SALARY HISTORY, ONE SHEET.
 *
 * Asked for directly: the roster (Users tab) shows one "Current salary" per
 * person, because a roster is not a ledger — and a fixed set of columns
 * cannot hold a history that keeps growing as increments happen. This is a
 * dedicated, spreadsheet-shaped screen for that: one row per person, then a
 * DATE and AMOUNT column pair for every increment anybody has had, growing
 * to fit whoever has the most.
 *
 * BUILT ON THE SAME GRID AS TEAM REVIEW AND SETTINGS › USERS, deliberately —
 * reported as "not matching other pages" the first time it was a hand-rolled
 * `<table>`. `DataGrid` is the one implementation every table-first screen in
 * the product shares; a second one here is exactly the drift that component
 * exists to prevent. Editable cells are the SAME `DateCell`/`MoneyCell` the
 * Users tab uses for exactly this job (components/appraise/editable-cell.tsx)
 * — not a bespoke input, so a cell here looks and behaves identically to the
 * one editing the same kind of figure two tabs over.
 *
 * BUILT FOR SOMEBODY NON-TECHNICAL WHO GETS CONFUSED EASILY, at the owner's
 * own words. Two rules, and only two:
 *
 *   - Change a figure that is ALREADY there → it is treated as a typo being
 *     fixed. The same row is corrected; nothing new is added.
 *   - Fill in the NEXT empty column → it is treated as a real new increment.
 *
 * There is no third choice, no mode switch, no dialog asking which one was
 * meant — which cell was empty is the only thing that decides it, exactly
 * how it would work in an ordinary spreadsheet.
 */

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataGrid, GridCell } from "@/components/appraise/data-grid";
import { DateCell, MoneyCell } from "@/components/appraise/editable-cell";
import { EmptyState } from "@/components/appraise/states";
import { saveEmploymentHistoryGrid } from "@/lib/employment/history-grid-actions";
import type { HistoryGridRow } from "@/lib/employment/history-grid";
import { monthlyFromAnnual } from "@/lib/increment/calc";
import { byEmployeeCode } from "@/lib/utils/employee-code";
import { formatDate, formatInr } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

type SlotDraft = { effectiveFrom?: string; newCtc?: number };
type PersonDraft = { dateOfJoining?: string; joiningCtc?: number };

/* -- THE BARE FIGURE, at the owner's instruction — every other salary readout
      in the product says "₹15,000 a month" (`moneyMonthly`, money-input.tsx),
      spelling the unit out because it usually sits beside an annual figure
      that also needs telling apart. On a sheet this dense, with every column
      already headed "Joining salary" / "Amount" and every value in the same
      unit throughout, restating "a month" on every one of dozens of cells is
      the word repeated rather than the fact. -- */
function bareMonthly(annual: number | null): string {
  const monthly = monthlyFromAnnual(annual);
  return monthly === null ? "—" : formatInr(monthly);
}

function slotKey(profileId: string, index: number) {
  return `${profileId}#${index}`;
}

export function SalaryHistoryTab({ rows }: { rows: HistoryGridRow[] }) {
  const [search, setSearch] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [personDrafts, setPersonDrafts] = React.useState<Map<string, PersonDraft>>(new Map());
  const [slotDrafts, setSlotDrafts] = React.useState<Map<string, SlotDraft>>(new Map());
  const [saving, setSaving] = React.useState(false);
  const [result, setResult] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);

  // Always one column PAST whoever has the most, so there is always a place
  // to add the next increment without a separate "add a column" step.
  const maxIncrements = Math.max(0, ...rows.map((r) => r.increments.length)) + 1;

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q
      ? rows.filter(
          (r) => r.name.toLowerCase().includes(q) || (r.employeeCode ?? "").toLowerCase().includes(q),
        )
      : rows;
    // ORDERED BY EMPLOYEE ID, 01 · 02 · 03 — the SAME comparator Team review
    // and Settings › Users already sort by (lib/utils/employee-code.ts), so
    // this is the third screen showing the same people rather than a fourth
    // one that quietly orders them differently.
    return [...matched].sort(byEmployeeCode);
  }, [search, rows]);

  const setPersonField = React.useCallback(
    <K extends keyof PersonDraft>(profileId: string, key: K, value: PersonDraft[K]) => {
      setPersonDrafts((prev) => {
        const next = new Map(prev);
        next.set(profileId, { ...(next.get(profileId) ?? {}), [key]: value });
        return next;
      });
    },
    [],
  );

  const setSlotField = React.useCallback(
    <K extends keyof SlotDraft>(profileId: string, index: number, key: K, value: SlotDraft[K]) => {
      setSlotDrafts((prev) => {
        const next = new Map(prev);
        const k = slotKey(profileId, index);
        next.set(k, { ...(next.get(k) ?? {}), [key]: value });
        return next;
      });
    },
    [],
  );

  // Touched profiles, across ALL rows rather than just what search shows —
  // filtering hides rows, not the fact that they were edited.
  const changedProfiles = React.useMemo(() => {
    const ids = new Set(personDrafts.keys());
    for (const key of slotDrafts.keys()) ids.add(key.split("#")[0] ?? "");
    return ids;
  }, [personDrafts, slotDrafts]);

  /* -- A NEW slot (nothing exists there yet) is INCOMPLETE until both its
        date and its amount are filled. Checked here so Save can refuse it
        with a plain sentence, rather than silently dropping half of what
        somebody typed. -- */
  const incomplete = React.useMemo(() => {
    const problems: string[] = [];
    for (const row of rows) {
      for (let index = row.increments.length + 1; index <= maxIncrements; index += 1) {
        const draft = slotDrafts.get(slotKey(row.profileId, index));
        if (!draft) continue;
        const hasDate = Boolean(draft.effectiveFrom);
        const hasAmount = draft.newCtc !== undefined;
        if (hasDate !== hasAmount) {
          problems.push(`Increment ${index} for ${row.name} needs both a date and an amount.`);
        }
      }
    }
    return problems;
  }, [rows, slotDrafts, maxIncrements]);

  function leaveEditMode() {
    setEditing(false);
    setPersonDrafts(new Map());
    setSlotDrafts(new Map());
  }

  async function save() {
    if (incomplete.length > 0) return;

    const patches = rows
      .map((row) => {
        const person = personDrafts.get(row.profileId);
        const slots: Array<{ index: number; effectiveFrom: string; newCtc: number }> = [];

        for (let index = 1; index <= maxIncrements; index += 1) {
          const draft = slotDrafts.get(slotKey(row.profileId, index));
          if (!draft) continue;
          const existing = row.increments[index - 1];
          const effectiveFrom = draft.effectiveFrom ?? existing?.effectiveFrom;
          const newCtc = draft.newCtc ?? existing?.newCtc;
          if (effectiveFrom && newCtc !== undefined) slots.push({ index, effectiveFrom, newCtc });
        }

        if (!person && slots.length === 0) return null;
        return {
          profileId: row.profileId,
          ...(person?.dateOfJoining !== undefined ? { dateOfJoining: person.dateOfJoining } : {}),
          ...(person?.joiningCtc !== undefined ? { joiningCtc: person.joiningCtc } : {}),
          slots,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    if (patches.length === 0) return;

    setSaving(true);
    setResult(null);
    const outcome = await saveEmploymentHistoryGrid({ patches });
    setSaving(false);

    if (!outcome.ok) {
      setResult({ tone: "error", text: outcome.error.message });
      return;
    }

    const failed = outcome.data.rows.filter((r) => !r.ok);
    const parts: string[] = [];
    if (outcome.data.corrected > 0) {
      parts.push(`${outcome.data.corrected} figure${outcome.data.corrected === 1 ? "" : "s"} corrected`);
    }
    if (outcome.data.added > 0) {
      parts.push(`${outcome.data.added} new increment${outcome.data.added === 1 ? "" : "s"} added`);
    }
    setResult({
      tone: failed.length > 0 ? "error" : "ok",
      text:
        failed.length > 0
          ? `${outcome.data.updated} saved, ${failed.length} could not be: ${failed[0]?.error ?? ""}`
          : `${outcome.data.updated} ${outcome.data.updated === 1 ? "person" : "people"} updated${
              parts.length > 0 ? ` — ${parts.join(", ")}.` : "."
            }`,
    });
    if (failed.length === 0) leaveEditMode();
  }

  const columns = React.useMemo<ColumnDef<HistoryGridRow>[]>(() => {
    const cols: ColumnDef<HistoryGridRow>[] = [
      {
        accessorKey: "name",
        header: "Name",
        size: 200,
        meta: { frozen: true },
        cell: ({ row }) => <GridCell value={row.original.name} />,
      },
      {
        id: "dateOfJoining",
        header: "Joined",
        size: 135,
        cell: ({ row }) => {
          const p = row.original;
          const draft = personDrafts.get(p.profileId)?.dateOfJoining;
          return editing ? (
            <DateCell
              value={draft ?? p.dateOfJoining ?? ""}
              onChange={(v) => setPersonField(p.profileId, "dateOfJoining", v)}
              label={`Joining date for ${p.name}`}
              dirty={draft !== undefined}
            />
          ) : (
            <GridCell value={p.dateOfJoining ? formatDate(p.dateOfJoining) : "—"} className="tabular" />
          );
        },
      },
      {
        id: "joiningCtc",
        header: "Joining salary",
        size: 150,
        meta: { align: "right" },
        cell: ({ row }) => {
          const p = row.original;
          const draft = personDrafts.get(p.profileId)?.joiningCtc;
          return editing ? (
            <MoneyCell
              annual={draft ?? p.joiningCtc}
              onChangeAnnual={(v) => setPersonField(p.profileId, "joiningCtc", v ?? undefined)}
              label={`Joining salary for ${p.name}`}
              dirty={draft !== undefined}
            />
          ) : (
            <GridCell value={bareMonthly(p.joiningCtc)} className="tabular" />
          );
        },
      },
    ];

    for (let n = 1; n <= maxIncrements; n += 1) {
      // -- GROUPED, so "Increment 2" reads once as a heading over its own
      //    Date/Amount pair — restored after the first DataGrid version
      //    flattened it into "Inc. 2 · Date" / "Inc. 2 · Amount" per column,
      //    which lost exactly this partitioning and was reported. `meta.label`
      //    on each leaf keeps a phone card unambiguous — it has no group row
      //    to borrow "Increment 2" from, so the leaf carries its own full
      //    name there while staying "Date"/"Amount" on the desktop table.
      cols.push({
        id: `inc_${n}`,
        header: `Increment ${n}`,
        columns: [
          {
            id: `inc_${n}_date`,
            header: "Date",
            size: 130,
            meta: { label: `Increment ${n} date` },
            cell: ({ row }) => {
              const p = row.original;
              const existing = p.increments[n - 1];
              const draft = slotDrafts.get(slotKey(p.profileId, n));
              return editing ? (
                <DateCell
                  value={draft?.effectiveFrom ?? existing?.effectiveFrom ?? ""}
                  onChange={(v) => setSlotField(p.profileId, n, "effectiveFrom", v)}
                  label={`Increment ${n} date for ${p.name}`}
                  dirty={draft?.effectiveFrom !== undefined}
                />
              ) : (
                <GridCell value={existing ? formatDate(existing.effectiveFrom) : "—"} className="tabular" />
              );
            },
          },
          {
            id: `inc_${n}_amount`,
            header: "Amount",
            size: 150,
            // The trailing edge of each Increment block — asked for
            // directly, so the boundary between "Increment 1" and
            // "Increment 2" reads as a partition rather than the same
            // hairline every ordinary column pair shares.
            meta: { align: "right", label: `Increment ${n} amount`, partition: true },
            cell: ({ row }) => {
              const p = row.original;
              const existing = p.increments[n - 1];
              const draft = slotDrafts.get(slotKey(p.profileId, n));
              return editing ? (
                <MoneyCell
                  annual={draft?.newCtc ?? existing?.newCtc ?? null}
                  onChangeAnnual={(v) => setSlotField(p.profileId, n, "newCtc", v ?? undefined)}
                  label={`Increment ${n} amount for ${p.name}`}
                  dirty={draft?.newCtc !== undefined}
                />
              ) : (
                <GridCell value={existing ? bareMonthly(existing.newCtc) : "—"} className="tabular" />
              );
            },
          },
        ],
      });
    }

    return cols;
    // `editing`, the two draft maps and the two setters are load-bearing —
    // the same reasoning Users tab's own column memo carries (F25-6): leaving
    // any out would memoise a set of cells that read stale state for ever.
  }, [editing, personDrafts, slotDrafts, maxIncrements, setPersonField, setSlotField]);

  return (
    // Same shape as Team review and Users: `data-full-bleed` drops the
    // shell's 1180px cap and its gutters, and the wrapper carries no padding
    // of its own so the toolbar and the grid both run edge to edge — reported
    // as "not full screen" against an earlier version that used its own
    // margins instead of this convention.
    <div
      data-full-bleed
      className="flex h-[calc(100dvh-theme(spacing.topbar)-5rem-var(--bottom-nav-h))] min-h-[24rem] flex-col overflow-hidden border-t border-rule bg-surface"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule bg-surface-mute px-3 py-2">
        <div className="relative w-full sm:w-[280px]">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or employee code"
            aria-label="Search people"
            className="min-h-11 border-rule bg-surface pl-9"
          />
        </div>

        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          {editing ? (
            <>
              <Button variant="ghost" className="min-h-11" onClick={leaveEditMode} disabled={saving}>
                Cancel
              </Button>
              <Button
                className="min-h-11 flex-1 sm:flex-none"
                onClick={() => void save()}
                disabled={saving || incomplete.length > 0 || changedProfiles.size === 0}
              >
                {saving
                  ? "Saving…"
                  : changedProfiles.size === 0
                    ? "Nothing changed yet"
                    : `Save ${changedProfiles.size} ${changedProfiles.size === 1 ? "person" : "people"}`}
              </Button>
            </>
          ) : (
            <Button variant="outline" className="min-h-11 flex-1 sm:flex-none" onClick={() => setEditing(true)}>
              Edit the table
            </Button>
          )}
        </div>
      </div>

      {/* -- What edit mode is, said once, where somebody is standing when they
            enter it — the same placement and shape as Users tab's own
            explanation banner. -- */}
      {editing ? (
        <p className="rounded-control border border-primary/40 bg-primary/10 px-4 py-3 font-sans text-body-sm text-ink">
          <span className="font-medium">Change a number that is already there</span> to fix a typo —
          the same entry is corrected, nothing new is added.{" "}
          <span className="font-medium">Type into an empty Increment column</span> to record a real
          new rise. Figures are typed and shown per month; the exact yearly figure is stored
          automatically.
        </p>
      ) : null}

      {incomplete.length > 0 ? (
        <p className="flex items-start gap-2 rounded-control border border-warning/40 bg-warning-tint px-4 py-3 font-sans text-body-sm text-ink">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          {incomplete[0]}
        </p>
      ) : null}

      {result ? (
        <div
          role="status"
          className={cn(
            "rounded-control border px-4 py-3 font-sans text-body-sm",
            result.tone === "ok"
              ? "border-final/40 bg-final-tint text-final"
              : "border-critical/40 bg-critical-tint text-critical",
          )}
        >
          {result.text}
        </div>
      ) : null}

      <DataGrid
        data={filtered}
        columns={columns}
        storageKey="appraise.salary-history.column-widths"
        minWidth={Math.max(1100, 480 + maxIncrements * 280)}
        rowLabel={{ header: "Employee ID", value: (p) => p.employeeCode || "—" }}
        empty={
          <EmptyState
            title="Nobody matches that"
            body={rows.length === 0 ? "No active people yet." : "Try a different search."}
          />
        }
        status={
          <span className="tabular text-body-sm text-ink">
            {filtered.length} of {rows.length} {rows.length === 1 ? "person" : "people"}
          </span>
        }
      />
    </div>
  );
}

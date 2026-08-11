"use client";

/** Wizard step 3 — who is in the cycle, and who reviews them. P10 screen 2. */

import * as React from "react";
import { AlertTriangle, Mail, Phone, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SelectablePerson } from "@/lib/cycles/queries";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/date";

export type PersonState = {
  included: boolean;
  leadId: string | null;
};

/**
 * Whether one person can be reached at all.
 *
 * Greyed when absent rather than hidden: §10 sends the invite over WhatsApp
 * and/or email, so "no phone" is a fact worth seeing before launch, not an
 * absence to tidy away.
 */
function ContactIcons({
  who,
  hasEmail,
  hasPhone,
}: {
  who: string;
  hasEmail: boolean;
  hasPhone: boolean;
}) {
  return (
    <span className="flex items-center gap-1">
      <Mail
        aria-label={`${who} ${hasEmail ? "has" : "has no"} email address`}
        className={cn("size-4", hasEmail ? "text-ink-muted" : "text-ink-faint/40")}
      />
      <Phone
        aria-label={`${who} ${hasPhone ? "has" : "has no"} phone number`}
        className={cn("size-4", hasPhone ? "text-ink-muted" : "text-ink-faint/40")}
      />
    </span>
  );
}

/** How many days ahead still counts as "coming up". A month, near enough. */
const DUE_WINDOW_DAYS = 31;

/**
 * Is their next increment due now, or within the window?
 *
 * Anything in the PAST counts too — somebody whose increment was due last month
 * and has not had it is the most important person on this list, and a filter
 * that only looked forward would hide exactly them.
 */
export function isIncrementDue(nextOn: string | null, today = new Date()): boolean {
  if (!nextOn) return false;
  const due = new Date(`${nextOn}T00:00:00`);
  if (Number.isNaN(due.getTime())) return false;
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  return days <= DUE_WINDOW_DAYS;
}

export function StepPeople({
  people,
  state,
  onChange,
  preset = "all",
}: {
  people: SelectablePerson[];
  state: Record<string, PersonState>;
  onChange: (next: Record<string, PersonState>) => void;
  /**
   * Which list step 1 asked for. "due" opens filtered to people whose next
   * increment has arrived or is within a month; "all" opens unfiltered.
   *
   * A DEFAULT, not a lock — the toggle below stays live, because an increment
   * paid early is a real thing and a filter HR cannot clear would hide it.
   */
  preset?: "due" | "all";
}) {
  const byId = React.useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const mdCandidates = React.useMemo(() => people.filter((p) => p.isMd), [people]);
  const mdIds = React.useMemo(() => new Set(mdCandidates.map((p) => p.id)), [mdCandidates]);

  /* -- WHO CAN BE APPRAISED.
        The MD is not, at the owner's instruction, and the reason is structural
        rather than a preference: an evaluation needs an evaluatee and a lead,
        and the MD is the top of the chain this very screen offers as the lead
        of last resort. They would have either nobody to rate them or somebody
        whose pay they approve.

        They stay in `people`, because `mdCandidates` above is what puts them in
        the HOD picker for a department head with nobody above them (PR-8). Only
        the ROSTER loses them. `setCycleParticipants` refuses them again on the
        server — this filter is a courtesy, not the guarantee. -- */
  const appraisable = React.useMemo(() => people.filter((p) => !p.isMd), [people]);
  const [search, setSearch] = React.useState("");
  const [department, setDepartment] = React.useState<string>("all");
  const [dueOnly, setDueOnly] = React.useState(preset === "due");

  const departments = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const p of appraisable) if (p.departmentId) map.set(p.departmentId, p.departmentName ?? "Unnamed");
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [appraisable]);

  const visible = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return appraisable.filter((p) => {
      if (department !== "all" && p.departmentId !== department) return false;
      if (dueOnly && !isIncrementDue(p.nextIncrementOn)) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        (p.employeeCode ?? "").toLowerCase().includes(needle) ||
        (p.designation ?? "").toLowerCase().includes(needle)
      );
    });
  }, [appraisable, search, department, dueOnly]);

  const dueCount = React.useMemo(
    () => appraisable.filter((p) => isIncrementDue(p.nextIncrementOn)).length,
    [appraisable],
  );

  const includedCount = appraisable.filter((p) => state[p.id]?.included).length;
  const leaderless = appraisable.filter((p) => state[p.id]?.included && !state[p.id]?.leadId);

  const patch = (id: string, next: Partial<PersonState>) => {
    const current = state[id] ?? { included: true, leadId: null };
    onChange({ ...state, [id]: { ...current, ...next } });
  };

  /* -- How many of the rows ON SCREEN are ticked.
        Drives the header checkbox's three states, so it reports the filtered
        list rather than the whole roster — otherwise a search matching two
        included people would show an empty box while both were in. -- */
  const visibleIncluded = visible.filter(
    (p) => (state[p.id]?.included ?? true) === true,
  ).length;

  const setAllVisible = (included: boolean) => {
    const next = { ...state };
    for (const p of visible) {
      next[p.id] = { ...(next[p.id] ?? { included: true, leadId: p.reportsTo }), included };
    }
    onChange(next);
  };

  return (
    <div className="space-y-4">
      {/* -- Toolbar -- */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Label htmlFor="people-search">Search</Label>
          <div className="relative mt-1.5">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            />
            <Input
              id="people-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, employee code or designation"
              className="pl-9"
            />
          </div>
        </div>

        <div className="min-w-44">
          <Label htmlFor="people-department">Department</Label>
          <select
            id="people-department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="mt-1.5 h-11 w-full rounded-input border border-rule bg-surface px-3 text-body text-ink"
          >
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        {/* The preset from step 1, as a live control. Pressed, the list is the
            people an increment is actually owed to; released, it is everybody.
            The count is on the button so HR knows what they are switching to
            before they press it. */}
        <Button
          type="button"
          variant={dueOnly ? "default" : "outline"}
          className="min-h-11"
          aria-pressed={dueOnly}
          onClick={() => setDueOnly((v) => !v)}
        >
          Increment due
          <span className="tabular ml-1.5 opacity-80">{dueCount}</span>
        </Button>

        <Button type="button" variant="outline" className="min-h-11" onClick={() => setAllVisible(true)}>
          {department === "all" && !dueOnly ? "Select all" : "Select all shown"}
        </Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => setAllVisible(false)}>
          Exclude all
        </Button>
      </div>

      {dueOnly ? (
        <p className="flex flex-wrap items-center gap-x-2 rounded-control border border-rule bg-surface-mute px-3 py-2 text-body-sm text-ink-muted">
          <span>
            Showing people whose next increment has arrived or falls within the next month.
            Somebody already overdue is included — they are the ones most worth catching.
          </span>
        </p>
      ) : null}

      {/* Item 8. Said once, above the table, because it explains what the HOD
          column actually means now — they are a rater, not an approver. */}
      <p className="rounded-card bg-accent px-4 py-3 text-body-sm text-accent-foreground">
        The form goes to both people at the same time. Neither can see the other&rsquo;s answers.
      </p>

      {/* `appraisable`, not `people` — with the MD in the denominator the line
          read "1 of 4" on a roster of three, which is a count nobody can make
          add up. */}
      <p className="tabular text-body-sm text-ink-muted">
        {includedCount} of {appraisable.length} people included
        {visible.length !== appraisable.length ? ` · showing ${visible.length}` : ""}
      </p>

      {/* -- Table -- */}
      {/*
        Gridlines and a muted header band, so this reads as the same kind of
        object as the question bank, the people list and the cycle board. It was
        a bare shadcn table with horizontal rules only — nine columns with
        nothing separating them, which is what made it look loose.

        Applied here rather than on the shared `Table` primitive: §3 keeps the
        shadcn components unmodified (P0-6), and this is one screen's density
        rather than a change to every table in the product.
      */}
      <div className="overflow-x-auto rounded-card border border-rule [&_td]:border-r [&_td]:border-rule [&_td]:py-2 [&_td:last-child]:border-r-0 [&_th]:border-r [&_th]:border-rule [&_th]:bg-surface-mute [&_th]:py-2 [&_th:last-child]:border-r-0">
        <Table>
          <TableHeader>
            <TableRow>
              {/* -- The header checkbox.
                    Everybody starts included, which is right for an annual
                    cycle and exactly wrong for sending to two people — that
                    meant unticking the whole roster by hand, one row at a time.
                    The buttons above could already do it, but a control that
                    clears a table belongs ON the table, at the top of the
                    column it clears.

                    Tri-state, so it also REPORTS. A bare tick cannot say "some
                    of these are in", and on a filtered list that is the usual
                    case — it would read as "none included" while three were.

                    It acts on what is SHOWN, matching the buttons: a filter is
                    how HR narrows to the people they mean, and a control that
                    reached past it would clear rows they cannot see. -- */}
              <TableHead className="w-24">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={
                      visibleIncluded === 0
                        ? false
                        : visibleIncluded === visible.length
                          ? true
                          : "indeterminate"
                    }
                    disabled={visible.length === 0}
                    onCheckedChange={() => setAllVisible(visibleIncluded !== visible.length)}
                    aria-label={
                      visibleIncluded === visible.length
                        ? `Exclude all ${visible.length} people shown`
                        : `Include all ${visible.length} people shown`
                    }
                  />
                  <span>Include</span>
                </div>
              </TableHead>
              <TableHead className="min-w-[9rem]">Name</TableHead>
              <TableHead className="whitespace-nowrap">Department</TableHead>
              <TableHead className="whitespace-nowrap">Designation</TableHead>
              {/* The three dates HR decides on. A name and a department do not
                  answer "should this person be in it"; when they were last
                  appraised, last paid more, and when the next rise is due, do.
                  Dates only — §5 keeps the figures off this screen. */}
              <TableHead className="whitespace-nowrap">Last evaluated</TableHead>
              <TableHead className="whitespace-nowrap">Last increment</TableHead>
              <TableHead className="whitespace-nowrap">Next increment</TableHead>
              <TableHead className="min-w-[11rem]">Manager who will rate them</TableHead>
              {/*
                One column, not two. These were "Employee" and "HOD", each
                holding nothing but a mail and a phone glyph — two headings
                wider than the content under them, spent on the same question
                asked about two people. Reachability is one fact per row now:
                the person's own icons, then the HOD's, with a divider between.
              */}
              <TableHead className="whitespace-nowrap">Reachable</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {visible.map((person) => {
              const row = state[person.id] ?? { included: true, leadId: person.reportsTo };
              const missingLead = row.included && !row.leadId;
              // Item 10. Under blind rating this person would fill both sides
              // and see both, which breaks §5's invariant — so it blocks rather
              // than warning, and the row says what to do about it.
              const selfRated = row.included && row.leadId === person.id;
              const blocked = missingLead || selfRated;

              return (
                <TableRow
                  key={person.id}
                  // The rose left bar marks a row that will block launch. It is
                  // paired with the words "Assign a lead" rather than standing
                  // alone: colour is never the only signal (§13.8).
                  className={cn(blocked && "border-l-2 border-l-critical bg-critical-tint/30")}
                >
                  <TableCell>
                    <Checkbox
                      checked={row.included}
                      onCheckedChange={(checked) => patch(person.id, { included: checked === true })}
                      aria-label={`Include ${person.name}`}
                    />
                  </TableCell>

                  <TableCell>
                    <p className="font-medium text-ink">{person.name}</p>
                    <p className="tabular text-body-sm text-ink-muted">{person.employeeCode ?? "—"}</p>
                  </TableCell>

                  <TableCell className="text-body-sm text-ink-muted">
                    {person.departmentName ?? "—"}
                  </TableCell>

                  <TableCell className="text-body-sm text-ink-muted">
                    {person.designation ?? "—"}
                  </TableCell>

                  <TableCell className="tabular whitespace-nowrap text-body-sm text-ink-muted">
                    {person.lastEvaluationOn ? formatDate(person.lastEvaluationOn) : "Never"}
                  </TableCell>

                  <TableCell className="tabular whitespace-nowrap text-body-sm text-ink-muted">
                    {person.lastIncrementOn ? formatDate(person.lastIncrementOn) : "—"}
                  </TableCell>

                  <TableCell className="tabular whitespace-nowrap text-body-sm">
                    {person.nextIncrementOn ? (
                      <span
                        className={cn(
                          // Due or overdue is the one thing on this row that
                          // should catch the eye — paired with the word "due"
                          // so it is never colour alone (§13.8).
                          isIncrementDue(person.nextIncrementOn)
                            ? "font-medium text-critical"
                            : "text-ink-muted",
                        )}
                      >
                        {formatDate(person.nextIncrementOn)}
                        {isIncrementDue(person.nextIncrementOn) ? " · due" : ""}
                      </span>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </TableCell>

                  <TableCell>
                    <select
                      value={row.leadId ?? ""}
                      onChange={(e) => patch(person.id, { leadId: e.target.value || null })}
                      disabled={!row.included}
                      aria-label={`Manager for ${person.name}`}
                      className="h-11 w-full rounded-input border border-rule bg-surface px-2 text-body-sm text-ink disabled:opacity-50"
                    >
                      <option value="">No Manager</option>
                      {/* The MD first, as the default alternative for somebody
                          with nobody above them — a department head still needs
                          a rater who is not themselves. */}
                      {mdCandidates.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name} (MD)
                        </option>
                      ))}
                      {people
                        // Themselves is no longer offered at all: an option that
                        // always blocks the launch is not a choice.
                        .filter((c) => c.id !== person.id && !mdIds.has(c.id))
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                          </option>
                        ))}
                    </select>
                    {missingLead ? (
                      <p className="mt-1 text-body-sm font-medium text-critical">Assign a Manager</p>
                    ) : selfRated ? (
                      <p className="mt-1 text-body-sm font-medium text-critical">
                        Needs a different rater — this person cannot rate themselves
                      </p>
                    ) : null}
                  </TableCell>

                  {/* Both sides' reachability in one cell: the person, a
                      divider, then their HOD. Item 9 — a HOD with no contact
                      details BLOCKS the launch rather than warning, because
                      they cannot receive their half of the form. */}
                  <TableCell>
                    {(() => {
                      const lead = row.leadId ? byId.get(row.leadId) : undefined;
                      const leadUnreachable = lead ? !lead.hasEmail && !lead.hasPhone : false;

                      return (
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <ContactIcons
                            who={person.name}
                            hasEmail={person.hasEmail}
                            hasPhone={person.hasPhone}
                          />
                          <span aria-hidden className="h-4 w-px bg-rule" />
                          {lead ? (
                            <ContactIcons
                              who={lead.name}
                              hasEmail={lead.hasEmail}
                              hasPhone={lead.hasPhone}
                            />
                          ) : (
                            <span className="text-body-sm text-ink-muted">—</span>
                          )}
                          {leadUnreachable ? (
                            <span className="text-[11px] font-medium text-critical">
                              Manager unreachable
                            </span>
                          ) : null}
                        </div>
                      );
                    })()}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {visible.length === 0 ? (
        <p className="py-8 text-center text-body-sm text-ink-muted">Nobody matches that search.</p>
      ) : null}

      {/* -- Sticky footer: the count of rows that block launch. -- */}
      {leaderless.length > 0 ? (
        <div className="sticky bottom-0 flex items-center gap-3 rounded-card border border-critical/40 bg-critical-tint px-4 py-3">
          <AlertTriangle aria-hidden className="size-4 shrink-0 text-critical" />
          <p className="text-body-sm text-ink">
            <span className="tabular font-medium">{leaderless.length}</span>{" "}
            {leaderless.length === 1 ? "person has" : "people have"} no lead. The cycle cannot launch
            until every included person has one.
          </p>
        </div>
      ) : null}
    </div>
  );
}

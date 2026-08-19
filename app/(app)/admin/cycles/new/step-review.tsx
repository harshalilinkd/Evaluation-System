"use client";

/** Wizard step 4 — the readiness report. P10 screen 2. */

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Check, Info } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { useSectionLabel } from "@/components/appraise/section-labels";
import type { SelectablePerson } from "@/lib/cycles/queries";
import type { ReadinessReport } from "@/lib/cycles/schema";
import type { InviteRecipients } from "@/lib/cycles/dispatch-launch";
import { plural } from "@/lib/cycles/schema";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/date";
import type { PersonState } from "@/app/(app)/admin/cycles/new/step-people";

/* -- Three, not a pair of checkboxes.
      Checkboxes allow "neither", which reads as a mistake rather than a
      choice, and they make the common case — both — two clicks. Each option
      says what actually happens rather than naming a role, because "HOD" does
      not tell somebody what lands on a phone. -- */
const RECIPIENT_CHOICES: Array<{
  id: string;
  label: string;
  detail: string;
  value: InviteRecipients;
}> = [
  { id: "both", label: "Both", detail: "The employee and their {M}", value: ["SELF", "LEAD"] },
  { id: "self", label: "Employee only", detail: "The {M} can be sent theirs later", value: ["SELF"] },
  { id: "lead", label: "{M} only", detail: "The employee can be sent theirs later", value: ["LEAD"] },
];

/**
 * "Manager" or "managers", following who is actually in this cycle.
 *
 * The CHOICE does not change: a second reviewer is a manager, and one LEAD
 * selection sends to both of them — a separate toggle would let a cycle go out
 * to one of a designer's two managers and not the other, which is not a
 * decision anybody would mean to take. Only the word follows the roster, so the
 * screen stops saying "their Manager" about somebody who has two.
 */
function managerWord(plural: boolean): string {
  return plural ? "Managers" : "Manager";
}

export function StepReview({
  people,
  state,
  jobSkillCounts,
  report,
  acknowledged,
  onAcknowledge,
  recipients,
  onRecipientsChange,
}: {
  people: SelectablePerson[];
  state: Record<string, PersonState>;
  /** Active Job Specific Skills questions per department id. */
  jobSkillCounts: Record<string, number>;
  report: ReadinessReport | null;
  acknowledged: Record<string, boolean>;
  onAcknowledge: (code: string, value: boolean) => void;
  recipients: InviteRecipients | null;
  onRecipientsChange: (next: InviteRecipients) => void;
}) {
  // HR's own name for it, not the shipped default (P25).
  const departmentSection = useSectionLabel("DEPARTMENT_SPECIFIC");
  const included = people.filter((p) => state[p.id]?.included);
  /** True when anybody in this cycle is rated by two managers (0083). */
  const anyTwoManagers = included.some((p) => Boolean(p.coReviewerName));
  const excluded = people.filter((p) => !state[p.id]?.included);

  /* -- Card 1: participants per department. -- */
  const byDepartment = new Map<string, { name: string; count: number }>();
  for (const p of included) {
    const key = p.departmentId ?? "none";
    const entry = byDepartment.get(key) ?? { name: p.departmentName ?? "No department", count: 0 };
    entry.count += 1;
    byDepartment.set(key, entry);
  }
  const departmentRows = [...byDepartment.entries()].sort((a, b) => b[1].count - a[1].count);
  const maxCount = Math.max(1, ...departmentRows.map(([, v]) => v.count));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* -- Participants by department -- */}
        <section className="card-surface p-5">
          <h3 className="text-display-sm text-ink">People</h3>
          <p className="tabular mt-1 text-body-sm text-ink-muted">
            {plural(included.length, "participant")}
            {/* The excluded COUNT keeps its place; the twenty-seven names do
                not. "27 left out" is worth checking before a launch; reading
                them back one per line was not. */}
            {excluded.length > 0 ? ` · ${excluded.length} left out` : ""}
          </p>

          <ul className="mt-4 space-y-3">
            {departmentRows.length === 0 ? (
              <li className="text-body-sm text-ink-muted">Nobody included yet.</li>
            ) : (
              departmentRows.map(([id, row]) => (
                <li key={id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-body-sm text-ink">{row.name}</span>
                    <span className="tabular text-body-sm text-ink-muted">{row.count}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-pill bg-surface-mute">
                    <span
                      className="block h-full rounded-pill bg-primary"
                      style={{ width: `${(row.count / maxCount) * 100}%` }}
                    />
                  </div>
                </li>
              ))
            )}
          </ul>
        </section>

        {/* -- Job Specific Skills readiness -- */}
        <section className="card-surface p-5">
          {/* Sourced from never retyped: labels.ts is the single
              source of section names (§0.2), and P8-PATCH's test fails the build
              for any component that restates one. */}
          <h3 className="text-display-sm text-ink">{departmentSection}</h3>
          <p className="mt-1 text-body-sm text-ink-muted">
            Questions mapped per department. This is the only section that varies.
          </p>

          <ul className="mt-4 space-y-2">
            {departmentRows.filter(([id]) => id !== "none").length === 0 ? (
              <li className="text-body-sm text-ink-muted">No departments represented yet.</li>
            ) : (
              departmentRows
                .filter(([id]) => id !== "none")
                .map(([id, row]) => {
                  const count = jobSkillCounts[id] ?? 0;
                  const empty = count === 0;
                  return (
                    <li
                      key={id}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-control px-3 py-2",
                        empty ? "bg-critical-tint" : "bg-surface-mute",
                      )}
                    >
                      <span className="truncate text-body-sm text-ink">{row.name}</span>
                      <span className="flex items-center gap-3">
                        <span
                          className={cn(
                            "tabular text-body-sm font-medium",
                            empty ? "text-critical" : "text-ink",
                          )}
                        >
                          {count}
                        </span>
                        {empty ? (
                          <Link
                            href={`/admin/departments/${id}`}
                            className="inline-flex items-center gap-1 text-body-sm font-medium text-critical underline underline-offset-2"
                          >
                            Fix
                            <ArrowUpRight className="size-3" aria-hidden />
                          </Link>
                        ) : null}
                      </span>
                    </li>
                  );
                })
            )}
          </ul>
        </section>

        {/* -- WHO IS IN IT, at the owner's instruction, replacing "Not
              included".
              That card listed twenty-seven people against one repeated phrase —
              "Unticked by you" — which is HR reading back their own decision
              twenty-seven times, and it crowded out the one list this step is
              for. Review means checking who WILL be appraised.

              The count of excluded people survives as a line under the
              participants card: it is worth knowing that twenty-seven were left
              out, and worth nothing to name them. -- */}
        <section className="card-surface p-5">
          <h3 className="text-display-sm text-ink">Who is in it</h3>
          <p className="tabular mt-1 text-body-sm text-ink-muted">
            {plural(included.length, "person")} · about to be appraised
          </p>

          <ul className="mt-4 space-y-2.5">
            {included.length === 0 ? (
              <li className="text-body-sm text-ink-muted">Nobody is included yet.</li>
            ) : (
              included.map((p) => (
                <li key={p.id} className="border-b border-rule pb-2.5 last:border-b-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-body-sm font-medium text-ink">{p.name}</span>
                    {/* §5: a DATE, never a figure. The amount is HR-and-MD-only
                        and does not belong on a launch screen at all. */}
                    <span className="tabular shrink-0 text-body-sm text-ink-muted">
                      {p.lastIncrementOn ? formatDate(p.lastIncrementOn) : "No rise on record"}
                    </span>
                  </div>
                  <p className="truncate text-body-sm text-ink-muted">
                    {[p.designation, p.departmentName].filter(Boolean).join(" · ") || "—"}
                  </p>
                  {/* -- A SECOND manager changes what this launch DOES: three
                         forms open instead of two, and the record does not reach
                         HR until all three are in. Setting one in Settings and
                         seeing no trace of it on the screen that launches the
                         cycle reads as the setting not having taken — which is
                         exactly how it was reported. -- */}
                  {p.coReviewerName ? (
                    <p className="truncate text-body-sm text-ink-muted">
                      Rated by two: their manager and{" "}
                      <span className="text-ink">{p.coReviewerName}</span>
                    </p>
                  ) : null}
                </li>
              ))
            )}
          </ul>

          {included.length > 0 ? (
            <p className="mt-3 text-body-sm text-ink-faint">
              Last increment shown on the right. Go back to People to add or remove somebody.
              {included.some((p) => p.coReviewerName)
                ? " Anybody rated by two managers gets a third form, and their appraisal reaches you once all three are in."
                : ""}
            </p>
          ) : null}
        </section>
      </div>

      {/* -- The readiness report -- */}
      {report === null ? (
        <p className="text-body-sm text-ink-muted">Checking readiness…</p>
      ) : (
        <div className="space-y-4">
          {report.blocking.length > 0 ? (
            <section className="rounded-card border border-critical/40 bg-critical-tint p-5">
              <h3 className="flex items-center gap-2 text-display-sm text-ink">
                <AlertTriangle aria-hidden className="size-4 text-critical" />
                {plural(report.blocking.length, "issue")} to fix before launching
              </h3>

              <ul className="mt-4 space-y-4">
                {report.blocking.map((issue) => (
                  <li key={issue.code + issue.message}>
                    <p className="text-body text-ink">{issue.message}</p>
                    {issue.subjects.length > 0 ? (
                      <p className="mt-1 text-body-sm text-ink-muted">
                        {issue.subjects.slice(0, 6).join(", ")}
                        {issue.subjects.length > 6
                          ? ` and ${plural(issue.subjects.length - 6, "other")}`
                          : ""}
                      </p>
                    ) : null}
                    {issue.href ? (
                      <Link
                        href={issue.href}
                        className="mt-1 inline-flex items-center gap-1 text-body-sm font-medium text-critical underline underline-offset-2"
                      >
                        {issue.hrefLabel ?? "Fix this"}
                        <ArrowUpRight className="size-3" aria-hidden />
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="flex items-center gap-3 rounded-card border border-success/40 bg-success-tint p-5">
              <Check aria-hidden className="size-4 shrink-0 text-success" />
              <p className="text-body text-ink">
                {/* `plural`, not a bare count. "1 people are ready" on the
                    screen that gates a launch reads as a number the app has
                    not looked at. */}
                Nothing is blocking this launch.{" "}
                <span className="tabular">{plural(report.participantCount, "person")}</span>{" "}
                {report.participantCount === 1 ? "is" : "are"} ready.
              </p>
            </section>
          )}

          {/* -- Who gets told. --
                Launch does two things at once — it opens the forms and it
                messages people — and only the first is reversible. So the
                second is asked about explicitly, here, rather than happening
                as a consequence of pressing a button labelled "Launch".

                No default. A pre-selected "both" is a decision the app made
                and HR is presumed to have agreed with, and this one puts a
                WhatsApp on every participant's phone. Launch stays disabled
                until somebody chooses.

                Both TOKENS are always minted (PR-5, PR-7) — the HOD needs one
                to open their form whenever they get to it. This is only about
                who is told now, so nothing here can lock anybody out. -- */}
          <section className="card-surface p-5">
            <h3 className="text-display-sm text-ink">Who gets the link now?</h3>
            <p className="mt-1 text-body-sm text-ink-muted">
              Both forms open either way. This is only about who is messaged.
            </p>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {RECIPIENT_CHOICES.map((choice) => {
                const chosen =
                  recipients !== null &&
                  recipients.length === choice.value.length &&
                  choice.value.every((v) => recipients.includes(v));
                return (
                  <button
                    key={choice.id}
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => onRecipientsChange([...choice.value])}
                    className={cn(
                      "rounded-card border p-4 text-left transition-colors min-h-11",
                      chosen
                        ? "border-primary bg-primary/10"
                        : "border-rule bg-surface hover:bg-surface-mute",
                    )}
                  >
                    <span
                      className={cn(
                        "block text-body font-medium",
                        chosen ? "text-primary" : "text-ink",
                      )}
                    >
                      {choice.label.replace("{M}", managerWord(anyTwoManagers))}
                    </span>
                    <span className="mt-0.5 block text-body-sm text-ink-muted">
                      {choice.detail.replace("{M}", managerWord(anyTwoManagers))}
                    </span>
                  </button>
                );
              })}
            </div>

            {recipients === null ? (
              <p className="mt-3 text-body-sm text-ink-muted">
                Pick one to enable Launch.
              </p>
            ) : null}
          </section>

          {report.warnings.length > 0 ? (
            <section className="card-surface p-5">
              <h3 className="flex items-center gap-2 text-display-sm text-ink">
                <Info aria-hidden className="size-4 text-ink-muted" />
                Worth checking
              </h3>
              <p className="mt-1 text-body-sm text-ink-muted">
                These do not stop the launch. Tick each one to say it is deliberate.
              </p>

              <ul className="mt-4 space-y-4">
                {report.warnings.map((warning) => (
                  <li key={warning.code} className="flex items-start gap-3">
                    <Checkbox
                      id={`ack-${warning.code}`}
                      checked={acknowledged[warning.code] === true}
                      onCheckedChange={(checked) => onAcknowledge(warning.code, checked === true)}
                      className="mt-1"
                    />
                    <div className="min-w-0">
                      <label htmlFor={`ack-${warning.code}`} className="text-body text-ink">
                        {warning.message}
                      </label>
                      {warning.subjects.length > 0 ? (
                        <p className="mt-1 text-body-sm text-ink-muted">
                          {warning.subjects.slice(0, 6).join(", ")}
                          {warning.subjects.length > 6
                            ? ` and ${plural(warning.subjects.length - 6, "other")}`
                            : ""}
                        </p>
                      ) : null}
                      {warning.href ? (
                        <Link
                          href={warning.href}
                          className="mt-1 inline-flex items-center gap-1 text-body-sm text-ink-muted underline underline-offset-2"
                        >
                          {warning.hrefLabel ?? "Review"}
                          <ArrowUpRight className="size-3" aria-hidden />
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

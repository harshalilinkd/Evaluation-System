"use client";

/** Wizard step 4 — the readiness report. P10 screen 2. */

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Check, Info } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import type { SelectablePerson } from "@/lib/cycles/queries";
import type { ReadinessReport } from "@/lib/cycles/schema";
import { plural } from "@/lib/cycles/schema";
import { SECTION_LABELS } from "@/lib/forms/labels";
import { cn } from "@/lib/utils";
import type { PersonState } from "@/app/(app)/admin/cycles/new/step-people";

export function StepReview({
  people,
  state,
  jobSkillCounts,
  report,
  acknowledged,
  onAcknowledge,
}: {
  people: SelectablePerson[];
  state: Record<string, PersonState>;
  /** Active Job Specific Skills questions per department id. */
  jobSkillCounts: Record<string, number>;
  report: ReadinessReport | null;
  acknowledged: Record<string, boolean>;
  onAcknowledge: (code: string, value: boolean) => void;
}) {
  const included = people.filter((p) => state[p.id]?.included);
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
          </p>

          <ul className="mt-4 space-y-3">
            {departmentRows.length === 0 ? (
              <li className="text-body-sm text-ink-faint">Nobody included yet.</li>
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
          {/* Sourced from SECTION_LABELS, never retyped: labels.ts is the single
              source of section names (§0.2), and P8-PATCH's test fails the build
              for any component that restates one. */}
          <h3 className="text-display-sm text-ink">{SECTION_LABELS.DEPARTMENT_SPECIFIC}</h3>
          <p className="mt-1 text-body-sm text-ink-muted">
            Questions mapped per department. This is the only section that varies.
          </p>

          <ul className="mt-4 space-y-2">
            {departmentRows.filter(([id]) => id !== "none").length === 0 ? (
              <li className="text-body-sm text-ink-faint">No departments represented yet.</li>
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

        {/* -- Excluded, with the reason -- */}
        <section className="card-surface p-5">
          <h3 className="text-display-sm text-ink">Not included</h3>
          <p className="tabular mt-1 text-body-sm text-ink-muted">{plural(excluded.length, "person")}</p>

          <ul className="mt-4 space-y-2">
            {excluded.length === 0 ? (
              <li className="text-body-sm text-ink-faint">Everyone is in.</li>
            ) : (
              excluded.slice(0, 12).map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-body-sm text-ink">{p.name}</span>
                  {/* The only reason available before launch is HR's own choice.
                      Post-launch withdrawals carry a typed reason instead. */}
                  <span className="shrink-0 text-body-sm text-ink-faint">Unticked by you</span>
                </li>
              ))
            )}
            {excluded.length > 12 ? (
              <li className="text-body-sm text-ink-faint">
                and {plural(excluded.length - 12, "more")}.
              </li>
            ) : null}
          </ul>
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

"use client";

/** The cycle's activity log. Read-only — audit_log has no write path at all. */

import * as React from "react";
import { History, Search } from "lucide-react";

import { EmptyState } from "@/components/appraise/states";
import { Input } from "@/components/ui/input";
import type { ActivityEntry } from "@/lib/cycles/activity";
import { formatDate, formatTime } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

/** DD-MM-YYYY, Asia/Kolkata (§0.10). Grouping by day is what makes a long log readable. */
function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Everything that has happened in this cycle, with who and when.
 *
 * §12 has required an audit row for every status change since P4 and nothing
 * displayed one. This is the reader.
 *
 * Grouped by DAY rather than shown as a flat list: a cycle produces dozens of
 * entries and the question people actually ask is "what happened on Tuesday",
 * not "what was the ninetieth event".
 */
export function ActivityPanel({ entries }: { entries: ActivityEntry[] }) {
  const [search, setSearch] = React.useState("");

  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((e) =>
      `${e.sentence} ${e.reason ?? ""}`.toLowerCase().includes(needle),
    );
  }, [entries, search]);

  const days = React.useMemo(() => {
    const map = new Map<string, ActivityEntry[]>();
    for (const entry of filtered) {
      const key = dayKey(entry.at);
      map.set(key, [...(map.get(key) ?? []), entry]);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3">
        <div className="flex items-center gap-2">
          <History aria-hidden className="size-4 text-ink-muted" />
          <h2 className="font-sans text-body font-semibold text-ink">Activity</h2>
          <span className="tabular text-body-sm text-ink-muted">
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </span>
        </div>

        <div className="relative min-w-0 flex-1 sm:w-[260px] sm:flex-none">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by person or event"
            aria-label="Search the activity log"
            className="min-h-11 border-rule bg-surface pl-9"
          />
        </div>
      </header>

      {days.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title={entries.length === 0 ? "Nothing has happened yet" : "Nothing matches that"}
            body={
              entries.length === 0
                ? "Every submission, return, approval and link goes on this list as it happens."
                : "Try a different name or event."
            }
          />
        </div>
      ) : (
        <div className="max-h-[32rem] overflow-y-auto">
          {days.map(([day, rows]) => (
            <div key={day}>
              {/* Sticky, so the date stays visible while its own entries scroll
                  under it — the same device the report queue uses. */}
              <h3 className="sticky top-0 z-10 border-b border-rule bg-surface-mute px-5 py-1.5 font-sans text-body-sm font-semibold text-ink">
                {formatDate(day)}
              </h3>

              <ol className="divide-y divide-rule">
                {rows.map((entry) => (
                  <li key={entry.id} className="flex gap-4 px-5 py-3">
                    {/* §0.10: 24-hour, Asia/Kolkata. Tabular so a column of
                        times lines up at the colon. */}
                    <time
                      dateTime={entry.at}
                      className="tabular w-12 shrink-0 pt-0.5 text-body-sm text-ink-muted"
                    >
                      {formatTime(entry.at)}
                    </time>

                    <div className="min-w-0 flex-1 space-y-1">
                      {/* ONE SENTENCE. It used to be a label, a subject, an
                          actor and a raw status pair rendered as four
                          fragments — "Employee submitted their self-evaluation
                          · Test Employee / Test Employee · OPEN → OPEN". Every
                          piece was true and the line was not readable: the name
                          appeared twice, and the statuses were enum values,
                          which §13.5 keeps off every user-facing surface. */}
                      <p className="font-sans text-body text-ink">
                        {entry.sentence}
                        {/* -- A run of identical events, folded. --
                              Setting a cycle up autosaves, and each save that
                              genuinely changed something is a real audit row
                              that can never be deleted (§12: no DELETE policy
                              exists for anyone). Twelve lines saying the same
                              thing is not a history — it buries the launches
                              and submissions somebody opened this panel to
                              find. One line, with how many times and over what
                              span, says everything the twelve said.

                              The rows are all still in `audit_log`. This is
                              what is SHOWN. -- */}
                        {entry.repeated > 1 ? (
                          <span className="ml-2 whitespace-nowrap rounded-pill bg-surface-mute px-2 py-0.5 text-body-sm text-ink-muted">
                            ×{entry.repeated}
                            {entry.firstAt !== entry.at
                              ? ` · ${formatTime(entry.firstAt)}–${formatTime(entry.at)}`
                              : null}
                          </span>
                        ) : null}
                      </p>

                      {/* §8 requires a reason on every return, and it is shown
                          WORD FOR WORD — the whole point of recording one is
                          that somebody reads what was actually written. */}
                      {entry.reason ? (
                        <p
                          className={cn(
                            "border-l-2 border-warning pl-3 font-sans text-body-sm italic text-ink-muted",
                          )}
                        >
                          &ldquo;{entry.reason}&rdquo;
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

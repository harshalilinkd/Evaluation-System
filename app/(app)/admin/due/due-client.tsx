"use client";

/** What is due, grouped by month. This screen is how HR runs the year. */

import * as React from "react";
import { useRouter } from "next/navigation";

// The three tile icons went with the tiles. They distinguished milestone from
// increment from overdue, and the tally LABELS now say those words outright —
// which §13.8 prefers anyway, since a glyph alone is not a signal.
import {
  ScreenBody,
  ScreenHeader,
  TableScreen,
  Tally,
} from "@/components/appraise/screen";
import { EmptyState } from "@/components/appraise/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createAndSend, skipDueItem } from "@/lib/due/actions";
import type { DueList, DueRow } from "@/lib/due/queries";
import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

/** "August 2026" — HR thinks in months on this screen. */
function monthLabel(iso: string): string {
  return new Date(`${iso.slice(0, 7)}-01T00:00:00`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

export function DueClient({ list, canAct }: { list: DueList; canAct: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [skipping, setSkipping] = React.useState<DueRow | null>(null);
  const [reason, setReason] = React.useState("");

  async function onCreate(row: DueRow) {
    setBusyId(row.id);
    setMessage(null);
    const result = await createAndSend(row.id);
    setBusyId(null);
    if (!result.ok) setMessage({ tone: "error", text: result.error.message });
    else {
      setMessage({
        tone: "ok",
        text: `${row.name}'s ${row.what.toLowerCase()} is open. ${result.data.sent} message${result.data.sent === 1 ? "" : "s"} sent${result.data.failed ? `, ${result.data.failed} failed` : ""}.`,
      });
      router.refresh();
    }
  }

  async function onSkip() {
    if (!skipping) return;
    setBusyId(skipping.id);
    const result = await skipDueItem({ dueItemId: skipping.id, reason });
    setBusyId(null);
    if (!result.ok) setMessage({ tone: "error", text: result.error.message });
    else {
      setSkipping(null);
      setReason("");
      router.refresh();
    }
  }

  /* -- Grouped by month, current month first. Overdue items sit in their own
        month, which is in the past, so they lead. -- */
  const groups = React.useMemo(() => {
    const map = new Map<string, DueRow[]>();
    for (const row of list.rows) {
      const key = row.dueOn.slice(0, 7);
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [list.rows]);

  return (
    <TableScreen>
      <ScreenHeader
        title="What is due"
        subtitle={
          list.rows.length === 0
            ? "Nothing is waiting. New joiners and increments appear here as their dates approach."
            : `${list.thisMonth} ${list.thisMonth === 1 ? "thing needs" : "things need"} your attention this month · ${list.rows.length} in total`
        }
        stats={
          <>
            {/* Cyan and pink were on the first two. A milestone evaluation and
                an increment are kinds of WORK, not layers — §13.1. The icons
                already tell them apart. */}
            <Tally
              label="Milestones"
              value={list.milestonesDue}
              title="Milestone evaluations due"
            />
            <Tally label="Increments" value={list.incrementsDue} />
            <Tally
              label="Overdue"
              value={list.overdue}
              tone={list.overdue > 0 ? "critical" : "neutral"}
              title={list.overdue > 0 ? "Past their date" : "Nothing is late"}
            />
          </>
        }
      />

      <ScreenBody>
        {message ? (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={cn(
              "m-4 rounded-control border px-3 py-2 font-sans text-body-sm",
              message.tone === "error"
                ? "border-critical/40 bg-critical-tint text-critical"
                : "border-final/40 bg-final-tint text-final",
            )}
          >
            {message.text}
          </p>
        ) : null}

        {groups.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Nothing is due"
              body="A new joiner appears here a month after they start, and again at six months. An increment appears as its date approaches."
            />
          </div>
        ) : (
          groups.map(([month, rows]) => (
            <section key={month}>
              {/* A sticky rule rather than a card header — it stays visible
                  while its own rows scroll under it, which is the job. */}
              <header className="sticky top-0 z-10 flex flex-wrap items-baseline gap-x-2 border-b border-rule bg-surface-mute px-4 py-1.5">
                <h2 className="font-sans text-body-sm font-semibold text-ink">
                  {monthLabel(month)}
                </h2>
                <p className="font-sans text-body-sm text-ink-faint">
                  {rows.length} {rows.length === 1 ? "item" : "items"}
                </p>
              </header>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse">
                  <thead>
                    <tr className="border-b border-rule">
                      {["Employee", "Department", "What is due", "Date", "Days", ""].map((h) => (
                        <th key={h} className="type-label px-4 py-1.5 text-left text-ink-faint">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                <tbody>
                  {rows.map((row) => {
                    const late = row.daysRemaining < 0;
                    return (
                      <tr
                        key={row.id}
                        className={cn(
                          "border-b border-rule last:border-b-0",
                          // A bar as well as the tint — colour is never the only
                          // signal (§13.8).
                          late && "border-l-2 border-l-critical bg-critical-tint/30",
                        )}
                      >
                        <td className="px-4 py-1.5">
                          <span className="block font-sans text-body-sm text-ink">{row.name}</span>
                          {row.employeeCode ? (
                            <span className="tabular block text-[11px] leading-tight text-ink-faint">
                              {row.employeeCode}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-1.5 font-sans text-body-sm text-ink-muted">
                          {row.department ?? "—"}
                        </td>
                        <td className="px-4 py-1.5 font-sans text-body-sm text-ink">{row.what}</td>
                        <td className="tabular px-4 py-1.5 text-body-sm text-ink-muted">
                          {formatDate(row.dueOn)}
                        </td>
                        <td
                          className={cn(
                            "tabular px-4 py-1.5 text-body-sm",
                            late ? "text-critical" : "text-ink-muted",
                          )}
                        >
                          {late ? `${Math.abs(row.daysRemaining)} late` : `${row.daysRemaining}`}
                        </td>
                        <td className="px-4 py-1.5">
                          {!canAct ? (
                            <span className="font-sans text-body-sm text-ink-faint">HR acts on this</span>
                          ) : row.blockedBecause ? (
                            // §13.4: the reason sits beside the disabled control,
                            // not in a tooltip — each of these has a different fix.
                            <span className="flex flex-wrap items-center gap-2">
                              <Button size="sm" disabled>
                                Create and send
                              </Button>
                              <span className="font-sans text-body-sm text-critical">
                                {row.blockedBecause}
                              </span>
                            </span>
                          ) : (
                            <span className="flex items-center gap-2">
                              <Button
                                size="sm"
                                disabled={busyId === row.id}
                                onClick={() => onCreate(row)}
                              >
                                {busyId === row.id ? "Working…" : "Create and send"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busyId === row.id}
                                onClick={() => {
                                  setSkipping(row);
                                  setReason("");
                                }}
                              >
                                Skip
                              </Button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  </tbody>
                </table>
              </div>
            </section>
          ))
        )}
      </ScreenBody>

      <Dialog open={skipping !== null} onOpenChange={(open) => !open && setSkipping(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Skip this one</DialogTitle>
            <DialogDescription>
              {skipping
                ? `${skipping.name}'s ${skipping.what.toLowerCase()} will not be created. It stays on the record as skipped.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="skip_reason" className="type-label text-ink-muted">
              Reason
            </Label>
            <Textarea
              id="skip_reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this one not going ahead?"
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setSkipping(null)}>
              Cancel
            </Button>
            <Button onClick={onSkip} disabled={reason.trim().length < 5 || busyId !== null}>
              Skip it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TableScreen>
  );
}

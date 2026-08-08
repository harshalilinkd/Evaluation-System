"use client";

/** Every notification row for one person in this cycle. P11 "View history". */

import * as React from "react";
import { Loader2 } from "lucide-react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getHistory } from "@/app/(app)/admin/cycles/[id]/distribute/history-action";
import type { HistoryRow } from "@/lib/notify/queries";
import type { DistributionRow } from "@/lib/notify/queries";
import { TEMPLATE_LABELS, type TemplateKey } from "@/lib/notify/templates";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils/date";

const STATUS_CLASSES: Record<string, string> = {
  SENT: "bg-success-tint text-success",
  FAILED: "bg-critical-tint text-critical",
  QUEUED: "bg-surface-mute text-ink-muted",
};

export function HistoryDrawer({
  row,
  onClose,
}: {
  row: DistributionRow | null;
  onClose: () => void;
}) {
  const [rows, setRows] = React.useState<HistoryRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Fetched on open rather than shipped with the table: history is one person's
  // full trail and loading 47 of them for a screen where most are never opened
  // would be a lot of rows for nothing.
  React.useEffect(() => {
    if (!row) return;
    let cancelled = false;

    void getHistory(row.evaluationId).then((result) => {
      if (cancelled) return;
      if (result.ok) setRows(result.data);
      else setError(result.error.message);
    });

    return () => {
      cancelled = true;
    };
  }, [row]);

  return (
    <Sheet open={row !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{row?.name}</SheetTitle>
          <SheetDescription>
            Every message sent about this evaluation, newest first.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6">
          {error ? (
            <p role="alert" className="text-body-sm text-critical">{error}</p>
          ) : rows === null ? (
            <p className="flex items-center gap-2 text-body-sm text-ink-muted">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="text-body-sm text-ink-muted">Nothing has been sent to this person yet.</p>
          ) : (
            <ul className="divide-y divide-rule">
              {rows.map((entry) => (
                <li key={entry.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-body text-ink">
                        {TEMPLATE_LABELS[entry.template as TemplateKey] ?? entry.template}
                      </p>
                      <p className="truncate text-body-sm text-ink-muted">
                        {entry.channel === "WHATSAPP" ? "WhatsApp" : "Email"} · {entry.recipient}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-pill px-2 py-0.5 text-body-sm font-medium",
                        STATUS_CLASSES[entry.status] ?? "bg-surface-mute text-ink-muted",
                      )}
                    >
                      {entry.status === "SENT" ? "Sent" : entry.status === "FAILED" ? "Failed" : "Queued"}
                    </span>
                  </div>

                  <p className="tabular mt-1 text-body-sm text-ink-muted">
                    {formatDateTime(entry.sentAt ?? entry.createdAt)}
                  </p>

                  {entry.error ? (
                    <p className="mt-1 text-body-sm text-critical">{entry.error}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

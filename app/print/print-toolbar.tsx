"use client";

/** The screen-only controls. Never printed — .print-toolbar is display:none in print. */

import { Printer } from "lucide-react";

/**
 * "Use the browser print dialog" — no PDF library (§17 forbids a dependency
 * outside §2, and the browser already renders the @page rules correctly).
 */
export function PrintToolbar({ label = "Print" }: { label?: string }) {
  return (
    <div className="print-toolbar no-print">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex min-h-11 items-center gap-2 rounded-control bg-ink px-4 text-body font-medium text-ink-invert"
      >
        <Printer className="size-4" aria-hidden />
        {label}
      </button>
    </div>
  );
}

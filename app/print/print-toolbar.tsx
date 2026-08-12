"use client";

/** The screen-only controls. Never printed — .print-toolbar is display:none in print. */

import * as React from "react";
import { Download, Printer } from "lucide-react";

/**
 * Download and print, which on the web are the same gesture with two endings.
 *
 * THERE IS STILL NO PDF LIBRARY, and that is a decision rather than a gap
 * (P15, P34-13). The three ways to produce a real .pdf server-side each cost
 * something this product will not pay: a headless Chromium is hostile to
 * Vercel's limits and needs a second authenticated route into a page P20-13
 * deliberately answers 403 to; a JS library cannot read the 600-line print
 * stylesheet and so becomes a SECOND renderer of a signed document (P9-1); and
 * a third-party service would send salary figures and both blind rating layers
 * off-site, which is a §5 decision and not an engineering one.
 *
 * What the browser already does is render these @page rules correctly and write
 * a PDF from them, named after `document.title` — which every print route sets
 * to a real file name. So "Download" opens that dialog with the destination set
 * to Save as PDF, and the line beneath says so. Naming the step is the honest
 * version: a button that opens a dialog should not pretend a file has landed.
 */
export function PrintToolbar({
  label = "Download report",
  /** Fire the dialog on arrival — set by `?download=1` from a Download link. */
  auto = false,
}: {
  label?: string;
  auto?: boolean;
}) {
  /* -- An effect is right here: printing is an external system, not state.
        Guarded by a ref so React's double-invoked development mount cannot
        raise two dialogs, and deferred a frame so the sheet has painted —
        printing a page mid-layout is how a pack comes out with the first
        section missing. -- */
  const fired = React.useRef(false);
  React.useEffect(() => {
    if (!auto || fired.current) return;
    fired.current = true;
    const id = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(id);
  }, [auto]);

  return (
    <div className="print-toolbar no-print">
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-11 items-center gap-2 rounded-control bg-ink px-4 text-body font-medium text-ink-invert"
          >
            <Download className="size-4" aria-hidden />
            {label}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-11 items-center gap-2 rounded-control border border-rule bg-surface px-4 text-body font-medium text-ink"
          >
            <Printer className="size-4" aria-hidden />
            Print
          </button>
        </div>
        {/* -- HOW TO GET A FILE, said once. Without it "Download" opens a print
              dialog and looks like the wrong button was wired. -- */}
        <p className="max-w-[22rem] text-right font-sans text-body-sm text-ink-muted">
          Choose <strong className="font-medium text-ink">Save as PDF</strong> as the destination to
          download it. The file is named for you.
        </p>
      </div>
    </div>
  );
}

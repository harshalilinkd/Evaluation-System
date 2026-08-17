"use client";

/** What a screen shows when its data could not be fetched at all. */

import { RotateCw } from "lucide-react";

import { ErrorState } from "@/components/appraise/states";
import { Button } from "@/components/ui/button";

/**
 * THERE WAS NO ERROR BOUNDARY ANYWHERE IN THE APP.
 *
 * A throw in a server component reached Next's own error page — a blank screen
 * with a digest hash on it, which tells the reader nothing and offers them
 * nothing. §0.7 says fail loudly, not incomprehensibly, and §13.4 says every
 * error states what to do next.
 *
 * THE `reset()` IS THE POINT. Most failures here are a dropped connection or a
 * cold database, and both clear on a retry — so the primary action re-runs the
 * render rather than sending somebody to reload the page by hand.
 *
 * WHAT IS NOT SHOWN: `error.message`. A server error's text can carry a table
 * name, a column, a row id — §14 keeps that out of anywhere a person can read,
 * and it would mean nothing to them anyway. The digest is shown because it is
 * the one thing that lets a report be matched to a log entry, and it identifies
 * nobody.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="px-4 py-6 lg:px-6">
      <ErrorState
        title="This page could not be loaded"
        body="Something went wrong fetching it. Nothing you have entered elsewhere is affected."
        detail={error.digest ? `Reference ${error.digest}` : undefined}
        action={
          <Button type="button" onClick={reset} className="min-h-11">
            <RotateCw className="size-4" aria-hidden />
            Try again
          </Button>
        }
      />
    </div>
  );
}

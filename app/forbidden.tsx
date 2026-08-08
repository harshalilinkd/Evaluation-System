/** The 403 boundary. Rendered when a route calls `forbidden()`. */

import Link from "next/link";

/**
 * A refusal, not a redaction.
 *
 * `/print/report/[id]` is the one route that answers 403 rather than producing
 * a reduced document, and the reason is §5: the combined report IS both sides of
 * a blind evaluation together, so there is no version of it that is safe for
 * anybody outside HR and the MD. A redacted edition would be a nearly-empty page
 * that still confirms what it is and who it is about.
 *
 * It says nothing about whose report was asked for. Naming the person would make
 * the URL a way to find out who is being evaluated (P6-11).
 */
export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="font-sans text-display-md text-ink">Not available to you</h1>
      <p className="font-sans text-body text-ink-muted">
        This document is available to HR and the Managing Director only.
      </p>
      <p className="font-sans text-body-sm text-ink-muted">
        If you believe you should be able to open it, ask HR.
      </p>
      <Link
        href="/dashboard"
        className="font-sans text-body text-primary underline underline-offset-4"
      >
        Back to your dashboard
      </Link>
    </main>
  );
}

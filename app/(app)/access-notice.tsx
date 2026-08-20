"use client";

/** Says why a guard sent somebody here, instead of landing them on a silent page. */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ShieldAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";

/*
 * `requireRole` and `requireEvaluationAccess` both redirect to
 * `landingPathFor(roles) + "?error=forbidden"`, and until now nothing read that
 * parameter. So opening a link you are not entitled to open bounced you to a
 * page that said nothing about why — which reads as the app losing your click,
 * not as a decision it made. §13.4: no dead ends.
 *
 * Mounted in the (app) layout rather than on each landing page, because
 * `landingPathFor` can send somebody to any of four routes and a notice that
 * appeared on three of them would be worse than none.
 */

const MESSAGES: Record<string, { title: string; body: string }> = {
  forbidden: {
    title: "That page is not yours to open",
    body:
      // Deliberately says nothing about whether the thing exists or who it
      // belongs to. P6-11: a guard that explains itself precisely becomes a way
      // to find out who is being evaluated.
      "You have been brought back to your own. If you were trying to open somebody else's evaluation, a report you supervise is under My Team.",
  },
};

export function AccessNotice() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const reason = params.get("error");
  const message = reason ? MESSAGES[reason] : undefined;
  if (!message) return null;

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-card border border-warning/40 bg-warning-tint px-4 py-3"
    >
      <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 text-body-sm">
        <p className="font-medium text-ink">{message.title}</p>
        <p className="text-ink-muted">{message.body}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 lg:size-8"
        aria-label="Dismiss"
        onClick={() => {
          // The parameter goes with the notice. Left in place it would come
          // back on every refresh and on anything that shares the URL.
          const next = new URLSearchParams(params.toString());
          next.delete("error");
          const query = next.toString();
          router.replace(query ? `${pathname}?${query}` : pathname);
        }}
      >
        <X className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

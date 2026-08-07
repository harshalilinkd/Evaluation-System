/** The way back out of a detail screen. One component, so it looks the same everywhere. */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A back link, not a back BUTTON.
 *
 * `history.back()` is the obvious implementation and the wrong one: somebody
 * who arrived from a WhatsApp link, a bookmark or a page refresh has no history
 * to go back to, and the control does nothing — the failure mode §13.4 calls a
 * dead end. Naming the destination means it works from anywhere, and it also
 * tells the reader where they are before they click.
 */
export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  /** Where it goes, named. "Back" alone tells the reader nothing. */
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        // 44px target (§13.8). Negative left margin so the arrow lines up with
        // the heading below it rather than sitting indented from it.
        "-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-body-sm font-medium text-ink-muted transition-colors duration-hover hover:text-ink",
        className,
      )}
    >
      <ArrowLeft className="size-4" aria-hidden />
      {label}
    </Link>
  );
}

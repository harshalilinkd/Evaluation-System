"use client";

/**
 * The strip shared by the three screens that make up "Evaluation Cycles":
 * the cycle list itself, what is due, and the increment calendar. The
 * sidebar holds one entry for all three now — this is what makes them read
 * as one section rather than three unrelated pages once you are inside it,
 * the same job the department mapping screen's own back-link does for
 * Departments.
 *
 * A real route each, not a client-side filter: the three screens load
 * different data through different guards, and folding them into one page
 * would mean one server component doing three screens' worth of queries on
 * every visit. Three links, not three tabs — `role="tab"` on an <a> is what
 * gives a screen reader the truth (this is navigation, not a filter within
 * one document), styled to match the Evaluation/Increment toggle already on
 * the cycle list so the two don't read as two different conventions.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/admin/cycles", label: "Cycles" },
  { href: "/admin/due", label: "Evaluation Due" },
  // Renamed at the owner's explicit instruction (§0.2). It sits beside
       // "Evaluation Due" and answers the same question about a different
       // thing, so the two now read as a pair rather than a list and a noun.
       { href: "/admin/increments", label: "Increments Due" },
] as const;

export function CycleSectionNav() {
  const pathname = usePathname();

  return (
    <div
      role="tablist"
      aria-label="Evaluation Cycles"
      className="flex shrink-0 items-end gap-1 border-b border-rule bg-surface px-4 lg:px-6"
    >
      {SECTIONS.map((section) => {
        const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
        return (
          <Link
            key={section.href}
            href={section.href}
            role="tab"
            aria-selected={active}
            className={cn(
              "-mb-px flex min-h-11 items-center border-b-2 px-3 text-body-sm font-medium transition-colors",
              active
                ? "border-b-primary text-ink"
                : "border-b-transparent text-ink-muted hover:text-ink",
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </div>
  );
}

/** The Form Builder / Question Bank switch. One job, two ways of working on it. */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HardHat, LayoutTemplate, Table2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * These were two sidebar entries, and two entries for one job read as two jobs.
 * The builder is the default way in (P9B) and shows the form as a person will
 * meet it; the bank is the same questions as a table, which is better for bulk
 * work — filtering, retiring several at once, seeing every department at a
 * glance. Neither replaces the other, so both stay, side by side.
 *
 * The bank lives UNDER /admin/form-builder so `activeHref`'s longest-match rule
 * highlights Form Builder on both, with no special case in the nav config.
 */
const TABS = [
  {
    href: "/admin/form-builder",
    label: "Form Builder",
    hint: "The form as a person meets it",
    icon: LayoutTemplate,
  },
  {
    href: "/admin/form-builder/questions",
    label: "Question Bank",
    hint: "Every question as a table",
    icon: Table2,
  },
  /*
   * §7's second module, and a THIRD tab rather than a mode of the first two.
   * The worker sheet shares no question, no scale and no department with the
   * staff form — §5's module boundary is a CHECK constraint, not a convention —
   * so folding it into the builder as a filter would suggest the two are views
   * of one bank. They are two forms, and the tab strip says so.
   */
  {
    href: "/admin/form-builder/worker",
    label: "Worker Form",
    hint: "The Production Team tick sheet",
    icon: HardHat,
  },
] as const;

export function BuilderTabs() {
  const pathname = usePathname();

  return (
    <div
      role="tablist"
      aria-label="Form Builder views"
      className="flex items-center gap-1 rounded-control bg-surface-mute p-1"
    >
      {TABS.map((tab) => {
        // Exact match, not startsWith: /admin/form-builder is a prefix of the
        // bank's own path, so a prefix test would light both at once.
        const active = pathname === tab.href;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            title={tab.hint}
            className={cn(
              "flex items-center gap-2 rounded-sm px-3.5 py-2 text-body-sm font-medium transition-colors",
              active
                ? "bg-surface text-ink shadow-sm"
                : "text-ink-muted hover:text-ink",
            )}
          >
            <Icon aria-hidden className="size-4" />
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

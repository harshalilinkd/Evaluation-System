/** The Form Builder / Worker Form switch — the staff form and the tick sheet. */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HardHat, LayoutTemplate, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * THE QUESTION BANK TAB IS GONE, at the owner's instruction.
 *
 * NAV-1 put it here: it had been its own sidebar entry, and two entries for one
 * job read as two jobs. The pairing was builder-as-the-form and bank-as-a-table,
 * two ways of working on the same questions.
 *
 * In practice the builder does the job — it edits, adds, removes, reorders and
 * previews — and a second tab offering the same questions in a different shape
 * is a fork in the road at the moment somebody has already decided what they
 * came to do.
 *
 * THE ROUTE STAYS. `/admin/form-builder/questions` still renders, and
 * `/admin/questions` still redirects to it, because a bookmark going nowhere
 * reads as a broken product (N1-2) and the table is genuinely better for bulk
 * work — filtering, retiring several at once, the CSV import. It is simply no
 * longer offered as a peer of the builder. That page carries its own way back
 * rather than this strip, which would otherwise show with nothing selected.
 */
const TABS = [
  /* -- THREE FORMS, NAMED, and that is the separation.
        The cycle type was a toggle inside the live preview: it filtered a third
        of the screen while the structure list beside it still listed every
        question in the bank, so somebody building the evaluation form was
        still looking at increment questions. A filter is not a separate place.
        Each tab is now a route that loads only its own cycle's questions, and
        a question added in one is scoped to that one. -- */
  {
    href: "/admin/form-builder",
    label: "Evaluation Form",
    hint: "What an evaluation cycle asks",
    icon: LayoutTemplate,
  },
  {
    href: "/admin/form-builder/increment",
    label: "Increment Form",
    hint: "What an increment cycle asks",
    icon: TrendingUp,
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

"use client";

/** The mobile tab bar. The fast path between screens on a phone. */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ICONS } from "@/components/appraise/sidebar-nav";
import { activeHref, navFor, type AppRole } from "@/components/appraise/nav-config";
import { cn } from "@/lib/utils";

/**
 * WHY THIS EXISTS.
 *
 * Below `lg` the rail is hidden and navigation lived entirely behind the
 * topbar's hamburger. Moving between two screens was therefore: tap the burger,
 * wait for the sheet to slide, read a list of up to eleven items, tap one, wait
 * for it to slide back. Three interactions and two animations to do the single
 * most common thing on a phone, with the destinations invisible until you go
 * looking for them.
 *
 * A tab bar makes it one tap and keeps the destinations on screen, so somebody
 * can see where they can go without opening anything.
 *
 * THE BURGER STAYS. This carries the four most-used destinations, not all
 * eleven — an admin has Cycles, Settings, Increments, Form Builder and the rest
 * behind the sheet, and cramming eleven items into a 375px bar would make every
 * one of them a poor target. Two affordances, each doing what it is good at:
 * the bar for the routes somebody uses all day, the sheet for the long tail.
 *
 * WHICH FOUR. They come from `navFor`, so the bar cannot offer a route the
 * guards would refuse — a link that renders and then redirects reads as a
 * permissions bug. The first group in `NAV` is the ungrouped, everyday set
 * (Dashboard, Scorecard, My Evaluation, My Team, Reports); admin groups are
 * deliberately not eligible. An employee sees three, a HOD four, HR four.
 */
const MAX_TABS = 4;

export function BottomNav({
  roles,
  leadsTeam = false,
  ratesWorkers = false,
}: {
  roles: readonly AppRole[];
  leadsTeam?: boolean;
  ratesWorkers?: boolean;
}) {
  const pathname = usePathname();
  const active = activeHref(pathname, roles, leadsTeam, ratesWorkers);

  /* -- The everyday group, capped — then the CURRENT page forced in.
        `navFor` has already removed anything this person may not open.

        The everyday group leads because your own work comes first whatever your
        role (P23-10, P6-8): HR and the MD have appraisals too, and a bar that
        opened on Cycles would bury the one form they personally owe.

        But four slots cannot hold an administrator's eleven destinations, and a
        bar showing NO active tab while you are standing on Reports is worse
        than a bar that is one item short — it reads as "you are nowhere". So if
        the current page is a nav destination that did not make the cut, it
        takes the last slot. The bar then always says where you are, and the
        screens somebody actually uses surface as they use them. -- */
  const groups = navFor(roles, leadsTeam, ratesWorkers);
  const everyday = groups[0]?.items ?? [];

  let items = everyday.slice(0, MAX_TABS);

  if (active && !items.some((item) => item.href === active)) {
    const currentItem = groups.flatMap((group) => group.items).find((i) => i.href === active);
    if (currentItem) items = [...items.slice(0, MAX_TABS - 1), currentItem];
  }

  // One destination is not a choice, so it is not a bar. Nothing to switch
  // between means the burger alone is honest.
  if (items.length < 2) return null;

  return (
    <nav
      aria-label="Main"
      /* -- `fixed`, not sticky, and it is deliberate.
            `TableScreen` owns the viewport height and scrolls its own content,
            so there is no page scroll for a sticky element to stick to on those
            screens — it would sit at the bottom of the document, far below the
            fold. Fixed is the only position that behaves the same on a
            document-scrolling page and a self-scrolling one.

            `pb-[env(safe-area-inset-bottom)]` keeps the row clear of the iOS
            home indicator, which otherwise overlaps the last few pixels of a
            44px target. -- */
      className="fixed inset-x-0 bottom-0 z-40 border-t border-sidebar-rule bg-sidebar pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="flex items-stretch">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const current = active === item.href;

          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                // §13.8: the current page is announced, not only tinted.
                aria-current={current ? "page" : undefined}
                /* 56px + the safe area clears §13.8's 44px floor with room for
                   the label, and a full-height target means the whole cell is
                   tappable rather than just the glyph. */
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors",
                  current ? "text-sidebar-ink" : "text-sidebar-ink-muted",
                )}
              >
                {/* The active state is a tinted pill behind the glyph, matching
                    the rail's `primary/10` fill (UI-3) so the two navigations
                    read as one system rather than two. */}
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-pill transition-colors",
                    current && "bg-primary/20",
                  )}
                >
                  <Icon aria-hidden className="size-5 shrink-0" />
                </span>
                {/* 11px is this codebase's floor (P31-6). The label is never
                    dropped in favour of the glyph alone: an icon-only tab bar
                    asks everybody to learn eleven glyphs, and the people most
                    affected are the ones using the product least often. */}
                <span className="w-full truncate text-center text-body-xs leading-tight">
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

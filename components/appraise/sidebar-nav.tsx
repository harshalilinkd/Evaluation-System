"use client";

/** The nav list. Shared by the desktop rail and the mobile sheet. DESIGN.md §6. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CalendarRange,
  ClipboardList,
  FileBarChart,
  LayoutDashboard,
  ListChecks,
  Scale,
  Settings,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { activeHref, navFor, type AppRole, type NavIcon } from "@/components/appraise/nav-config";

// Resolved here rather than in the config so nav-config.ts stays a plain data
// file, and so the icon set is statically analysable and tree-shakeable.
//
// Exported because the mobile bottom bar draws the same destinations. Two maps
// would drift, and a rail and a tab bar showing different glyphs for the same
// screen is the kind of thing that makes an app feel like two apps.
export const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  myEvaluation: ClipboardList,
  team: UsersRound,
  review: Scale,
  scorecard: FileBarChart,
  questions: ListChecks,
  departments: Building2,
  cycles: CalendarRange,
  settings: Settings,
};

export function SidebarNav({
  roles,
  leadsTeam = false,
  ratesWorkers = false,
  onNavigate,
  onNavy = true,
}: {
  roles: readonly AppRole[];
  leadsTeam?: boolean;
  ratesWorkers?: boolean;
  /** Closes the sheet on mobile. Omitted on the desktop rail. */
  onNavigate?: () => void;
  /**
   * The desktop rail is Slate Navy; the mobile sheet is a white surface. The
   * ink tokens have to swap with the ground or the labels vanish — `text-ink`
   * on navy is charcoal on charcoal.
   */
  onNavy?: boolean;
}) {
  const pathname = usePathname();
  const active = activeHref(pathname, roles, leadsTeam, ratesWorkers);

  return (
    <nav className="space-y-6" aria-label="Main">
      {navFor(roles, leadsTeam, ratesWorkers).map((group, index) => (
        <div key={group.heading ?? `group-${index}`} className="space-y-1">
          {group.heading ? (
            <p
              className={cn(
                "rail-heading type-label px-3 pb-1",
                onNavy ? "text-sidebar-ink-muted" : "text-ink-muted",
              )}
            >
              {group.heading}
            </p>
          ) : null}

          {group.items.map((item) => {
            const isActive = active === item.href;
            const Icon = ICONS[item.icon];

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                // The label is the accessible name when expanded; collapsed, it
                // is visually hidden, so the title carries it to a tooltip and
                // to assistive tech. Without this a 76px rail is nine unlabelled
                // icons.
                title={item.label}
                className={cn(
                  // 8px radius, 44px minimum target (§4, §13.8).
                  "rail-item flex min-h-11 items-center gap-3 rounded-input px-3 py-2",
                  "text-body transition-colors duration-hover ease-out",
                  isActive
                    ? // §6: a soft accent tint with coloured text and icon. No
                      // left bar — the fill is the signal.
                      onNavy
                      ? "bg-sidebar-active/20 font-medium text-white"
                      : "bg-primary/10 font-medium text-primary"
                    : onNavy
                      ? "text-sidebar-ink-muted hover:bg-white/5 hover:text-sidebar-ink"
                      : "text-ink-muted hover:bg-surface-mute hover:text-ink",
                )}
              >
                <Icon
                  className={cn(
                    "size-[18px] shrink-0",
                    isActive
                      ? onNavy
                        ? "text-white"
                        : "text-primary"
                      : onNavy
                        ? "text-sidebar-ink-muted"
                        : "text-ink-muted",
                  )}
                  aria-hidden
                />
                <span className="rail-label truncate whitespace-nowrap">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

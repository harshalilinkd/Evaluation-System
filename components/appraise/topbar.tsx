"use client";

/** Topbar: title, cycle selector, user menu, mobile nav trigger. DESIGN.md §7. */

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";

import { NotificationBell } from "@/components/appraise/notification-bell";
import type { NotificationFeed } from "@/lib/notify/inapp";
import { RailToggle, ThemeToggle } from "@/components/appraise/theme";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SidebarNav } from "@/components/appraise/sidebar-nav";
import { SidebarBrand } from "@/components/appraise/sidebar";
import {
  meaningfulRoles,
  ROLE_LABELS,
  titleFor,
  type AppRole,
} from "@/components/appraise/nav-config";

export type CycleOption = { id: string; label: string };

export function Topbar({
  roles,
  userName,
  userEmail,
  notifications,
  onSignOut,
}: {
  roles: readonly AppRole[];
  userName: string;
  userEmail: string;
  /** Read server-side by the shell, so the badge is right in the first frame. */
  notifications: NotificationFeed;
  /** A form action — sign-out must clear an httpOnly cookie server-side. */
  onSignOut: () => void;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  // §7: the role indicator appears only when someone genuinely holds more than
  // one role. For most people it never appears at all.
  const roleBadges = meaningfulRoles(roles);
  const showRoles = roleBadges.length > 1;

  return (
    // Glass: translucent surface over a blur, so content scrolling underneath
    // reads as depth rather than vanishing at a hard edge.
    <header className="glass sticky top-0 z-20 flex h-topbar items-center gap-2 border-b border-rule px-4 lg:px-6">
      {/* §7: below 1024px the sidebar collapses into a sheet. */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-sidebar border-sidebar-rule bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {/* The sheet carries the rail's navy, not the card surface: it IS the
              rail on a small screen, and switching grounds between the two
              would make them read as different things. */}
          <div className="flex h-full flex-col gap-6 p-4">
            <SidebarBrand />
            <div className="flex-1 overflow-y-auto">
              <SidebarNav roles={roles} onNavigate={() => setNavOpen(false)} />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Collapse control sits with the rail it controls, at the boundary. */}
      <RailToggle className="hidden lg:inline-flex" />

      {/* §6: page title in display-md. */}
      <h1 className="min-w-0 shrink-0 truncate text-display-md text-ink">
        {titleFor(pathname, roles)}
      </h1>

      {/* §6: "Minimal. Contains global search, notification bell, and quick
          settings." Search is presentational for now — wiring it to a real query
          is a feature, and this phase changes appearance only. */}
      <div className="mx-auto hidden w-full max-w-sm md:block">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Search"
            aria-label="Search"
            className="h-9 min-h-9 rounded-input border-rule bg-surface-mute pl-9 text-body"
          />
        </div>
      </div>

      <div className="flex items-center gap-1">
        <ThemeToggle />

        {/* -- Was a Button with a hardcoded dot and nothing behind it, marked
              "static until the notification log lands". It has landed.

              The dot it replaces was `bg-accent-pink`, which is #EC4899 — the
              same value as `--lead`. §13.1 reserves that hue for the HOD layer
              and says it is "never used decoratively for anything else", so the
              placeholder was a quiet violation of the one rule the design
              system calls sacred. The count is `--primary`, following P30-4:
              the token carries the role, and "there is something here" is not a
              tier. -- */}
        <NotificationBell initial={notifications} />

        {/*
          THE CYCLE SELECTOR WAS HERE, AND IS DELETED.

          It had no `onValueChange` and nothing anywhere read its value: picking
          a different cycle changed precisely nothing. §13.4 is about dead ends,
          and a control that silently does nothing is the worst kind — it
          teaches people the screen is lying to them.

          Bringing it back means first deciding what "the current cycle" scopes:
          the dashboard, the reports, Team review? That is a feature, not a
          dropdown, and it should arrive with the screens that honour it.

          The `cycles` prop went with it, and so did the query behind it — the
          layout was reading twelve cycles on every authenticated page load to
          fill a control nothing consumed. A prop kept "for later" is a prop
          that rots; the query is four lines when it is genuinely needed.
        */}

        {showRoles ? (
          <div className="hidden items-center gap-1 md:flex">
            {roleBadges.map((role) => (
              <span
                key={role}
                className={cn(
                  "type-label rounded-pill border border-rule bg-surface-mute px-2 py-1 text-ink-muted",
                )}
              >
                {ROLE_LABELS[role]}
              </span>
            ))}
          </div>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-9 min-h-9 gap-2 px-2 font-sans text-body"
              aria-label="Account"
            >
              <span
                aria-hidden
                className="flex h-7 w-7 items-center justify-center rounded-pill bg-accent font-sans text-body-sm text-accent-foreground"
              >
                {userName.slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden max-w-[140px] truncate md:inline">{userName}</span>
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-60 border-rule">
            <DropdownMenuLabel className="space-y-0.5 font-normal">
              <p className="font-sans text-body text-ink">{userName}</p>
              <p className="truncate tabular text-body-sm text-ink-muted">{userEmail}</p>
              {roleBadges.length > 0 ? (
                <p className="type-label pt-1 text-ink-muted">
                  {roleBadges.map((r) => ROLE_LABELS[r]).join(" · ")}
                </p>
              ) : null}
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-rule" />
            <form action={onSignOut}>
              <DropdownMenuItem asChild>
                <button type="submit" className="w-full cursor-pointer font-sans text-body">
                  Sign out
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

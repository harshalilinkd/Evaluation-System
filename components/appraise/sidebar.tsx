/** The collapsible Slate Navy rail. DESIGN.md §6. */

import Link from "next/link";

import { ROUTES } from "@/lib/auth/landing";
import { SidebarNav } from "@/components/appraise/sidebar-nav";
import type { AppRole } from "@/components/appraise/nav-config";

/**
 * Shared by the rail and the mobile sheet so the two cannot drift apart.
 *
 * `onNavy` exists because the sheet is a white surface while the rail is Slate
 * Navy — the same mark, two grounds. It is a prop rather than two components so
 * a change to the brand lands in one place.
 */
export function SidebarBrand({ onNavy = true }: { onNavy?: boolean }) {
  return (
    <Link
      href={ROUTES.dashboard}
      className="rail-item flex items-center gap-3 rounded-control px-2 py-1.5"
    >
      {/*
        The company mark, with no plate behind it.

        IT USED TO SIT ON A WHITE TILE, and the reason was real: the LinkD
        artwork is drawn with heavy BLACK strokes, and black on Slate Navy
        disappears — the "D" is almost entirely outline, so on the bare rail the
        wordmark lost its last letter. The plate was the fix.

        The better fix is a reversed mark. `logo-light.png` is the same artwork
        with only the black knocked out to slate-100; every coloured letter is
        untouched. It needs no plate, so the mark is transparent on the rail as
        it should be, and it can then be given the width a 2.11:1 wordmark
        actually needs (see `.rail-mark`) instead of being squeezed into a 40px
        square.

        `onNavy` picks the ground: the mobile sheet is a white surface, where
        the original black-stroked mark is the correct one. Neither file is a
        substitute for the other.

        `alt` is empty because the company name is written beside it — a screen
        reader announcing "LinkD Prints" twice is noise, not access — and
        because a decorative image renders as NOTHING when its file is missing,
        rather than as a broken-image glyph (P27 addendum).
      */}
      {/* eslint-disable-next-line @next/next/no-img-element -- a small fixed-width mark; the optimiser has nothing to add and next/image would defer the one element that should paint first. */}
      <img
        src={onNavy ? "/logo-light.png" : "/logo.png"}
        alt=""
        className="rail-mark shrink-0 object-contain"
      />

      {/* Faded out by CSS on collapse rather than unmounted — the transition
          has to animate a real element, and remounting the brand on every
          toggle would flicker the logo. */}
      <span className="rail-label min-w-0 overflow-hidden">
        <span
          className={`block truncate text-display-sm leading-tight ${
            onNavy ? "text-sidebar-ink" : "text-ink"
          }`}
        >
          Appraise
        </span>
        <span
          className={`type-label block truncate ${
            onNavy ? "text-sidebar-ink-muted" : "text-ink-muted"
          }`}
        >
          LinkD Prints
        </span>
      </span>
    </Link>
  );
}

export function Sidebar({ roles }: { roles: readonly AppRole[] }) {
  return (
    // Slate Navy, edge to edge, pinned left — the one large dark field in the
    // light theme, and that is its job: it anchors the page, separates
    // navigation from content without needing a border, and gives the indigo
    // active state a ground to glow against.
    //
    // Width comes from --rail-w, flipped by the `data-rail` attribute the
    // pre-paint script sets on <html>. No state lives here.
    //
    // Hidden below 1024px, where the topbar's sheet takes over.
    <aside className="rail hidden shrink-0 bg-sidebar transition-[width] duration-panel ease-panel lg:block">
      <div className="sticky top-0 flex h-dvh flex-col gap-6 overflow-x-hidden p-4">
        <SidebarBrand />

        <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
          <SidebarNav roles={roles} />
        </div>

        <p className="rail-label tabular whitespace-nowrap px-3 text-body-sm text-sidebar-ink-muted">
          v0.1.0
        </p>
      </div>
    </aside>
  );
}

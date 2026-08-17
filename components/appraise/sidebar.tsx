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
        The company mark, on a plate when the ground is navy.

        THE KNOCKED-OUT VARIANT IS NOT USED, and the reason is worth writing
        down so it is not attempted a third time. `logo-light.png` is the same
        artwork with the black replaced by slate-100, on the reasoning that the
        black is a background the navy can supply itself. It is not: in this
        mark the BLACK STROKES ARE THE LETTERFORMS. Knocking them out does not
        reverse the drawing, it deletes it — the "D" is almost entirely stroke
        and becomes a pale ghost, and every coloured letter is left floating
        inside a thick white halo with the four colour bars reduced to confetti.
        That is the "weird" the owner saw.

        A genuine reversed mark would have to be REDRAWN, not recoloured, and
        that is artwork rather than code.

        So the plate comes back (P27-8's original call), with the one fair
        criticism of it answered: it squeezed a 2.11:1 wordmark into a 40px
        square. The plate is now shaped to the mark instead.

        `onNavy` picks the ground, and BOTH current callers are navy — the
        mobile sheet carries the rail's own colour rather than the card surface,
        because it IS the rail on a small screen. The bare branch is kept for a
        light ground, where a white plate would be an invisible box drawn around
        the mark, and it is the reason this is a prop rather than a constant.

        `alt` is STILL empty, but not for the reason it used to be. That reason
        was "the company name is written beside it", and it is not any more —
        so the justification had to be re-derived rather than left standing.

        It holds on two others. The link is named by the visible "Appraise"
        beside it, so the mark inside it is decorative in the accessibility
        sense: giving it alt text would make the link announce itself twice.
        And a decorative image renders as NOTHING when its file is missing,
        rather than as a broken-image glyph (P27 addendum).
      */}
      {/* eslint-disable-next-line @next/next/no-img-element -- a small fixed-width mark; the optimiser has nothing to add and next/image would defer the one element that should paint first. */}
      <img
        src="/logo.png"
        alt=""
        className={
          onNavy
            ? "rail-mark shrink-0 rounded-control bg-white object-contain p-1.5"
            : "rail-mark shrink-0 object-contain"
        }
      />

      {/* Faded out by CSS on collapse rather than unmounted — the transition
          has to animate a real element, and remounting the brand on every
          toggle would flicker the logo. */}
      {/* -- THE COMPANY NAME IS THE MARK, and it was written beside it too.
            The artwork already reads "LiNKD" — so the rail said it twice, once
            in the logo and once in 11px caps underneath, and the app's own name
            had to share the space with a repeat.

            The mark now carries the company and this carries the product, which
            is one thing each. It also lets "Appraise" sit on the mark's centre
            line rather than being pushed up by a second line beneath it. -- */}
      <span className="rail-label min-w-0 overflow-hidden">
        <span
          className={`block truncate text-display-sm leading-tight ${
            onNavy ? "text-sidebar-ink" : "text-ink"
          }`}
        >
          Appraise
        </span>
      </span>
    </Link>
  );
}

export function Sidebar({
  roles,
  leadsTeam = false,
}: {
  roles: readonly AppRole[];
  leadsTeam?: boolean;
}) {
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
          <SidebarNav roles={roles} leadsTeam={leadsTeam} />
        </div>

        <p className="rail-label tabular whitespace-nowrap px-3 text-body-sm text-sidebar-ink-muted">
          v0.1.0
        </p>
      </div>
    </aside>
  );
}

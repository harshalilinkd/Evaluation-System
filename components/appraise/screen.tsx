/** The table-screen shell: a compact header, a filter strip, then the content. */

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * THE SHAPE EVERY LIST SCREEN TAKES.
 *
 * The screens that grew up around a `HeroCard` spent roughly 480px before their
 * first row of data: a 130px hero repeating the page title, three 110px tiles,
 * a filter row that wrapped onto two lines, and a card header per group. On a
 * 900px laptop that is more than half the window gone before anything is shown,
 * and the table — the thing the screen exists for — opened below the fold.
 *
 * This is the same anatomy the roster and the question bank already used,
 * extracted rather than copied a fifth time: **title and counts on ONE line,
 * filters on the next, and the content taking every remaining pixel.** ~116px
 * of chrome instead of ~480px.
 *
 * Three rules it encodes, so no caller has to remember them:
 *
 *   - `data-full-bleed` drops the shell's 1180px cap and its gutters (the
 *     `:has()` rule in globals.css). A table centred in 1180px wastes half a
 *     wide monitor; a 2000px text input does not, which is why this is for
 *     LIST screens and not for forms or documents.
 *   - The screen owns the viewport height and the CONTENT scrolls inside it, so
 *     the header and the filters stay put while a long list moves under them.
 *   - Nothing here is tier-coloured. §13.1 reserves cyan, pink and indigo for
 *     "who said this", and a count of rows is not a layer.
 *
 * Not for `/dashboard`, `/scorecard`, `/my-evaluation` or Employment & pay:
 * those are documents about one subject, and a centred column is right for them.
 */
export function TableScreen({
  children,
  className,
  extraChromeRem,
}: {
  children: React.ReactNode;
  className?: string;
  /**
   * Rem height of anything rendered ABOVE this element that also has to come
   * out of the viewport calc — Reports' own tab strip, for one. Omit it and
   * nothing changes: the CSS variable this sets defaults to 0 in
   * globals.css, so every existing caller is unaffected.
   */
  extraChromeRem?: number;
}) {
  return (
    <div
      data-full-bleed
      /* -- `.table-screen` carries the height, because it has to subtract the
            mobile tab bar as well as the topbar and that calc belongs in CSS
            where `theme()` resolves — an inline style is not processed by
            Tailwind and would emit the literal string.

            The subtraction matters: this screen owns the viewport height and
            scrolls its CONTENT, so an over-tall box does not produce a
            scrollbar. It pushes the bottom of the list, and the grid's own
            status bar with it, underneath a fixed bar that reserves no space of
            its own. `--bottom-nav-h` is 0 above `lg`, so desktop is
            unchanged. -- */
      className={cn("table-screen flex min-h-[26rem] flex-col overflow-hidden bg-surface", className)}
      style={extraChromeRem ? ({ "--extra-chrome-h": `${extraChromeRem}rem` } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

/**
 * One line: what this screen is on the left, what the numbers are on the right.
 *
 * The counts sit BESIDE the title rather than in a row of cards beneath it.
 * Three cards to carry three integers is the single biggest waste on these
 * screens, and the integers are easier to compare when they are adjacent.
 */
export function ScreenHeader({
  title,
  subtitle,
  stats,
  action,
}: {
  title: string;
  /** One line. If it needs two, it belongs in the content, not the header. */
  subtitle?: React.ReactNode;
  /** `Tally` elements, or anything else compact. */
  stats?: React.ReactNode;
  /** §13.3: at most one primary action per screen. */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule px-4 py-2.5 lg:px-6">
      <div className="min-w-0">
        <h1 className="truncate text-display-sm font-semibold leading-tight text-ink">{title}</h1>
        {subtitle ? <p className="text-body-sm leading-snug text-ink-muted">{subtitle}</p> : null}
      </div>

      {stats || action ? (
        <div className="flex flex-wrap items-center gap-2">
          {stats}
          {action}
        </div>
      ) : null}
    </div>
  );
}

/** The filter strip. One line at desktop widths; it wraps rather than clips. */
export function ScreenToolbar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule bg-surface-mute px-3 py-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The scrolling region, for screens whose content is not a `DataGrid`.
 *
 * `DataGrid` brings its own scroller and status bar, so it goes straight into
 * `TableScreen`. Anything else — a grouped table, a card list — goes in here, or
 * it scrolls the window and takes the header with it.
 */
export function ScreenBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("min-h-0 flex-1 overflow-auto", className)}>{children}</div>;
}

/**
 * A count in the header.
 *
 * NO TIER TONE, deliberately. The screens this replaces tinted their tiles cyan,
 * pink and indigo for things like "Pending your review", "With the MD" and
 * "Closed" — pipeline stages, not layers. §13.1 reserves those three hues for
 * who said a thing, and spending them on a stage is exactly the decorative use
 * it forbids. `critical` is here because late is a failure rather than a tier,
 * and the label carries it too (§13.8).
 */
const TALLY_TONE = {
  neutral: "text-ink",
  critical: "text-critical",
  warning: "text-warning",
} as const;

export function Tally({
  label,
  value,
  tone = "neutral",
  title,
}: {
  label: string;
  value: React.ReactNode;
  tone?: keyof typeof TALLY_TONE;
  title?: string;
}) {
  return (
    <div title={title} className="rounded-card bg-surface-mute px-3 py-1.5 text-center">
      <div className={cn("tabular text-body-lg font-semibold leading-tight", TALLY_TONE[tone])}>
        {value}
      </div>
      <div className="text-body-xs leading-tight text-ink-muted">{label}</div>
    </div>
  );
}

/** The native select, styled to match the Input it sits beside in a toolbar. */
export const SCREEN_SELECT_CLASS =
  "min-h-11 rounded-control border border-rule bg-surface px-3 text-body-sm text-ink";

/* ---------- The KPI row ----------

   RESTORED AT THE OWNER'S EXPLICIT INSTRUCTION, having been removed a moment
   earlier as wasted space. Recorded rather than absorbed, because it reverses a
   decision made in this session and the reasoning matters to whoever reads this
   next: the cards were costing ~110px and the tints were spending §13.1's
   reserved tier hues on things that are not layers ("Closed", "Increments").

   What is kept from that pass, so the reversal costs as little as possible:

     · the row is HALF the height it was — label, number, optional caption, and
       no icon slot, so three counts cost ~76px rather than ~110px;
     · the NUMBER IS INK on the tint, not the tint's own hue. §13.8 sets 4.5:1
       and cyan text is 2.3:1, so the old cards were failing it in the same way
       the report was. Ink on a tint is ~15:1 and the tint still reads as
       colour at a glance, which is what was actually wanted;
     · the header `Tally` stays for screens with more than three counts.

   §13.1's tension is real and unresolved: a tier tint on "With the MD" says
   "the lead said this" to anybody who learned the legend elsewhere. Flagged
   once, reaffirmed, applied. */
export type KpiTone = "self" | "lead" | "final" | "plain" | "critical" | "warning";

const KPI_TONE: Record<KpiTone, string> = {
  self: "bg-self-tint",
  lead: "bg-lead-tint",
  final: "bg-final-tint",
  plain: "bg-surface-mute",
  critical: "bg-critical-tint",
  warning: "bg-warning-tint",
};

/** Three (or four) tinted counts, directly under the header. */
export function KpiRow({ children }: { children: React.ReactNode }) {
  /* -- THE COLUMN COUNT COMES FROM THE CHILDREN, not from `auto-fit`.
        `repeat(auto-fit, minmax(9rem, 1fr))` was the tidy answer and it was
        wrong on a phone: 9rem is 144px, and three of them plus gaps need 448px.
        A 375–400px screen therefore got TWO columns and an orphan on a line of
        its own — three counts occupying two rows and ~150px, which is the
        stacking this row was written to avoid, arrived at by arithmetic instead
        of by a breakpoint.

        Counting is what makes "three counts, one row" true at every width
        rather than only above 448px. Four still fall to two-by-two on a phone,
        because four across 375px leaves ~80px a tile and the labels stop being
        readable — the honest place to wrap. -- */
  const count = React.Children.toArray(children).filter(Boolean).length;

  const columns =
    count <= 1
      ? "grid-cols-1"
      : count === 2
        ? "grid-cols-2"
        : count === 3
          ? "grid-cols-3"
          : count === 4
            ? "grid-cols-2 sm:grid-cols-4"
            /* -- FIVE GETS ITS OWN ROW, at the owner's instruction.
                  It fell into the catch-all below and capped at four columns,
                  so the fifth tile dropped to a line of its own — a full-width
                  card under four narrow ones, which reads as a different kind
                  of thing rather than the fifth of five. Reports has five since
                  "One side in" was added, and the production board has five
                  whenever anything is with management.
                  Still two-up on a phone and three at `sm`: five across 375px
                  is 60px a tile, where the labels stop being readable. -- */
            : count === 5
              ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
              : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";

  return (
    <div
      className={cn(
        /* -- ON A PHONE THIS IS ONE SWIPEABLE STRIP, not a grid.
              Reported against /reports: "table data starting from almost 3/4 of
              screen". Five tiles two-up is THREE stacked rows — about 170px of
              counts above a list somebody opened the screen to read, and the
              counts are context where the list is the job.

              Wrapping is what costs the height, so the fix is to stop wrapping:
              one row that scrolls sideways inside itself. The tiles keep their
              size and their labels stay readable, which is what the two-up
              compromise was protecting, and the row costs one row's height
              whether it holds three tiles or six.

              Sideways INSIDE ITSELF — `overflow-x-auto` on this element, so the
              page itself never widens. That is the fault the Settings tab strip
              had, where an unscrollable row made the whole document wider than
              the phone and shifted every screen sideways.

              The scrollbar is hidden because a permanent one under a 56px strip
              is most of a tile's worth of chrome; the partially-visible tile at
              the right edge is what says it scrolls. -- */
        "flex shrink-0 snap-x snap-mandatory gap-1.5 overflow-x-auto border-b border-rule px-3 py-2.5",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "[&>*]:min-w-[8.75rem] [&>*]:shrink-0 [&>*]:snap-start",
        /* From `sm` there is room to lay them out properly, so the grid comes
           back and the per-child minimum is released. */
        "sm:grid sm:gap-3 sm:overflow-x-visible sm:px-4 sm:py-3 sm:[&>*]:min-w-0 lg:px-6",
        columns,
      )}
    >
      {children}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  caption,
  tone = "plain",
  onSelect,
  active = false,
}: {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  tone?: KpiTone;
  /**
   * Makes the tile a filter.
   *
   * A count sitting above a list it describes invites a press — "show me those
   * three" — and a tile that does nothing when pressed reads as a broken
   * control rather than as a label. Optional, because a tile that filters
   * nothing should not pretend it can: the ones that stay `div`s are genuinely
   * read-only figures, and only a caller with something to filter passes this.
   */
  onSelect?: () => void;
  /** Whether this tile's filter is the one currently applied. */
  active?: boolean;
}) {
  const interactive = Boolean(onSelect);

  /* -- A real <button> when it does something, a <div> when it does not.
        A div with an onClick is unreachable by keyboard and announces nothing;
        §13.8 wants the control to BE a control. `aria-pressed` is what says
        "this filter is on" to a screen reader, since the ring alone says it
        only to somebody who can see it. -- */
  const Tag = interactive ? "button" : "div";

  return (
    <Tag
      {...(interactive
        ? {
            type: "button" as const,
            onClick: onSelect,
            "aria-pressed": active,
            title: `Show only: ${label}`,
          }
        : {})}
      className={cn(
        "min-w-0 rounded-card px-2.5 py-2 text-left sm:px-4 sm:py-2.5",
        KPI_TONE[tone],
        interactive &&
          "cursor-pointer transition-shadow duration-hover hover:shadow-dashboard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
        active && "ring-2 ring-primary",
      )}
    >
      {/* -- Written as utilities rather than `.type-label`, because the label
            has to give ground on a phone and a component class cannot be
            varied by breakpoint. At three-across on a 375px screen a tile is
            ~105px wide, and 12px uppercase at 0.05em tracking pushes "Pending
            your review" to three lines. 11px at tighter tracking holds it to
            two, and 11px is the floor this codebase set for itself (P31-6).

            `break-words` because a single long word — a department name, a
            future label — must wrap rather than widen the tile and push its
            neighbours off the row. -- */}
      <p className="break-words text-body-xs font-semibold uppercase leading-tight tracking-[0.02em] text-ink-muted sm:text-body-sm sm:tracking-[0.05em]">
        {label}
      </p>
      <p className="tabular text-display-sm leading-tight text-ink sm:text-display-md">{value}</p>
      {/* -- The caption is the first thing to go on a narrow screen.
            It explains a number that is already labelled, so it is the least
            load-bearing line in the tile and the one that costs three tiles
            their extra height. Still read by anybody on a laptop. -- */}
      {caption ? (
        <p className="hidden font-sans text-body-sm leading-tight text-ink-muted sm:block">
          {caption}
        </p>
      ) : null}
    </Tag>
  );
}

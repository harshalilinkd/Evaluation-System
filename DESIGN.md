# DESIGN.md — "Dossier"

## Design system for the LinkD Prints Performance Evaluation Platform

> Referenced by CLAUDE.md §13. Where this file and a phase prompt disagree,
> CLAUDE.md decides.

---

## 1. The idea

The appraisal platform is a modern, fast, and data-rich **SaaS dashboard**. The
interface should feel dynamic, clean, and highly visual. Users should be able to
parse complex data quickly through intuitive visualizations, clear card-based
layouts, and vibrant status indicators.

We are moving away from flat, document-style designs. The UI should feel like a
premium tech product: soft shadows, pill-shaped badges, bright accent colors to
draw the eye, and a unified, highly legible professional typeface.

Reference words: modern, techy, vibrant, clean, data-driven, approachable.
Anti-words: dull, flat, paper-like, institutional, rigid, monochromatic.

---

## 2. Colour tokens

Define once in `globals.css` as CSS variables and map into `tailwind.config.ts`.
Never write a raw hex in a component.

### Ground & Surfaces

```css
--background   #F4F7FE   /* Page background (cool, subtle gray/blue) */
--surface      #FFFFFF   /* Main cards, sidebars, topnav */
--surface-mute #F8F9FA   /* Secondary panels, table headers */
--rule         #E2E8F0   /* Standard borders (subtle) */
```

### Ink (Typography)

```css
--ink          #111827   /* Primary text, headings (near black for high contrast) */
--ink-muted    #6B7280   /* Secondary text, labels, chart axes */
--ink-invert-muted #D6DEE7 /* Muted text on a dark ground; inverts in dark */
--ink-faint    #9CA3AF   /* Placeholders, disabled states */
--ink-invert   #FFFFFF   /* Text on solid dark/accent backgrounds */
```

### Brand & Accents (Vibrant Dashboard Palette)

Drawn from the reference metrics and charts. Use these for graphs, progress
bars, and key data points.

```css
--accent-primary   #4F46E5  /* Primary buttons, active nav, focus rings (Indigo) */
--accent-cyan      #06B6D4  /* Secondary charts, soft UI elements */
--accent-pink      #EC4899  /* Alert highlights, chart accents */
--accent-green     #10B981  /* Positive trends, success states */
```

### Status & Feedback

```css
--success      #10B981   /* Approvals, positive delta */
--success-tint #D1FAE5
--warning      #F59E0B   /* Pending, variance flags */
--warning-tint #FEF3C7
--critical     #EF4444   /* Overdue, negative delta, destructive actions */
--critical-tint #FEE2E2
```

### Tier colours — RESERVED

The product's defining mechanic is that three rating layers collide (CLAUDE.md
§1). The reader has to know at a glance *who said this*, so the three tiers get
three fixed colours drawn from the accent palette above. They mean the same
thing on every screen, chart, badge and cell, and are never used decoratively.

```css
--self         #06B6D4   /* cyan   · Self rating (the employee) */
--self-tint    #CFFAFE
--lead         #EC4899   /* pink   · Lead rating (HOD / Supervisor) */
--lead-tint    #FCE7F3
--final        #4F46E5   /* indigo · Final (MD) — the authoritative answer */
--final-tint   #E0E7FF
```

`--success` / `--accent-green` (#10B981) is deliberately **not** a tier. Green
means "positive trend", and a green that also meant "the MD said this" would
make every good delta look like a final score.

### Sidebar — its own family

The rail does not follow the page. In the light theme it is Slate Navy while
every card is white, so its foreground tokens are separate: reaching for
`text-ink` inside it gives charcoal on charcoal.

```css
--sidebar           #1E293B  /* Slate navy rail */
--sidebar-ink       #F1F5F9  /* Nav labels */
--sidebar-ink-muted #94A3B8  /* Group headings, meta */
--sidebar-rule      #334155  /* Hairlines inside the rail */
--sidebar-active    #6366F1  /* Indigo, lifted for the dark ground */
```

### Dark theme

Both themes ship. `data-theme="dark"` on `<html>`, set **before first paint** by
an inline script in `app/layout.tsx` — applying it after hydration gives a
dark-theme user a full-brightness flash on every page load, which React cannot
prevent because the markup paints before it hydrates.

It is a **re-mapping, not a second palette**. Every token keeps its role, so no
component knows which theme it is in: `--surface` is still "the thing a card is
made of", it is simply #1E293B rather than #FFFFFF. Brand hues lift one step to
hold 4.5:1 on the darker ground. Tier identity is unchanged — cyan is still the
employee, pink still the lead, indigo still the MD; only the tints invert.

One structural difference: a soft shadow is invisible against a dark ground, so
`.card-surface` swaps its shadow for a hairline in dark. Same job, done by the
tool that works on that ground.

*This supersedes "light-only for v1", at the owner's instruction. Implemented
without `next-themes` — CLAUDE.md §17 still forbids a dependency outside §2, and
two attributes on `<html>` cost about forty lines.*

---

## 3. Typography

To keep the UI clean, professional, and uniform, we use one single font family
across the entire application.

```
UI & Display   "Inter" (or "Roboto")  → All interface text, headings, numbers, and tables
```

Load via `next/font` with `display: swap`.

| Token | Size / line | Weight | Tracking | Use Case |
|---|---|---|---|---|
| display-lg | 30 / 36 | 700 (Bold) | -0.02em | Dashboard hero numbers, Page titles |
| display-md | 24 / 32 | 600 (Semibold) | -0.01em | Section headers |
| display-sm | 18 / 28 | 600 (Semibold) | 0 | Widget titles, Card headers |
| body-lg | 16 / 24 | 400 (Regular) | 0 | Standard form inputs, primary reading text |
| body | 14 / 20 | 400 (Regular) | 0 | Table data, standard UI elements |
| body-sm | 12 / 16 | 400 (Regular) | 0 | Meta text, captions, chart labels |
| body-xs | 11 / 16 | 400 (Regular) | 0 | Dense chrome: table gutters, pill counts, axis labels, nav captions |
| label | 12 / 16 | 500 (Medium) | 0.05em, uppercase | Table headers, pill labels |

Rules:

- All numeric data (scores, monetary values, deltas) must use
  `font-variant-numeric: tabular-nums` to ensure chart and table alignment.
- Font weights should do the heavy lifting for hierarchy (e.g., Bold display-sm
  for a card title, Regular body for the content).

---

## 4. Space, shape, depth

- **Spacing scale**: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64.
- **Radius**: Soft and friendly. `8px` for inputs and buttons, `16px` or `20px`
  for main dashboard cards and widgets, `999px` for status pills and avatars.
- **Shadows over Borders**: The interface relies heavily on depth. Main dashboard
  cards should sit on the `--background` using a soft, diffused drop shadow
  (e.g., `box-shadow: 0 4px 20px rgba(0,0,0,0.05)`).
- **Gradients**: Allowed and encouraged for data visualizations (e.g., area
  charts fading into the background) and subtle primary button hover states.
- **Density**: Open and breathable. Dashboard widgets should have generous
  internal padding (minimum 20px–24px).

---

## 5. Signature components

### 5.1 Dashboard Cards

White surface (`--surface`), 16px border radius, soft drop shadow, no border.
Title in `display-sm` at the top left, often accompanied by an interactive
element (dropdown or kebab menu) at the top right.

### 5.2 Data Visualizations

- **Donut Charts**: Used for task completion or multi-metric summaries.
  High-contrast colors (Cyan, Green, Pink). A prominent central number (in
  `display-lg`) is encouraged.
- **Area/Line Charts**: Smooth, wavy splines. Lines should be bold (3px+), with
  a soft, semi-transparent gradient fill dropping down to the x-axis.
- **Bar Charts**: Rounded tops (radius 4px on the top corners of bars).

### 5.3 Status Pills (Badges)

Pill-shaped (999px radius). Highly vibrant. Use the `-tint` colors for the
background and the solid status color for the text and a small leading dot.

### 5.4 Metric Widgets

A standard card containing a label (`body-sm`, `--ink-muted`), a massive number
(`display-lg`, `--ink`), and a small trend indicator (e.g., "↑ +4.23%" in green
or "↓ -1.5%" in red).

---

## 6. Screen-level direction

**Shell**

- **Sidebar**: Edge-to-edge **Slate Navy** rail (`--sidebar`, #1E293B), pinned
  left, **collapsible** to 76px. It is the only large dark field in the light
  theme, and that is its job: it anchors the page, separates navigation from
  content without needing a border, and gives the indigo active state a ground
  to glow against. Nav items feature prominent icons. Active states use a soft
  `--sidebar-active` fill with white text — no left bar, the fill is the signal.
  Collapsed, labels fade out and icons centre; the label moves to `title` so a
  narrow rail is never nine unlabelled glyphs.

  *Changed from "white sidebar" at the owner's instruction. The rail has its own
  token family (`--sidebar-*`) precisely because its foreground does not follow
  the page — `text-ink` on navy is charcoal on charcoal.*
- **Topbar**: Minimal, and **glass**: a translucent surface over a backdrop blur,
  so content scrolling underneath reads as depth rather than vanishing at a hard
  edge. Contains the rail toggle, global search, the theme toggle, a notification
  bell (with coloured unread dot), and the user menu.
- **Content width**: capped at 1180px with 32px gutters. A page opts out with
  `data-full-bleed` on its root element — used by the dashboard, where the grid
  *is* the layout and a 1180px column leaves 700px of empty desk either side on
  a wide monitor.

**Dashboards (HR / HOD / MD)**

Masonry or grid layout of cards. Top row is usually 3 to 4 Metric Widgets
summarizing key data. Below that, mixed-width cards containing colorful Recharts
(wavy lines for evaluation trends over time, donuts for completion statuses) and
recent activity lists.

**Forms & Employee View**

Clean, centered column. Even data entry should feel modern — inputs with soft
gray borders that highlight to `--accent-primary` on focus. Progress represented
by a smooth, animated progress bar rather than flat nodes.

---

## 7. Quality bar — check before calling a screen done

- [ ] One uniform sans-serif font family used everywhere.
- [ ] Cards have consistent 16px+ border radiuses and soft shadows, avoiding
      heavy borders.
- [ ] Charts use smooth curves (splines) and vibrant accent colors, not flat
      monochrome.
- [ ] Key metrics pop using the `display-lg` heavy font weights.
- [ ] Empty, loading and error states feature modern illustrations or clean,
      centered text with a clear CTA.
- [ ] Keyboard: tab order sane, focus ring visible in `--accent-primary`.

- [ ] Tier colours used only for tiers — cyan, pink and indigo never decorate
      anything (§13.1).
- [ ] **375px**: nothing overflows, nothing under 44px is tappable. Employee
      screens are mobile-first — most employees open the link on a phone (§13.2).
- [ ] Exactly one primary action on screen (§13.3).
- [ ] No dead ends: every list has an empty state, every async action a loading
      state, every error says what to do next (§13.4).
- [ ] Autosave visible: "Saved HH:MM", never lose a half-filled form (§13.6).
- [ ] Contrast ≥ 4.5:1 for text, ≥ 3:1 for interface borders; labels tied to
      inputs (§13.8).
- [ ] `prefers-reduced-motion` honoured.

---

## 7a. Print

The dashboard aesthetic stops at the print boundary. §13.7 makes print a
first-class output: HR and the MD print a signature-ready pack, and a page that
is signed and filed is not a dashboard.

Print routes render pure white, black text, no shadows, no tints, no gradients.
Ruled tables mirroring the original paper forms, title in `display-lg`,
signature blocks at the foot with 40mm rules. A4 portrait, 18mm margins, page
numbers, `page-break-inside: avoid` on every card. Dedicated `/print` routes,
never a media query over the app shell.

---

## 8. Implementation status

**This file is the current state as of P10.** The UI-REFRESH phase migrated the
whole codebase onto the direction above: `app/globals.css` carries the §2 tokens
as RGB channel triplets, `tailwind.config.ts` consumes them through
`rgb(var(--token) / <alpha-value>)`, `app/layout.tsx` loads Inter alone, and
every component in `components/appraise/` is built on them. `/styleguide` is the
regression check.

### Components, and which section governs each

| Component | Section |
|---|---|
| `MetricWidget`, `StatTile`, `HeroCard`, `DashboardCard` | §5.1, §5.4 |
| `TrendAreaChart`, `CompletionBarChart`, `StatusDonutChart`, `ChartLegend` | §5.2 |
| `StatusChip`, `TierBadge` | §5.3 |
| `SegmentedProgress`, `SegmentedLegend` | §5.3 + §13.1 (tier colours, used as tiers) |
| `ProgressRail` (five §8 nodes), `StepRail` (arbitrary wizard steps) | §6 |
| `RatingScale`, `TickScale`, `SectionCard`, `ScoreStat`, `FormRenderer` | §6 Forms |
| `EmptyState`, `ErrorState`, `TableSkeleton`, `AutosaveIndicator` | §7 |

Two notes worth keeping:

- **`StatTile` / `HeroCard` were named by the P10 brief, not by this file.**
  They are variants of §5.1's card and §5.4's metric widget rather than a new
  species. `HeroCard`'s `night` tone uses `--ink` as a surface: §2 has no dark
  surface token, and adding a nineteenth colour outside the §2 block would
  contradict "this block is the only place a colour is defined".
- **`StepRail` is a sibling of `ProgressRail`, not a prop on it.** `ProgressRail`
  answers "where does this record stand in the state machine", and its node
  colours are tier colours carrying tier meaning. A wizard step is not a tier, so
  `StepRail` is accent throughout — tinting step 2 pink would imply the lead had
  said something.

Nothing in `lib/`, `supabase/` or the state machine is affected.

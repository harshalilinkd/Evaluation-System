/** Token inventory driving /styleguide. Names only — values live in globals.css. */

// Every swatch names its CSS variable and the Tailwind class that consumes it.
// The class strings are literals so Tailwind's content scanner emits them, and
// no hex is duplicated here — the page reads the real computed value off the
// document at runtime, which also proves the variable is actually wired up.

export type ColorToken = {
  /** CSS custom property, without the leading `--`. */
  variable: string;
  /** Tailwind class that paints the swatch. */
  swatchClass: string;
  /** What it is for, in the words of DESIGN.md §2. */
  usage: string;
  /** Set when the swatch needs light text to stay legible. */
  invertLabel?: boolean;
};

export type ColorGroup = {
  title: string;
  note?: string;
  tokens: ColorToken[];
};

export const COLOR_GROUPS: ColorGroup[] = [
  {
    title: "Ground & surfaces",
    tokens: [
      {
        variable: "background",
        swatchClass: "bg-background",
        usage: "page background (cool, subtle gray/blue)",
      },
      { variable: "surface", swatchClass: "bg-surface", usage: "main cards, sidebars, topnav" },
      {
        variable: "surface-mute",
        swatchClass: "bg-surface-mute",
        usage: "secondary panels, table headers",
      },
      { variable: "rule", swatchClass: "bg-rule", usage: "standard borders (subtle)" },
    ],
  },
  {
    title: "Ink",
    tokens: [
      {
        variable: "ink",
        swatchClass: "bg-ink",
        usage: "primary text, headings",
        invertLabel: true,
      },
      {
        variable: "ink-muted",
        swatchClass: "bg-ink-muted",
        usage: "secondary text, labels, chart axes",
        invertLabel: true,
      },
      {
        variable: "ink-faint",
        swatchClass: "bg-ink-faint",
        usage: "placeholders, disabled states",
        invertLabel: true,
      },
      { variable: "ink-invert", swatchClass: "bg-ink-invert", usage: "text on solid backgrounds" },
    ],
  },
  {
    title: "Brand & accents",
    note: "Use these for graphs, progress bars and key data points.",
    tokens: [
      {
        variable: "accent-primary",
        swatchClass: "bg-accent-primary",
        usage: "primary buttons, active nav, focus rings (Indigo)",
        invertLabel: true,
      },
      {
        variable: "accent-tint",
        swatchClass: "bg-accent-tint",
        usage: "active nav background, hover surfaces",
      },
      {
        variable: "accent-cyan",
        swatchClass: "bg-accent-cyan",
        usage: "secondary charts, soft UI elements",
        invertLabel: true,
      },
      {
        variable: "accent-pink",
        swatchClass: "bg-accent-pink",
        usage: "alert highlights, chart accents",
        invertLabel: true,
      },
      {
        variable: "accent-green",
        swatchClass: "bg-accent-green",
        usage: "positive trends, success states",
        invertLabel: true,
      },
    ],
  },
  {
    title: "Status & feedback",
    tokens: [
      {
        variable: "success",
        swatchClass: "bg-success",
        usage: "approvals, positive delta",
        invertLabel: true,
      },
      { variable: "success-tint", swatchClass: "bg-success-tint", usage: "success chip background" },
      {
        variable: "warning",
        swatchClass: "bg-warning",
        usage: "pending, variance flags",
        invertLabel: true,
      },
      { variable: "warning-tint", swatchClass: "bg-warning-tint", usage: "warning chip background" },
      {
        variable: "critical",
        swatchClass: "bg-critical",
        usage: "overdue, negative delta, destructive",
        invertLabel: true,
      },
      {
        variable: "critical-tint",
        swatchClass: "bg-critical-tint",
        usage: "critical chip background",
      },
    ],
  },
  {
    title: "Tier colours — reserved",
    note: "Never decorative. These three mean “who said this” on every screen, chart, badge and cell. Note that the success green is deliberately not a tier.",
    tokens: [
      {
        variable: "self",
        swatchClass: "bg-self",
        usage: "cyan · Self rating (the employee)",
        invertLabel: true,
      },
      { variable: "self-tint", swatchClass: "bg-self-tint", usage: "self chips, quoted blocks" },
      {
        variable: "lead",
        swatchClass: "bg-lead",
        usage: "pink · Lead rating (HOD / Supervisor)",
        invertLabel: true,
      },
      { variable: "lead-tint", swatchClass: "bg-lead-tint", usage: "lead chips, review column" },
      {
        variable: "final",
        swatchClass: "bg-final",
        usage: "indigo · Final (MD) — the authoritative answer",
        invertLabel: true,
      },
      { variable: "final-tint", swatchClass: "bg-final-tint", usage: "final chips, override cells" },
    ],
  },
];

/* ---------- Typography ---------- */

export type TypeToken = {
  token: string;
  /** Tailwind classes that apply the token. */
  className: string;
  family: string;
  spec: string;
  sample: string;
};

// One family everywhere (§3) — weight does the hierarchy work, so the `family`
// column is the same on every row by design.
export const TYPE_TOKENS: TypeToken[] = [
  {
    token: "display-lg",
    className: "text-display-lg",
    family: "Inter",
    spec: "30 / 36 · 700 · -0.02em",
    sample: "4.25",
  },
  {
    token: "display-md",
    className: "text-display-md",
    family: "Inter",
    spec: "24 / 32 · 600 · -0.01em",
    sample: "Annual Appraisal 2025–26",
  },
  {
    token: "display-sm",
    className: "text-display-sm",
    family: "Inter",
    spec: "18 / 28 · 600",
    sample: "Evaluation completion",
  },
  {
    token: "body-lg",
    className: "text-body-lg",
    family: "Inter",
    spec: "16 / 24 · 400",
    sample: "Standard form inputs and primary reading text.",
  },
  {
    token: "body",
    className: "text-body",
    family: "Inter",
    spec: "14 / 20 · 400",
    sample: "Table data and standard UI elements.",
  },
  {
    token: "body-sm",
    className: "text-body-sm",
    family: "Inter",
    spec: "12 / 16 · 400",
    sample: "Meta text, captions and chart labels.",
  },
  {
    token: "label",
    className: "type-label",
    family: "Inter",
    spec: "12 / 16 · 500 · 0.05em · uppercase",
    sample: "Reporting line",
  },
];

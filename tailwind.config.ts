/** Tailwind theme for the "Dossier" dashboard system. See DESIGN.md §2–§5. */

import type { Config } from "tailwindcss";
// Required by the shadcn primitives for their overlay transitions.
import tailwindcssAnimate from "tailwindcss-animate";

/* ---------- Token bridge ---------- */
// Every colour points at a CSS variable declared in app/globals.css, so a raw
// hex can never reach a component (DESIGN.md §2).
//
// The `<alpha-value>` placeholder is what makes opacity modifiers work. The
// variables hold RGB channel triplets precisely so this form is possible —
// without it Tailwind v3 emits nothing at all for `bg-primary/90`, and every
// hover state fails silently.
const color = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;
const token = (name: string) => `var(--${name})`;

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      /* ---------- Colour ---------- */
      //
      // Two layers:
      //   1. DESIGN.md names (background, surface, ink, accent-*, tier) — what
      //      domain components in /components/appraise write.
      //   2. shadcn's semantic names (primary, muted, border …) — what the
      //      untouched primitives in /components/ui already reference. Mapping
      //      them here themes those primitives without editing one of them.
      colors: {
        /* -- Ground & surfaces -- */
        background: color("background"),
        surface: {
          DEFAULT: color("surface"),
          mute: color("surface-mute"),
        },
        rule: color("rule"),

        /* -- Ink -- */
        ink: {
          DEFAULT: color("ink"),
          muted: color("ink-muted"),
          faint: color("ink-faint"),
          invert: color("ink-invert"),
          "invert-muted": color("ink-invert-muted"),
        },

        /* -- Brand & accents -- */
        //
        // One group serving two vocabularies. The shadcn primitives use bare
        // `bg-accent` / `text-accent-foreground` for hover and selected
        // surfaces, so DEFAULT and foreground must exist or every dropdown,
        // select and ghost button loses its hover state. DEFAULT is the soft
        // indigo tint, which is exactly what §6 asks for on active nav.
        //
        // The brand hues are always named in full: accent-primary, accent-cyan,
        // accent-pink, accent-green.
        accent: {
          DEFAULT: color("accent-tint"),
          foreground: color("accent-primary"),
          tint: color("accent-tint"),
          primary: color("accent-primary"),
          cyan: color("accent-cyan"),
          pink: color("accent-pink"),
          green: color("accent-green"),
        },

        /* -- Status & feedback -- */
        success: {
          DEFAULT: color("success"),
          tint: color("success-tint"),
        },
        warning: {
          DEFAULT: color("warning"),
          tint: color("warning-tint"),
        },
        critical: {
          DEFAULT: color("critical"),
          tint: color("critical-tint"),
        },

        /* -- Tier colours: RESERVED (DESIGN.md §2, CLAUDE.md §13.1) -- */
        // These three answer "who said this" on every screen, chart, badge and
        // cell. Nothing else may use them. Written out in full rather than
        // interpolated because Tailwind scans source statically — which is also
        // what makes it impossible to apply one by accident.
        self: {
          DEFAULT: color("self"),
          tint: color("self-tint"),
        },
        lead: {
          DEFAULT: color("lead"),
          tint: color("lead-tint"),
        },
        final: {
          DEFAULT: color("final"),
          tint: color("final-tint"),
        },

        /* -- Two record tints, chosen by the owner for the salary panel's
              joining and last-increment cards. TINT ONLY, no DEFAULT: there is
              no "joining" foreground and never should be. Kept beside the tiers
              because they share a row with them, and separate from them because
              they are not layers — see globals.css. -- */
        joining: {
          tint: color("joining-tint"),
        },
        /* Named `today`, not `current`: Tailwind already ships `bg-current` for
           `currentColor`, and a token that shadows a built-in is a trap. */
        today: {
          tint: color("today-tint"),
        },
        increment: {
          tint: color("increment-tint"),
        },
        /* -- The three decision cards. TINT ONLY: there is no "asked"
              foreground. They no longer wear the tier tints — the owner chose
              these — so the tier survives on each card as the small dot beside
              its label, which is now the only thing tying this row to the
              legend every other screen uses (§13.1). -- */
        asked: {
          tint: color("asked-tint"),
        },
        proposed: {
          tint: color("proposed-tint"),
        },
        approved: {
          tint: color("approved-tint"),
        },

        /* -- The rail -- */
        //
        // Its own family, not a reuse of surface/ink. The sidebar is Slate Navy
        // in the light theme while every card is white, so it is the one region
        // whose foreground and background do not follow the page. Giving it
        // named tokens is what stops somebody reaching for `text-ink` inside it
        // and getting charcoal on navy.
        sidebar: {
          DEFAULT: color("sidebar"),
          ink: color("sidebar-ink"),
          "ink-muted": color("sidebar-ink-muted"),
          rule: color("sidebar-rule"),
          active: color("sidebar-active"),
        },

        /* -- shadcn semantic layer -- */
        foreground: color("ink"),
        border: color("rule"),
        input: color("rule"),
        ring: color("accent-primary"),

        primary: {
          DEFAULT: color("accent-primary"),
          foreground: color("ink-invert"),
        },
        secondary: {
          DEFAULT: color("surface-mute"),
          foreground: color("ink"),
        },
        muted: {
          DEFAULT: color("surface-mute"),
          foreground: color("ink-muted"),
        },
        destructive: {
          DEFAULT: color("critical"),
          foreground: color("ink-invert"),
        },
        card: {
          DEFAULT: color("surface"),
          foreground: color("ink"),
        },
        popover: {
          DEFAULT: color("surface"),
          foreground: color("ink"),
        },
      },

      /* ---------- Typography (DESIGN.md §3) ---------- */
      // One family everywhere. `sans` is the default, so the primitives — which
      // use `font-sans` — land on Inter without being touched.
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },

      // Each token carries its own line-height, tracking and weight, so a
      // component never pairs a size class with a separate leading class and
      // gets it subtly wrong.
      fontSize: {
        "display-lg": ["30px", { lineHeight: "36px", letterSpacing: "-0.02em", fontWeight: "700" }],
        "display-md": ["24px", { lineHeight: "32px", letterSpacing: "-0.01em", fontWeight: "600" }],
        "display-sm": ["18px", { lineHeight: "28px", letterSpacing: "0", fontWeight: "600" }],

        "body-lg": ["16px", { lineHeight: "24px", letterSpacing: "0", fontWeight: "400" }],
        body: ["14px", { lineHeight: "20px", letterSpacing: "0", fontWeight: "400" }],
        "body-sm": ["12px", { lineHeight: "16px", letterSpacing: "0", fontWeight: "400" }],
        /* -- AN EIGHTH STEP, and it documents what was already there.
              `text-[11px]` appeared 47 times across the product — dense chrome:
              table gutters, pill counts, axis labels, nav captions. Forty-seven
              consistent uses is not drift, it is an unnamed step, and an
              arbitrary value cannot be checked, themed or found. Naming it
              changes nothing visually and makes the scale the whole truth.
              16px line-height matches body-sm; the fourteen sites that set
              their own `leading-*` still override it. */
        "body-xs": ["11px", { lineHeight: "16px", letterSpacing: "0", fontWeight: "400" }],

        // The uppercase half is applied by `.type-label` in globals.css — a
        // fontSize entry cannot set text-transform.
        label: ["12px", { lineHeight: "16px", letterSpacing: "0.05em", fontWeight: "500" }],
      },

      /* ---------- Shape & depth (DESIGN.md §4) ---------- */
      borderRadius: {
        input: token("radius-control"), // 8px — inputs and buttons (§4)
        control: token("radius-control"), // alias, same 8px
        card: token("radius-card"), // 16px — dashboard cards
        "card-lg": token("radius-card-lg"), // 20px — hero widgets
        pill: "999px",
        mark: token("radius-mark"), // 2px — a chart legend key, not a tier dot

        // The sizes the shadcn primitives already reference, mapped onto the
        // same scale so nothing renders off-system.
        sm: "6px",
        md: token("radius-control"),
        lg: token("radius-card"),
        xl: token("radius-card-lg"),
      },

      // Shadows over borders (§4). Depth carries the hierarchy now — a card is
      // lifted off the canvas, not drawn on it, so no card carries a border.
      boxShadow: {
        dashboard: "0 4px 20px rgb(0 0 0 / 0.05)",
        card: "0 4px 20px rgb(0 0 0 / 0.05)", // alias of dashboard
        "dashboard-hover": "0 8px 30px rgb(0 0 0 / 0.08)",
        overlay: "0 12px 40px rgb(0 0 0 / 0.12)",
      },

      maxWidth: {
        content: "1180px",
        form: "760px",
      },
      spacing: {
        sidebar: "264px",
        // The collapsed rail still shows an icon at a 44px touch target with
        // breathing room either side (§13.8), so it stays usable rather than
        // becoming a decorative strip.
        "sidebar-collapsed": "76px",
        topbar: "64px",
      },

      /* ---------- Motion ---------- */
      transitionDuration: {
        hover: "120ms",
        panel: "220ms",
        reveal: "400ms",
      },
      transitionTimingFunction: {
        panel: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      },

      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        "accordion-up": "accordion-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;

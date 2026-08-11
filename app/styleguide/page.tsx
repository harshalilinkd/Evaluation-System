/** Temporary /styleguide route: renders every design token so the system can be eyeballed. */

import type { Metadata } from "next";
import { Flag, Plus } from "lucide-react";

import { ColorSwatch } from "@/app/styleguide/color-swatch";
import { ComponentGallery } from "@/app/styleguide/component-gallery";
import { COLOR_GROUPS, TYPE_TOKENS } from "@/app/styleguide/tokens";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = { title: "Styleguide" };

/* ---------- Section shell ---------- */
// The "document section" device from DESIGN.md §3: a label-token header sitting
// above a hairline rule. Used here so the styleguide is itself an example of the
// convention it documents.
function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h2 className="section-header">{title}</h2>
        {note ? <p className="max-w-form font-sans text-body-sm text-ink-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default function StyleguidePage() {
  return (
    <div className="mx-auto max-w-content px-6 py-12">
      {/* ---------- Masthead ---------- */}
      <header className="space-y-3 pb-8">
        <p className="type-label text-ink-faint">Design system</p>
        <h1 className="font-sans text-display-lg text-ink">Dossier</h1>
        <p className="max-w-form font-sans text-body-lg text-ink-muted">
          An appraisal is a document of record. Warm paper, hairline rules, a serif that carries
          authority, and numbers set in a precise mono so a score reads as a fact. Against that
          ground, exactly three colours carry meaning.
        </p>
      </header>

      <Separator className="bg-rule" />

      <div className="space-y-16 py-12">
        {/* ---------- Colour ---------- */}
        {COLOR_GROUPS.map((group) => (
          <Section key={group.title} title={group.title} note={group.note}>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {group.tokens.map((token) => (
                <ColorSwatch key={token.variable} token={token} />
              ))}
            </div>
          </Section>
        ))}

        {/* ---------- Typography ---------- */}
        <Section
          title="Typography"
          note="Instrument Serif for display, Geist Sans for interface, IBM Plex Mono for anything numeric. Every token carries its own line-height and tracking."
        >
          <div className="divide-y divide-rule card-surface">
            {TYPE_TOKENS.map((type) => (
              <div key={type.token} className="grid gap-3 p-6 lg:grid-cols-[200px_1fr] lg:gap-8">
                <div className="space-y-1">
                  <p className="tabular text-body-sm text-ink">{type.token}</p>
                  <p className="font-sans text-body-sm text-ink-faint">{type.family}</p>
                  <p className="tabular text-body-sm text-ink-faint">{type.spec}</p>
                </div>
                <div className={`${type.className} min-w-0 text-ink`}>{type.sample}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------- Buttons ---------- */}
        <Section
          title="Buttons"
          note="One primary action per screen (DESIGN.md §13.3). Everything else is secondary, outline or ghost."
        >
          <div className="space-y-6 card-surface p-6">
            <div className="flex flex-wrap items-center gap-3">
              <Button>
                <Plus />
                Primary
              </Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link</Button>
              <Button variant="destructive">Destructive</Button>
            </div>

            <Separator />

            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button>Default</Button>
              <Button size="lg">Large</Button>
              <Button size="icon" aria-label="Add">
                <Plus />
              </Button>
              <Button disabled>Disabled</Button>
            </div>
          </div>
        </Section>

        {/* ---------- Inputs ---------- */}
        <Section
          title="Inputs"
          note="Labels are always tied to their control. Focus shows a 2px accent ring — tab through this block to check it."
        >
          <div className="grid max-w-form gap-6 card-surface p-6">
            <div className="space-y-2">
              <Label htmlFor="sg-name" className="type-label text-ink-muted">
                Employee name
              </Label>
              <Input id="sg-name" placeholder="Aarti Shah" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sg-code" className="type-label text-ink-muted">
                Employee code
              </Label>
              {/* Codes and IDs are mono so they align in a column (DESIGN.md §3). */}
              <Input id="sg-code" className="tabular" placeholder="EMP-01847" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sg-disabled" className="type-label text-ink-faint">
                Locked after submit
              </Label>
              <Input id="sg-disabled" disabled placeholder="Read-only once the layer is submitted" />
            </div>
          </div>
        </Section>

        {/* ---------- Badges ---------- */}
        <Section
          title="Badges"
          note="Tier badges use the reserved colours; status badges use tint backgrounds. The full StatusChip mapping in DESIGN.md §6.5 arrives with the component itself."
        >
          <div className="space-y-6 card-surface p-6">
            <div className="flex flex-wrap items-center gap-3">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="destructive">Destructive</Badge>
            </div>

            <Separator />

            {/* Tier identity: the dot-plus-word device from DESIGN.md §6.3. */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-pill border border-self/40 bg-self-tint px-3 py-1">
                <span className="h-2 w-2 rounded-pill bg-self" aria-hidden />
                <span className="type-label text-self">Self</span>
              </span>
              <span className="inline-flex items-center gap-2 rounded-pill border border-lead/40 bg-lead-tint px-3 py-1">
                <span className="h-2 w-2 rounded-pill bg-lead" aria-hidden />
                <span className="type-label text-lead">Manager</span>
              </span>
              <span className="inline-flex items-center gap-2 rounded-pill border border-final/40 bg-final-tint px-3 py-1">
                <span className="h-2 w-2 rounded-pill bg-final" aria-hidden />
                <span className="type-label text-final">Final</span>
              </span>
              <span className="inline-flex items-center gap-2 rounded-pill border border-warning/40 bg-warning-tint px-3 py-1">
                <Flag className="h-3 w-3 text-warning" aria-hidden />
                <span className="type-label text-warning">Variance</span>
              </span>
              <span className="inline-flex items-center gap-2 rounded-pill border border-critical/40 bg-critical-tint px-3 py-1">
                <span className="type-label text-critical">Overdue</span>
              </span>
            </div>
          </div>
        </Section>

        {/* ---------- Numerals ---------- */}
        <Section
          title="Numerals"
          note="Every number in the product is mono and tabular so columns align. This is the score treatment the collision view is built on."
        >
          <div className="grid gap-6 card-surface p-6 sm:grid-cols-3">
            {[
              { label: "Self", value: "3.80", className: "text-self", tint: "bg-self-tint" },
              { label: "Manager", value: "4.25", className: "text-lead", tint: "bg-lead-tint" },
              { label: "Final", value: "4.10", className: "text-final", tint: "bg-final-tint" },
            ].map((score) => (
              <div key={score.label} className={`rounded-control ${score.tint} p-4`}>
                <p className="type-label text-ink-muted">{score.label}</p>
                <p className={`tabular text-display-lg ${score.className}`}>{score.value}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------- Shape & depth ---------- */}
        <Section
          title="Shape and depth"
          note="Borders over shadows. One shadow token exists, for overlays only. No gradients."
        >
          <div className="flex flex-wrap items-end gap-6">
            <div className="space-y-2">
              <div className="h-20 w-32 rounded-control border border-rule bg-surface" />
              <p className="tabular text-body-sm text-ink-muted">rounded-control · 6px</p>
            </div>
            <div className="space-y-2">
              <div className="h-20 w-32 card-surface" />
              <p className="tabular text-body-sm text-ink-muted">rounded-card · 10px</p>
            </div>
            <div className="space-y-2">
              <div className="h-20 w-32 rounded-pill border border-rule bg-surface" />
              <p className="tabular text-body-sm text-ink-muted">rounded-pill · 999px</p>
            </div>
            <div className="space-y-2">
              <div className="h-20 w-32 rounded-card bg-surface shadow-overlay" />
              <p className="tabular text-body-sm text-ink-muted">shadow-overlay</p>
            </div>
          </div>
        </Section>

        <Separator className="bg-rule" />

        {/* ---------- Domain components ---------- */}
        {/* Everything in components/appraise, in every state. This is the
            regression check for the rest of the build: if a token moves, it
            shows up here first. */}
        <div className="space-y-3">
          <p className="type-label text-ink-faint">Components</p>
          <h2 className="font-sans text-display-lg text-ink">The pieces every screen is made of</h2>
          <p className="max-w-form font-sans text-body-lg text-ink-muted">
            Narrow the window to 375px to check the mobile behaviour: nothing should overflow, and
            every target should stay at least 44px.
          </p>
        </div>

        <ComponentGallery />
      </div>
    </div>
  );
}

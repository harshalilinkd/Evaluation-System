/** SectionCard — the visual unit of the whole product. DESIGN.md §6.7. */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * White surface, 1px rule, 10px radius, a label header with a hairline under it,
 * 24px inner padding (§6.7).
 *
 * Every form section and every report block is one of these. `page-break-inside:
 * avoid` is set here rather than on the print route, because §13.7 makes print a
 * first-class output and a section splitting across two sheets is the single
 * most common way a signature-ready document stops being one.
 */
export function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  /** Sits opposite the title — a count, a status chip, a small control. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "card-surface print:break-inside-avoid",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-4 border-b border-rule px-6 py-4">
        <div className="space-y-1">
          {/* The "document section" device: label token above a hairline (§3). */}
          <h2 className="type-label text-ink-muted">{title}</h2>
          {description ? (
            <p className="font-sans text-body-sm text-ink-muted">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>

      <div className="p-6">{children}</div>
    </section>
  );
}

/**
 * One question inside a SectionCard.
 *
 * §4 sets a 64px minimum row height on employee-facing forms; the generous
 * vertical rhythm is what makes a long appraisal read like a printed page
 * rather than a spreadsheet.
 */
export function QuestionRow({
  label,
  helpText,
  required,
  children,
  className,
}: {
  label: string;
  helpText?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-h-16 space-y-3 border-b border-rule py-5 last:border-b-0 last:pb-0 first:pt-0", className)}>
      <div className="space-y-1">
        {/* §3: question text is body-lg, help text is body-sm in ink-muted. */}
        <p className="font-sans text-body-lg text-ink">
          {label}
          {required ? (
            <span className="ml-1 text-critical" aria-hidden>
              *
            </span>
          ) : null}
          {required ? <span className="sr-only"> (required)</span> : null}
        </p>
        {helpText ? <p className="font-sans text-body-sm text-ink-muted">{helpText}</p> : null}
      </div>
      {children}
    </div>
  );
}

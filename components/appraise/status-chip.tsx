/** StatusChip. DESIGN.md §6.5 — the mapping is fixed; do not improvise. */

import { cn } from "@/lib/utils";

/**
 * The six §8 statuses plus the two derived states DESIGN.md §6.5 names.
 * RETURNED and OVERDUE are not stored — they are computed from the audit trail
 * and the cycle deadlines — but they read as statuses to a user, so they get
 * the same treatment.
 */
export type ChipStatus =
  | "DRAFT"
  | "OPEN"
  | "PENDING_HR_REVIEW"
  | "HR_APPROVED"
  | "MD_REVIEWED"
  | "INTERVIEW_DONE"
  // The four pre-blind statuses. Kept because historical rows carry them and a
  // chip that cannot render one would break every screen showing an old cycle.
  | "CYCLE_ACTIVE"
  | "SELF_SUBMITTED"
  | "LEAD_REVIEWED"
  | "MD_FINALIZED"
  | "CLOSED"
  | "RETURNED"
  | "OVERDUE";

/**
 * Two vocabularies, deliberately.
 *
 * DESIGN.md §8: "Never show an employee the words 'collision', 'variance flag',
 * 'override' or a raw status enum. Employees see: In progress · Submitted ·
 * Under review · Completed."
 *
 * So the same row renders differently depending on who is looking at it. The
 * internal labels are for HR, leads and the MD; `audience="employee"` collapses
 * the middle of the pipeline into "Under review", because whether the MD has
 * finalised is not the employee's business until the result is disclosed.
 */
const STATUS: Record<
  ChipStatus,
  { internal: string; employee: string; classes: string }
> = {
  // sunk / faint (§6.5)
  DRAFT: {
    internal: "Draft",
    employee: "In progress",
    classes: "bg-surface-mute border-rule text-ink-muted",
  },
  // accent
  CYCLE_ACTIVE: {
    internal: "Cycle active",
    employee: "In progress",
    classes: "bg-accent border-primary/40 text-accent-foreground",
  },
  // amber — the employee's tier
  SELF_SUBMITTED: {
    internal: "Self submitted",
    employee: "Submitted",
    classes: "bg-self-tint border-self/40 text-self",
  },
  // blue — the lead's tier
  LEAD_REVIEWED: {
    internal: "Lead reviewed",
    employee: "Under review",
    classes: "bg-lead-tint border-lead/40 text-lead",
  },
  // emerald — the final tier
  MD_FINALIZED: {
    internal: "MD finalized",
    employee: "Under review",
    classes: "bg-final-tint border-final/40 text-final",
  },
  /* -- AMEND-3's statuses. §8 fixes the employee vocabulary at four words:
        In progress · Submitted · Under review · Completed. Everything between
        HR review and the MD collapses to "Under review" — which of the two
        desks it is sitting on is not the employee's business. -- */
  OPEN: {
    internal: "Open",
    employee: "In progress",
    classes: "bg-accent border-rule text-ink",
  },
  PENDING_HR_REVIEW: {
    internal: "With HR",
    employee: "Under review",
    classes: "bg-self-tint border-self/40 text-self",
  },
  HR_APPROVED: {
    internal: "With the MD",
    employee: "Under review",
    classes: "bg-lead-tint border-lead/40 text-lead",
  },
  MD_REVIEWED: {
    internal: "MD reviewed",
    employee: "Under review",
    classes: "bg-final-tint border-final/40 text-final",
  },
  INTERVIEW_DONE: {
    internal: "Interview done",
    employee: "Under review",
    classes: "bg-final-tint border-final/40 text-final",
  },
  CLOSED: {
    internal: "Closed",
    employee: "Completed",
    classes: "bg-surface-mute border-rule text-ink-muted",
  },
  RETURNED: {
    internal: "Returned",
    employee: "Returned for changes",
    classes: "bg-warning-tint border-warning/40 text-warning",
  },
  OVERDUE: {
    internal: "Overdue",
    employee: "Overdue",
    classes: "bg-critical-tint border-critical/40 text-critical",
  },
};

export function StatusChip({
  status,
  audience = "internal",
  className,
}: {
  status: ChipStatus;
  audience?: "internal" | "employee";
  className?: string;
}) {
  const entry = STATUS[status];

  return (
    <span
      className={cn(
        "type-label inline-flex items-center rounded-pill border px-2.5 py-1",
        entry.classes,
        className,
      )}
    >
      {audience === "employee" ? entry.employee : entry.internal}
    </span>
  );
}

export const STATUS_LABELS = STATUS;

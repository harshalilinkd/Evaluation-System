/** The salary panel's card tints — one per card, chosen by the owner. */

/**
 * WHY THIS IS ITS OWN PALETTE RATHER THAN THE KPI ONE.
 *
 * The salary cards briefly borrowed `KPI_TONE`, on the reasoning that sharing a
 * map is what makes "uniformity" structural rather than two files agreeing on a
 * hex today and disagreeing after the next change. That reasoning still holds —
 * it is why this is a map and not six class strings scattered across two
 * screens — but it no longer points at the KPI palette: the owner has now
 * chosen a specific colour for every one of these six cards, and none of them
 * is a KPI tone. Folding six salary-only members into `KpiTone` would have left
 * a type that is mostly salary and a tile component offering tones no tile will
 * ever use.
 *
 * What IS still shared is the card's construction: borderless, `rounded-card`,
 * label in ink, value in ink. See `Figure` in the salary band.
 *
 * THREE CONSUMERS, and the third is in the OTHER MODULE: the production
 * appraisal's salary row wears `proposed` and `approved` too. §7 forbids
 * refactoring a staff function to serve the worker module — it does not
 * forbid sharing infrastructure, and a colour palette is infrastructure in the
 * same way the shared `FormRenderer` is (P24-5). No worker data crosses; only
 * the tokens do. The tone names are figure-ROLES, not staff concepts, which is
 * what makes them read correctly there: a supervisor's percentage IS a
 * proposal, and what HR sets IS the settled figure.
 *
 * ⚠ THE THREE DECISION CARDS NO LONGER WEAR THE TIER TINTS. §13.1 reserves
 * cyan, pink and indigo for "who said this", and until now the ask / proposal /
 * approval carried them — which was correct, because those three cards ARE the
 * three layers. They now carry the owner's own hues instead, so the DOT is what
 * keeps the connection to the legend used on every other screen. That is why
 * `SALARY_DOT` exists and why it must not quietly be dropped: without it these
 * cards would be coloured and say nothing about whose figure they hold.
 *
 * ⚠ `asked` IS GREEN, and that was raised before it was applied. UI2-2 keeps
 * green for movement — a trend, a delta — and out of the tier palette
 * deliberately, so a green card on a salary panel carries a faint "this is
 * good" that the employee's own asking price does not mean. Instructed anyway,
 * and recorded here so it reads as a decision rather than an oversight.
 */
export type SalaryTone =
  /* -- The record: what is true of this person's pay, said by nobody. -- */
  | "joining"
  | "today"
  | "increment"
  /* -- The decision: three figures, three authors. -- */
  | "asked"
  | "proposed"
  | "approved"
  /* -- Nothing to show yet. A card wearing management's colour before
        management has decided anything shows an approval nobody gave. -- */
  | "none";

/* Written out in full and never interpolated: Tailwind scans source
   statically, so `bg-${tone}-tint` compiles to nothing at all (P7-1). The
   verbosity is what makes a missing colour impossible rather than silent. */
export const SALARY_TINT: Record<SalaryTone, string> = {
  joining: "bg-joining-tint",
  today: "bg-today-tint",
  increment: "bg-increment-tint",
  asked: "bg-asked-tint",
  proposed: "bg-proposed-tint",
  approved: "bg-approved-tint",
  none: "bg-surface-mute",
};

/**
 * The tier mark, for the three cards that are a layer.
 *
 * Deliberately partial. The record cards have no dot because nobody said them —
 * a joining salary is a fact, not a statement — and the dot answers "who".
 * §13.8: it never stands alone, and always sits beside a label saying the same
 * thing in words.
 */
export const SALARY_DOT: Partial<Record<SalaryTone, string>> = {
  asked: "bg-self",
  proposed: "bg-lead",
  approved: "bg-final",
};

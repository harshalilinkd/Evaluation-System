/** What to call each reviewer on a report. Pure, and shared by every surface. */

/**
 * AT THE OWNER'S INSTRUCTION: "instead of names use their designations like
 * Managers Assessment Designer Coordinator Assessment", and "in report print
 * also instead of their names manager and design coordinator means their
 * designation should mention everywhere".
 *
 * ONE MODULE, because the rule was being restated on four surfaces — the
 * ratings table, the assessment bands, the salary panel and the printed sheet —
 * and they had already drifted apart into three different answers. A reader
 * comparing the screen with the printout should not have to work out that
 * "harshali.linkd" and "Manager" are the same person.
 *
 * THE REPORTING LEAD IS ALWAYS "MANAGER", and their designation is deliberately
 * not consulted. It is a free-text field on a profile holding whatever was
 * typed there — on the report that prompted this it held "HR-Admin", which is
 * an access level rather than a job. The one thing reliably true of that
 * position is the role they hold on THIS evaluation, and it fits in one word.
 *
 * THE SECOND REVIEWER TAKES THEIR DESIGNATION, because that is the whole point
 * of their column: "Design Coordinator" says in two words why a second opinion
 * is on the page, which "Manager" beside "Manager" could not.
 *
 * AND NEVER AN INVENTED ROLE. An earlier version fell back to the literal words
 * "2nd reviewer"; the owner's objection was exact — it is not a designation or
 * a role, it is this system's word for a slot, and printing it where a job
 * title goes says the two are the same kind of fact. With no designation on
 * record the fallback is the person's NAME, which is honest and identifies
 * them.
 */
export const LEAD_ROLE = "Manager";

/** First name only, for the places that still legitimately name a person. */
export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "They";
}

/** What the second reviewer's column, band or figure is called. */
export function coLeadRole(
  designation: string | null | undefined,
  name: string | null | undefined,
): string {
  return designation?.trim() || firstName(name);
}

/**
 * The possessive form, for a band heading — "Manager's assessment".
 *
 * Written here rather than at each call site so the apostrophe rule is decided
 * once: a role ending in s takes a bare apostrophe, which is the one thing
 * about this that somebody would otherwise get wrong on one surface and right
 * on the other.
 */
export function possessive(role: string): string {
  return role.endsWith("s") ? `${role}'` : `${role}'s`;
}

/**
 * "their manager", "their Design Coordinator", or "Harshali" — for a sentence
 * like "What {phrase} said about them".
 *
 * A DESIGNATION reads as a role and takes "their" in front of it: "their
 * Design Coordinator". A NAME does not — "their Harshali" is not English, so
 * the fallback drops the possessive and states the name plainly. `coLeadRole`
 * alone cannot make this distinction, because a caller heading a COLUMN wants
 * exactly the same string whichever case it is; a caller building a SENTENCE
 * needs to know which one it got.
 */
export function reviewerPhrase(
  designation: string | null | undefined,
  name: string | null | undefined,
): string {
  const role = designation?.trim();
  return role ? `their ${role}` : firstName(name);
}

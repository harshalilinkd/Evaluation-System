/** Ordering people by their employee ID. Shared by every roster that shows one. */

/**
 * The number at the end of an employee code, or Infinity when there is none.
 *
 * BY THE NUMBER, NOT THE STRING. Plain text sorting puts `AN-15` before `AN-4`,
 * which is the classic way a "sorted" list stops being sorted once it passes ten
 * people — and these codes run in joining order, so getting it wrong scrambles
 * exactly the sequence HR reads them in.
 *
 * Infinity for a missing or unnumbered code, so those sort LAST. An empty cell
 * at the top of a list reads as the list being broken; at the bottom it reads as
 * somebody whose details are not finished, which is what it is.
 */
function trailingNumber(code: string | null | undefined): number {
  const digits = /(\d+)\s*$/.exec(code ?? "");
  return digits ? Number(digits[1]) : Number.POSITIVE_INFINITY;
}

/**
 * Compare two people by employee ID: 01, 02, 03.
 *
 * ONE IMPLEMENTATION, because two screens show this list — Team review and
 * Settings › Users — and a roster that orders itself differently depending on
 * which one you opened is the kind of difference nobody can explain later.
 *
 * The prefix breaks ties, so two codes sharing a number keep a stable order
 * rather than depending on where the rows happened to arrive from.
 */
export function byEmployeeCode(
  a: { employeeCode?: string | null; employee_code?: string | null },
  b: { employeeCode?: string | null; employee_code?: string | null },
): number {
  /* -- BOTH SPELLINGS ACCEPTED, and that is not laziness. The two screens were
        written against different row shapes — one camelCase from a view, one
        snake_case straight off `profiles` — and renaming either would be a
        change to a whole file for the sake of this one function. -- */
  const codeA = a.employeeCode ?? a.employee_code ?? null;
  const codeB = b.employeeCode ?? b.employee_code ?? null;

  const byNumber = trailingNumber(codeA) - trailingNumber(codeB);
  if (byNumber !== 0) return byNumber;
  return (codeA ?? "").localeCompare(codeB ?? "");
}

/** Rendering a stored answer as text a person can read. Pure. */

import { SCALE_0_5_LABELS } from "@/components/appraise/tier";
import { TICK_3_VALUES } from "@/lib/evaluations/scoring";
import type { FormQuestion } from "@/lib/forms/types";
import { formatDate } from "@/lib/utils/date";

/**
 * One answer, as text.
 *
 * Returns null for "not answered" rather than an empty string, so a caller can
 * tell the difference between a blank answer and an answer of "" — and so §11's
 * rule that missing is not zero survives all the way to the page.
 *
 * The scale labels come from `SCALE_0_5_LABELS`, which is asserted against
 * CLAUDE.md §6 itself (P7-4). §6 says "fixed wording — do not paraphrase", and a
 * report HR reads to make a pay decision is the last place to restate them.
 */
export function readableAnswer(question: FormQuestion, answer: unknown): string | null {
  if (answer === null || answer === undefined) return null;
  if (typeof answer === "string" && answer.trim() === "") return null;
  if (Array.isArray(answer) && answer.length === 0) return null;

  switch (question.responseType) {
    case "SCALE_0_5": {
      const value = Number(answer);
      if (!Number.isFinite(value)) return null;
      const label = SCALE_0_5_LABELS.find((l) => l.value === value);
      // An out-of-range value is shown as itself rather than silently dropped —
      // P4-10 scores it as null, and the report should let somebody see why.
      return label ? `${label.value} · ${label.full}` : String(value);
    }

    case "TICK_3": {
      const key = String(answer);
      return key in TICK_3_VALUES
        ? key
            .split("_")
            .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
            .join(" ")
        : key;
    }

    case "BOOLEAN":
      // `false` is a real answer to "Any concern about this person?" (P4-9).
      return answer === true ? "Yes" : answer === false ? "No" : null;

    case "DATE":
      return typeof answer === "string" ? formatDate(answer) : null;

    case "SINGLE_SELECT": {
      const option = question.options?.find((o) => o.value === answer);
      return option?.label ?? String(answer);
    }

    case "MULTI_SELECT": {
      if (!Array.isArray(answer)) return String(answer);
      const labels = answer.map((value) => {
        const option = question.options?.find((o) => o.value === value);
        return option?.label ?? String(value);
      });
      return labels.join(", ");
    }

    case "NUMBER":
      return Number.isFinite(Number(answer)) ? String(answer) : null;

    default:
      return String(answer);
  }
}

/** Is this a free-text question? Decides which band an answer belongs in. */
export function isNarrative(question: FormQuestion): boolean {
  return question.responseType === "TEXT_LONG" || question.responseType === "TEXT_SHORT";
}

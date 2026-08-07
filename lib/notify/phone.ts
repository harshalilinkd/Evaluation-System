/** E.164 normalisation. CLAUDE.md §10 — "default country +91". Pure, no imports. */

/**
 * Why this returns a reason rather than null.
 *
 * The distribution screen has to tell HR what to do about a number it cannot
 * use, and "invalid" is not actionable. "That is a landline" and "that is 9
 * digits" lead to different fixes, and the person fixing it is looking at a
 * table of 47 rows, not at one number.
 */
export type PhoneFailure =
  | "EMPTY"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "INVALID_CHARS"
  | "AMBIGUOUS_COUNTRY";

export type PhoneResult =
  | { ok: true; e164: string }
  | { ok: false; reason: PhoneFailure; message: string };

/** One sentence per failure, addressed to HR. Shown in the row's tooltip. */
export const PHONE_FAILURE_MESSAGE: Record<PhoneFailure, string> = {
  EMPTY: "No phone number on record.",
  TOO_SHORT: "Too short for a mobile number — Indian mobiles are 10 digits.",
  TOO_LONG: "Too long for a mobile number.",
  INVALID_CHARS: "Contains characters that are not part of a phone number.",
  AMBIGUOUS_COUNTRY: "Starts with + but is not a country code we can send to.",
};

function fail(reason: PhoneFailure): PhoneResult {
  return { ok: false, reason, message: PHONE_FAILURE_MESSAGE[reason] };
}

/**
 * Indian mobile numbers start 6, 7, 8 or 9. Everything shorter, or starting
 * 0-5, is a landline or a service number, and WhatsApp will never reach it.
 *
 * Rejecting them here rather than letting the provider do it is the difference
 * between HR seeing "that is a landline" in the table before sending, and
 * seeing a failed row an hour later.
 */
const INDIAN_MOBILE_FIRST_DIGIT = /^[6-9]/;

/**
 * Normalise a raw phone number to E.164, or explain why not.
 *
 * Accepted, all yielding +919876543210:
 *   9876543210        bare 10 digits, gets the default country
 *   09876543210       leading trunk zero, stripped
 *   +91 98765 43210   already international, spaces removed
 *   91-9876543210     country code without the plus
 *   (+91) 98765-43210 brackets and hyphens removed
 *
 * `defaultCountry` is "+91" from DEFAULT_COUNTRY_CODE (§15). It is a parameter
 * rather than read from the environment so this stays pure and testable — the
 * caller reads the env once.
 */
export function normaliseToE164(raw: string | null | undefined, defaultCountry = "+91"): PhoneResult {
  if (raw === null || raw === undefined) return fail("EMPTY");

  const trimmed = raw.trim();
  if (trimmed === "") return fail("EMPTY");

  // Separators people actually type. Everything else is suspicious, so it is
  // caught below rather than silently discarded — a number containing letters
  // is far more likely to be a note ("9876543210 (old)") than a typo.
  const cleaned = trimmed.replace(/[\s()\-.–—]/g, "");

  if (!/^\+?\d+$/.test(cleaned)) return fail("INVALID_CHARS");

  const hadPlus = cleaned.startsWith("+");
  let digits = hadPlus ? cleaned.slice(1) : cleaned;

  if (digits.length === 0) return fail("EMPTY");

  const country = defaultCountry.replace(/\D/g, "") || "91";

  /* -- Already carrying the country code -- */
  if (digits.startsWith(country) && digits.length === country.length + 10) {
    const national = digits.slice(country.length);
    return finishIndian(national, country);
  }

  /* -- An explicit + with some other country code -- */
  //
  // We cannot validate the national format of a country we know nothing about,
  // and guessing would be worse than refusing: a wrongly "corrected" number
  // fails silently at the provider, or reaches a stranger.
  if (hadPlus && !digits.startsWith(country)) {
    return fail("AMBIGUOUS_COUNTRY");
  }

  /* -- Trunk zero -- */
  //
  // Only stripped when what remains is a plausible national number. Stripping
  // unconditionally would turn a 9-digit typo into a 8-digit one and change the
  // error from TOO_SHORT to something more confusing.
  if (digits.startsWith("0") && digits.length === 11) {
    digits = digits.slice(1);
  }

  return finishIndian(digits, country);
}

function finishIndian(national: string, country: string): PhoneResult {
  if (national.length < 10) return fail("TOO_SHORT");
  if (national.length > 10) return fail("TOO_LONG");
  // A 10-digit number starting 0-5 is not a mobile, so no amount of formatting
  // makes it reachable on WhatsApp.
  if (!INDIAN_MOBILE_FIRST_DIGIT.test(national)) return fail("TOO_SHORT");

  return { ok: true, e164: `+${country}${national}` };
}

/**
 * For display in the table: +919876543210 -> +91 98765 43210.
 *
 * Never used for sending. E.164 is what goes to the provider; this is only so a
 * human can check a number against the one in their records at a glance.
 */
export function formatForDisplay(e164: string): string {
  const match = /^\+(\d{1,3})(\d{5})(\d{5})$/.exec(e164);
  if (!match) return e164;
  return `+${match[1]} ${match[2]} ${match[3]}`;
}

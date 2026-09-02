/** Which of a person's two contact pairs a message goes to. One rule, one place. */

import type { TemplateKey } from "@/lib/notify/templates";

/**
 * A message is either about somebody PERSONALLY or about their ADMINISTRATIVE
 * job, and the two can legitimately reach different places.
 *
 * HR is an employee too. Her own self-evaluation and the reviews she writes as
 * a manager are about her as a person in the company; HR administration is her
 * job function. So the first two go to a personal number and address, and the
 * third to official ones.
 *
 * THE TEMPLATE DECIDES, NOT THE RECIPIENT — and that is the whole design.
 *
 * A flag on the profile could not express this: the same person receives some
 * messages personally and others in their administrative capacity, on the same
 * day. What varies is the MESSAGE, and a template already knows its own
 * audience — `selfEvaluationInvite` only ever goes to an evaluatee,
 * `hrDueDigest` only ever to HR. So the audience is a property of the template
 * and is written down once, here.
 *
 * It is a `Record` over the full union rather than a partial map with a
 * default: a template added without an entry is a COMPILE ERROR, not a message
 * that quietly goes to the wrong address. The bell's destination map is the
 * same device for the same reason.
 */
export type ContactPurpose = "personal" | "official";

export const TEMPLATE_PURPOSE: Record<TemplateKey, ContactPurpose> = {
  /* ====================================================================
     THE LINE, AT THE OWNER'S EXPLICIT INSTRUCTION:

       PERSONAL is only ever YOUR OWN APPRAISAL — the form you fill in about
       yourself, it coming back to you, and the result.

       OFFICIAL is everything you receive BECAUSE OF A ROLE YOU HOLD: rating
       your team, a report waiting on you, an overdue notice, a digest.

     In their words: "all official emails on official no ... she'll get email
     and message on personal ids only when cycle launch for hr as a employee,
     they will fill the form self evaluation for them".
     ==================================================================== */

  /* -- Your own appraisal. Yours, personally. -- */
  selfEvaluationInvite: "personal",
  selfEvaluationReminder: "personal",
  selfEvaluationOverdue: "personal",
  formReturned: "personal",
  evaluationClosed: "personal",

  /* -- Rating somebody else. OFFICIAL, and this REVERSES an earlier
        instruction that filed it as personal on the reasoning that rating your
        own reports is about you as a person rather than an administrative
        duty. The owner has reversed it: you are asked to rate those people
        because of the position you hold, and it should reach you where work
        reaches you. Recorded rather than quietly swapped, because the note it
        replaces argued the opposite.

        It is also what makes the production sheet land correctly. HR is the
        Reports-to of two shop-floor workers, so the sheet was going to their
        personal address — reported, and this is the fix. -- */
  workerRatingInvite: "official",
  leadReviewInvite: "official",
  leadReviewReminder: "official",
  leadReviewOverdue: "official",

  /* -- The administrative job. Everything received BECAUSE of the role. -- */
  hrDueDigest: "official",
  incrementsOverdue: "official",
  evaluationsOverdue: "official",
  reportReady: "official",
  evaluationFinalised: "official",

  /* -- The MD's one message, and it is the same kind of thing: they receive it
        because they approve, not because it is about them. -- */
  mdReviewPending: "official",
};

/**
 * The two columns a caller has to select. Exported so a query cannot select
 * three of the four and silently lose the fallback.
 */
export const CONTACT_COLUMNS = "email, phone_e164, work_email, work_phone_e164" as const;

/** Whatever shape the caller loaded, as long as it has the four columns. */
export type ContactSource = {
  email?: string | null;
  phone_e164?: string | null;
  work_email?: string | null;
  work_phone_e164?: string | null;
};

export type Contact = { phone: string | null; email: string | null };

/**
 * Where this message goes for this person.
 *
 * BLANK FALLS BACK TO THE PERSONAL PAIR, and that is what makes the whole
 * feature opt-in: a person who has never filled in a work contact behaves
 * exactly as they did before, so switching this on changes nothing for anybody
 * who does not need it. There is no state in which somebody stops being
 * reachable because a new column is empty.
 *
 * THE TWO HALVES FALL BACK INDEPENDENTLY. Somebody with an official email and
 * no second phone number gets administrative mail at work and administrative
 * WhatsApp on their personal number — which is the honest answer, and better
 * than an all-or-nothing rule that would either lose the address they set or
 * refuse to send at all.
 */
export function contactFor(person: ContactSource, template: TemplateKey): Contact {
  if (TEMPLATE_PURPOSE[template] === "official") {
    return {
      phone: person.work_phone_e164 ?? person.phone_e164 ?? null,
      email: person.work_email ?? person.email ?? null,
    };
  }
  return { phone: person.phone_e164 ?? null, email: person.email ?? null };
}

/**
 * Whether this person has a separate work contact at all.
 *
 * For the screens that explain where a message went. Somebody with neither is
 * the ordinary case and needs no explanation; somebody with one is worth
 * saying so, because "why did that go to my personal number" is otherwise a
 * question with no answer on screen.
 */
export function hasWorkContact(person: ContactSource): boolean {
  return Boolean(person.work_email || person.work_phone_e164);
}

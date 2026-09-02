/**
 * Every outbound message string in the product. CLAUDE.md §10, DESIGN.md §8.
 *
 * NOTHING ELSE MAY CONTAIN A MESSAGE STRING. Not a server action, not a
 * component, not a catch block. A message that lives beside the code that sends
 * it gets edited by whoever is touching that code, and the four places an
 * employee is addressed drift into four different voices.
 *
 * The company signs off as LinkD Prints. The P11 brief's example text says
 * "LD Silk Mills", which is the name P8-PATCH corrected throughout — kept
 * correct here rather than reintroduced.
 */

/* ---------- Palette ---------- */

/**
 * The one place in the repo where a hex colour is written outside globals.css,
 * and it is unavoidable: an email client cannot read a CSS custom property, and
 * roughly half of them strip <style> blocks entirely, so every colour has to be
 * an inline literal.
 *
 * These values mirror DESIGN.md §2 exactly. If a token changes there, change it
 * here — they cannot be derived from each other across that boundary.
 */
const EMAIL = {
  night: "#111827", // --ink
  canvas: "#F4F7FE", // --background
  surface: "#FFFFFF", // --surface
  ink: "#111827", // --ink
  inkMuted: "#6B7280", // --ink-muted
  inkFaint: "#9CA3AF", // --ink-faint
  invert: "#FFFFFF", // --ink-invert
  rule: "#E2E8F0", // --rule
} as const;

export type RenderedMessage = {
  /** Email only. WhatsApp has no subject line. */
  subject?: string;
  /** The WhatsApp body, and the plain-text half of an email. */
  body: string;
  /** The HTML half of an email. Absent for WhatsApp-only templates. */
  html?: string;
};

export type TemplateKey =
  | "selfEvaluationInvite"
  | "selfEvaluationReminder"
  | "selfEvaluationOverdue"
  | "leadReviewInvite"
  | "leadReviewReminder"
  | "leadReviewOverdue"
  | "hrDueDigest"
  | "incrementsOverdue"
  | "evaluationsOverdue"
  // `mdReviewDigest` was here. The MD gets one message only — see the note
  // beside where its body used to live, and `MD_MAY_RECEIVE` in dispatch.ts.
  | "mdReviewPending"
  | "reportReady"
  | "formReturned"
  | "evaluationFinalised"
  | "evaluationClosed"
  /* -- The production round's own invite. The worker module has sent NOTHING
        since it was built: a round opened and the only way anybody learned of
        it was opening the app and noticing. Its own key rather than reusing
        `leadReviewInvite`, because that one says the employee is rating
        themselves at the same time — true on the staff form, and on the shop
        floor the worker fills nothing (§7's isolation, applied to wording). -- */
  | "workerRatingInvite";

/** Shown in the history drawer and the template filter, so HR never reads a key. */
export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  selfEvaluationInvite: "Self-evaluation invite",
  selfEvaluationReminder: "Reminder",
  selfEvaluationOverdue: "Overdue notice",
  leadReviewInvite: "Manager rating invite",
  leadReviewReminder: "Manager rating reminder",
  leadReviewOverdue: "Manager rating overdue",
  hrDueDigest: "What is due (to HR)",
  incrementsOverdue: "Increments overdue (to HR)",
  evaluationsOverdue: "Forms overdue (to HR)",
  mdReviewPending: "Management review pending",
  reportReady: "Report ready for HR",
  formReturned: "Form returned",
  evaluationFinalised: "Finalised (to HR)",
  evaluationClosed: "Result available",
  workerRatingInvite: "Production rating invite",
};

/* -- ONE VOICE, IN ONE PLACE.
      Thirteen bodies were normalised by hand and the fourteenth was missed,
      because its sign-off is interpolated inline rather than written as its own
      literal — so a search for the string did not find it. A constant is what
      stops a fifteenth template inventing a fifteenth voice. P11-16. -- */
const SIGN_OFF = "— LinkD Prints";

/* ---------- HTML shell ---------- */

/**
 * DESIGN.md §5.1 and §6, rebuilt for email: night header band, white body card
 * on the canvas background, one button in night.
 *
 * Table-based and inline-styled throughout, because Outlook renders through
 * Word's HTML engine — no flexbox, no grid, no `max-width` on a div, no
 * shorthand `padding` it can be trusted with. The 600px cap is the width every
 * client agrees on.
 *
 * The P11 brief asks for a 26px radius. DESIGN.md §4 defines 16px for a card and
 * 20px for a hero and no 26px step; the brief wins on its own screen, so 26px is
 * used here and only here, on the email card. Noted so it does not look like a
 * stray value.
 */
function shell({ heading, bodyHtml, cta, personal = true }: {
  heading: string;
  bodyHtml: string;
  cta?: { label: string; href: string };
  /* -- Whether this message carries a link meant for one person.
        The footer said "this link is personal to you, do not forward it" on
        EVERY email — including the digests, which carry a link to an admin
        screen and go to several people at once. A standing warning that is
        untrue on a third of the messages is one nobody reads on the two thirds
        where it matters. -- */
  personal?: boolean;
}): string {
  const button = cta
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px 0;">
        <tr>
          <td align="center" bgcolor="${EMAIL.night}" style="border-radius:8px;">
            <a href="${cta.href}"
               style="display:inline-block;padding:14px 28px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:${EMAIL.invert};text-decoration:none;border-radius:8px;">
              ${cta.label}
            </a>
          </td>
        </tr>
      </table>`
    : "";

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:${EMAIL.canvas};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${EMAIL.canvas};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:${EMAIL.surface};border-radius:26px;overflow:hidden;">

          <!-- Night header band -->
          <tr>
            <td style="background-color:${EMAIL.night};padding:22px 32px;">
              <span style="font-family:Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:${EMAIL.invert};letter-spacing:-0.01em;">Appraisal</span>
              <span style="font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;color:#9CA3AF;letter-spacing:0.08em;text-transform:uppercase;padding-left:10px;">LinkD Prints</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 16px 0;font-family:Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;color:${EMAIL.ink};">${heading}</h1>
              ${bodyHtml}
              ${button}
            </td>
          </tr>

          <!-- Foot -->
          <tr>
            <td style="border-top:1px solid ${EMAIL.rule};padding:20px 32px;">
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${EMAIL.inkFaint};">
                ${personal ? "This link is personal to you. Please do not forward it.<br>" : ""}
                LinkD Prints &middot; Sent by the HR team &middot; Please do not reply to this message
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * A labelled detail block — the facts, out of the prose.
 *
 * A deadline inside a sentence is a deadline somebody has to read a sentence to
 * find. These are the two or three things the reader is actually looking for,
 * set apart so the message can be scanned rather than read.
 *
 * A table rather than a definition list: Outlook renders `dl` inconsistently and
 * strips the margins, and half of email clients drop `<style>` entirely (P11-14),
 * so structure has to be built from the elements that survive.
 */
function details(rows: Array<[string, string]>): string {
  if (rows.length === 0) return "";
  return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;border-collapse:collapse;">
        ${rows
          .map(
            ([label, value]) => `
        <tr>
          <td style="padding:6px 24px 6px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${EMAIL.inkFaint};white-space:nowrap;">${escapeHtml(label)}</td>
          <td style="padding:6px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:${EMAIL.ink};">${escapeHtml(value)}</td>
        </tr>`,
          )
          .join("")}
      </table>`;
}

/** A courteous close. Every message ends the same way, because they are all from the same team. */
function signOff(): string {
  return `<p style="margin:24px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${EMAIL.inkMuted};">Thank you,<br><span style="font-weight:600;color:${EMAIL.ink};">The HR team</span><br><span style="font-size:13px;color:${EMAIL.inkFaint};">LinkD Prints</span></p>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 12px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${EMAIL.inkMuted};">${escapeHtml(text)}</p>`;
}

/**
 * Everything interpolated into the HTML is escaped. A person's name is
 * user-controlled data, and an unescaped apostrophe or angle bracket in a name
 * is the ordinary case, not the attack.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------- The templates ---------- */

/**
 * §10's wording, verbatim from the brief apart from the company name.
 *
 * The link is a parameter and never a default: a template that could render
 * without one would eventually be sent without one.
 */
export function selfEvaluationInvite(v: {
  name: string;
  period: string;
  dueDate: string;
  link: string;
}): RenderedMessage {
  return {
    subject: `Your performance evaluation for ${v.period} is open`,
    /*
      WHATSAPP IS NOT A PARAGRAPH.

      Every template used to be one run-on line, so the reader had to parse a
      sentence to find the deadline and the link was buried mid-paragraph. Three
      changes, applied to all of these:

      - Line breaks and a *bold* first line, which WhatsApp renders. The subject
        of the message is readable from the notification preview alone.
      - THE LINK SITS ALONE ON ITS OWN LINE. WhatsApp ends a hyperlink at
        whitespace, so a URL with prose either side is easy to mistap and, on
        some clients, gets punctuation swept into it.
      - The deadline on its own labelled line rather than inside a sentence.
    */
    body:
      `📋 *Your performance evaluation is open*\n\n` +
      `Hello ${v.name},\n\n` +
      `Your evaluation for ${v.period} is now open. Please fill in your self-assessment — it takes about ten minutes.\n\n` +
      `Due by: ${v.dueDate}\n\n` +
      `Open your form:\n${v.link}\n\n` +
      `This link is personal to you. Please do not forward it.\n\n` +
      SIGN_OFF,
    html: shell({
      heading: "📋 Your performance evaluation is open",
      bodyHtml:
        p(`Dear ${v.name},`) +
        p("Your self-evaluation is now open. It takes about ten minutes, and your answers are read by HR and your head of department.") +
        details([["Period", v.period], ["Please complete by", v.dueDate]]) +
        signOff(),
      cta: { label: "Open your form", href: v.link },
    }),
  };
}

export function selfEvaluationReminder(v: {
  name: string;
  period: string;
  dueDate: string;
  days: number;
  link: string;
}): RenderedMessage {
  const daysLeft = `${v.days} ${v.days === 1 ? "day" : "days"} left`;
  return {
    subject: `${daysLeft} to complete your evaluation for ${v.period}`,
    body:
      `⏳ *A reminder — your evaluation is still open*\n\n` +
      `Hello ${v.name},\n\n` +
      `Your evaluation for ${v.period} has not been submitted yet — ${daysLeft}.\n\n` +
      `Due by: ${v.dueDate}\n\n` +
      `Pick up where you left off:\n${v.link}\n\n` +
      `This link is personal to you. Please do not forward it.\n\n` +
      SIGN_OFF,
    html: shell({
      heading: "⏳ A reminder about your evaluation",
      bodyHtml:
        p(`Dear ${v.name},`) +
        p("Your self-evaluation is still open. We would be grateful if you could complete it before the date below.") +
        details([["Period", v.period], ["Due", v.dueDate], ["Time left", daysLeft]]) +
        signOff(),
      cta: { label: "Open your form", href: v.link },
    }),
  };
}

/**
 * "Firmer, one line, no guilt."
 *
 * So: state the fact and what to do. No "you have failed to", no "we are still
 * waiting", no exclamation mark. The person is late, they know they are late,
 * and a chasing message that moralises gets ignored by the people it is aimed at.
 */
export function selfEvaluationOverdue(v: {
  name: string;
  period: string;
  dueDate: string;
  link: string;
}): RenderedMessage {
  return {
    subject: `Your evaluation for ${v.period} was due on ${v.dueDate}`,
    body:
      `⚠️ *Your evaluation is past its date*\n\n` +
      `Hello ${v.name},\n\n` +
      `Your self-evaluation for ${v.period} was due on ${v.dueDate} and has not been submitted.\n\n` +
      `Please complete it as soon as you can:\n${v.link}\n\n` +
      SIGN_OFF,
    html: shell({
      heading: "⚠️ Your evaluation is now overdue",
      bodyHtml:
        p(`Dear ${v.name},`) +
        p("Your self-evaluation has passed its date and is still open. Please complete it at your earliest convenience — it remains open and nothing has been lost.") +
        details([["Period", v.period], ["Was due", v.dueDate]]) +
        signOff(),
      cta: { label: "Complete it now", href: v.link },
    }),
  };
}


/**
 * P13: the lead has finished, so the record is now on the MD's desk.
 *
 * It carries no score. §9 hands the MD the collision view, and a number in a
 * WhatsApp message is a rating disclosed on a channel with no access control
 * around it — the point of the message is that there is something to look at,
 * not what it says.
 */
/**
 * The lead's form is open. It says THAT and nothing more.
 *
 * P10-REV wrote this to replace `leadReviewPending`, whose body said "{employee}
 * has submitted their self-evaluation" — true under the old sequential flow, and
 * a readout of the other side under blind rating. Under §5 the lead may not know
 * whether the employee has started, finished, or not opened it at all.
 */
export function leadReviewInvite(v: {
  leadName: string;
  employeeName: string;
  department: string;
  period: string;
  dueDate: string;
  link: string;
}): RenderedMessage {
  return {
    subject: `Your rating for ${v.employeeName} is open`,
    body:
      `⭐ *You have a rating to complete*\n\n` +
      `Hello ${v.leadName},\n\n` +
      `The performance evaluation for ${v.employeeName} (${v.department}) is open for ${v.period}. ` +
      `You and they rate the same form at the same time, and neither of you sees the other's answers.\n\n` +
      `Due by: ${v.dueDate}\n\n` +
      `Open your team's rating form:\n${v.link}\n\n` +
      `This link is personal to you. Please do not forward it.\n\n` +
      SIGN_OFF,
    html: shell({
      heading: "⭐ A review is open for you",
      bodyHtml:
        p(`Dear ${v.leadName},`) +
        p("A performance review is now open for one of your team. Their own answers are not shown to you, and yours are not shown to them.") +
        details([
          ["Employee", v.employeeName],
          ["Department", v.department],
          ["Period", v.period],
          ["Please complete by", v.dueDate],
        ]) +
        signOff(),
      cta: { label: "Open your form", href: v.link },
    }),
  };
}

/**
 * A production round has opened, and this person fills the sheet.
 *
 * NO TOKEN, a plain URL. PW-4's rule: a token is a way in for somebody with no
 * account, and it scopes them to one record — which is right for an employee
 * meeting the system once a year and wrong for a team leader who has several
 * people to rate and a queue to work through. They sign in.
 */
export function workerRatingInvite(v: {
  leadName: string;
  employeeName: string;
  department: string;
  period: string;
  dueDate: string;
  link: string;
}): RenderedMessage {
  return {
    subject: `Appraisal open for ${v.employeeName}`,
    body:
      `🦺 *A production appraisal is open for you*

` +
      `Hello ${v.leadName},

` +
      `The appraisal for ${v.employeeName} (${v.department}) is open for ${v.period}. ` +
      `Please tick each quality on their sheet and submit it.

` +
      `Due by: ${v.dueDate}

` +
      `Open the sheet:
${v.link}

` +
      SIGN_OFF,
    html: shell({
      heading: "🦺 A production appraisal is open for you",
      bodyHtml:
        p(`Dear ${v.leadName},`) +
        p("An appraisal is now open for one of your production team. Tick each quality on their sheet and submit it.") +
        details([
          ["Worker", v.employeeName],
          ["Team", v.department],
          ["Period", v.period],
          ["Please complete by", v.dueDate],
        ]) +
        signOff(),
      cta: { label: "Open the sheet", href: v.link },
    }),
  };
}

export function mdReviewPending(v: {
  employeeName: string;
  leadName: string;
  period: string;
  dueDate: string;
  link: string;
}): RenderedMessage {
  return {
    subject: `${v.employeeName}'s evaluation is ready for management review`,
    body:
      `🖊️ *A report is ready for your approval*\n\n` +
      `${v.employeeName}'s evaluation for ${v.period} has been reviewed by HR.\n\n` +
      `Please approve by: ${v.dueDate}\n\n` +
      `Open the report:\n${v.link}\n\n` +
      SIGN_OFF,
    html: shell({
      heading: "🖊️ A review is ready for your approval",
      bodyHtml:
        p("A performance review has been completed and is ready for your attention.") +
        details([
          ["Employee", v.employeeName],
          ["Period", v.period],
          ["Please review by", v.dueDate],
        ]) +
        signOff(),
      cta: { label: "Open the review", href: v.link },
    }),
  };
}

/**
 * Both sides are in. HR can now see the two together for the first time.
 *
 * Carries no score and no gap. Under blind rating the gap is the one figure
 * §11 confines to HR and the MD, and a WhatsApp message has no access control
 * around it — the same reasoning that keeps a rating out of `mdReviewPending`
 * (P13-13). The message says the report is ready; the report says what it says.
 */
export function reportReady(v: {
  employeeName: string;
  period: string;
  /**
   * Set when HR advanced the record PAST a side that never submitted.
   *
   * "Both sides are now in" was stated unconditionally — and one of the two
   * paths that raises this message is `advanceWithoutOneSide`, whose entire
   * precondition is that a side has NOT submitted and is being marked skipped.
   * So the message asserted the opposite of what had happened, to the person
   * about to open the report and find half of it missing. §0.7.
   */
  skipped?: "SELF" | "LEAD" | null;
  link: string;
}): RenderedMessage {
  const opening =
    v.skipped === "SELF"
      ? `${v.employeeName}'s evaluation for ${v.period} has been advanced to review without their self-evaluation. The report is ready.`
      : v.skipped === "LEAD"
        ? `${v.employeeName}'s evaluation for ${v.period} has been advanced to review without their manager's rating. The report is ready.`
        : `Both sides of ${v.employeeName}'s evaluation for ${v.period} are now in, and the combined report is ready for your review.`;

  return {
    subject: `${v.employeeName}'s report is ready for your review`,
    body:
      `📄 *A combined report is ready*\n\n` +
      `${opening}\n\n` +
      `Open the report:\n${v.link}\n\n` +
      SIGN_OFF,
    html: shell({
      heading: "📄 A combined report is ready",
      bodyHtml:
        p(opening) +
        details([["Employee", v.employeeName], ["Period", v.period]]) +
        signOff(),
      cta: { label: "Open the report", href: v.link },
    }),
  };
}

/**
 * The lead's reason travels verbatim.
 *
 * §8 requires a reason on every return, and paraphrasing it here would leave the
 * employee guessing at what to change — which is the entire content of the
 * message. It is escaped for HTML, not edited.
 */
export function formReturned(v: {
  name: string;
  period: string;
  reason: string;
  /**
   * WHOSE FORM CAME BACK. This goes to three different people and said the
   * same thing to all of them.
   *
   * A manager read "Your self-evaluation has been returned" when what came
   * back was their RATING OF SOMEBODY ELSE, and went looking for a form of
   * their own that had not moved. HR read it too, with the employee's name
   * smuggled into the period field to compensate.
   */
  audience?: "SELF" | "LEAD" | "HR";
  /** Whose evaluation it is — needed by the two audiences it is not about. */
  employeeName?: string;
  link: string;
}): RenderedMessage {
  const who = v.audience ?? "SELF";
  const subject =
    who === "LEAD"
      ? `Your rating of ${v.employeeName ?? "your report"} is back with you`
      : who === "HR"
        ? `${v.employeeName ?? "A"}'s report has been sent back`
        : `Your evaluation for ${v.period} is back with you`;

  const opening =
    who === "LEAD"
      ? `Your rating of ${v.employeeName ?? "your report"} for ${v.period} has been returned for another look.`
      : who === "HR"
        ? `${v.employeeName ?? "A"}'s report for ${v.period} has been sent back by the MD.`
        : `Your self-evaluation for ${v.period} has been returned for another look.`;

  return {
    subject,
    body:
      `↩️ *${subject}*\n\n` +
      `Hello ${v.name},\n\n` +
      `${opening}\n\n` +
      `What was asked for:\n"${v.reason}"\n\n` +
      `Your answers are still there — open your form, make the changes and submit it again:\n${v.link}\n\n` +
      SIGN_OFF,
    html: shell({
      heading: `↩️ ${subject}`,
      bodyHtml:
        p(`Dear ${v.name},`) +
        p(`${opening} The reason given was:`) +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px 0;">
           <tr><td style="border-left:3px solid ${EMAIL.rule};padding:4px 0 4px 14px;">
             <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${EMAIL.ink};font-style:italic;">${escapeHtml(v.reason)}</p>
           </td></tr>
         </table>`,
      cta: { label: "Open your form", href: v.link },
    }),
  };
}

/**
 * NO SCORE. NOT REWORDED — REMOVED, AND THE PARAMETER WITH IT.
 *
 * This carried "Final score: 3.15" in the body and again in the email table.
 * §11 confines a score to HR and the MD, and P13-13 and P20-16 both state the
 * rule this broke: a rating in a message is a rating on a channel with no
 * access control around it. It sits on a lock screen, in a chat backup, and on
 * whatever device the recipient happens to be holding — HR included. Being
 * entitled to READ a number is not the same as it being safe to BROADCAST.
 *
 * The message says the record is complete and links to it. Anybody entitled to
 * the figure opens the report; the message carries none.
 *
 * `finalScore` is deleted from the parameters rather than left unused, because
 * an unused field on a message template is an invitation to interpolate it
 * again — the same reasoning P22 used when it deleted `leadReviewPending`
 * outright rather than leaving it unwired.
 */
export function evaluationFinalised(v: {
  employeeName: string;
  period: string;
  link: string;
}): RenderedMessage {
  return {
    subject: `${v.employeeName}'s evaluation has been finalised`,
    body:
      `✅ *An evaluation has been finalised*\n\n` +
      `${v.employeeName}'s evaluation for ${v.period} has been finalised by management and is now on record.\n\n` +
      `See the record:\n${v.link}\n\n` +
      SIGN_OFF,
    html: shell({
      heading: "✅ An evaluation has been finalised",
      bodyHtml:
        p("An evaluation has been finalised by management and is now on record.") +
        details([
          ["Employee", v.employeeName],
          ["Period", v.period],
        ]) +
        signOff(),
      cta: { label: "Open the record", href: v.link },
    }),
  };
}

/**
 * The disclosure policy decides how much of this message exists.
 *
 * §9: an employee "sees final score + decision, never raw lead comments", and
 * the cycle's policy narrows that further. NONE means the result is recorded and
 * never shown, so the message says the cycle is closed and stops — it does not
 * hint at a number it will not give.
 */
export function evaluationClosed(v: {
  name: string;
  period: string;
  /* -- FULL is gone. 0022 retired it by CHECK because it contradicted §5's
        blindness invariant, and 0021 had already deleted the RLS branch
        honouring it — so it was an option promising something the database
        refuses. A dead branch that WIDENS disclosure, in the one template that
        speaks to the person being evaluated, is the worst place to leave one. -- */
  disclosure: "NONE" | "SCORE_ONLY" | "SCORE_AND_DECISION";
  decision?: string | null;
  link: string;
}): RenderedMessage {
  const showsScore = v.disclosure !== "NONE";
  const showsDecision = v.disclosure === "SCORE_AND_DECISION";

  /* -- THE FIGURE IS NOT IN THE MESSAGE, though this person is entitled to it.
        §9 gives an employee their own final score, and they still get it — on
        their scorecard, behind their login. What changed is the CHANNEL: a
        score in a WhatsApp message sits on a lock screen, in a chat backup and
        on whatever handset is nearest, where a colleague reads it over a
        shoulder. Being entitled to READ a number is not the same as it being
        safe to BROADCAST one (P13-13, P20-16).

        `showsScore` still decides whether there is anything to look at, and so
        whether a link is offered at all — that logic is the disclosure policy
        and is unchanged. Only the number has gone. -- */
  const lines: string[] = [`your evaluation for ${v.period} is complete.`];
  if (showsDecision && v.decision) lines.push(v.decision);

  const closing = showsScore
    ? `Your result is on your scorecard: ${v.link}`
    : `Your manager will discuss it with you.`;

  return {
    subject: `Your evaluation for ${v.period} is complete`,
    body: `Hello ${v.name}, ${lines.join(" ")} ${closing} ${SIGN_OFF}`,
    html: shell({
      heading: "🏁 Your evaluation is complete",
      bodyHtml:
        lines.map((line, i) => p(i === 0 ? capitalise(line) : line)).join("") +
        (showsScore ? "" : p("Your manager will discuss it with you.")),
      // No button when there is nothing behind it to look at.
      cta: showsScore ? { label: "See your result", href: v.link } : undefined,
    }),
  };
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/* ---------- Registry ---------- */

/** Used by the history drawer to render a stored template key. */
export const TEMPLATE_KEYS = Object.keys(TEMPLATE_LABELS) as TemplateKey[];

/* ---------- P22: reminders and digests ---------- */

/**
 * THE CONSTRAINT THAT GOVERNS THE NEXT TWO TEMPLATES.
 *
 * Under blind parallel rating the employee and the lead are reminded
 * INDEPENDENTLY, and neither message may reveal whether the other side has
 * submitted. So: no "your lead is waiting for you", no "the employee has
 * already submitted", no count of what is outstanding on the other half.
 *
 * Each side is reminded about their own form and nothing else. That is why
 * these are separate templates from `selfEvaluationReminder` rather than one
 * with a role parameter — a shared body is a body somebody eventually adds a
 * helpful sentence to.
 */
export function leadReviewReminder(v: {
  leadName: string;
  employeeName: string;
  period: string;
  dueDate: string;
  days: number;
  link: string;
}): RenderedMessage {
  return {
    subject: `Your rating for ${v.employeeName} is due in ${v.days} day${v.days === 1 ? "" : "s"}`,
    body:
      `🕒 *A reminder — a rating is waiting*\n\n` +
      `Hello ${v.leadName},\n\n` +
      `Your rating for ${v.employeeName} (${v.period}) is due on ${v.dueDate}.\n\n` +
      `Pick up where you left off:\n${v.link}\n\n` +
      SIGN_OFF,
    html: shell({
      heading: "🕒 A reminder about your review",
      bodyHtml:
        p(`Dear ${v.leadName},`) +
        p("One of your team is still waiting on your rating. We would be grateful if you could complete it before the date below.") +
        details([["Employee", v.employeeName], ["Period", v.period], ["Due", v.dueDate]]) +
        signOff(),
      cta: { label: "Open your form", href: v.link },
    }),
  };
}

export function leadReviewOverdue(v: {
  leadName: string;
  employeeName: string;
  period: string;
  dueDate: string;
  link: string;
}): RenderedMessage {
  return {
    subject: `Your rating for ${v.employeeName} is overdue`,
    body:
      `🔔 *A rating is now overdue*\n\n` +
      `Hello ${v.leadName},\n\n` +
      `Your rating for ${v.employeeName} (${v.period}) was due on ${v.dueDate} and has not been submitted.\n\n` +
      `It takes a few minutes and the form is still open:\n${v.link}\n\n` +
      SIGN_OFF,
    html: shell({
      heading: "🔔 Your review is now overdue",
      bodyHtml:
        p(`Dear ${v.leadName},`) +
        p("A rating for one of your team has passed its date. The form is still open and takes only a few minutes.") +
        details([["Employee", v.employeeName], ["Period", v.period], ["Was due", v.dueDate]]) +
        signOff(),
      cta: { label: "Open your form", href: v.link },
    }),
  };
}

/** One line per person, capped — a message nobody scrolls is a message nobody reads. */
const INLINE_CAP = 8;

function nameList(items: Array<{ name: string; department: string; date: string }>): string {
  const shown = items.slice(0, INLINE_CAP)
    .map((i) => `${i.name} (${i.department}) on ${i.date}`)
    .join(", ");
  const rest = items.length - INLINE_CAP;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

/**
 * ONE message a day to HR, listing everything — never one message per employee.
 *
 * NO SALARY FIGURE. The message says an increment is due; the amount lives
 * behind the login (§5). There is no parameter here that could carry one.
 */
export function hrDueDigest(v: {
  increments: Array<{ name: string; department: string; date: string }>;
  milestones: Array<{ name: string; department: string; date: string }>;
  reportsWaiting: number;
  link: string;
}): RenderedMessage {
  const parts: string[] = [];
  if (v.increments.length > 0) {
    parts.push(`${v.increments.length} increment${v.increments.length === 1 ? " is" : "s are"} due next month: ${nameList(v.increments)}.`);
  }
  if (v.milestones.length > 0) {
    parts.push(`${v.milestones.length} milestone evaluation${v.milestones.length === 1 ? " is" : "s are"} due within a week: ${nameList(v.milestones)}.`);
  }
  if (v.reportsWaiting > 0) {
    parts.push(`${v.reportsWaiting} report${v.reportsWaiting === 1 ? " is" : "s are"} waiting for your review.`);
  }

  const bodyText = parts.join(" ");
  return {
    subject: "What needs your attention today",
    body:
      `☀️ *Today's summary*

` +
      `Good morning.

` +
      `${bodyText}

` +
      `Open the list:
${v.link}

` +
      SIGN_OFF,
    html: shell({
      heading: "☀️ Today's summary",
      bodyHtml:
        p("Good morning,") +
        p("Here is what needs your attention today.") +
        parts.map((line) => p(line)).join("") +
        signOff(),
      cta: { label: "Open the list", href: v.link },
      personal: false,
    }),
  };
}

/**
 * WEEKLY, not daily.
 *
 * An overdue increment is often waiting on something HR cannot control — a
 * budget conversation, an MD who is travelling. A daily nag on it becomes noise,
 * and a channel people have learned to ignore fails on the message that matters.
 */
export function incrementsOverdue(v: {
  items: Array<{ name: string; department: string; date: string }>;
  link: string;
}): RenderedMessage {
  return {
    subject: `${v.items.length} increment${v.items.length === 1 ? " is" : "s are"} overdue`,
    body:
      `📅 *Increments past their date*

` +
      `${v.items.length} ${v.items.length === 1 ? "increment is" : "increments are"} past the date they were due:
` +
      `${nameList(v.items)}

` +
      `Open the list:
${v.link}

` +
      SIGN_OFF,
    html: shell({
      heading: "📅 Increments past their date",
      bodyHtml:
        p(
          `${v.items.length} ${v.items.length === 1 ? "increment is" : "increments are"} past the date they were due. They are listed below and on the increments screen.`,
        ) +
        p(nameList(v.items)) +
        signOff(),
      cta: { label: "Open the list", href: v.link },
      personal: false,
    }),
  };
}

/**
 * Who has not filled their form in, to HR.
 *
 * P22 chases each side against their OWN deadline, which is right — but nobody
 * was telling HR the total. So a cycle could sit with nine people late and the
 * only way to know was to open the board and count, which is exactly the thing
 * that gets missed.
 *
 * NO SCORES, and no indication of who rated whom. §5: the message says somebody
 * has not submitted, never anything they wrote — a WhatsApp has no access
 * control around it, so nothing that is confined inside the product may travel
 * in one (P13-13).
 *
 * COUNTS BY SIDE, not by name, once past a handful. Nine names is a wall of
 * text on a phone; "6 employees and 3 HODs" is the same fact in a glance, and
 * the link opens the list where the names belong.
 */
export function evaluationsOverdue(v: {
  employees: number;
  leads: number;
  cycleName: string;
  link: string;
}): RenderedMessage {
  const total = v.employees + v.leads;
  const parts = [
    v.employees > 0 ? `${v.employees} employee${v.employees === 1 ? "" : "s"}` : null,
    v.leads > 0 ? `${v.leads} Manager${v.leads === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return {
    subject: `${total} form${total === 1 ? " is" : "s are"} overdue in ${v.cycleName}`,
    body:
      `🗂️ *${total} form${total === 1 ? " is" : "s are"} still outstanding* in ${v.cycleName}: ` +
      `${parts.join(" and ")} have not submitted.

` +
      `See who:
${v.link}

` +
      SIGN_OFF,
    html: shell({
      heading: "🗂️ Forms are still outstanding",
      bodyHtml:
        p("Some forms in the current cycle have passed their date and are still outstanding.") +
        details([["Cycle", v.cycleName], ["Still to submit", parts.join(" and ")]]) +
        signOff(),
      cta: { label: "See who", href: v.link },
      personal: false,
    }),
  };
}

/* -- `mdReviewDigest` was here, and is DELETED.
      At the owner's instruction the MD receives one message and one only: the
      report HR has approved and passed up to them. Chasing them about the size
      of their queue is HR's job.

      Deleted rather than left unused. An orphaned template is a body sitting
      where the next person will reach for it, and P22 had to remove
      `leadReviewPending` for exactly that reason. `MD_MAY_RECEIVE` in
      dispatch.ts is where the decision now lives; the wording is in git if it
      is ever wanted back. -- */

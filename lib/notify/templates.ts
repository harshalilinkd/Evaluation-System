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
  | "mdReviewDigest"
  | "mdReviewPending"
  | "reportReady"
  | "formReturned"
  | "evaluationFinalised"
  | "evaluationClosed";

/** Shown in the history drawer and the template filter, so HR never reads a key. */
export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  selfEvaluationInvite: "Self-evaluation invite",
  selfEvaluationReminder: "Reminder",
  selfEvaluationOverdue: "Overdue notice",
  leadReviewInvite: "HOD rating invite",
  leadReviewReminder: "HOD rating reminder",
  leadReviewOverdue: "HOD rating overdue",
  hrDueDigest: "What is due (to HR)",
  incrementsOverdue: "Increments overdue (to HR)",
  evaluationsOverdue: "Forms overdue (to HR)",
  mdReviewDigest: "Reports waiting (to the MD)",
  mdReviewPending: "Management review pending",
  reportReady: "Report ready for HR",
  formReturned: "Form returned",
  evaluationFinalised: "Finalised (to HR)",
  evaluationClosed: "Result available",
};

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
function shell({ heading, bodyHtml, cta }: {
  heading: string;
  bodyHtml: string;
  cta?: { label: string; href: string };
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
              <span style="font-family:Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:${EMAIL.invert};letter-spacing:-0.01em;">Appraise</span>
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
                This link is personal to you. Please do not forward it.<br>
                LinkD Prints &middot; sent by HR
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
      `*Your performance evaluation is open*\n\n` +
      `Hello ${v.name},\n\n` +
      `Your evaluation for ${v.period} is now open. Please fill in your self-assessment — it takes about ten minutes.\n\n` +
      `Due by: ${v.dueDate}\n\n` +
      `Open your form:\n${v.link}\n\n` +
      `This link is personal to you. Please do not forward it.\n\n` +
      `— HR, LinkD Prints`,
    html: shell({
      heading: `Hello ${escapeHtml(v.name)}`,
      bodyHtml:
        p(`Your performance evaluation for ${v.period} is open.`) +
        p(`Please fill your self-evaluation by ${v.dueDate}.`),
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
      `*Reminder: your evaluation is still open*\n\n` +
      `Hello ${v.name},\n\n` +
      `Your evaluation for ${v.period} has not been submitted yet — ${daysLeft}.\n\n` +
      `Due by: ${v.dueDate}\n\n` +
      `Open your form:\n${v.link}\n\n` +
      `This link is personal to you. Please do not forward it.\n\n` +
      `— HR, LinkD Prints`,
    html: shell({
      heading: `${daysLeft}, ${escapeHtml(v.name)}`,
      bodyHtml:
        p(`Your performance evaluation for ${v.period} is still open.`) +
        p(`Please fill your self-evaluation by ${v.dueDate}.`),
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
      `*Your evaluation is past its date*\n\n` +
      `Hello ${v.name},\n\n` +
      `Your self-evaluation for ${v.period} was due on ${v.dueDate} and has not been submitted.\n\n` +
      `Please complete it as soon as you can:\n${v.link}\n\n` +
      `— HR, LinkD Prints`,
    html: shell({
      heading: "Your evaluation is past its date",
      bodyHtml: p(`Your self-evaluation for ${v.period} was due on ${v.dueDate} and is still open.`),
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
      `*You have a rating to complete*\n\n` +
      `Hello ${v.leadName},\n\n` +
      `The performance evaluation for ${v.employeeName} (${v.department}) is open for ${v.period}. ` +
      `You and they rate the same form at the same time, and neither of you sees the other's answers.\n\n` +
      `Due by: ${v.dueDate}\n\n` +
      `Open your form:\n${v.link}\n\n` +
      `This link is personal to you. Please do not forward it.\n\n` +
      `— HR, LinkD Prints`,
    html: shell({
      heading: `Hello ${escapeHtml(v.leadName)}`,
      bodyHtml:
        p(`The performance evaluation for ${escapeHtml(v.employeeName)} (${escapeHtml(v.department)}) is open for ${escapeHtml(v.period)}.`) +
        p(`Please complete your rating by ${escapeHtml(v.dueDate)}.`),
      cta: { label: "Open your form", href: v.link },
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
      `${v.leadName} has completed their review of ${v.employeeName} for ${v.period}. ` +
      `It is ready for management review by ${v.dueDate}. ` +
      `Open it here: ${v.link} ` +
      `— HR, LinkD Prints`,
    html: shell({
      heading: `${escapeHtml(v.employeeName)} is ready for review`,
      bodyHtml:
        p(`${v.leadName} has completed their review of ${v.employeeName} for ${v.period}.`) +
        p(`Management review is due by ${v.dueDate}.`),
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
  link: string;
}): RenderedMessage {
  return {
    subject: `${v.employeeName}'s report is ready for your review`,
    body:
      `Both sides of ${v.employeeName}'s evaluation for ${v.period} are now in, ` +
      `and the combined report is ready for your review. ` +
      `Open it here: ${v.link} ` +
      `— LinkD Prints`,
    html: shell({
      heading: `${escapeHtml(v.employeeName)}'s report is ready`,
      bodyHtml:
        p(`Both sides of ${escapeHtml(v.employeeName)}'s evaluation for ${escapeHtml(v.period)} are now in.`) +
        p("The combined report is ready for your review."),
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
  link: string;
}): RenderedMessage {
  return {
    subject: `Your evaluation for ${v.period} has been sent back`,
    body:
      `*Your evaluation has been sent back*\n\n` +
      `Hello ${v.name},\n\n` +
      `Your self-evaluation for ${v.period} has been returned for another look.\n\n` +
      `What was asked for:\n"${v.reason}"\n\n` +
      `Your answers are still there — open your form, make the changes and submit it again:\n${v.link}\n\n` +
      `— HR, LinkD Prints`,
    html: shell({
      heading: "Your evaluation has been sent back",
      bodyHtml:
        p(`Your self-evaluation for ${v.period} has been returned for another look.`) +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px 0;">
           <tr><td style="border-left:3px solid ${EMAIL.rule};padding:4px 0 4px 14px;">
             <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${EMAIL.ink};font-style:italic;">${escapeHtml(v.reason)}</p>
           </td></tr>
         </table>`,
      cta: { label: "Open your form", href: v.link },
    }),
  };
}

export function evaluationFinalised(v: {
  employeeName: string;
  period: string;
  finalScore: string;
  link: string;
}): RenderedMessage {
  return {
    subject: `${v.employeeName}'s evaluation has been finalised`,
    body:
      `${v.employeeName}'s evaluation for ${v.period} has been finalised by the MD. ` +
      `Final score: ${v.finalScore}. ` +
      `Open it here: ${v.link} ` +
      `— Appraise`,
    html: shell({
      heading: "An evaluation has been finalised",
      bodyHtml:
        p(`${v.employeeName}'s evaluation for ${v.period} has been finalised by the MD.`) +
        p(`Final score: ${v.finalScore}.`),
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
  disclosure: "NONE" | "SCORE_ONLY" | "SCORE_AND_DECISION" | "FULL";
  finalScore?: string | null;
  decision?: string | null;
  link: string;
}): RenderedMessage {
  const showsScore = v.disclosure !== "NONE";
  const showsDecision = v.disclosure === "SCORE_AND_DECISION" || v.disclosure === "FULL";

  const lines: string[] = [`your evaluation for ${v.period} is complete.`];
  if (showsScore && v.finalScore) lines.push(`Your final score is ${v.finalScore}.`);
  if (showsDecision && v.decision) lines.push(v.decision);

  const closing = showsScore
    ? `You can see the result here: ${v.link}`
    : `Your manager will discuss it with you.`;

  return {
    subject: `Your evaluation for ${v.period} is complete`,
    body: `Hello ${v.name}, ${lines.join(" ")} ${closing} — HR, LinkD Prints`,
    html: shell({
      heading: "Your evaluation is complete",
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
      `*Reminder: a rating is due*\n\n` +
      `Hello ${v.leadName},\n\n` +
      `Your rating for ${v.employeeName} (${v.period}) is due on ${v.dueDate}.\n\n` +
      `Open your form:\n${v.link}\n\n` +
      `— HR, LinkD Prints`,
    html: shell({
      heading: `Hello ${escapeHtml(v.leadName)}`,
      bodyHtml:
        p(`Your rating for ${escapeHtml(v.employeeName)} (${escapeHtml(v.period)}) is due on ${escapeHtml(v.dueDate)}.`),
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
      `*A rating is overdue*\n\n` +
      `Hello ${v.leadName},\n\n` +
      `Your rating for ${v.employeeName} (${v.period}) was due on ${v.dueDate} and has not been submitted.\n\n` +
      `Please complete it:\n${v.link}\n\n` +
      `— HR, LinkD Prints`,
    html: shell({
      heading: `Hello ${escapeHtml(v.leadName)}`,
      bodyHtml:
        p(`Your rating for ${escapeHtml(v.employeeName)} (${escapeHtml(v.period)}) was due on ${escapeHtml(v.dueDate)}.`),
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
    body: `Good morning. ${bodyText} Open the list: ${v.link} — Appraise, LinkD Prints`,
    html: shell({
      heading: "What needs your attention",
      bodyHtml: parts.map((line) => p(line)).join(""),
      cta: { label: "Open the list", href: v.link },
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
      `${v.items.length} increment${v.items.length === 1 ? " is" : "s are"} past their due date: ` +
      `${nameList(v.items)}. Open the list: ${v.link} — Appraise, LinkD Prints`,
    html: shell({
      heading: "Overdue increments",
      bodyHtml: p(`${v.items.length} past their due date: ${nameList(v.items)}.`),
      cta: { label: "Open the list", href: v.link },
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
    v.leads > 0 ? `${v.leads} HOD${v.leads === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return {
    subject: `${total} form${total === 1 ? " is" : "s are"} overdue in ${v.cycleName}`,
    body:
      `*${total} form${total === 1 ? " is" : "s are"} overdue* in ${v.cycleName}: ` +
      `${parts.join(" and ")} have not submitted. ` +
      `See who: ${v.link} — Appraise, LinkD Prints`,
    html: shell({
      heading: "Forms are overdue",
      bodyHtml: p(
        `${parts.join(" and ")} have not submitted in ${v.cycleName}.`,
      ),
      cta: { label: "See who", href: v.link },
    }),
  };
}

/** Every two days. The MD is not chased daily about a queue they are working through. */
export function mdReviewDigest(v: { waiting: number; link: string }): RenderedMessage {
  return {
    subject: `${v.waiting} report${v.waiting === 1 ? "" : "s"} waiting for your approval`,
    body:
      `${v.waiting} report${v.waiting === 1 ? " is" : "s are"} waiting for your approval. ` +
      `Open them here: ${v.link} — Appraise, LinkD Prints`,
    html: shell({
      heading: "Reports waiting for you",
      bodyHtml: p(`${v.waiting} report${v.waiting === 1 ? " is" : "s are"} waiting for your approval.`),
      cta: { label: "Open the reports", href: v.link },
    }),
  };
}

/**
 * HR's own wording for a message, and the rules that keep it sendable.
 *
 * §10 keeps every message string in one place. That place is now two: the
 * defaults in `templates.ts` and, where HR has written their own, one row in
 * `notification_templates`. What has NOT changed is the thing the rule exists
 * for — no message string lives beside the code that sends it, so a body is
 * never edited in passing by somebody working on a server action.
 */

import "server-only";

import type { RenderedMessage, TemplateKey } from "@/lib/notify/templates";
import { TEMPLATE_LABELS } from "@/lib/notify/templates";
import type { createClient } from "@/lib/supabase/server";

/* ---------- Which templates may be edited ---------- */

/**
 * WHY FOUR ARE NOT EDITABLE, and why that is a code constant rather than a flag
 * in the table.
 *
 * Three of them — the two HR digests and the overdue sweep — do not have a
 * wording so much as a SHAPE: they compose a list of names and dates at send
 * time, and a body of fixed text with placeholders cannot express "one line per
 * person, up to eight, then 'and 4 more'". An override would silently replace a
 * list with a sentence.
 *
 * The fourth, `evaluationClosed`, is the one message governed by a disclosure
 * policy (§9). Its wording differs depending on whether the cycle releases a
 * score, a decision or nothing at all, and a single editable body would flatten
 * that into one text sent under all three — which is how a score reaches
 * somebody a cycle deliberately withheld it from.
 *
 * A constant, not a column, because "may this be edited" is a property of what
 * the template DOES. Putting it in data would make it something somebody could
 * switch on for `evaluationClosed` without meeting the reason it is off.
 */
export const EDITABLE_TEMPLATES: ReadonlySet<TemplateKey> = new Set<TemplateKey>([
  "selfEvaluationInvite",
  "selfEvaluationReminder",
  "selfEvaluationOverdue",
  "leadReviewInvite",
  "leadReviewReminder",
  "leadReviewOverdue",
  "mdReviewPending",
  "reportReady",
  "formReturned",
  "evaluationFinalised",
]);

/** Why a template is read-only, in the words the screen shows. */
export const NOT_EDITABLE_BECAUSE: Partial<Record<TemplateKey, string>> = {
  hrDueDigest: "This one lists everybody who is due, so its shape is built when it is sent rather than written out in advance.",
  incrementsOverdue: "This one lists everybody whose increment is late, so its shape is built when it is sent.",
  evaluationsOverdue: "This one counts the forms still outstanding, so its shape is built when it is sent.",
  evaluationClosed:
    "This one changes with the cycle's disclosure setting — whether the employee is shown a score, a decision, or neither. Its wording is fixed so a result cannot reach somebody a cycle withheld it from.",
};

/* ---------- Placeholders ---------- */

/**
 * The friendly name HR types, and the variable keys it can come from.
 *
 * SEVERAL KEYS PER PLACEHOLDER, because the templates were written
 * independently and name the same thing differently — `name` on one,
 * `employeeName` on another. Renaming them would be a change to fourteen
 * function signatures for no gain; resolving several candidates is one line and
 * cannot get it wrong, since a template only ever supplies one of them.
 */
const PLACEHOLDERS: ReadonlyArray<{ token: string; keys: readonly string[]; describes: string }> = [
  { token: "{employee}", keys: ["employeeName", "name"], describes: "the person being appraised" },
  { token: "{head of department}", keys: ["leadName"], describes: "their manager" },
  { token: "{department}", keys: ["department"], describes: "their team" },
  { token: "{period}", keys: ["period"], describes: "the cycle, e.g. Q3 FY26" },
  { token: "{date}", keys: ["dueDate"], describes: "the due date" },
  { token: "{their personal link}", keys: ["link"], describes: "the link to their own form" },
  { token: "{your reason, word for word}", keys: ["reason"], describes: "the reason typed when a form is sent back" },
];

/** What HR may type into a given template, for the editor's help panel. */
export function placeholdersFor(key: TemplateKey): Array<{ token: string; describes: string }> {
  const required = REQUIRED_PLACEHOLDERS[key] ?? [];
  return PLACEHOLDERS.filter((p) => ALLOWED_PLACEHOLDERS[key]?.includes(p.token) || required.includes(p.token)).map(
    (p) => ({ token: p.token, describes: p.describes }),
  );
}

/**
 * What each template actually supplies. Typing anything else produces a message
 * with `{soemthing}` printed in it, so it is refused at save rather than
 * discovered by a recipient.
 */
const ALLOWED_PLACEHOLDERS: Partial<Record<TemplateKey, readonly string[]>> = {
  selfEvaluationInvite: ["{employee}", "{period}", "{date}", "{their personal link}"],
  selfEvaluationReminder: ["{employee}", "{period}", "{date}", "{their personal link}"],
  selfEvaluationOverdue: ["{employee}", "{period}", "{date}", "{their personal link}"],
  leadReviewInvite: ["{head of department}", "{employee}", "{department}", "{period}", "{date}", "{their personal link}"],
  leadReviewReminder: ["{head of department}", "{employee}", "{department}", "{period}", "{date}", "{their personal link}"],
  leadReviewOverdue: ["{head of department}", "{employee}", "{department}", "{period}", "{date}", "{their personal link}"],
  mdReviewPending: ["{employee}", "{head of department}", "{period}", "{date}", "{their personal link}"],
  reportReady: ["{employee}", "{head of department}", "{period}", "{their personal link}"],
  formReturned: ["{employee}", "{period}", "{date}", "{your reason, word for word}", "{their personal link}"],
  evaluationFinalised: ["{employee}", "{period}", "{their personal link}"],
};

/**
 * WITHOUT THESE THE MESSAGE CANNOT DO ITS JOB.
 *
 * A reminder with no link is a reminder nobody can act on, and it would go out
 * looking perfectly reasonable. A returned form with no reason is §8's return
 * with the one thing it exists to carry removed.
 *
 * Deliberately short: everything else is HR's to phrase, including whether to
 * name the person at all.
 */
const REQUIRED_PLACEHOLDERS: Partial<Record<TemplateKey, readonly string[]>> = {
  selfEvaluationInvite: ["{their personal link}"],
  selfEvaluationReminder: ["{their personal link}"],
  selfEvaluationOverdue: ["{their personal link}"],
  leadReviewInvite: ["{their personal link}"],
  leadReviewReminder: ["{their personal link}"],
  leadReviewOverdue: ["{their personal link}"],
  mdReviewPending: ["{their personal link}"],
  reportReady: ["{their personal link}"],
  formReturned: ["{your reason, word for word}", "{their personal link}"],
  evaluationFinalised: ["{their personal link}"],
};

/* ---------- Validation ---------- */

export type TemplateProblem = { field: "subject" | "body"; message: string };

/**
 * Everything that would make a saved template unsendable, checked before it is
 * stored rather than when somebody fails to receive it.
 */
export function validateTemplate(
  key: TemplateKey,
  subject: string,
  body: string,
): TemplateProblem[] {
  const problems: TemplateProblem[] = [];

  if (!EDITABLE_TEMPLATES.has(key)) {
    return [{ field: "body", message: "This message cannot be reworded — see the note beside it." }];
  }

  if (subject.trim() === "") problems.push({ field: "subject", message: "Write a subject line." });
  if (body.trim() === "") problems.push({ field: "body", message: "Write the message." });
  if (subject.length > 200) problems.push({ field: "subject", message: "Keep the subject under 200 characters." });
  if (body.length > 4000) problems.push({ field: "body", message: "Keep the message under 4000 characters." });

  /* §10, and the same refusal the table carries. Checked here too so HR reads a
     sentence rather than a constraint violation. */
  for (const [field, text] of [["subject", subject], ["body", body]] as const) {
    if (/https?:\/\//i.test(text) || text.includes("/invite/")) {
      problems.push({
        field,
        message:
          "Do not paste a web address. The link is added when the message is sent — write {their personal link} where it should go.",
      });
    }
  }

  const allowed = ALLOWED_PLACEHOLDERS[key] ?? [];
  const used = [...`${subject}\n${body}`.matchAll(/\{[^{}]*\}/g)].map((m) => m[0]);

  for (const token of new Set(used)) {
    if (!allowed.includes(token)) {
      problems.push({
        field: body.includes(token) ? "body" : "subject",
        message: `${token} is not something this message knows. Use one of: ${allowed.join(", ")}.`,
      });
    }
  }

  for (const token of REQUIRED_PLACEHOLDERS[key] ?? []) {
    if (!used.includes(token)) {
      problems.push({
        field: "body",
        message: `${token} has to appear somewhere — without it the message cannot be acted on.`,
      });
    }
  }

  return problems;
}

/* ---------- Rendering ---------- */

export type TemplateOverride = { key: string; subject: string; body: string };

/**
 * Substitute the placeholders and rebuild the email inside the designed shell.
 *
 * ONE WORDING ON BOTH CHANNELS. The defaults deliberately say slightly
 * different things over WhatsApp and email — the email has room for a details
 * table and a button. An override cannot express that and should not try: what
 * HR wrote is what goes out, on both, and the shell keeps the header band, the
 * button and the sign-off so it still looks like the company sent it.
 */
export function applyOverride(
  override: TemplateOverride,
  vars: Record<string, unknown>,
  fallback: RenderedMessage,
): RenderedMessage {
  const fill = (text: string): string => {
    let out = text;
    for (const placeholder of PLACEHOLDERS) {
      const key = placeholder.keys.find((k) => vars[k] !== undefined && vars[k] !== null);
      /* -- LEFT IN PLACE WHEN THERE IS NO VALUE, never blanked.
            A placeholder the caller did not supply means the two lists here have
            drifted apart, and an empty gap in a sentence reads as a bug in the
            wording HR wrote. Leaving the token visible says where to look. -- */
      if (key === undefined) continue;
      out = out.split(placeholder.token).join(String(vars[key]));
    }
    return out;
  };

  const subject = fill(override.subject);
  const body = fill(override.body);

  return {
    subject,
    body,
    /* The link is what the button points at. Absent — a template with no link
       placeholder — the shell simply renders without one. */
    html: fallback.html === undefined ? undefined : rebuildHtml(body, vars),
  };
}

/**
 * HR's text, inside the shell.
 *
 * Built here rather than in `templates.ts` because it is a different job: that
 * file composes a designed email from parts, this one wraps prose somebody
 * typed. Escaped, because the text came from a form and an email client will
 * happily render a stray `<` as markup.
 */
function rebuildHtml(body: string, vars: Record<string, unknown>): string {
  const link = typeof vars.link === "string" ? vars.link : undefined;

  /* The sign-off is already the last line of the body, because it is part of
     the default wording HR started from. Stripping it and re-adding it would
     silently overrule somebody who deliberately changed it. */
  const paragraphs = body
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    /* The link is rendered as a button below, so the bare URL line that carries
       it over WhatsApp is dropped from the email — an address printed in full
       beside a button is the thing that makes an email look automated. */
    .filter((para) => !(link !== undefined && para.includes(link) && para.length - link.length < 40))
    .map(
      (para) =>
        `<p style="margin:0 0 16px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#111827;">${escapeHtml(
          para,
        )
          // *bold* is how the plain body emphasises a line; carried across
          // rather than printed as asterisks.
          .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
          .replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  const button =
    link === undefined
      ? ""
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px 0;">
        <tr><td align="center" bgcolor="#111827" style="border-radius:8px;">
          <a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 28px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px;">Open</a>
        </td></tr></table>`;

  return `<!doctype html><html><body style="margin:0;padding:0;background:#F4F7FE;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F7FE;">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#FFFFFF;border-radius:12px;">
          <tr><td style="padding:32px;">${paragraphs}${button}</td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------- Loading ---------- */

/**
 * Every override, keyed. One query per send — the table has at most fourteen
 * rows, and caching it would mean an edit not taking effect until something
 * evicted it.
 *
 * NEVER THROWS. A message going out with the default wording is a far better
 * failure than a submission reporting an error because a settings table could
 * not be read.
 */
export async function loadOverrides(
  client: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, TemplateOverride>> {
  try {
    const { data } = await client.from("notification_templates").select("key, subject, body");
    return new Map((data ?? []).map((row) => [row.key, row as TemplateOverride]));
  } catch {
    return new Map();
  }
}

/** Both halves of what the editor shows for one template. */
export type EditableTemplate = {
  key: TemplateKey;
  label: string;
  editable: boolean;
  /** Why not, when it is not. */
  lockedBecause?: string;
  /** What is stored, or the default if nothing is. */
  subject: string;
  body: string;
  customised: boolean;
  placeholders: Array<{ token: string; describes: string }>;
};

export function templateLabel(key: TemplateKey): string {
  return TEMPLATE_LABELS[key];
}

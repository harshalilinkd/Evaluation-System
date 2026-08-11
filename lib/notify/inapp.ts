/** In-app notifications — the bell's data. Reads and the single raise. */

import "server-only";

import { TEMPLATE_LABELS, type TemplateKey } from "@/lib/notify/templates";
import { createClient } from "@/lib/supabase/server";

/* ---------- What the bell says ---------- */

/**
 * ONE FIXED SENTENCE PER TEMPLATE, WITH NO INTERPOLATION. That is the design,
 * and it is a §5 decision rather than a shortcut.
 *
 * A notification body ends up on a phone in a meeting, on a laptop somebody is
 * screen-sharing, in a browser notification tray — all places with no access
 * control of their own. So the risk is not that the wrong person is notified
 * (that decision is made upstream, and correctly), it is that the right person
 * is told something the product spends four migrations withholding: a score
 * (§11), a salary figure (§5 salary confinement), or the other side's state
 * (§5 blindness — a lead must never learn the employee has submitted, and the
 * employee must never learn the lead has rated them).
 *
 * With nothing interpolated, none of those can appear. Not "we reviewed the
 * strings"— there is no expression to review. The detail lives one click away,
 * behind the login, on a screen that already knows who may see what.
 *
 * The trade is real and worth naming: "Your self-evaluation is open" cannot say
 * which cycle or when it is due. The bell is a prompt to go and look, not a
 * replacement for the page — and the WhatsApp and email messages, which reach
 * somebody who is NOT already signed in, do carry the period and the date.
 */
const IN_APP_TEXT: Record<TemplateKey, { title: string; body: string }> = {
  selfEvaluationInvite: {
    title: "Your self-evaluation is open",
    body: "Rate yourself against this cycle's form. Your answers are yours alone until HR reviews the record.",
  },
  selfEvaluationReminder: {
    title: "Your self-evaluation is due soon",
    body: "It has not been submitted yet. Open it to pick up where you left off.",
  },
  selfEvaluationOverdue: {
    title: "Your self-evaluation is overdue",
    body: "The date has passed. It can still be submitted.",
  },
  leadReviewInvite: {
    title: "A rating is open for you",
    body: "Somebody who reports to you is due a rating this cycle. Open your team list to begin.",
  },
  leadReviewReminder: {
    title: "A rating is due soon",
    body: "One of your team has not been rated yet.",
  },
  leadReviewOverdue: {
    title: "A rating is overdue",
    body: "The date has passed on one of your team. It can still be submitted.",
  },
  hrDueDigest: {
    title: "There is work due",
    body: "Evaluations and increments have come due. Open What is due to see them.",
  },
  incrementsOverdue: {
    title: "Increments are overdue",
    body: "One or more increments have passed their date without being started.",
  },
  evaluationsOverdue: {
    title: "Forms are overdue",
    body: "One or more forms have passed their date without being submitted.",
  },
  mdReviewPending: {
    title: "A report is ready for your review",
    body: "HR has reviewed a record and passed it up for approval.",
  },
  reportReady: {
    title: "A report is ready for review",
    body: "Both sides are in. The record is waiting for an HR review.",
  },
  formReturned: {
    title: "Your form has been returned",
    body: "It has been unlocked so it can be corrected. Open it to read why and resubmit.",
  },
  evaluationFinalised: {
    title: "A record has been reviewed",
    body: "Management has recorded their review.",
  },
  evaluationClosed: {
    title: "Your result is available",
    body: "Your evaluation is complete. Open it to see what was recorded.",
  },
};

/* ---------- Where each one takes you ---------- */

/**
 * THE TEMPLATE IS THE AUDIENCE, which is what makes this derivable rather than
 * a parameter threaded through fifteen call sites. `selfEvaluationInvite` only
 * ever goes to the person being evaluated; `leadReviewInvite` only ever to
 * their HOD; `reportReady` only ever to HR. So the destination follows from the
 * key, and there is no call site that can pass the wrong one.
 *
 * Relative paths only — 0059 has a CHECK that refuses anything else, because an
 * absolute URL in a notification is an open redirect wearing the company's own
 * chrome.
 *
 * `Record<TemplateKey, …>` is the completeness guarantee: a template added
 * without a destination is a compile error, not a bell entry that goes nowhere.
 */
const IN_APP_PATH: Record<TemplateKey, (evaluationId: string | null) => string> = {
  // The employee's own form. They are signed in when they see the bell, so this
  // is the plain route — a token is a way in for somebody who has no session
  // (PW-4), and using one here would scope them down rather than help.
  selfEvaluationInvite: (id) => (id ? `/my-evaluation/${id}` : "/my-evaluation"),
  selfEvaluationReminder: (id) => (id ? `/my-evaluation/${id}` : "/my-evaluation"),
  selfEvaluationOverdue: (id) => (id ? `/my-evaluation/${id}` : "/my-evaluation"),

  // The HOD's queue. Not the employee's record — /team is where their own
  // outstanding ratings are, and it is the only place blindness permits them.
  leadReviewInvite: (id) => (id ? `/team/${id}` : "/team"),
  leadReviewReminder: (id) => (id ? `/team/${id}` : "/team"),
  leadReviewOverdue: (id) => (id ? `/team/${id}` : "/team"),

  hrDueDigest: () => "/admin/due",
  incrementsOverdue: () => "/admin/increments",
  evaluationsOverdue: () => "/admin/cycles",

  mdReviewPending: (id) => (id ? `/reports/${id}` : "/reports"),
  reportReady: (id) => (id ? `/reports/${id}` : "/reports"),
  evaluationFinalised: (id) => (id ? `/reports/${id}` : "/reports"),

  formReturned: (id) => (id ? `/my-evaluation/${id}` : "/my-evaluation"),

  // Their own result, on their own scorecard — not the report, which carries
  // both sides and which §9 does not give the employee.
  evaluationClosed: () => "/scorecard",
};

/* ---------- The raise ---------- */

export type RaiseInAppInput = {
  profileId: string | null | undefined;
  template: TemplateKey;
  evaluationId?: string | null;
};

/**
 * Write one in-app notification. Never throws.
 *
 * CALLED FROM TWO PLACES, AND THAT IS SAFE BY CONSTRUCTION rather than by
 * discipline: 0059's unique index collapses a person + template + evaluation +
 * day onto one row, so a second call is a no-op. The two callers are
 *
 *   1. `sendNotification` — the chokepoint every outbound message passes
 *      through (§10). Hooking there means every event that notifies somebody
 *      today, and every one added later, lights the bell without its author
 *      knowing this module exists. It also inherits the two rules that live
 *      there: the pause switch (P17) and FIX-13's MD suppression. Both are
 *      honoured deliberately — "paused" that still lit 47 bells would be a
 *      brake that does not stop the vehicle, and one answer to "does the MD
 *      hear about this" is better than two.
 *
 *      It calls once PER CHANNEL, which is the duplicate the index absorbs.
 *
 *   2. `deliver`'s no-contact branch — the case that makes in-app worth having.
 *      Somebody with no phone number and no email address gets no outbound
 *      message at all, and `deliver` returns before `sendNotification` is ever
 *      reached. They are signed in to the product, so the bell reaches them
 *      when nothing else does.
 *
 * A failure here must never affect the caller. `sendNotification`'s contract is
 * that it reports on the SEND, and a notification row that could not be written
 * is not a delivery failure — reporting it as one would put a red row on HR's
 * screen that no retry can clear (P11-11's reasoning, applied one layer up).
 */
export async function raiseInAppNotification(
  input: RaiseInAppInput,
  client?: Awaited<ReturnType<typeof createClient>>,
): Promise<void> {
  if (!input.profileId) return;

  const text = IN_APP_TEXT[input.template];
  // A template with no entry is a gap, not a crash: the send has already
  // happened and the bell is the lesser half. The label is a truthful fallback,
  // and a test asserts the map is complete so this stays theoretical.
  const title = text?.title ?? TEMPLATE_LABELS[input.template] ?? "Notification";
  const body = text?.body ?? "Open the app to see what changed.";
  const path = IN_APP_PATH[input.template];
  const href = path ? path(input.evaluationId ?? null) : null;

  try {
    const supabase = client ?? (await createClient());
    await supabase.rpc("raise_app_notification", {
      p_profile_id: input.profileId,
      p_template: input.template,
      p_title: title,
      p_body: body,
      p_href: href,
      p_evaluation_id: input.evaluationId ?? null,
    });
  } catch {
    // Deliberately swallowed — see the contract above.
  }
}

/* ---------- The read ---------- */

export type AppNotification = {
  id: string;
  template: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationFeed = {
  items: AppNotification[];
  unread: number;
};

/** The most recent notifications for whoever is signed in. RLS scopes it. */
export async function getMyNotifications(limit = 20): Promise<NotificationFeed> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("app_notifications")
    .select("id, template, title, body, href, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  // An empty bell rather than a broken shell. The topbar renders on every
  // authenticated page, so a failure here must not take the app down with it —
  // and there is no action a reader could take on the error anyway.
  if (error || !data) return { items: [], unread: 0 };

  const items = data.map((row) => ({
    id: row.id,
    template: row.template,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));

  return { items, unread: items.filter((n) => n.readAt === null).length };
}

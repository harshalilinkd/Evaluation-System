/** Daily reminder sweep. CLAUDE.md §10, §15. P17 scheduling rules. */

import { NextResponse } from "next/server";

import { inviteUrl, issueInviteToken } from "@/lib/auth/invites";
import { sendNotification, type Channel } from "@/lib/notify/dispatch";
import {
  dayInKolkata,
  daysUntil,
  isQuietHour,
  reminderFor,
  timingSafeEqual,
  type ReminderKind,
} from "@/lib/notify/schedule";
import {
  leadReviewOverdue,
  leadReviewReminder,
  selfEvaluationOverdue,
  selfEvaluationReminder,
} from "@/lib/notify/templates";
import { sendDueDigests, type DigestOutcome } from "@/lib/notify/due-digest";
import { createServiceClient } from "@/lib/supabase/service";
import { formatDate } from "@/lib/utils/date";

/**
 * WHY THE SERVICE CLIENT, AND WHY THAT IS ALLOWED
 *
 * §0.5 permits the service-role key in "server-side notification/cron code".
 * A scheduled job has no session, so `auth.uid()` is null and RLS would hide
 * every row it needs. The key never leaves this module's server boundary and is
 * never used to act on a person's behalf.
 *
 * WHY IT IS NOT RATE-LIMITED
 *
 * queue_notification's 200/hour cap counts by `sent_by`, null for the system
 * actor. The cap stops a person fat-fingering a bulk send; it is not there to
 * throttle a nightly sweep sized by how many people are genuinely late.
 */
export const dynamic = "force-dynamic";

/** So an early return still reports what the digests did. */
function totals(d: DigestOutcome) {
  return { sent: d.sent, failed: d.failed, contactGaps: d.skipped };
}

/** Nobody is chased about the same thing twice inside this window. */
/* -- 20, NOT 24, AND THE FOUR HOURS ARE THE POINT.
      P17-4 dedupes on `notifications_log` so two runs in one day cannot each
      think they are the first. But this job runs every 24 hours, and a window
      of exactly 24 puts the previous run's message ON the boundary — seconds of
      drift decide whether today's reminder is suppressed as a duplicate.
      Roughly every other one vanished, and the due-day nudge could disappear
      entirely.

      20 leaves four hours of slack for a job that never runs twice in that span
      anyway, so the guard still does its work and can no longer swallow a real
      message. -- */
const DEDUPE_HOURS = 20;

type Holder = {
  profileId: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** Every record this person is holding up today. */
  records: Array<{
    evaluationId: string;
    cycleName: string;
    periodLabel: string;
    dueOn: string;
    kind: Exclude<ReminderKind, null>;
    /** Which form of theirs this is. Decides the template, never the content. */
    layer: "SELF" | "LEAD";
    /** The person being rated, for a lead's message. Null on the employee's own. */
    subjectName: string | null;
  }>;
};

export async function GET(request: Request) {
  /* ---------- Authorise ---------- */
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization") ?? "";

  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  // Timing-safe: `!==` short-circuits on the first wrong byte and leaks how much
  // of the prefix was right, which recovers the secret one character at a time.
  if (!timingSafeEqual(provided, `Bearer ${secret}`)) {
    // No detail. A 401 that explains itself is a hint to whoever is probing.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const now = new Date();

  /* ---------- Quiet hours ---------- */
  //
  // 21:00–08:00 Asia/Kolkata, computed in that zone rather than the server's —
  // a Vercel function runs in UTC, and a naive getHours() would put this five
  // and a half hours out and send at 02:30 local.
  //
  // Nothing is queued for later: the job runs again tomorrow at 10:00 and the
  // same people are still late. A backlog that fires at 08:00 would deliver
  // yesterday's reasoning against today's data.
  if (isQuietHour(now)) {
    return NextResponse.json({
      ok: true, skipped: "quiet_hours",
      message: "Nothing sends between 21:00 and 08:00 Asia/Kolkata.",
    });
  }

  const supabase = createServiceClient();
  const today = dayInKolkata(now);

  /* ---------- P22: find what is due, then tell HR and the MD ----------
     `compute_due_items` creates PENDING items and NOTHING else — no evaluation
     and no message. HR confirms each one on /admin/due. An appraisal that
     appeared because a clock ticked is an appraisal nobody chose to run.

     Both run BEFORE the per-person reminders' early returns: a day with no
     evaluation to chase is still a day HR may have an increment due. */
  await supabase.rpc("compute_due_items", { p_on: today });

  /* ---------- Prune the notification bell ----------

     `app_notifications` (0059) grows one row per person per event for ever, and
     nothing had ever removed one. A bell is a feed, not a record: what happened
     is in `audit_log` and what was SENT is in `notifications_log`, both of which
     are permanent by design and neither of which this touches.

     NINETY DAYS, and only rows that have been READ. An unread notification is
     still somebody's outstanding message however old it is — deleting one would
     take away a task they never saw, which is the opposite of what the bell is
     for. A read one has done its job.

     The service client is what makes this possible at all: 0059 gives the table
     no DELETE policy for anyone (N1-9 — a bell that can be emptied is a record
     that can be made never to have existed), so this is the one caller that can
     prune it, and it does so on a rule rather than on request.

     Guarded like everything else here: a prune that fails must not stop the
     chase, which is the job people actually notice. */
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  let pruned = 0;
  try {
    const { data } = await supabase
      .from("app_notifications")
      .delete()
      .not("read_at", "is", null)
      .lt("created_at", cutoff)
      .select("id");
    pruned = data?.length ?? 0;
  } catch {
    // Left at 0 and reported as such. Nothing downstream depends on it.
  }

  /* -- GUARDED, because it can throw and take the whole job with it.
        `sendDueDigests` builds links through `absoluteUrl()`, which REFUSES to
        produce one when NEXT_PUBLIC_APP_URL is unset or points at localhost
        (P30) — deliberately, so a dead link is never sent. This route had no
        try/catch, so that refusal propagated out of the handler and every
        per-person reminder below was never reached. One misconfigured
        environment variable silenced the entire nightly chase, which is exactly
        the "HR is not told on time" report.

        Failing loudly is right. Failing loudly should not also mean failing
        silently for everything else. -- */
  let digests: DigestOutcome;
  try {
    digests = await sendDueDigests(supabase, now);
  } catch (cause) {
    digests = {
      sent: 0,
      failed: 1,
      skipped: [cause instanceof Error ? cause.message : "The due digests could not be sent."],
    };
  }

  /* ---------- Who is holding what ---------- */
  const { data: cycles } = await supabase
    .from("evaluation_cycles")
    .select("id, name, period_label, self_due_on, lead_due_on, md_due_on")
    .eq("status", "ACTIVE");

  if (!cycles?.length) return NextResponse.json({ ok: true, people: 0, ...totals(digests) });

  /* -- AMEND-3. This asked for CYCLE_ACTIVE and SELF_SUBMITTED, both retired —
        so it matched nothing and the nightly chase has been silent ever since.
        The model was wrong as well as the names: it picked ONE holder per
        evaluation from the status, which only makes sense when the two sides
        take turns. They do not. -- */
  const { data: evaluations } = await supabase
    .from("evaluations")
    .select(
      "id, evaluatee_id, lead_id, cycle_id, status, excluded_at, self_submitted_at, lead_submitted_at, self_skipped, lead_skipped, due_self_on, due_lead_on",
    )
    .eq("status", "OPEN")
    .is("excluded_at", null)
    .in("cycle_id", cycles.map((c) => c.id));

  const rows = evaluations ?? [];
  if (rows.length === 0) return NextResponse.json({ ok: true, people: 0, ...totals(digests) });

  const byCycle = new Map(cycles.map((c) => [c.id, c]));

  /* -- Already chased today? Asked of notifications_log, not of memory. -- */
  //
  // P17: "Deduplicate in the query … Enforce it by querying notifications_log,
  // not by an in-memory flag." An in-memory flag is per-invocation, so two runs
  // in a day would each think they were the first — which is exactly the
  // idempotency the acceptance criteria ask about.
  const since = new Date(now.getTime() - DEDUPE_HOURS * 3_600_000).toISOString();
  const { data: recent } = await supabase
    .from("notifications_log")
    .select("profile_id, template")
    .in("template", [
      "selfEvaluationReminder", "selfEvaluationOverdue",
      "leadReviewReminder", "leadReviewOverdue",
    ])
    .gte("created_at", since);

  // Keyed by PERSON, not by evaluation: the rule is one message per person per
  // day across all their records.
  const chased = new Set((recent ?? []).map((r) => r.profile_id).filter(Boolean));

  /* -- Group the work by the person holding it -- */
  const holders = new Map<string, Holder>();

  /* -- BLIND REMINDERS. Each side is chased about its OWN form, against its OWN
        deadline, and neither message says anything about the other.

        Two independent tasks per evaluation rather than one holder: under §5
        the employee and the lead fill at the same time, so "whose turn is it"
        has no answer — and asking the question at all is how a message ends up
        saying "your lead is waiting for you".

        A layer that is submitted, or that HR marked skipped, is simply not a
        task. That is the ONLY thing either side's own state is used for; it is
        never told to the other. -- */
  for (const row of rows) {
    const cycle = byCycle.get(row.cycle_id);
    if (!cycle) continue;

    const sides: Array<{ who: string | null; dueOn: string | null; layer: "SELF" | "LEAD" }> = [
      {
        who: row.self_submitted_at || row.self_skipped ? null : row.evaluatee_id,
        // A rolling evaluation carries its own dates; a batch one falls back to
        // the cycle's (0022 backfilled both).
        dueOn: row.due_self_on ?? cycle.self_due_on,
        layer: "SELF",
      },
      {
        who: row.lead_submitted_at || row.lead_skipped ? null : row.lead_id,
        dueOn: row.due_lead_on ?? cycle.lead_due_on,
        layer: "LEAD",
      },
    ];

    for (const side of sides) {
      if (!side.who || !side.dueOn) continue;

      const kind = reminderFor(daysUntil(today, side.dueOn));
      if (!kind) continue;

      const entry = holders.get(side.who) ?? {
        profileId: side.who, name: "", phone: null, email: null, records: [],
      };
      entry.records.push({
        evaluationId: row.id,
        cycleName: cycle.name,
        periodLabel: cycle.period_label,
        dueOn: side.dueOn,
        kind,
        layer: side.layer,
        // The lead's message names the person they are rating. The employee's
        // does not need a name — it is their own form.
        subjectName: side.layer === "LEAD" ? row.evaluatee_id : null,
      });
      holders.set(side.who, entry);
    }
  }

  if (holders.size === 0) return NextResponse.json({ ok: true, people: 0, ...totals(digests) });

  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone_e164, is_active")
    .in("id", [...holders.keys()]);

  /* -- Names of the people being RATED, for a lead's message. A separate read
        rather than a join: `people` above is keyed on who receives a message,
        and the two sets overlap but are not the same. -- */
  const subjectIds = [...new Set(
    [...holders.values()].flatMap((h) => h.records.map((r) => r.subjectName).filter(Boolean)),
  )] as string[];
  const { data: subjects } = subjectIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", subjectIds)
    : { data: [] };
  const subjectNames = new Map((subjects ?? []).map((p) => [p.id, p.full_name]));

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const [profileId, holder] of holders) {
    const person = (people ?? []).find((p) => p.id === profileId);

    // "Do not send to an inactive profile." Somebody who has left should not be
    // chased about an appraisal, and the message would bounce anyway.
    if (!person || !person.is_active) { skipped += 1; continue; }
    if (chased.has(profileId)) { skipped += 1; continue; }

    holder.name = person.full_name;
    holder.phone = person.phone_e164;
    holder.email = person.email;

    /* -- One message per person per day, and it covers ONE form.
          A person can be both an employee with their own form and a lead with
          several. Their most urgent record is the one messaged, and the
          template follows THAT record's layer — an employee never receives the
          lead wording, and a lead's message never mentions their own form.
          The rest are picked up tomorrow. -- */
    const ordered = [...holder.records].sort((a, b) =>
      (a.kind === "overdue" ? 0 : 1) - (b.kind === "overdue" ? 0 : 1) ||
      a.dueOn.localeCompare(b.dueOn),
    );
    const lead = ordered[0];
    if (!lead) { skipped += 1; continue; }

    const overdue = lead.kind === "overdue";
    const template = lead.layer === "LEAD"
      ? (overdue ? "leadReviewOverdue" : "leadReviewReminder")
      : (overdue ? "selfEvaluationOverdue" : "selfEvaluationReminder");

    const channels: Array<{ channel: Channel; recipient: string }> = [];
    if (person.phone_e164) channels.push({ channel: "WHATSAPP", recipient: person.phone_e164 });
    if (person.email) channels.push({ channel: "EMAIL", recipient: person.email });
    if (channels.length === 0) { skipped += 1; continue; }

    for (const { channel, recipient } of channels) {
      /* -- THE LAYER MUST BE PASSED. Two bugs came from taking the default.
            §10 keys a token on (evaluation, LAYER, channel) since 0022, and
            `issue_invite_token` resolves the recipient FROM the layer: 'SELF'
            means `evaluatee_id`, 'LEAD' means `lead_id`. This call omitted it
            and took the `'SELF'` default while the lines below correctly chose
            the LEAD template from `lead.layer` — so the nightly sweep sent a
            HOD the lead wording carrying the EMPLOYEE'S token.

            1. The HOD could never open it. `consume_invite_token` re-checks the
               session against the token's `profile_id` (P6-5), so they were
               signed out, sent to log in, and returned to "This link belongs to
               someone else" — every night, permanently, because the token was
               never going to be theirs.

            2. Quieter and worse: issuing revokes the previous token for that
               (evaluation, layer, channel). Minting a SELF token to chase a HOD
               therefore REVOKED THE EMPLOYEE'S OWN LIVE LINK from launch, on an
               evaluation where the employee had done nothing wrong.

            FIX-12 (F12-2) hit the same trap on the launch path and recorded it;
            this call site was missed. -- */
      const issued = await issueInviteToken(
        lead.evaluationId,
        channel === "WHATSAPP" ? "whatsapp" : "email",
        lead.layer,
      );
      if (!issued.ok) { failed += 1; continue; }

      const link = inviteUrl(issued.data.token);
      const dueDate = formatDate(lead.dueOn);
      const days = daysUntil(today, lead.dueOn);

      const subject = lead.subjectName ? (subjectNames.get(lead.subjectName) ?? "your report") : "";

      /* -- ONE OBJECT for the template AND for HR's own wording (0073).
            The four chase templates take the same values in two shapes — the
            lead's names the employee, the employee's does not — so both are
            here and each template takes what it needs. -- */
      const chaseVars =
        lead.layer === "LEAD"
          ? {
              leadName: person.full_name,
              employeeName: subject,
              period: lead.periodLabel,
              dueDate,
              link,
            }
          : { name: person.full_name, period: lead.periodLabel, dueDate, link };

      const message = lead.layer === "LEAD"
        ? overdue
          ? leadReviewOverdue({
              leadName: person.full_name, employeeName: subject,
              period: lead.periodLabel, dueDate, link,
            })
          : leadReviewReminder({
              leadName: person.full_name, employeeName: subject,
              period: lead.periodLabel, dueDate, days: Math.max(days, 0), link,
            })
        : overdue
          ? selfEvaluationOverdue({ name: person.full_name, period: lead.periodLabel, dueDate, link })
          : selfEvaluationReminder({
              name: person.full_name, period: lead.periodLabel, dueDate, days: Math.max(days, 0), link,
            });

      const result = await sendNotification(
        {
          channel, recipient, template, message, vars: chaseVars,
          evaluationId: lead.evaluationId,
          profileId,
          // Display context only — no link, no token (§10). `records` says how
          // many things this one message covers.
          context: { cycle: lead.cycleName, records: holder.records.length, days_left: days },
        },
        supabase,
      );

      if (result.ok) sent += 1;
      else failed += 1;

      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    // Marked immediately, so two records for the same person inside this run
    // cannot both send.
    chased.add(profileId);
  }

  return NextResponse.json({
    ok: true,
    people: holders.size,
    sent: sent + digests.sent,
    failed: failed + digests.failed,
    skipped,
    // "Mark the row so HR can see it" — who could only be reached by email.
    contactGaps: digests.skipped,
    // Read notifications older than ninety days, removed. Reported so a run
    // that prunes nothing is distinguishable from one that never tried.
    pruned,
    day: today,
  });
}

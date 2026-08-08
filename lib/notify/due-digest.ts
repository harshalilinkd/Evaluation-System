/**
 * The HR and MD digests (P22). Called by the P17 cron route — NOT a second job.
 *
 * Everything here goes out through `sendNotification`, the same P11 dispatcher
 * every other message uses, so the pause switch, the rate limit, the
 * `notifications_log` row and §10's no-token-in-the-payload constraint all apply
 * without being restated.
 *
 * NO SALARY FIGURE REACHES ANY OF THESE. The messages say an increment is due;
 * the amount lives behind the login (§5). None of the template parameters can
 * carry one.
 */

import "server-only";
import { absoluteUrl } from "@/lib/notify/preflight";

import { sendNotification } from "@/lib/notify/dispatch";
import {
  evaluationsOverdue,
  hrDueDigest,
  incrementsOverdue,
  mdReviewDigest,
} from "@/lib/notify/templates";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { formatDate } from "@/lib/utils/date";

type Client = SupabaseClient<Database>;

export type DigestOutcome = { sent: number; failed: number; skipped: string[] };

/** How long each digest waits before it may go again. */
const CADENCE_HOURS = {
  hrDueDigest: 20, // daily
  incrementsOverdue: 24 * 6.5, // weekly
  /* -- Every two days, not daily. --
        A form is overdue because a person has not done it, and a daily nag
        about the same nine people is how a channel stops being read (P22-15).
        Two days is often enough that nothing sits unnoticed for a week. -- */
  evaluationsOverdue: 44,
  mdReviewDigest: 44, // every two days
} as const;

function appUrl(path: string): string {
  return absoluteUrl(path);
}

/** Everyone holding a role, with the contact details a message needs. */
async function holdersOf(supabase: Client, role: "HR_ADMIN" | "MD") {
  const { data } = await supabase
    .from("user_roles")
    .select("profile_id, profiles!inner(id, full_name, email, phone_e164, is_active)")
    .eq("role", role);

  return (data ?? [])
    .map((row) => {
      const embedded = row.profiles as unknown;
      return (Array.isArray(embedded) ? embedded[0] : embedded) as {
        id: string; full_name: string; email: string | null;
        phone_e164: string | null; is_active: boolean;
      } | undefined;
    })
    .filter((p): p is NonNullable<typeof p> => Boolean(p) && p!.is_active);
}

/**
 * Has this person had this digest inside its cadence?
 *
 * Asked of `notifications_log`, never of memory (P17-4): an in-memory flag is
 * per-invocation, so two runs in a day would each think they were the first —
 * which is exactly the idempotency the acceptance asks about.
 */
async function sentRecently(
  supabase: Client,
  template: keyof typeof CADENCE_HOURS,
  now: Date,
): Promise<Set<string>> {
  const since = new Date(now.getTime() - CADENCE_HOURS[template] * 3_600_000).toISOString();
  const { data } = await supabase
    .from("notifications_log")
    .select("profile_id")
    .eq("template", template)
    .gte("created_at", since);
  return new Set((data ?? []).map((r) => r.profile_id).filter((v): v is string => Boolean(v)));
}

/**
 * Send one rendered message on every channel a person can be reached on.
 *
 * "If a profile has no phone, fall back to email and mark the row so HR can see
 * it" — the mark is the returned `skipped` note, which the cron's JSON carries
 * back. Nothing is invented in `notifications_log` for a channel that was never
 * attempted (P11-11).
 */
async function deliver(
  supabase: Client,
  person: { id: string; full_name: string; email: string | null; phone_e164: string | null },
  template: keyof typeof CADENCE_HOURS,
  message: { subject?: string; body: string; html?: string },
  context: Record<string, string | number | null>,
): Promise<{ sent: number; failed: number; note: string | null }> {
  const channels: Array<{ channel: "WHATSAPP" | "EMAIL"; recipient: string }> = [];
  if (person.phone_e164) channels.push({ channel: "WHATSAPP", recipient: person.phone_e164 });
  if (person.email) channels.push({ channel: "EMAIL", recipient: person.email });

  if (channels.length === 0) {
    return { sent: 0, failed: 0, note: `${person.full_name} has no phone or email on record.` };
  }

  let sent = 0;
  let failed = 0;
  for (const { channel, recipient } of channels) {
    const result = await sendNotification(
      { channel, recipient, template, message, profileId: person.id, context },
      supabase,
    );
    if (result.ok) sent += 1;
    else failed += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return {
    sent,
    failed,
    note: person.phone_e164 ? null : `${person.full_name} has no phone — sent by email only.`,
  };
}

type Listed = { name: string; department: string; date: string };

/** Turn due items into the display rows a digest lists. */
async function describe(
  supabase: Client,
  items: Array<{ profile_id: string; due_on: string }>,
): Promise<Listed[]> {
  if (items.length === 0) return [];

  const ids = [...new Set(items.map((i) => i.profile_id))];
  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, department_id")
    .in("id", ids);
  const deptIds = [...new Set((people ?? []).map((p) => p.department_id).filter(Boolean))] as string[];
  const { data: departments } = deptIds.length
    ? await supabase.from("departments").select("id, name").in("id", deptIds)
    : { data: [] };

  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  const deptName = new Map((departments ?? []).map((d) => [d.id, d.name]));

  return items
    .map((item) => {
      const person = byId.get(item.profile_id);
      if (!person) return null;
      return {
        name: person.full_name,
        department: person.department_id ? (deptName.get(person.department_id) ?? "—") : "—",
        date: formatDate(item.due_on),
      };
    })
    .filter((v): v is Listed => v !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Run all three digests.
 *
 * Returns a summary rather than throwing: a digest that fails must not take the
 * per-person reminders down with it, and the cron reports both halves.
 */
export async function sendDueDigests(supabase: Client, now: Date): Promise<DigestOutcome> {
  const outcome: DigestOutcome = { sent: 0, failed: 0, skipped: [] };
  const today = now.toISOString().slice(0, 10);

  const inDays = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const { data: pending } = await supabase
    .from("due_items")
    .select("profile_id, milestone_type, due_on")
    .eq("status", "PENDING");

  const items = pending ?? [];

  // "Due next month" is read as the next 31 days rather than the calendar month:
  // on the 28th, a calendar reading would say nothing is due and then three
  // things would land four days later.
  const incrementsDue = items.filter(
    (i) => i.milestone_type === "INCREMENT" && i.due_on >= today && i.due_on <= inDays(31),
  );
  const incrementsLate = items.filter(
    (i) => i.milestone_type === "INCREMENT" && i.due_on < today,
  );
  /* -- Notice periods differ by WHAT is due, not by "increment or not". --

        A month for anything needing arranging: an increment, and the tenured
        evaluation six months ahead of one (0042's PRE_INCREMENT). A budget
        conversation and a diary slot both need more than a week.

        A week for a new joiner's own milestones. A month's notice on an
        evaluation due 30 days after somebody joins would fire ON THEIR FIRST
        DAY, before they had done any work to be evaluated on — and a notice
        that lands before it can possibly matter is one people learn to skip.

        Written as an explicit list rather than `!== "INCREMENT"`. That test
        silently swept every future milestone type into the 7-day bucket, which
        is exactly what it did to PRE_INCREMENT the moment 0042 added it. -- */
  const NEEDS_A_MONTH = new Set(["INCREMENT", "PRE_INCREMENT"]);

  const milestonesDue = items.filter(
    (i) =>
      i.milestone_type !== "INCREMENT" &&
      i.due_on >= today &&
      i.due_on <= inDays(NEEDS_A_MONTH.has(i.milestone_type) ? 31 : 7),
  );

  const { count: reportsWaiting } = await supabase
    .from("evaluations")
    .select("id", { count: "exact", head: true })
    .eq("status", "PENDING_HR_REVIEW")
    .is("excluded_at", null);

  const { count: withMd } = await supabase
    .from("evaluations")
    .select("id", { count: "exact", head: true })
    .eq("status", "HR_APPROVED")
    .is("excluded_at", null);

  /* ---------- 1. The daily HR digest ---------- */
  //
  // ONE message listing everyone, never one per employee. A per-person message
  // on a day twelve increments fall due is twelve WhatsApps, which is how a
  // channel stops being read.
  const hasHrWork =
    incrementsDue.length > 0 || milestonesDue.length > 0 || (reportsWaiting ?? 0) > 0;

  if (hasHrWork) {
    const alreadySent = await sentRecently(supabase, "hrDueDigest", now);
    const increments = await describe(supabase, incrementsDue);
    const milestones = await describe(supabase, milestonesDue);

    for (const person of await holdersOf(supabase, "HR_ADMIN")) {
      if (alreadySent.has(person.id)) continue;
      const result = await deliver(
        supabase,
        person,
        "hrDueDigest",
        hrDueDigest({
          increments,
          milestones,
          reportsWaiting: reportsWaiting ?? 0,
          link: appUrl("/admin/due"),
        }),
        // Counts only. No name, no date, no figure — §10 keeps the payload free
        // of anything that identifies a person's pay.
        {
          increments: increments.length,
          milestones: milestones.length,
          reports: reportsWaiting ?? 0,
        },
      );
      outcome.sent += result.sent;
      outcome.failed += result.failed;
      if (result.note) outcome.skipped.push(result.note);
    }
  }

  /* ---------- 2. Overdue increments, weekly ---------- */
  if (incrementsLate.length > 0) {
    const alreadySent = await sentRecently(supabase, "incrementsOverdue", now);
    const late = await describe(supabase, incrementsLate);

    for (const person of await holdersOf(supabase, "HR_ADMIN")) {
      if (alreadySent.has(person.id)) continue;
      const result = await deliver(
        supabase,
        person,
        "incrementsOverdue",
        incrementsOverdue({ items: late, link: appUrl("/admin/due") }),
        { overdue: late.length },
      );
      outcome.sent += result.sent;
      outcome.failed += result.failed;
      if (result.note) outcome.skipped.push(result.note);
    }
  }

  /* ---------- 2b. Overdue FORMS, to HR ----------
        P22 chases each side against their own deadline, which is right — but
        nobody told HR the total. A cycle could sit with nine people late and
        the only way to find out was to open the board and count, which is
        precisely the thing that gets missed.

        NO NAMES in the message and no scores: §5 keeps what people wrote
        inside the product, and a WhatsApp has no access control around it. The
        counts and the link are enough to act on, and the names belong on the
        board where they can be chased.

        Counted per SIDE from the timestamps, never from the status — under
        blind rating both layers fill during OPEN, so no status can say which
        side is missing (0027 made the same correction). */
  {
    const { data: openCycle } = await supabase
      .from("evaluation_cycles")
      .select("id, name")
      .eq("status", "ACTIVE")
      .is("deleted_at", null)
      .order("starts_on", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (openCycle) {
      const { data: lateRows } = await supabase
        .from("evaluations")
        .select("self_submitted_at, lead_submitted_at, self_skipped, lead_skipped, due_self_on, due_lead_on")
        .eq("cycle_id", openCycle.id)
        .eq("status", "OPEN")
        .is("excluded_at", null);

      // A skipped layer is closed deliberately by HR and is not outstanding.
      const employeesLate = (lateRows ?? []).filter(
        (r) => !r.self_submitted_at && !r.self_skipped && r.due_self_on && r.due_self_on < today,
      ).length;
      const leadsLate = (lateRows ?? []).filter(
        (r) => !r.lead_submitted_at && !r.lead_skipped && r.due_lead_on && r.due_lead_on < today,
      ).length;

      if (employeesLate + leadsLate > 0) {
        const alreadySent = await sentRecently(supabase, "evaluationsOverdue", now);

        for (const person of await holdersOf(supabase, "HR_ADMIN")) {
          if (alreadySent.has(person.id)) continue;
          const result = await deliver(
            supabase,
            person,
            "evaluationsOverdue",
            evaluationsOverdue({
              employees: employeesLate,
              leads: leadsLate,
              cycleName: openCycle.name,
              link: appUrl(`/admin/cycles/${openCycle.id}`),
            }),
            { employees: employeesLate, leads: leadsLate },
          );
          outcome.sent += result.sent;
          outcome.failed += result.failed;
          if (result.note) outcome.skipped.push(result.note);
        }
      }
    }
  }

  /* ---------- 3. The MD's queue, every two days ---------- */
  if ((withMd ?? 0) > 0) {
    const alreadySent = await sentRecently(supabase, "mdReviewDigest", now);

    for (const person of await holdersOf(supabase, "MD")) {
      if (alreadySent.has(person.id)) continue;
      const result = await deliver(
        supabase,
        person,
        "mdReviewDigest",
        mdReviewDigest({ waiting: withMd ?? 0, link: appUrl("/reports") }),
        { waiting: withMd ?? 0 },
      );
      outcome.sent += result.sent;
      outcome.failed += result.failed;
      if (result.note) outcome.skipped.push(result.note);
    }
  }

  return outcome;
}

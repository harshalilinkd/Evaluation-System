import "server-only";

/**
 * The nightly chase for production rounds.
 *
 * THE WORKER MODULE WENT OUT WITH NONE. A due date passed and nobody was told —
 * not the team leader, not the supervisor, not HR — because the cron route
 * reads `evaluations` and §5 keeps a worker row out of that table entirely. The
 * only message a production round has ever sent is the invite at launch.
 *
 * At the owner's instruction: "hr and staff should get reminder but the form
 * will still open no expiry". So this chases, and nothing here closes,
 * locks or expires anything — a sheet past its date is late, not gone.
 *
 * §7's isolation rule is why this is its own module rather than a branch inside
 * the staff loop: the two share a LADDER, which is a rule, and nothing else.
 * `reminderFor` and `daysUntil` are that shared rule and are imported; the
 * queries, the templates and the destination are all this module's own.
 */

import { contactFor } from "@/lib/notify/contacts";
import { sendNotification, type Channel } from "@/lib/notify/dispatch";
import { absoluteUrl } from "@/lib/notify/preflight";
import { daysUntil, reminderFor } from "@/lib/notify/schedule";
import {
  workerOverdueDigest,
  workerSheetOverdue,
  workerSheetReminder,
} from "@/lib/notify/templates";
import { formatDate } from "@/lib/utils/date";
import { roundLabel } from "@/lib/utils/round-label";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/** One message per person per day, asked of `notifications_log` (P17-4). */
const DEDUPE_HOURS = 20;

/* -- HR hears about overdue sheets WEEKLY, not nightly.
      An overdue appraisal usually waits on somebody HR cannot make act today,
      and a daily nag about it is how a channel stops being read — P22-15 made
      the same call for overdue increments. The people who can actually finish
      it are chased every day; HR is told once a week. -- */
const HR_DIGEST_HOURS = 24 * 6.5;

type Task = {
  evaluationId: string;
  personId: string;
  workerName: string;
  round: string;
  dueOn: string;
  kind: "ahead" | "due_today" | "overdue";
};

export type WorkerChaseResult = {
  sent: number;
  failed: number;
  skipped: number;
  overdue: number;
  hrDigest: "sent" | "not_due" | "nothing_overdue" | "no_recipient" | "failed";
};

const EMPTY: WorkerChaseResult = {
  sent: 0,
  failed: 0,
  skipped: 0,
  overdue: 0,
  hrDigest: "nothing_overdue",
};

/**
 * @param today ISO date in Asia/Kolkata, from the caller — the same day string
 *   the staff sweep uses, so the two cannot disagree about what "today" is on
 *   a server running in UTC (P17-2).
 */
export async function chaseWorkerRounds(
  supabase: Client,
  today: string,
  now: Date,
): Promise<WorkerChaseResult> {
  /* ---------- What is still owed ---------- */

  const { data: cycles } = await supabase
    .from("worker_cycles")
    .select("id, name, period_label, supervisor_due_on")
    .eq("status", "ACTIVE")
    .is("deleted_at", null);

  if (!cycles?.length) return EMPTY;

  const { data: rows } = await supabase
    .from("worker_evaluations")
    .select(
      "id, worker_id, supervisor_id, reviewer_id, cycle_id, status, supervisor_submitted_at, supervisor_skipped, reviewer_submitted_at, reviewer_skipped",
    )
    .in("status", ["OPEN", "PENDING_SUPERVISOR"])
    .is("excluded_at", null)
    .in("cycle_id", cycles.map((c) => c.id));

  if (!rows?.length) return EMPTY;

  const byCycle = new Map(cycles.map((c) => [c.id, c]));

  /* -- Who owes what. At most ONE person per appraisal owes something at a
        time here, which is the difference from the staff sweep: the two staff
        layers are filled in parallel and blind to each other, whereas a
        production round is a hand-over — the supervisor cannot start until the
        team leader has finished. So there is no blindness to preserve and no
        second task to raise. -- */
  const tasks: Task[] = [];
  const workerIds = new Set<string>();

  for (const row of rows) {
    const cycle = byCycle.get(row.cycle_id);
    if (!cycle?.supervisor_due_on) continue;

    const owes =
      row.status === "OPEN"
        ? row.supervisor_submitted_at || row.supervisor_skipped
          ? null
          : row.supervisor_id
        : row.reviewer_submitted_at || row.reviewer_skipped
          ? null
          : row.reviewer_id;

    if (!owes) continue;

    /* -- The round's own date for both steps. There is no separate reviewer
          deadline — the third date was removed from the form at the owner's
          instruction (FIX-22), so inventing one here would put a date on
          screen that nobody set. A review that starts late is late, which is
          the truthful reading. -- */
    const kind = reminderFor(daysUntil(today, cycle.supervisor_due_on));
    if (!kind) continue;

    workerIds.add(row.worker_id);
    tasks.push({
      evaluationId: row.id,
      personId: owes,
      workerName: row.worker_id,
      round: roundLabel(cycle.name, cycle.period_label),
      dueOn: cycle.supervisor_due_on,
      kind,
    });
  }

  if (tasks.length === 0) return EMPTY;

  /* ---------- The names ---------- */

  const personIds = [...new Set(tasks.map((t) => t.personId))];
  const [{ data: holders }, { data: workers }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, is_active, email, phone_e164, work_email, work_phone_e164")
      .in("id", personIds),
    supabase.from("profiles").select("id, full_name").in("id", [...workerIds]),
  ]);

  const workerName = new Map((workers ?? []).map((p) => [p.id, p.full_name]));
  for (const task of tasks) task.workerName = workerName.get(task.workerName) ?? "a worker";

  /* -- Already chased today? Asked of the log, never of memory: two runs in a
        day would each think they were the first, which is exactly the
        idempotency this has to have (P17-4). Keyed by PERSON — the rule is one
        message a day whatever they owe. -- */
  const since = new Date(now.getTime() - DEDUPE_HOURS * 3_600_000).toISOString();
  const { data: recent } = await supabase
    .from("notifications_log")
    .select("profile_id")
    .in("template", ["workerSheetReminder", "workerSheetOverdue"])
    .gte("created_at", since);

  const chased = new Set((recent ?? []).map((r) => r.profile_id).filter(Boolean));

  const link = absoluteUrl("/worker-team") ?? "";
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const personId of personIds) {
    const person = (holders ?? []).find((p) => p.id === personId);

    // Somebody who has left is not chased about an appraisal, and the message
    // would bounce anyway.
    if (!person || !person.is_active) { skipped += 1; continue; }
    if (chased.has(personId)) { skipped += 1; continue; }

    /* -- One message, covering ONE appraisal: the most urgent. Somebody with
          six people on the round gets one, not six — six identical WhatsApps in
          a minute is how a channel stops being read (P22-12). The rest are
          picked up tomorrow. -- */
    const mine = tasks
      .filter((t) => t.personId === personId)
      .sort(
        (a, b) =>
          (a.kind === "overdue" ? 0 : 1) - (b.kind === "overdue" ? 0 : 1) ||
          a.dueOn.localeCompare(b.dueOn),
      );

    const task = mine[0];
    if (!task || !link) { skipped += 1; continue; }

    const overdue = task.kind === "overdue";
    const template = overdue ? "workerSheetOverdue" : "workerSheetReminder";
    const dueDate = formatDate(task.dueOn);
    const days = Math.max(daysUntil(today, task.dueOn), 0);

    const vars = {
      name: person.full_name,
      leadName: person.full_name,
      employeeName: task.workerName,
      period: task.round,
      dueDate,
      days,
    };

    const message = overdue
      ? workerSheetOverdue({ ...vars, link })
      : workerSheetReminder({ ...vars, link });

    /* -- Official, resolved from the TEMPLATE rather than chosen here. Chasing
          somebody about their team's sheet is something they receive because of
          the position they hold (0081, as amended). -- */
    const to = contactFor(person, template);
    const channels: Array<{ channel: Channel; recipient: string }> = [];
    if (to.phone) channels.push({ channel: "WHATSAPP", recipient: to.phone });
    if (to.email) channels.push({ channel: "EMAIL", recipient: to.email });
    if (channels.length === 0) { skipped += 1; continue; }

    for (const { channel, recipient } of channels) {
      const result = await sendNotification(
        {
          channel,
          recipient,
          template,
          message,
          vars,
          evaluationId: task.evaluationId,
          profileId: personId,
          // Display context only — no link and no token (§10).
          context: { round: task.round, records: mine.length, days_left: days },
        },
        supabase,
      );
      if (result.ok) sent += 1;
      else failed += 1;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    // Marked inside the run too, so two records for one person cannot both send.
    chased.add(personId);
  }

  const overdueTasks = tasks.filter((t) => t.kind === "overdue");
  const hrDigest = await sendHrDigest(supabase, now, overdueTasks, holders ?? []);

  return { sent, failed, skipped, overdue: overdueTasks.length, hrDigest };
}

/* ---------- HR's weekly list ---------- */

async function sendHrDigest(
  supabase: Client,
  now: Date,
  overdue: Task[],
  holders: Array<{ id: string; full_name: string }>,
): Promise<WorkerChaseResult["hrDigest"]> {
  if (overdue.length === 0) return "nothing_overdue";

  const since = new Date(now.getTime() - HR_DIGEST_HOURS * 3_600_000).toISOString();
  const { data: recent } = await supabase
    .from("notifications_log")
    .select("id")
    .eq("template", "workerOverdueDigest")
    .gte("created_at", since)
    .limit(1);

  if ((recent ?? []).length > 0) return "not_due";

  const { data: hrRows } = await supabase
    .from("user_roles")
    .select("profile_id")
    .eq("role", "HR_ADMIN");

  const hrIds = [...new Set((hrRows ?? []).map((r) => r.profile_id))];
  if (hrIds.length === 0) return "no_recipient";

  const { data: hrPeople } = await supabase
    .from("profiles")
    .select("id, full_name, is_active, email, phone_e164, work_email, work_phone_e164")
    .in("id", hrIds)
    .eq("is_active", true);

  if (!hrPeople?.length) return "no_recipient";

  const holderName = new Map(holders.map((p) => [p.id, p.full_name]));
  const lines = overdue.map(
    (t) => `${t.workerName} — with ${holderName.get(t.personId) ?? "whoever holds it"}`,
  );

  const link = absoluteUrl("/admin/worker-appraisals") ?? "";
  if (!link) return "failed";

  const message = workerOverdueDigest({ count: overdue.length, lines, link });
  let any = false;

  for (const person of hrPeople) {
    const to = contactFor(person, "workerOverdueDigest");
    const channels: Array<{ channel: Channel; recipient: string }> = [];
    if (to.phone) channels.push({ channel: "WHATSAPP", recipient: to.phone });
    if (to.email) channels.push({ channel: "EMAIL", recipient: to.email });

    for (const { channel, recipient } of channels) {
      const result = await sendNotification(
        {
          channel,
          recipient,
          template: "workerOverdueDigest",
          message,
          // A count and names. No tick, no score, no salary (§5, §11) — there
          // is no placeholder here that could hold one.
          vars: { count: overdue.length },
          profileId: person.id,
          context: { overdue: overdue.length },
        },
        supabase,
      );
      if (result.ok) any = true;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  return any ? "sent" : "failed";
}

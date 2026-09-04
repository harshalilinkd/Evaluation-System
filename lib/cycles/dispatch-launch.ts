/** Sends both invite links after a launch commits. Never inside the transaction. */

import "server-only";
import { absoluteUrl } from "@/lib/notify/preflight";

import { inviteUrl, issueInviteToken } from "@/lib/auth/invites";
import type { LaunchPlan } from "@/lib/cycles/launch";
import { contactFor, type ContactSource } from "@/lib/notify/contacts";
import { MD_MAY_RECEIVE, sendNotification } from "@/lib/notify/dispatch";
import type { RenderedMessage, TemplateKey } from "@/lib/notify/templates";
import { leadReviewInvite, selfEvaluationInvite } from "@/lib/notify/templates";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/date";

/**
 * P10-REV item 16: one message per report, not a digest, because each carries
 * its own link. Capped so a HOD with thirty reports does not receive thirty
 * WhatsApp messages in one minute — the remainder is left for the cron sweep,
 * which chases against each evaluation's own due date.
 */
const MAX_PER_LEAD_PER_LAUNCH = 10;

export type LaunchDispatch = {
  sent: number;
  failed: number;
  queued: number;
  /**
   * Why nothing went out, when nothing could.
   *
   * Not an error — the cycle is launched and durable by the time this runs. It
   * is the sentence HR needs in order to know the links still have to be sent,
   * and it is shown on the launch confirmation rather than thrown.
   */
  blocked?: string;
};

/**
 * Send the invites for a freshly launched cycle.
 *
 * ⚠ THIS FUNCTION MUST NEVER THROW. It is called AFTER `launch_cycle` has
 * committed — the evaluations, the frozen snapshots, both response rows per
 * person and every token are already written and audited. A throw here does not
 * undo any of that; it only turns a successful launch into a runtime error on
 * screen, with the dialog stuck on "Launching…" while the cycle is in fact
 * live. That is the worst available outcome: durable work reported as a crash,
 * and HR pressing Launch again on a cycle that has already launched.
 *
 * PW-2 made exactly this call for transitions — "the hook runs after the commit
 * and cannot throw" — and PR-11 restated it for this path. The rule was written
 * down in both places and enforced in neither: `absoluteUrl` throws when
 * NEXT_PUBLIC_APP_URL is localhost (a real and correct refusal — §10 links have
 * to be reachable from a phone), and nothing caught it.
 */
/**
 * Who a launch messages.
 *
 * BOTH tokens are always created (PR-5, PR-7) — the lead needs one to open
 * their own form whenever they get to it, and minting it later would mean a
 * second write path for the same secret. This decides only who is TOLD, which
 * is a separate question and HR's to answer: a HOD who is sitting beside you
 * does not need a WhatsApp about it.
 */
export type InviteRecipients = Array<"SELF" | "LEAD">;

export async function dispatchLaunchInvites(
  cycleId: string,
  plan: LaunchPlan,
  recipients: InviteRecipients = ["SELF", "LEAD"],
): Promise<LaunchDispatch> {
  // Nobody chosen means nobody messaged. Not a failure — HR can send from the
  // distribute screen whenever they are ready.
  if (recipients.length === 0) return { sent: 0, failed: 0, queued: 0 };
  try {
    return await sendLaunchInvites(cycleId, plan, recipients);
  } catch (cause) {
    /* -- The one place the rule above is actually enforced. Every failure
          becomes an advisory the launch carries back, never an exception the
          launch dies on. -- */
    return {
      sent: 0,
      failed: plan.links.length,
      queued: 0,
      blocked: cause instanceof Error ? cause.message : "The invite links could not be sent.",
    };
  }
}

async function sendLaunchInvites(
  cycleId: string,
  plan: LaunchPlan,
  recipients: InviteRecipients,
): Promise<LaunchDispatch> {
  const out: LaunchDispatch = { sent: 0, failed: 0, queued: 0 };
  if (plan.links.length === 0) return out;

  const supabase = await createClient();

  const [{ data: cycle }, { data: evaluations }] = await Promise.all([
    supabase
      .from("evaluation_cycles")
      .select("name, period_label")
      .eq("id", cycleId)
      .maybeSingle(),
    supabase
      .from("evaluations")
      .select("id, evaluatee_id, lead_id, co_lead_id, department_id, due_self_on, due_lead_on")
      .eq("cycle_id", cycleId),
  ]);

  const byEvaluation = new Map((evaluations ?? []).map((e) => [e.id, e]));
  const personIds = [
    ...new Set(
      (evaluations ?? [])
        .flatMap((e) => [e.evaluatee_id, e.lead_id, e.co_lead_id])
        .filter((v): v is string => Boolean(v)),
    ),
  ];

  const [{ data: people }, { data: departments }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, phone_e164, work_email, work_phone_e164")
      .in("id", personIds),
    supabase.from("departments").select("id, name"),
  ]);

  const person = new Map((people ?? []).map((p) => [p.id, p]));
  const departmentName = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const period = cycle?.period_label ?? "";

  /* -- FIX-13's rule, asked ONCE rather than once per recipient.
        The MD receives only the approved report, so every other message to
        somebody whose sole administrative role is MD is suppressed. That was
        being decided inside `deliverInvite` — which built a Supabase client
        and read `user_roles` for EVERY invite, so a launch of forty-seven paid
        for a hundred round trips to answer a question about two or three
        people.

        `sendNotification` still applies the rule itself and is the real
        guarantee; this is the cheap version of the same answer, and it exists
        here because the email branch mints a token BEFORE sending, and a token
        issued for a message that is then suppressed is an orphan that has also
        revoked whatever it replaced (§10). -- */
  const { data: roleRows } = personIds.length
    ? await supabase.from("user_roles").select("profile_id, role").in("profile_id", personIds)
    : { data: [] as Array<{ profile_id: string; role: string }> };

  const held = new Map<string, Set<string>>();
  for (const row of roleRows ?? []) {
    const set = held.get(row.profile_id) ?? new Set<string>();
    set.add(row.role);
    held.set(row.profile_id, set);
  }

  // Holding HR as well is not suppressed: the rule is about somebody whose
  // ONLY administrative role is MD (F13-3).
  const mdOnly = new Set(
    [...held.entries()]
      .filter(([, roles]) => roles.has("MD") && !roles.has("HR_ADMIN"))
      .map(([id]) => id),
  );

  /* -- The per-HOD cap. Counted as we go, so the first ten of a large team go
        out now and the rest are left for cron — which is why nothing is
        silently dropped. -- */
  const perLead = new Map<string, number>();

  for (const link of plan.links) {
    const evaluation = byEvaluation.get(link.evaluationId);
    if (!evaluation) continue;

    /* -- The employee -- */
    const employee = recipients.includes("SELF")
      ? person.get(evaluation.evaluatee_id)
      : undefined;
    if (employee) {
      const result = await deliverInvite({
        mdOnly,
        evaluationId: link.evaluationId,
        layer: "SELF",
        profileId: employee.id,
        person: employee,
        whatsappToken: link.selfToken,
        template: "selfEvaluationInvite",
        // Rendered per channel, because each channel carries its own token.
        render: (url) =>
          selfEvaluationInvite({
            name: employee.full_name,
            period,
            // The EVALUATION's date, not the cycle's — a rolling cycle gives
            // each person their own (item 3).
            dueDate: formatDate(evaluation.due_self_on),
            link: url,
          }),
        context: { cycle: cycle?.name ?? "" },
      });
      out.sent += result.sent;
      out.failed += result.failed;
    }

    /* -- The HOD -- */
    const lead =
      recipients.includes("LEAD") && evaluation.lead_id
        ? person.get(evaluation.lead_id)
        : undefined;
    if (lead && link.leadToken) {
      const already = perLead.get(lead.id) ?? 0;
      if (already >= MAX_PER_LEAD_PER_LAUNCH) {
        out.queued += 1;
        continue;
      }
      perLead.set(lead.id, already + 1);

      const result = await deliverInvite({
        mdOnly,
        evaluationId: link.evaluationId,
        layer: "LEAD",
        profileId: lead.id,
        person: lead,
        whatsappToken: link.leadToken,
        template: "leadReviewInvite",
        render: (url) =>
          leadReviewInvite({
            leadName: lead.full_name,
            employeeName: person.get(evaluation.evaluatee_id)?.full_name ?? "your report",
            department: evaluation.department_id
              ? (departmentName.get(evaluation.department_id) ?? "their team")
              : "their team",
            period,
            dueDate: formatDate(evaluation.due_lead_on),
            link: url,
          }),
        // No `employee_submitted` or anything like it: §5's blindness applies
        // to the notification log as much as to a screen.
        context: { cycle: cycle?.name ?? "" },
      });
      out.sent += result.sent;
      out.failed += result.failed;
    }

    /* -- The SECOND manager -- */
    //
    // Governed by the same `LEAD` choice as the HOD, not a third option: HR's
    // question on the review step is "who is rated by whom in this cycle", and
    // the second reviewer is a manager. A separate toggle would let a cycle go
    // out to one of a designer's two managers and not the other, which is not a
    // decision anybody would mean to take.
    //
    // Counted against the SAME per-HOD cap, keyed on their own id: a Design
    // Coordinator carrying twenty designers is exactly the person the cap
    // exists for. The remainder is left for the nightly chase, which works from
    // each evaluation's own due date.
    const coLead =
      recipients.includes("LEAD") && evaluation.co_lead_id
        ? person.get(evaluation.co_lead_id)
        : undefined;
    if (coLead && link.coLeadToken) {
      const already = perLead.get(coLead.id) ?? 0;
      if (already >= MAX_PER_LEAD_PER_LAUNCH) {
        out.queued += 1;
        continue;
      }
      perLead.set(coLead.id, already + 1);

      const result = await deliverInvite({
        mdOnly,
        evaluationId: link.evaluationId,
        layer: "LEAD_2",
        profileId: coLead.id,
        person: coLead,
        whatsappToken: link.coLeadToken,
        // The SAME template as the HOD's. The two managers are asked for the
        // same thing on the same form, and a second wording is a second place
        // for the message to drift — and the one most likely to drift into
        // saying something about the other manager (§5).
        template: "leadReviewInvite",
        render: (url) =>
          leadReviewInvite({
            leadName: coLead.full_name,
            employeeName: person.get(evaluation.evaluatee_id)?.full_name ?? "your report",
            department: evaluation.department_id
              ? (departmentName.get(evaluation.department_id) ?? "their team")
              : "their team",
            period,
            dueDate: formatDate(evaluation.due_lead_on),
            link: url,
          }),
        context: { cycle: cycle?.name ?? "" },
      });
      out.sent += result.sent;
      out.failed += result.failed;
    }
  }

  return out;
}

/** §10: the token appears in exactly one URL and is never re-shown. */
function inviteLink(token: string): string {
  return absoluteUrl(`/invite/${token}`);
}

/**
 * Send one invite on EVERY channel the person can actually be reached on.
 *
 * This is what the launch was missing. It messaged WhatsApp and nothing else,
 * with a comment saying "email follows from the distribution screen" — which
 * was true when P11 wrote it and stopped being true the moment launching became
 * the moment the whole company hears about it (P17). So a launch quietly told
 * half the story: the email address was even SELECTED in the query above and
 * then never used, which is the tell.
 *
 * `events.ts` has sent on every reachable channel since P11-WIRE. This brings
 * the launch onto the same rule rather than leaving two answers to "which
 * channels does an invite go out on".
 *
 * A MISSING CONTACT DETAIL IS NOT A FAILURE. Nothing is attempted, so nothing
 * is logged — P11-11's rule, so the failure count stays a count of things that
 * actually went wrong and can be retried.
 */
async function deliverInvite(opts: {
  /** Profile ids whose only administrative role is MD, resolved once per launch. */
  mdOnly: Set<string>;
  evaluationId: string;
  /** Whose link. Decides which token is minted for the email channel. */
  layer: "SELF" | "LEAD" | "LEAD_2";
  profileId: string;
  /* -- The person, not a phone and an email (0081). Both templates this sends
        are invites — somebody's own form or their team's — so both resolve to
        the personal pair; but the choice is `contactFor`'s from the template,
        not a decision restated at the two call sites below. -- */
  person: ContactSource;
  /**
   * The plaintext token `launch_cycle` minted, which is scoped to WHATSAPP.
   *
   * §10 gives one active token per (evaluation, layer, channel), so the email
   * link needs its OWN — reusing this one would put a whatsapp-scoped secret in
   * an email, and minting a second whatsapp token here would revoke the one the
   * launch just wrote.
   */
  whatsappToken: string;
  template: TemplateKey;
  render: (link: string) => RenderedMessage;
  /**
   * The values `render` was given, minus the link — so HR's own wording can be
   * filled in with the same ones (0073). The link is added per channel below,
   * because each channel's is different and this is what mints them.
   */
  vars?: Record<string, unknown>;
  context: Record<string, string | number | null>;
}): Promise<{ sent: number; failed: number }> {
  const out = { sent: 0, failed: 0 };

  // Resolved once for the whole launch — see `mdOnly` in sendLaunchInvites.
  if (!MD_MAY_RECEIVE.has(opts.template) && opts.mdOnly.has(opts.profileId)) return out;

  const to = contactFor(opts.person, opts.template);

  /* -- THE TWO CHANNELS TOGETHER.
        They were awaited in turn, so every recipient waited out a WhatsApp
        round trip and then an SMTP one before the next person was even
        started. They share nothing: §10 scopes a token to a channel, so each
        link is separately minted, and `sendNotification` writes its own log
        row per send. Sending them at the same time halves the wait per person
        and changes nothing about what is sent or recorded.

        Not widened past this. The loop over PEOPLE stays sequential, because
        the per-HOD cap is a running count and "the first ten of a large team"
        is only meaningful in an order. -- */
  const [whatsapp, email] = await Promise.all([
    // §13.2 — most people open the link on a phone, and a WhatsApp message is
    // read in minutes where an email may not be read at all.
    to.phone
      ? sendNotification({
          channel: "WHATSAPP",
          recipient: to.phone,
          template: opts.template,
          message: opts.render(inviteLink(opts.whatsappToken)),
          vars: { ...(opts.vars ?? {}), link: inviteLink(opts.whatsappToken) },
          evaluationId: opts.evaluationId,
          profileId: opts.profileId,
          context: opts.context,
        })
      : null,
    to.email
      ? (async () => {
          const issued = await issueInviteToken(opts.evaluationId, "email", opts.layer);
          if (!issued.ok) return "MINT_FAILED" as const;
          return sendNotification({
            channel: "EMAIL",
            recipient: to.email as string,
            template: opts.template,
            message: opts.render(inviteUrl(issued.data.token)),
            vars: { ...(opts.vars ?? {}), link: inviteUrl(issued.data.token) },
            evaluationId: opts.evaluationId,
            profileId: opts.profileId,
            context: opts.context,
          });
        })()
      : null,
  ]);

  for (const result of [whatsapp, email]) {
    if (result === null) continue;
    if (result === "MINT_FAILED") {
      out.failed += 1;
      continue;
    }
    if (result.ok) out.sent += 1;
    // Not a failure — the MD is deliberately not invited as an employee or a
    // HOD, and there is nothing here for HR to retry.
    else if (!result.suppressed) out.failed += 1;
  }

  return out;
}

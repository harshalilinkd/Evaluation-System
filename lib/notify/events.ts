/** Transition-driven notifications. CLAUDE.md §8 events → §10 messages. */

import "server-only";

import { inviteUrl, issueInviteToken } from "@/lib/auth/invites";
import { sendNotification, type Channel } from "@/lib/notify/dispatch";
import {
  evaluationClosed,
  selfEvaluationInvite,
  evaluationFinalised,
  formReturned,
  leadReviewInvite,
  mdReviewPending,
  reportReady,
  type RenderedMessage,
  type TemplateKey,
} from "@/lib/notify/templates";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatScore } from "@/lib/utils/date";

/**
 * WHY THIS HANGS OFF transition() AND NOWHERE ELSE
 *
 * §8's transition function is the only place an evaluation's status changes.
 * Hanging the notifications off it means every screen that ever moves an
 * evaluation — P12's self-evaluation form, P13's lead review, P14's MD
 * collision view — raises the right message without knowing this file exists.
 *
 * The alternative is each screen remembering to send, which is how a product
 * ends up notifying on three transitions out of five and nobody noticing until
 * an employee asks why they were never told their form came back.
 *
 * NOTHING HERE CAN BREAK A TRANSITION. The status change is already committed
 * and audited by the time this runs. A provider outage, a missing key, a person
 * with no email — none of it may turn a successful transition into a failure the
 * caller reports. So every path returns, none throws, and the result is
 * advisory. §10: "Failures never block the UI."
 */

export type TransitionNotice = {
  sent: number;
  failed: number;
  /** Human-readable, for a screen that wants to say "we could not reach X". */
  problems: string[];
};

const NOTHING: TransitionNotice = { sent: 0, failed: 0, problems: [] };

/**
 * WHICH LINK EACH AUDIENCE GETS, AND WHY THEY DIFFER
 *
 * Employees get a signed invite token (§10). Most of them have never signed in,
 * open the message on a phone, and would otherwise hit a login form for an
 * account they do not know they have.
 *
 * Leads, the MD and HR get a plain application URL. They have accounts and use
 * them daily, and minting a single-evaluation token for somebody who needs to
 * see a queue would scope them *down* — §10 is explicit that a token "never
 * grants access to anything beyond that one evaluation". A token is a way in
 * for someone who has none; it is not a convenience for someone who does.
 */
function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `${base.replace(/\/$/, "")}${path}`;
}

async function employeeLink(evaluationId: string, channel: Channel): Promise<string | null> {
  const issued = await issueInviteToken(evaluationId, channel === "WHATSAPP" ? "whatsapp" : "email");
  return issued.ok ? inviteUrl(issued.data.token) : null;
}

/**
 * Send one message on every channel a person can actually be reached on.
 *
 * WhatsApp first: §13.2 notes most employees open the link on a phone, and a
 * WhatsApp message is read in minutes where an email may not be read at all.
 * Email is sent as well rather than instead — a link that matters should not
 * depend on one channel being up.
 */
async function deliver(opts: {
  template: TemplateKey;
  evaluationId: string;
  profileId: string;
  phone: string | null;
  email: string | null;
  /** Called per channel, because an employee's link is channel-scoped (§10). */
  render: (link: string) => RenderedMessage;
  /** Employees get a token; staff with accounts get a plain URL. */
  audience: "employee" | "staff";
  staffPath?: string;
  context?: Record<string, string | number | null>;
}): Promise<TransitionNotice> {
  const channels: Array<{ channel: Channel; recipient: string }> = [];
  if (opts.phone) channels.push({ channel: "WHATSAPP", recipient: opts.phone });
  if (opts.email) channels.push({ channel: "EMAIL", recipient: opts.email });

  if (channels.length === 0) {
    return {
      sent: 0,
      failed: 0,
      // Not a failure — nothing was attempted. It is worth surfacing so HR can
      // fix the contact details, but it is not a provider problem.
      problems: ["No phone number or email address on record."],
    };
  }

  const notice: TransitionNotice = { sent: 0, failed: 0, problems: [] };

  for (const { channel, recipient } of channels) {
    const link =
      opts.audience === "employee"
        ? await employeeLink(opts.evaluationId, channel)
        : appUrl(opts.staffPath ?? "/dashboard");

    if (!link) {
      notice.failed += 1;
      notice.problems.push("Could not create a link.");
      continue;
    }

    const result = await sendNotification({
      channel,
      recipient,
      template: opts.template,
      message: opts.render(link),
      evaluationId: opts.evaluationId,
      profileId: opts.profileId,
      context: opts.context,
    });

    if (result.ok) notice.sent += 1;
    else {
      notice.failed += 1;
      notice.problems.push(result.message);
    }
  }

  return notice;
}

/* ---------- The mapping ---------- */

/**
 * Raise whatever §8 transition just happened as a message.
 *
 * Called by transition() after the commit. Returns a summary rather than
 * throwing, and swallows its own errors — see the banner.
 */
export async function notifyTransition(input: {
  evaluationId: string;
  from: string;
  to: string;
  reason?: string | null;
}): Promise<TransitionNotice> {
  try {
    return await run(input);
  } catch {
    // A bug in here must not surface as a failed transition that already
    // committed. The notifications_log row (or its absence) is the record.
    return NOTHING;
  }
}

async function run({
  evaluationId,
  from,
  to,
  reason,
}: {
  evaluationId: string;
  from: string;
  to: string;
  reason?: string | null;
}): Promise<TransitionNotice> {
  const move = `${from}->${to}`;

  // AMENDED (P17). PW-3 deliberately raised NOTHING on launch, on the reasoning
  // that 47 messages firing the instant a cycle opens — before HR has checked
  // the roster — is not a feature, and that the invite should stay a deliberate
  // act on the distribution screen.
  //
  // P17 reverses that at the owner's instruction: launching now messages each
  // employee with their personal link. The consequence is worth stating plainly
  // — pressing Launch is now the moment the whole company hears about it, and
  // the distribution screen becomes a resend tool rather than the first send.
  // The pause switch (0016) is the brake if a launch goes out by mistake.
  /* -- AMEND-3 item 11. `CYCLE_ACTIVE->SELF_SUBMITTED` used to tell the lead
        "your review is open now" the moment the employee submitted, which is a
        readout of the other side's progress — the same signal the queue and the
        self column lost. It is GONE.
        
        The lead is told at LAUNCH instead, which is when their form actually
        opens under §8, and chased against their own due date by the cron sweep.
        A layer submission (OPEN->OPEN) raises nothing at all: neither side is
        told anything about the other. -- */
  /* -- P20 adds three. Both-submitted tells HR the report exists; the MD's two
        ways of handing it back tell HR, with the reason. All three are between
        HR and the MD about a report neither the employee nor the lead can read,
        so neither of them hears anything. -- */
  if (
    move !== "DRAFT->OPEN" &&
    move !== "OPEN->PENDING_HR_REVIEW" &&
    move !== "PENDING_HR_REVIEW->OPEN" &&
    move !== "PENDING_HR_REVIEW->HR_APPROVED" &&
    move !== "HR_APPROVED->PENDING_HR_REVIEW" &&
    move !== "HR_APPROVED->MD_REVIEWED" &&
    move !== "MD_REVIEWED->HR_APPROVED" &&
    move !== "MD_REVIEWED->CLOSED" &&
    move !== "INTERVIEW_DONE->CLOSED"
  ) {
    return NOTHING;
  }

  const supabase = await createClient();

  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id, evaluatee_id, lead_id, cycle_id, lead_overall, returned_to")
    .eq("id", evaluationId)
    .maybeSingle();

  if (!evaluation) return NOTHING;

  const { data: cycle } = await supabase
    .from("evaluation_cycles")
    .select("id, name, period_label, self_due_on, lead_due_on, md_due_on, disclosure")
    .eq("id", evaluation.cycle_id)
    .maybeSingle();

  if (!cycle) return NOTHING;

  const ids = [evaluation.evaluatee_id, evaluation.lead_id].filter((v): v is string => Boolean(v));
  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone_e164, department_id")
    .in("id", ids);

  const employee = (people ?? []).find((p) => p.id === evaluation.evaluatee_id);
  const lead = (people ?? []).find((p) => p.id === evaluation.lead_id);

  if (!employee) return NOTHING;

  /* -- The lead's invite names the employee's department, so a HOD with several
        reports can tell at a glance which form this is. It is NOT a readout of
        the other side — a department is a fact about the person, not about
        whether they have submitted. -- */
  const { data: employeeDept } = employee.department_id
    ? await supabase.from("departments").select("name").eq("id", employee.department_id).maybeSingle()
    : { data: null };
  const employeeDepartment = employeeDept?.name ?? "their department";

  switch (move) {
    /* -- Launch opens BOTH layers at once (§8), so both people are told — and
          each is told only about their own form. This is where the lead now
          hears "your review is open": item 11 moved it here from the employee's
          submission, which was a readout of the other side. -- */
    case "DRAFT->OPEN": {
      const notice: TransitionNotice = { sent: 0, failed: 0, problems: [] };

      if (lead) {
        const forLead = await deliver({
          template: "leadReviewInvite",
          evaluationId,
          profileId: lead.id,
          phone: lead.phone_e164,
          email: lead.email,
          audience: "staff",
          staffPath: `/team/${evaluationId}`,
          render: (link) =>
            /* -- P22: this was `leadReviewPending`, whose body says
                  "{employee} has submitted their self-evaluation". At LAUNCH
                  that is both false and a readout of the other side — the exact
                  signal AMEND-3 removed. P10-REV wrote `leadReviewInvite` for
                  this moment and the call site was never switched, so every HOD
                  has been told their report already submitted. -- */
            leadReviewInvite({
              leadName: lead.full_name,
              employeeName: employee.full_name,
              department: employeeDepartment,
              period: cycle.period_label,
              dueDate: formatDate(cycle.lead_due_on),
              link,
            }),
          context: { cycle: cycle.name, employee: employee.full_name },
        });
        notice.sent += forLead.sent;
        notice.failed += forLead.failed;
        notice.problems.push(...forLead.problems);
      }

      const forEmployee = await deliver({
        template: "selfEvaluationInvite",
        evaluationId,
        profileId: employee.id,
        phone: employee.phone_e164,
        email: employee.email,
        // Somebody who has never signed in needs a token, not a login form.
        audience: "employee",
        render: (link) =>
          selfEvaluationInvite({
            name: employee.full_name,
            period: cycle.period_label,
            dueDate: formatDate(cycle.self_due_on),
            link,
          }),
        context: { cycle: cycle.name },
      });
      notice.sent += forEmployee.sent;
      notice.failed += forEmployee.failed;
      notice.problems.push(...forEmployee.problems);
      return notice;
    }

    /* -- HR sent it back. ONLY the side whose layer was unlocked is told: a
          return of one layer says nothing about the other, and telling both
          would report the other side's state to each of them. -- */
    case "PENDING_HR_REVIEW->OPEN": {
      const notice: TransitionNotice = { sent: 0, failed: 0, problems: [] };
      const returnedTo = evaluation.returned_to ?? "BOTH";

      if (returnedTo === "SELF" || returnedTo === "BOTH") {
        const r = await deliver({
          template: "formReturned",
          evaluationId,
          profileId: employee.id,
          phone: employee.phone_e164,
          email: employee.email,
          audience: "employee",
          render: (link) =>
            formReturned({
              name: employee.full_name,
              period: cycle.period_label,
              reason: reason ?? "No reason was recorded.",
              link,
            }),
          context: { cycle: cycle.name },
        });
        notice.sent += r.sent;
        notice.failed += r.failed;
        notice.problems.push(...r.problems);
      }

      if ((returnedTo === "LEAD" || returnedTo === "BOTH") && lead) {
        const r = await deliver({
          template: "formReturned",
          evaluationId,
          profileId: lead.id,
          phone: lead.phone_e164,
          email: lead.email,
          audience: "staff",
          staffPath: `/team/${evaluationId}`,
          render: (link) =>
            formReturned({
              name: lead.full_name,
              period: cycle.period_label,
              reason: reason ?? "No reason was recorded.",
              link,
            }),
          context: { cycle: cycle.name, employee: employee.full_name },
        });
        notice.sent += r.sent;
        notice.failed += r.failed;
        notice.problems.push(...r.problems);
      }
      return notice;
    }

    /* -- Both sides are in, and the combined report exists for the first time.
          HR is told — they are the only role that can act on it, and under §5
          they are one of only two that can read both halves at all.

          The employee and the lead are told NOTHING here. Either message would
          be a readout of the other side's progress: "your report is ready" said
          to an employee means their HOD has submitted, which is precisely what
          blind rating withholds (A3-12). -- */
    case "OPEN->PENDING_HR_REVIEW": {
      const { data: hrForReady } = await supabase
        .from("user_roles")
        .select("profile_id, profiles!inner(id, full_name, email, phone_e164)")
        .eq("role", "HR_ADMIN");

      const notice: TransitionNotice = { sent: 0, failed: 0, problems: [] };

      for (const row of hrForReady ?? []) {
        const embedded = row.profiles as unknown;
        const person = (Array.isArray(embedded) ? embedded[0] : embedded) as
          | { id: string; full_name: string; email: string | null; phone_e164: string | null }
          | undefined;
        if (!person) continue;

        const result = await deliver({
          template: "reportReady",
          evaluationId,
          profileId: person.id,
          phone: person.phone_e164,
          email: person.email,
          audience: "staff",
          staffPath: `/reports/${evaluationId}`,
          render: (link) =>
            reportReady({
              employeeName: employee.full_name,
              period: cycle.period_label,
              link,
            }),
          context: { cycle: cycle.name, employee: employee.full_name },
        });
        notice.sent += result.sent;
        notice.failed += result.failed;
        notice.problems.push(...result.problems);
      }
      return notice;
    }

    /* -- The MD has sent it back, or pulled it back for a correction. HR is
          told, with the reason verbatim — it is the only thing that says what
          to change. Neither the employee nor the lead hears about it: this is a
          conversation between HR and the MD about a report neither of them can
          read. -- */
    case "HR_APPROVED->PENDING_HR_REVIEW":
    case "MD_REVIEWED->HR_APPROVED": {
      const { data: hrForReturn } = await supabase
        .from("user_roles")
        .select("profile_id, profiles!inner(id, full_name, email, phone_e164)")
        .eq("role", "HR_ADMIN");

      const notice: TransitionNotice = { sent: 0, failed: 0, problems: [] };

      for (const row of hrForReturn ?? []) {
        const embedded = row.profiles as unknown;
        const person = (Array.isArray(embedded) ? embedded[0] : embedded) as
          | { id: string; full_name: string; email: string | null; phone_e164: string | null }
          | undefined;
        if (!person) continue;

        const result = await deliver({
          template: "formReturned",
          evaluationId,
          profileId: person.id,
          phone: person.phone_e164,
          email: person.email,
          audience: "staff",
          staffPath: `/reports/${evaluationId}`,
          render: (link) =>
            formReturned({
              name: person.full_name,
              period: `${employee.full_name} · ${cycle.period_label}`,
              reason: reason ?? "No reason was recorded.",
              link,
            }),
          context: { cycle: cycle.name, employee: employee.full_name },
        });
        notice.sent += result.sent;
        notice.failed += result.failed;
        notice.problems.push(...result.problems);
      }
      return notice;
    }

    /* -- HR has approved and passed it up. The MD is told, because this is the
          only point at which the report becomes theirs to read. -- */
    case "PENDING_HR_REVIEW->HR_APPROVED": {
      const { data: mds } = await supabase
        .from("user_roles")
        .select("profile_id, profiles!inner(id, full_name, email, phone_e164)")
        .eq("role", "MD");

      const notice: TransitionNotice = { sent: 0, failed: 0, problems: [] };

      for (const row of mds ?? []) {
        const embedded = row.profiles as unknown;
        const person = (Array.isArray(embedded) ? embedded[0] : embedded) as
          | { id: string; full_name: string; email: string | null; phone_e164: string | null }
          | undefined;
        if (!person) continue;

        const result = await deliver({
          template: "mdReviewPending",
          evaluationId,
          profileId: person.id,
          phone: person.phone_e164,
          email: person.email,
          audience: "staff",
          staffPath: `/reports/${evaluationId}`,
          // No score in the body: a rating in a WhatsApp message is a rating
          // disclosed on a channel with no access control around it (P13-13).
          render: (link) =>
            mdReviewPending({
              employeeName: employee.full_name,
              leadName: lead?.full_name ?? "their lead",
              period: cycle.period_label,
              dueDate: formatDate(cycle.md_due_on),
              link,
            }),
          context: { cycle: cycle.name, employee: employee.full_name },
        });
        notice.sent += result.sent;
        notice.failed += result.failed;
        notice.problems.push(...result.problems);
      }
      return notice;
    }

    /* -- The MD has read the report. HR is told, because HR owns what happens
          next — closing an evaluation cycle, or booking the interview on an
          increment one. The employee is NOT: §9 releases the result at CLOSED,
          under the cycle's disclosure policy, and a message here would leak the
          outcome before it has been released (PW-6). -- */
    case "HR_APPROVED->MD_REVIEWED": {
      const { data: hr } = await supabase
        .from("user_roles")
        .select("profile_id, profiles!inner(id, full_name, email, phone_e164)")
        .eq("role", "HR_ADMIN");

      const notice: TransitionNotice = { sent: 0, failed: 0, problems: [] };

      for (const row of hr ?? []) {
        const embedded = row.profiles as unknown;
        const person = (Array.isArray(embedded) ? embedded[0] : embedded) as
          | { id: string; full_name: string; email: string | null; phone_e164: string | null }
          | undefined;
        if (!person) continue;

        const result = await deliver({
          template: "evaluationFinalised",
          evaluationId,
          profileId: person.id,
          phone: person.phone_e164,
          email: person.email,
          audience: "staff",
          staffPath: `/reports/${evaluationId}`,
          render: (link) =>
            evaluationFinalised({
              employeeName: employee.full_name,
              period: cycle.period_label,
              // §11 as amended: there is no final score. The LEAD average is
              // the headline figure, labelled as such.
              finalScore: formatScore(evaluation.lead_overall),
              link,
            }),
          context: { cycle: cycle.name, employee: employee.full_name },
        });
        notice.sent += result.sent;
        notice.failed += result.failed;
        notice.problems.push(...result.problems);
      }
      return notice;
    }

    /* -- Closed. The employee is told, and the template is handed the policy
          rather than a pre-filtered payload: filtering here would put §9's
          disclosure rules in two places, and they would disagree the first time
          one changed (PW-7). -- */
    case "MD_REVIEWED->CLOSED":
    case "INTERVIEW_DONE->CLOSED": {
      return deliver({
        template: "evaluationClosed",
        evaluationId,
        profileId: employee.id,
        phone: employee.phone_e164,
        email: employee.email,
        audience: "employee",
        render: (link) =>
          evaluationClosed({
            name: employee.full_name,
            period: cycle.period_label,
            disclosure: cycle.disclosure,
            finalScore: formatScore(evaluation.lead_overall),
            link,
          }),
        context: { cycle: cycle.name },
      });
    }

    default:
      return NOTHING;
  }
}

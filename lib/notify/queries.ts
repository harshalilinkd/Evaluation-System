/** Reads for the distribution screen. No writes. */

import "server-only";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { normaliseToE164, type PhoneFailure } from "@/lib/notify/phone";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

/**
 * Where a person's link has got to.
 *
 * NOT_SENT / SENT / OPENED / SUBMITTED, in that order of progress. There is no
 * DELIVERED: Maytapi accepting a message is not WhatsApp delivering it, and a
 * chip that claimed otherwise would be a lie the system cannot back up.
 *
 * OPENED is real evidence, not a pixel — it means the invite token was
 * consumed, so somebody followed the link and signed in.
 */
export type LinkStatus = "NOT_SENT" | "SENT" | "OPENED" | "SUBMITTED";

export type DistributionRow = {
  evaluationId: string;
  profileId: string;
  name: string;
  initials: string;
  employeeCode: string | null;
  departmentId: string | null;
  departmentName: string | null;
  evaluationStatus: Enums<"evaluation_status">;

  /** Raw, for the "Fix number" drawer. */
  phoneRaw: string | null;
  /** Normalised, when it normalises. */
  phoneE164: string | null;
  phoneError: { reason: PhoneFailure; message: string } | null;
  email: string | null;

  linkStatus: LinkStatus;
  lastSentAt: string | null;
  lastChannels: Array<"WHATSAPP" | "EMAIL">;
  lastResult: { status: "SENT" | "FAILED" | "QUEUED"; error: string | null } | null;

  /** False when the evaluation is not CYCLE_ACTIVE, or there is no contact at all. */
  sendable: boolean;
  blockedReason: string | null;

  /**
   * Whether this evaluation has a SECOND reviewer (0083).
   *
   * The board carries no name or contact detail for them — fetching one per row
   * would be a query this screen does not otherwise need — only whether the
   * per-row menu should offer their link at all. Most evaluations have none, so
   * the action is hidden rather than shown-and-refused.
   */
  hasCoLead: boolean;
};

export type DistributionBoard = {
  cycle: {
    id: string;
    name: string;
    periodLabel: string;
    status: Enums<"cycle_status">;
    selfDueOn: string | null;
  };
  rows: DistributionRow[];
  departments: Array<{ id: string; name: string }>;
  totals: { total: number; notSent: number; sent: number; opened: number; failed: number; noContact: number };
};

export async function getDistributionBoard(cycleId: string): Promise<CycleResult<DistributionBoard>> {
  const supabase = await createClient();

  const { data: cycle, error: cycleReadError } = await supabase
    .from("evaluation_cycles")
    .select("id, name, period_label, status, self_due_on")
    .eq("id", cycleId)
    .maybeSingle();

  if (cycleReadError) return cycleError("QUERY_FAILED", `Could not read cycle: ${cycleReadError.message}`);
  if (!cycle) return cycleError("CYCLE_NOT_FOUND", "That cycle no longer exists.");

  const { data: evaluations, error: evaluationError } = await supabase
    .from("evaluations")
    .select("id, evaluatee_id, department_id, status, excluded_at, self_submitted_at, co_lead_id")
    .eq("cycle_id", cycleId)
    .is("excluded_at", null);

  if (evaluationError) {
    return cycleError("QUERY_FAILED", `Could not read evaluations: ${evaluationError.message}`);
  }

  const live = evaluations ?? [];
  if (live.length === 0) {
    return {
      ok: true,
      data: {
        cycle: {
          id: cycle.id,
          name: cycle.name,
          periodLabel: cycle.period_label,
          status: cycle.status,
          selfDueOn: cycle.self_due_on,
        },
        rows: [],
        departments: [],
        totals: { total: 0, notSent: 0, sent: 0, opened: 0, failed: 0, noContact: 0 },
      },
    };
  }

  const evaluationIds = live.map((e) => e.id);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, employee_code, email, phone_e164")
    .in("id", live.map((e) => e.evaluatee_id));

  const { data: departments } = await supabase.from("departments").select("id, name");

  // Every send for this cycle, newest first. Reduced in TypeScript to "the
  // latest per evaluation" — PostgREST has no DISTINCT ON, and a view would put
  // presentation logic in the schema.
  const { data: notifications } = await supabase
    .from("notifications_log")
    .select("evaluation_id, channel, status, error, created_at, sent_at")
    .in("evaluation_id", evaluationIds)
    .order("created_at", { ascending: false });

  // OPENED comes from the invite tokens: used_at is set when somebody follows
  // the link and signs in (§10). That is evidence of an actual human, which no
  // provider receipt gives us.
  const { data: invites } = await supabase
    .from("invite_tokens")
    .select("evaluation_id, used_at")
    .in("evaluation_id", evaluationIds)
    .not("used_at", "is", null);

  const byProfile = new Map((profiles ?? []).map((p) => [p.id, p]));
  const departmentName = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const opened = new Set((invites ?? []).map((i) => i.evaluation_id));

  const latest = new Map<string, { at: string; channels: Set<"WHATSAPP" | "EMAIL">; status: string; error: string | null }>();
  for (const row of notifications ?? []) {
    if (!row.evaluation_id) continue;
    const existing = latest.get(row.evaluation_id);
    if (!existing) {
      latest.set(row.evaluation_id, {
        at: row.created_at,
        channels: new Set([row.channel as "WHATSAPP" | "EMAIL"]),
        status: row.status,
        error: row.error,
      });
      continue;
    }
    // Sends fired together in a "send both" run share a moment; group them so
    // the row shows two channel icons rather than only the most recent.
    if (Math.abs(Date.parse(existing.at) - Date.parse(row.created_at)) < 60_000) {
      existing.channels.add(row.channel as "WHATSAPP" | "EMAIL");
      if (existing.status !== "FAILED" && row.status === "FAILED") {
        existing.status = "FAILED";
        existing.error = row.error;
      }
    }
  }

  // `||`, not `??` — see dispatch.ts. A blank key is empty, not absent.
  const defaultCountry = process.env.DEFAULT_COUNTRY_CODE || "+91";
  const rows: DistributionRow[] = [];

  for (const evaluation of live) {
    const person = byProfile.get(evaluation.evaluatee_id);
    if (!person) continue;

    const phone = normaliseToE164(person.phone_e164, defaultCountry);
    const last = latest.get(evaluation.id);

    const hasContact = phone.ok || Boolean(person.email);

    // §8: only an evaluation the employee can actually open is worth a link.
    // The reason is carried rather than the button silently disabled — P11:
    // "with the reason shown rather than the button silently disabled".
    // AMEND-3's rename again: this was true for every row, so the whole board
    // showed as unsendable with a reason nobody could act on.
    const wrongStatus = evaluation.status !== "OPEN";

    /* -- Under blind rating "submitted" is not a status — both layers are filled
          during OPEN and recorded as timestamps (AMEND-3). The board is the
          EMPLOYEE's distribution list, so it reads the employee's own
          timestamp; anything past OPEN means both sides are in. Reading the
          lead's timestamp here would leak their progress to a screen about the
          employee (§5). -- */
    const linkStatus: LinkStatus =
      evaluation.self_submitted_at !== null ||
      evaluation.status === "PENDING_HR_REVIEW" ||
      evaluation.status === "HR_APPROVED" ||
      evaluation.status === "MD_REVIEWED" ||
      evaluation.status === "INTERVIEW_DONE" ||
      evaluation.status === "CLOSED"
        ? "SUBMITTED"
        : opened.has(evaluation.id)
          ? "OPENED"
          : last && last.status !== "FAILED"
            ? "SENT"
            : "NOT_SENT";

    rows.push({
      evaluationId: evaluation.id,
      profileId: person.id,
      name: person.full_name,
      initials: initialsOf(person.full_name),
      employeeCode: person.employee_code,
      departmentId: evaluation.department_id,
      departmentName: evaluation.department_id
        ? (departmentName.get(evaluation.department_id) ?? null)
        : null,
      evaluationStatus: evaluation.status,
      phoneRaw: person.phone_e164,
      phoneE164: phone.ok ? phone.e164 : null,
      phoneError: phone.ok ? null : { reason: phone.reason, message: phone.message },
      email: person.email,
      linkStatus,
      lastSentAt: last?.at ?? null,
      lastChannels: last ? [...last.channels] : [],
      lastResult: last
        ? { status: last.status as "SENT" | "FAILED" | "QUEUED", error: last.error }
        : null,
      sendable: hasContact && !wrongStatus,
      blockedReason: !hasContact
        ? "No phone number and no email address, so no link can be sent."
        : wrongStatus
          ? blockedMessage(evaluation.status)
          : null,
      hasCoLead: Boolean(evaluation.co_lead_id),
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));

  const departmentSet = new Map<string, string>();
  for (const row of rows) if (row.departmentId) departmentSet.set(row.departmentId, row.departmentName ?? "Unnamed");

  return {
    ok: true,
    data: {
      cycle: {
        id: cycle.id,
        name: cycle.name,
        periodLabel: cycle.period_label,
        status: cycle.status,
        selfDueOn: cycle.self_due_on,
      },
      rows,
      departments: [...departmentSet.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      totals: {
        total: rows.length,
        notSent: rows.filter((r) => r.linkStatus === "NOT_SENT").length,
        sent: rows.filter((r) => r.linkStatus === "SENT").length,
        opened: rows.filter((r) => r.linkStatus === "OPENED" || r.linkStatus === "SUBMITTED").length,
        failed: rows.filter((r) => r.lastResult?.status === "FAILED").length,
        noContact: rows.filter((r) => !r.phoneE164 && !r.email).length,
      },
    },
  };
}

function blockedMessage(status: Enums<"evaluation_status">): string {
  switch (status) {
    case "DRAFT":
      return "This cycle has not been launched yet, so there is no form to open.";
    case "SELF_SUBMITTED":
      return "Already submitted — there is nothing left for them to fill in.";
    case "LEAD_REVIEWED":
      return "Already with the MD. Sending a form link now would be confusing.";
    case "MD_FINALIZED":
    case "CLOSED":
      return "This evaluation is finished.";
    default:
      return "Not open for editing.";
  }
}

/* ---------- History drawer ---------- */

export type HistoryRow = {
  id: string;
  channel: string;
  template: string;
  status: string;
  recipient: string;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
};

export async function getNotificationHistory(evaluationId: string): Promise<CycleResult<HistoryRow[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notifications_log")
    .select("id, channel, template, status, recipient, error, created_at, sent_at")
    .eq("evaluation_id", evaluationId)
    .order("created_at", { ascending: false });

  if (error) return cycleError("QUERY_FAILED", `Could not read history: ${error.message}`);

  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      id: r.id,
      channel: r.channel,
      template: r.template,
      status: r.status,
      recipient: r.recipient,
      error: r.error,
      createdAt: r.created_at,
      sentAt: r.sent_at,
    })),
  };
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

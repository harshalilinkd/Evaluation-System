"use server";

/** The outbound pause switch and the message log (P23). HR and the MD. */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkRole } from "@/lib/auth/guards";
import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { smtpConfigured, verifySmtp } from "@/lib/notify/smtp";
import { createClient } from "@/lib/supabase/server";

/* ---------- The pause switch ---------- */

export type OutboundState = {
  paused: boolean;
  pausedByName: string | null;
  pausedAt: string | null;
  reason: string | null;
};

export async function getOutboundState(): Promise<CycleResult<OutboundState>> {
  const auth = await checkRole(["HR_ADMIN", "MD"]);
  if (!auth.ok) return cycleError("FORBIDDEN", auth.error.message);

  const supabase = await createClient();
  const { data } = await supabase
    .from("notification_settings")
    .select("outbound_paused, paused_by, paused_at, paused_reason")
    .eq("id", true)
    .maybeSingle();

  const { data: person } = data?.paused_by
    ? await supabase.from("profiles").select("full_name").eq("id", data.paused_by).maybeSingle()
    : { data: null };

  return {
    ok: true,
    data: {
      paused: data?.outbound_paused ?? false,
      pausedByName: person?.full_name ?? null,
      pausedAt: data?.paused_at ?? null,
      reason: data?.paused_reason ?? null,
    },
  };
}

/**
 * Stop or resume every outbound message.
 *
 * The brake. P17 built the engine and 0016 the switch, but nothing rendered it —
 * so silencing the company's messages meant a SQL console, which is not
 * something you reach for while a launch is going out by mistake.
 *
 * Goes through `set_outbound_paused` (0016) rather than an UPDATE: that function
 * takes the actor from the session and audits both directions (§12).
 */
export async function setOutboundPaused(input: {
  paused: boolean;
  reason: string;
}): Promise<CycleResult<{ paused: boolean }>> {
  const auth = await checkRole(["HR_ADMIN", "MD"]);
  if (!auth.ok) return cycleError("FORBIDDEN", auth.error.message);

  const parsed = z
    .object({
      paused: z.boolean(),
      // Required in both directions. "Why is everything silent?" is a question
      // somebody asks days later, and the answer should be on the screen.
      reason: z.string().trim().min(5, "Say why, so the next person knows."),
    })
    .safeParse(input);

  if (!parsed.success) {
    return cycleError("INVALID", parsed.error.issues[0]?.message ?? "Give a reason.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_outbound_paused", {
    p_paused: parsed.data.paused,
    p_reason: parsed.data.reason,
  });

  if (error) return cycleError("SAVE_FAILED", `Could not change it: ${error.message}`);

  // Every admin screen carries the banner, so every admin screen is stale now.
  revalidatePath("/", "layout");
  return { ok: true, data: { paused: parsed.data.paused } };
}

/* ---------- The message log ---------- */

export type MessageRow = {
  id: string;
  createdAt: string;
  channel: string;
  template: string;
  recipient: string;
  status: string;
  error: string | null;
  personName: string | null;
  evaluationId: string | null;
};

export type MessageLog = {
  rows: MessageRow[];
  total: number;
  failed: number;
  queued: number;
  templates: string[];
};

/**
 * What actually went out.
 *
 * Reads `notifications_log`, which has a SELECT policy for administrators and no
 * insert or update policy for anyone (P11-3) — so this can only ever report.
 */
export async function getMessageLog(filters?: {
  status?: string;
  channel?: string;
  template?: string;
  search?: string;
}): Promise<CycleResult<MessageLog>> {
  const auth = await checkRole(["HR_ADMIN", "MD"]);
  if (!auth.ok) return cycleError("FORBIDDEN", auth.error.message);

  const supabase = await createClient();

  let query = supabase
    .from("notifications_log")
    .select("id, created_at, channel, template, recipient, status, error, profile_id, evaluation_id")
    .order("created_at", { ascending: false })
    .limit(200);

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.channel) query = query.eq("channel", filters.channel);
  if (filters?.template) query = query.eq("template", filters.template);

  const { data, error } = await query;
  if (error) return cycleError("QUERY_FAILED", `Could not read the log: ${error.message}`);

  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.profile_id).filter(Boolean))] as string[];
  const { data: people } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));

  const mapped: MessageRow[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    channel: r.channel,
    template: r.template,
    recipient: r.recipient,
    status: r.status,
    error: r.error,
    personName: r.profile_id ? (nameOf.get(r.profile_id) ?? null) : null,
    evaluationId: r.evaluation_id,
  }));

  const needle = filters?.search?.trim().toLowerCase();
  const filtered = needle
    ? mapped.filter(
        (r) =>
          (r.personName ?? "").toLowerCase().includes(needle) ||
          r.recipient.toLowerCase().includes(needle),
      )
    : mapped;

  return {
    ok: true,
    data: {
      rows: filtered,
      total: filtered.length,
      failed: filtered.filter((r) => r.status === "FAILED").length,
      queued: filtered.filter((r) => r.status === "QUEUED").length,
      templates: [...new Set(mapped.map((r) => r.template))].sort(),
    },
  };
}

/* ---------- Is email actually going to work? ---------- */

export type EmailCheck = {
  /** Which transport the credentials select. `null` when neither is set up. */
  transport: "SMTP" | "RESEND" | null;
  /** Present only for SMTP: the account, so the screen can name it. */
  account: string | null;
  ok: boolean;
  message: string;
};

/**
 * Open the mail connection and authenticate, without sending anything.
 *
 * The problem this solves: until now the only way to discover that an App
 * Password was mistyped was to launch a cycle and watch every invite fail —
 * after the messages had already been logged as attempts. This asks the
 * question directly, at the moment somebody is entering the credentials.
 *
 * It is NOT a send. §10 makes `dispatch.ts` the single path a message may
 * leave by, and a test send bolted on beside it would be a second one:
 * unlogged, and needing a template key that is not a product message. So this
 * verifies the connection and says plainly what that does and does not prove.
 *
 * Resend has no equivalent handshake — its credentials are only exercised by a
 * real request — so for that transport this reports what is configured and
 * stops there rather than inventing a check it cannot perform.
 */
export async function checkEmailTransport(): Promise<CycleResult<EmailCheck>> {
  const auth = await checkRole(["HR_ADMIN", "MD"]);
  if (!auth.ok) return cycleError("FORBIDDEN", auth.error.message);

  const account = process.env.SMTP_USER?.trim() || null;

  if (smtpConfigured()) {
    const result = await verifySmtp();
    return {
      ok: true,
      data: {
        transport: "SMTP",
        account,
        ok: result.ok,
        message: result.ok
          ? `Signed in to ${account} successfully. Mail will send from this account.`
          : result.message,
      },
    };
  }

  if (process.env.RESEND_API_KEY && process.env.MAIL_FROM) {
    return {
      ok: true,
      data: {
        transport: "RESEND",
        account: null,
        ok: true,
        // Said rather than implied: this is what is configured, not a
        // successful handshake. Resend does not offer one.
        message:
          "Resend is configured. It has no connection test — the credentials " +
          "are only exercised by a real send, so the first invite is the proof.",
      },
    };
  }

  return {
    ok: true,
    data: {
      transport: null,
      account: null,
      ok: false,
      message:
        "Email is not set up. Either set SMTP_USER, SMTP_PASSWORD and MAIL_FROM " +
        "to send from a Google account, or set RESEND_API_KEY and MAIL_FROM to " +
        "send through Resend. WhatsApp works without either.",
    },
  };
}

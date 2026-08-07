"use server";

/** The outbound pause switch and the message log (P23). HR and the MD. */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkRole } from "@/lib/auth/guards";
import { cycleError, type CycleResult } from "@/lib/cycles/schema";
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

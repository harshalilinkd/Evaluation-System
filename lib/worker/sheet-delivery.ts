/** Whether each team leader's sheet actually went out, and when. Read-only. */

import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * WHAT HAPPENED TO THE SHEET, per appraisal.
 *
 * The production board had no answer to "was this sent" at all. A round sends
 * once, at launch, from a function that discarded the result — so a launch that
 * delivered nothing looked exactly like one that delivered everything, and the
 * only way to find out was to ask the team leader. Reported as "no status shown
 * like sent or not", and it is the whole of that report.
 *
 * `notifications_log` has carried the answer since P11 — one row per attempt,
 * with the provider's own outcome on it. Nothing read it back onto this screen.
 * The staff side has had a distribution board doing exactly this since then;
 * this is the same reading for one column.
 *
 * NOT DERIVED FROM THE ROUND'S STATUS. A launched round proves the appraisals
 * were opened, which is a different fact from a message arriving — and it is
 * precisely the conflation that let a silent failure pass as success.
 */
export type SheetDelivery = {
  /** SENT · FAILED · null when nothing was ever attempted. */
  status: "SENT" | "FAILED" | null;
  /** When the most recent attempt was made. */
  at: string | null;
  /** The provider's own words on a failure, unedited (P23-6). */
  error: string | null;
  /** How many attempts in total, so a resend is visible as one. */
  attempts: number;
};

const NOTHING: SheetDelivery = { status: null, at: null, error: null, attempts: 0 };

export async function sheetDeliveryFor(
  evaluationIds: readonly string[],
): Promise<Map<string, SheetDelivery>> {
  const out = new Map<string, SheetDelivery>();
  if (evaluationIds.length === 0) return out;

  const supabase = await createClient();

  /* -- THE RATING INVITE ONLY. An appraisal raises other messages later — the
        review hand-off, the close — and counting those would report a sheet as
        sent because something else was. -- */
  const { data } = await supabase
    .from("notifications_log")
    .select("evaluation_id, status, error, created_at")
    .eq("template", "workerRatingInvite")
    .in("evaluation_id", evaluationIds)
    .order("created_at", { ascending: false });

  for (const row of data ?? []) {
    if (!row.evaluation_id) continue;
    const seen = out.get(row.evaluation_id) ?? { ...NOTHING };

    /* -- THE NEWEST ATTEMPT DECIDES, and the ordering above is what makes that
          true: a resend that worked must not be reported as failed because an
          earlier try was. Both channels of one send land in the same second,
          so a SENT on either is a sheet that went — a WhatsApp that arrived is
          not undone by an email that bounced. -- */
    if (seen.status === null) {
      seen.status = row.status === "SENT" ? "SENT" : "FAILED";
      seen.at = row.created_at;
      seen.error = row.status === "SENT" ? null : (row.error ?? null);
    } else if (seen.status === "FAILED" && row.status === "SENT" && row.created_at === seen.at) {
      seen.status = "SENT";
      seen.error = null;
    }

    seen.attempts += 1;
    out.set(row.evaluation_id, seen);
  }

  return out;
}

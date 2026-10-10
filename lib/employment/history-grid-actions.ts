"use server";

/** Saving the whole-company salary sheet (lib/employment/history-grid.ts). */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkRole } from "@/lib/auth/guards";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { createClient } from "@/lib/supabase/server";

const slotSchema = z.union([
  z.object({
    /** 1-based — "Increment 1" is index 1, matching the column header. */
    index: z.number().int().min(1).max(60),
    effectiveFrom: z.string().min(1),
    /** THE RISE (0109). What somebody is paid is derived from it, never typed. */
    amount: z.number().positive(),
  }),
  /* -- REMOVE an increment that is already on record: the sheet sends this
        when both its date and its amount have been cleared. It goes through
        `delete_increment` (0109), which is HR/MD-gated, refuses a rise that
        came from a closed increment cycle, audits it, and rebuilds the
        current salary from what is left. -- */
  z.object({
    index: z.number().int().min(1).max(60),
    remove: z.literal(true),
  }),
]);

const personPatchSchema = z.object({
  profileId: z.string().uuid(),
  dateOfJoining: z.string().optional(),
  joiningCtc: z.number().positive().optional(),
  slots: z.array(slotSchema).max(60).default([]),
});

const gridSchema = z.object({
  patches: z.array(personPatchSchema).min(1, "Nothing was changed.").max(200),
});

export type HistoryGridRowOutcome = { profileId: string; ok: boolean; error?: string };

export type HistoryGridSaveResult = {
  updated: number;
  corrected: number;
  added: number;
  removed: number;
  rows: HistoryGridRowOutcome[];
};

/**
 * Saves the sheet. Per person, per touched slot:
 *
 *   - a row ALREADY EXISTS at that position   → corrected in place (0093) —
 *     no new row, and the row's own reason and note are left exactly as
 *     they were.
 *   - NO row exists, and the slot is the NEXT one in sequence (position
 *     `existing + 1`)                         → a genuine new rise, appended
 *     (`addSalaryChange`, reason "Annual increment" — the sheet has no
 *     reason column, and that is the overwhelmingly common case; anything
 *     else is still recorded from a person's own Employment page).
 *   - NO row exists, and the slot is further out than that (a gap)
 *                                              → refused, naming which slot
 *     has to be filled first, rather than guessing at an order.
 *
 * Re-reads each person's REAL rows from the database rather than trusting
 * what the sheet showed when it loaded — the same reasoning P9D-3 gives for
 * not trusting a client-supplied `existing_id`: two people could have this
 * screen open at once, and the position a slot refers to has to be the
 * position it is AT NOW, not whenever this browser tab last fetched it.
 */
export async function saveEmploymentHistoryGrid(
  input: z.input<typeof gridSchema>,
): Promise<CycleResult<HistoryGridSaveResult>> {
  const auth = await checkRole(["HR_ADMIN", "MD"]);
  if (!auth.ok) return auth;

  const parsed = gridSchema.safeParse(input);
  if (!parsed.success) {
    return cycleError("INVALID", parsed.error.issues[0]?.message ?? "Check the changes.");
  }

  const supabase = await createClient();
  const rows: HistoryGridRowOutcome[] = [];
  let corrected = 0;
  let added = 0;
  let removed = 0;

  for (const patch of parsed.data.patches) {
    const { profileId } = patch;
    let failed = false;

    /* ---------- Joining date ---------- */
    if (patch.dateOfJoining !== undefined) {
      const { error } = await supabase
        .from("profiles")
        .update({ date_of_joining: patch.dateOfJoining })
        .eq("id", profileId);
      if (error) {
        rows.push({ profileId, ok: false, error: `Joining date: ${error.message}` });
        failed = true;
      }
    }

    /* ---------- Joining salary — through 0075's function, same as every
       other caller (P9D-3: the "does this seed current_ctc" decision lives
       inside it, not restated here). ---------- */
    if (!failed && patch.joiningCtc !== undefined) {
      const { error } = await supabase.rpc("set_joining_salary", {
        p_profile_id: profileId,
        p_amount: patch.joiningCtc,
      });
      if (error) {
        rows.push({ profileId, ok: false, error: `Joining salary: ${error.message}` });
        failed = true;
      }
    }

    /* ---------- Increment slots, in order ---------- */
    if (!failed && patch.slots.length > 0) {
      // Re-read what is REALLY there right now — the sheet's own idea of
      // "how many increments does this person have" may already be stale by
      // the time Save is pressed.
      const { data: existingRows } = await supabase
        .from("salary_history")
        .select("id, effective_from, reason, note")
        .eq("profile_id", profileId)
        .neq("reason", "JOINING")
        .order("effective_from", { ascending: true })
        .order("recorded_at", { ascending: true });

      const existing = existingRows ?? [];
      const sortedSlots = [...patch.slots].sort((a, b) => a.index - b.index);

      /* -- REMOVALS FIRST, by the row id each position held when this save
            began. Positions are what the sheet showed; resolving them to ids
            up front means removing Increment 2 cannot shift what "Increment 3"
            refers to for a correction in the same batch. -- */
      const removeIds = new Set<string>();
      for (const slot of sortedSlots) {
        if (!("remove" in slot)) continue;
        const at = existing[slot.index - 1];
        if (!at) {
          rows.push({ profileId, ok: false, error: `Increment ${slot.index} is not on record, so there is nothing to remove.` });
          failed = true;
          break;
        }
        removeIds.add(at.id);
      }
      for (const id of removeIds) {
        if (failed) break;
        const index = existing.findIndex((r) => r.id === id) + 1;
        const { error } = await supabase.rpc("delete_increment", { p_id: id });
        if (error) {
          rows.push({ profileId, ok: false, error: `Increment ${index}: ${error.message}` });
          failed = true;
          break;
        }
        removed += 1;
      }

      for (const slot of sortedSlots) {
        if (failed) break;
        if ("remove" in slot) continue;
        const at = existing[slot.index - 1];
        // A position whose row was just removed takes no correction.
        if (at && removeIds.has(at.id)) continue;

        if (at) {
          /* -- ALREADY THERE — a correction, in place. The row's own reason and
                note are untouched; only the rise and the date move.

                `correct_increment` rather than 0093's
                `correct_salary_history_entry`: that one is told a NEW SALARY,
                and this sheet's Amount column is the rise. Both end in the same
                `rebuild_salary_chain`, so they cannot disagree about what the
                rest of the ledger becomes. -- */
          const { error } = await supabase.rpc("correct_increment", {
            p_id: at.id,
            p_effective_from: slot.effectiveFrom,
            p_amount: slot.amount,
          });
          if (error) {
            rows.push({ profileId, ok: false, error: `Increment ${slot.index}: ${error.message}` });
            failed = true;
            break;
          }
          corrected += 1;
          // Keep the local copy in step, so a later slot in the SAME batch
          // that also targets this position (unlikely, but the loop must
          // not act on a figure it has already moved past) sees the change.
          existing[slot.index - 1] = { ...at, effective_from: slot.effectiveFrom };
        } else if (slot.index === existing.length + 1) {
          // THE NEXT ONE IN SEQUENCE — a genuine new rise, by its amount.
          const { data: newId, error } = await supabase.rpc("record_increment", {
            p_profile_id: profileId,
            p_effective_from: slot.effectiveFrom,
            p_amount: slot.amount,
            p_reason: "ANNUAL_INCREMENT",
          });
          if (error || !newId) {
            rows.push({
              profileId,
              ok: false,
              error: `Increment ${slot.index}: ${error?.message ?? "could not be recorded."}`,
            });
            failed = true;
            break;
          }
          added += 1;
          existing.push({
            id: newId,
            effective_from: slot.effectiveFrom,
            reason: "ANNUAL_INCREMENT",
            note: null,
          });
        } else {
          // A GAP — refused rather than guessed at, so an increment cannot
          // land out of order with nothing on screen to explain why.
          rows.push({
            profileId,
            ok: false,
            error: `Increment ${slot.index} cannot be filled in before Increment ${existing.length + 1}.`,
          });
          failed = true;
          break;
        }
      }
    }

    if (!failed) rows.push({ profileId, ok: true });
  }

  const updated = rows.filter((r) => r.ok).length;

  revalidatePath("/admin/settings");
  revalidatePath("/admin/people");
  revalidatePath("/admin/increments");

  return { ok: true, data: { updated, corrected, added, removed, rows } };
}

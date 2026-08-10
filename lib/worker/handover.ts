"use server";

/** The hand-over submit. Calls 0048's function; every check is repeated there. */

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import type { WorkerTick } from "@/lib/worker/form";

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

/**
 * The worker has ticked their sheet on their supervisor's device.
 *
 * THIS FUNCTION DECIDES NOTHING. `submit_worker_self_handover` re-checks the
 * caller is that worker's named supervisor, that the record is OPEN, and that
 * the worker has not already answered — because this action is reachable
 * through any signed-in session and a guard that only exists in TypeScript is
 * not a guard (§9).
 *
 * What it does add is the completeness check, which needs the frozen sheet and
 * so belongs here rather than in PL/pgSQL — the same split every other write in
 * this codebase uses.
 */
export async function submitHandover(
  evaluationId: string,
  answers: Record<string, WorkerTick>,
): Promise<Result<{ ok: true }>> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return { ok: false, error: { code: "NOT_AUTHENTICATED", message: "Please sign in again." } };
  }

  const supabase = await createClient();

  /* -- Validated against the FROZEN sheet, never against what the browser sent.
        The overall quality is excluded because it is the supervisor's (§11) and
        is not on this form at all. -- */
  const { data: snapshot } = await supabase
    .from("worker_evaluation_questions")
    .select("question_id, is_required, is_overall")
    .eq("evaluation_id", evaluationId);

  const required = (snapshot ?? []).filter((q) => q.is_required && !q.is_overall);
  const missing = required.filter((q) => !answers[q.question_id]);

  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        code: "INCOMPLETE",
        message: `${missing.length} ${
          missing.length === 1 ? "quality still needs" : "qualities still need"
        } a tick before this can be submitted.`,
      },
    };
  }

  const { error } = await supabase.rpc("submit_worker_self_handover", {
    p_evaluation_id: evaluationId,
    p_answers: answers as Json,
  });

  if (error) {
    // Postgres RAISE messages here are written for the person holding the
    // device, so they are passed through rather than replaced.
    return {
      ok: false,
      error: { code: "REFUSED", message: error.message.replace(/^.*?:\s*/, "").trim() || error.message },
    };
  }

  revalidatePath("/worker-team");
  return { ok: true, data: { ok: true } };
}

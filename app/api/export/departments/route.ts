/** Department scores as CSV. Same view, same RLS, same numbers as the screen. */

import { requireAuth } from "@/lib/auth/guards";
import { csvResponse, toCsv } from "@/lib/analytics/csv";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Not role-gated: the view is security_invoker, so an employee downloading
  // this gets their own single row. Gating on a role as well would be belt and
  // braces, but the correctness comes from RLS.
  await requireAuth();

  const cycleId = new URL(request.url).searchParams.get("cycle");
  if (!cycleId) return new Response("A cycle is required.", { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_department_scores")
    .select("*")
    .eq("cycle_id", cycleId);

  if (error) return new Response(error.message, { status: 500 });

  const csv = toCsv(
    ["Department", "People", "Average self", "Average lead", "Average final", "Gap"],
    (data ?? []).map((r) => [
      r.department_name ?? "—", r.people, r.avg_self, r.avg_lead, r.avg_final, r.gap,
    ]),
  );

  return csvResponse(`department-scores-${cycleId}.csv`, csv);
}

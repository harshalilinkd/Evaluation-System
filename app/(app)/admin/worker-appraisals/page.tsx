/** /admin/worker-appraisals — opens the current round, not a list of one card. */

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WorkerCyclesClient } from "@/app/(app)/admin/worker-appraisals/cycles-client";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Worker appraisals" };

export default async function Page() {
  // §9: the guard is the first statement.
  await requireRole(["HR_ADMIN", "MD"]);

  const supabase = await createClient();

  const { data: cycles } = await supabase
    .from("worker_cycles")
    .select("id")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  /* -- Straight into the round.
        A list holding one card, whose only purpose is to be clicked, is a
        screen that exists to be got past. The board carries the round switcher
        and the Start button, so nothing is unreachable — there is simply one
        fewer page between the menu and the work. -- */
  const newest = cycles?.[0];
  if (newest) redirect(`/admin/worker-appraisals/${newest.id}`);

  /* -- No round yet. This is the only thing the old list page said that the
        board cannot, so it is what survives here. -- */
  const { data: workers } = await supabase
    .from("profiles")
    .select("id, full_name, employee_code, reports_to")
    .eq("track", "WORKER")
    .eq("is_active", true)
    .order("full_name");

  const supervisorIds = [
    ...new Set((workers ?? []).map((w) => w.reports_to).filter((v): v is string => Boolean(v))),
  ];
  const { data: supervisors } = supervisorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", supervisorIds)
    : { data: [] };
  const nameOf = new Map((supervisors ?? []).map((p) => [p.id, p.full_name]));

  return (
    <WorkerCyclesClient
      cycles={[]}
      workers={(workers ?? []).map((w) => ({
        id: w.id,
        name: w.full_name,
        employeeCode: w.employee_code,
        supervisorId: w.reports_to,
        supervisorName: w.reports_to ? (nameOf.get(w.reports_to) ?? null) : null,
      }))}
      raters={[]}
    />
  );
}

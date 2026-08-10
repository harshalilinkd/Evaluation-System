/** /admin/worker-appraisals — the shop-floor appraisal, run separately from staff (§7). */

import type { Metadata } from "next";

import { WorkerCyclesClient } from "@/app/(app)/admin/worker-appraisals/cycles-client";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Worker appraisals" };

export default async function Page() {
  // §9: the guard is the first statement.
  await requireRole(["HR_ADMIN", "MD"]);

  const supabase = await createClient();

  /* -- Read through the AUTHENTICATED client, so RLS decides (P16-9). The role
        guard above is the clean exit, not the protection. -- */
  const [{ data: cycles, error }, { data: workers }] = await Promise.all([
    supabase
      .from("worker_cycles")
      .select("id, name, period_label, status, self_due_on, supervisor_due_on, md_due_on")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    /* -- track = WORKER is the module boundary (§5), applied at the only point
          people enter this module. A staff row cannot be launched into a worker
          cycle because it is never offered. -- */
    supabase
      .from("profiles")
      .select("id, full_name, employee_code, department_id, reports_to")
      .eq("track", "WORKER")
      .eq("is_active", true)
      .order("full_name"),
  ]);

  if (error) {
    return <ErrorState title="Could not load worker appraisals" body={error.message} />;
  }

  const supervisorIds = [
    ...new Set((workers ?? []).map((w) => w.reports_to).filter((v): v is string => Boolean(v))),
  ];

  const { data: supervisors } = supervisorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", supervisorIds)
    : { data: [] };

  const nameOf = new Map((supervisors ?? []).map((p) => [p.id, p.full_name]));

  return (
    <WorkerCyclesClient
      cycles={cycles ?? []}
      workers={(workers ?? []).map((w) => ({
        id: w.id,
        name: w.full_name,
        employeeCode: w.employee_code,
        supervisorName: w.reports_to ? (nameOf.get(w.reports_to) ?? null) : null,
      }))}
    />
  );
}

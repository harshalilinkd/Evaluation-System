/** One worker appraisal round: who is in it, where each side is, and what happens next. */

import type { Metadata } from "next";

import { WorkerBoard } from "@/app/(app)/admin/worker-appraisals/[cycleId]/board";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Worker appraisals" };

export default async function Page({ params }: { params: Promise<{ cycleId: string }> }) {
  await requireRole(["HR_ADMIN", "MD"]);

  const { cycleId } = await params;
  const supabase = await createClient();

  const [{ data: cycle }, { data: rows }, { data: allCycles }, { data: workerPool }] =
    await Promise.all([
      supabase
        .from("worker_cycles")
        .select("id, name, period_label, status, self_due_on, supervisor_due_on, md_due_on")
        .eq("id", cycleId)
        .maybeSingle(),
      supabase
        .from("worker_evaluations")
        .select(
          "id, worker_id, supervisor_id, status, self_submitted_at, supervisor_submitted_at, self_skipped, supervisor_skipped, self_filled_via, overall_tick",
        )
        .eq("cycle_id", cycleId)
        .is("excluded_at", null),
      supabase
        .from("worker_cycles")
        .select("id, name, period_label")
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("profiles")
        .select("id, full_name, employee_code, reports_to")
        .eq("track", "WORKER")
        .eq("is_active", true)
        .order("full_name"),
    ]);

  /* -- Who may rate a worker.
        Anybody on the STAFF track, not only people holding the SUPERVISOR role
        — in a small company a department head or the MD genuinely does
        supervise the floor, and refusing them would be the app overruling the
        organisation. What the picker does instead is SHOW the role beside each
        name, so "Rated by test MD" is visibly odd rather than silently
        inherited from a Reports-to nobody looked at. -- */
  const [{ data: raterPool }, { data: roleRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("track", "STAFF")
      .eq("is_active", true)
      .order("full_name"),
    supabase.from("user_roles").select("profile_id, role"),
  ]);

  const rolesOf = new Map<string, string[]>();
  for (const r of roleRows ?? []) {
    rolesOf.set(r.profile_id, [...(rolesOf.get(r.profile_id) ?? []), r.role]);
  }

  /* -- The word beside a name, chosen for what it means HERE.
        Somebody may hold several roles; the one worth showing is whether they
        are a supervisor, because that is the question being asked. -- */
  const describe = (id: string) => {
    const roles = rolesOf.get(id) ?? [];
    if (roles.includes("SUPERVISOR")) return "Supervisor";
    if (roles.includes("MD")) return "MD — not usually a rater";
    if (roles.includes("HR_ADMIN")) return "HR — not usually a rater";
    if (roles.includes("HOD")) return "Head of department";
    return "No supervisor role";
  };

  if (!cycle) return <ErrorState title="Not found" body="That round no longer exists." />;

  const ids = [
    ...new Set(
      [
        ...(rows ?? []).flatMap((r) => [r.worker_id, r.supervisor_id]),
        ...(workerPool ?? []).map((w) => w.reports_to),
      ].filter((v): v is string => Boolean(v)),
    ),
  ];
  const { data: people } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));

  return (
    <WorkerBoard
      cycle={cycle}
      allCycles={allCycles ?? []}
      rows={(rows ?? []).map((r) => ({
        id: r.id,
        workerName: nameOf.get(r.worker_id) ?? "—",
        supervisorName: r.supervisor_id ? (nameOf.get(r.supervisor_id) ?? "—") : "—",
        selfIn: Boolean(r.self_submitted_at) || r.self_skipped,
        supervisorIn: Boolean(r.supervisor_submitted_at) || r.supervisor_skipped,
        selfSubmittedAt: r.self_submitted_at,
        supervisorSubmittedAt: r.supervisor_submitted_at,
        handedOver: r.self_filled_via === "HANDOVER",
        status: r.status,
        overallTick: r.overall_tick,
      }))}
      workers={(workerPool ?? []).map((w) => ({
        id: w.id,
        name: w.full_name,
        employeeCode: w.employee_code,
        supervisorId: w.reports_to,
        supervisorName: w.reports_to ? (nameOf.get(w.reports_to) ?? null) : null,
      }))}
      raters={(raterPool ?? []).map((r) => ({
        id: r.id,
        name: r.full_name,
        role: describe(r.id),
        isSupervisor: (rolesOf.get(r.id) ?? []).includes("SUPERVISOR"),
      }))}
    />
  );
}

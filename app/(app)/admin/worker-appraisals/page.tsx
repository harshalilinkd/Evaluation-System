/** /admin/worker-appraisals — opens the current round, not a list of one card. */

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WorkerCyclesClient } from "@/app/(app)/admin/worker-appraisals/cycles-client";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { listWorkerRaters } from "@/lib/worker/raters";

export const metadata: Metadata = { title: "Worker appraisals" };

export default async function Page() {
  // §9: the guard is the first statement.
  await requireRole(["HR_ADMIN", "MD"]);

  const supabase = await createClient();

  /* -- THIS PAGE IS THE LIST AGAIN, and the redirect that used to be here was
        half of a bug that made every round but the newest unreachable.

        Two changes collided. This page redirected straight into the newest
        cycle, reasoning that "the board carries the round switcher and the
        Start button, so nothing is unreachable". The board then REMOVED its
        round picker, at the owner's instruction, reasoning that "Worker
        Appraisals in the sidebar IS that list, and it shows each round with its
        status and dates".

        Each screen delegated the job to the other, so neither did it. HR opened
        Worker appraisals, was thrown into the newest round, and had no way to
        reach any earlier one — reported as "the system appears to be stuck on a
        single entry".

        The board's picker stays gone, because removing it was an explicit
        instruction (§0.2). The list comes back, because that is what the board
        was told it could rely on. -- */
  /* -- Both lists. `worker_cycles.deleted_at` has existed since 0047 and
        nothing ever wrote it, so there was no bin to read — and no way back for
        a round once one existed. A bin with no view is a one-way door. -- */
  const [{ data: cycles }, { data: binned }] = await Promise.all([
    supabase
      .from("worker_cycles")
      .select("id, name, period_label, status, self_due_on, supervisor_due_on, md_due_on")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("worker_cycles")
      .select("id, name, period_label, status, self_due_on, supervisor_due_on, md_due_on")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false }),
  ]);

  /* -- STRAIGHT TO THE ROUND WHEN THERE IS ONLY ONE.

        The owner does not want a list standing between the menu item and the
        work, and with a single round that list is a page whose only content is
        one link — the same objection P12-15 answers on /my-evaluation, where an
        index of one exists only to be clicked through.

        ONLY WHEN THERE IS EXACTLY ONE, which is what keeps FIX-15 fixed. The
        redirect that used to live here was unconditional and went to the NEWEST
        round, so every earlier one became unreachable — the board had removed
        its own picker on the reasoning that this list was it. With two or more
        rounds the list still appears, and it is still the only way to reach an
        older one. -- */
  const live = cycles ?? [];
  if (live.length === 1 && (binned ?? []).length === 0) {
    redirect(`/admin/worker-appraisals/${live[0]!.id}`);
  }

  /* -- The worker pool, for the Start a round dialog. Needed whether or not
        any round exists — starting the SECOND round needs it as much as the
        first, which the old early-return shape did not allow for. -- */
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
      cycles={cycles ?? []}
      binned={binned ?? []}
      workers={(workers ?? []).map((w) => ({
        id: w.id,
        name: w.full_name,
        employeeCode: w.employee_code,
        supervisorId: w.reports_to,
        supervisorName: w.reports_to ? (nameOf.get(w.reports_to) ?? null) : null,
      }))}
      raters={await listWorkerRaters()}
    />
  );
}

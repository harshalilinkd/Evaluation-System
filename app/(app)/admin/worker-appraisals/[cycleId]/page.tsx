/** One worker appraisal round: who is in it, and where each side has got to. */

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ErrorState } from "@/components/appraise/states";
import { KpiCard, KpiRow } from "@/components/appraise/screen";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/date";

export const metadata: Metadata = { title: "Worker appraisal round" };

const STAGE_WORD: Record<string, string> = {
  DRAFT: "Not open",
  OPEN: "Open",
  PENDING_REVIEW: "With HR",
  REVIEWED: "Reviewed",
  CLOSED: "Finished",
};

export default async function Page({ params }: { params: Promise<{ cycleId: string }> }) {
  await requireRole(["HR_ADMIN", "MD"]);

  const { cycleId } = await params;
  const supabase = await createClient();

  const [{ data: cycle }, { data: rows }] = await Promise.all([
    supabase
      .from("worker_cycles")
      .select("id, name, period_label, status, self_due_on, supervisor_due_on, md_due_on")
      .eq("id", cycleId)
      .maybeSingle(),
    supabase
      .from("worker_evaluations")
      .select(
        "id, worker_id, supervisor_id, status, self_submitted_at, supervisor_submitted_at, overall_tick",
      )
      .eq("cycle_id", cycleId)
      .is("excluded_at", null),
  ]);

  if (!cycle) return <ErrorState title="Not found" body="That round no longer exists." />;

  const ids = [
    ...new Set(
      (rows ?? []).flatMap((r) => [r.worker_id, r.supervisor_id]).filter((v): v is string => Boolean(v)),
    ),
  ];
  const { data: people } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));

  const list = rows ?? [];
  const bothIn = list.filter((r) => r.self_submitted_at && r.supervisor_submitted_at).length;
  const waiting = list.length - bothIn;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/worker-appraisals"
          className="inline-flex items-center gap-1.5 font-sans text-body-sm text-ink-muted"
        >
          <ArrowLeft className="size-4" aria-hidden />
          All worker appraisals
        </Link>
        <h1 className="mt-2 font-sans text-h2 text-ink">{cycle.name}</h1>
        <p className="font-sans text-body-sm text-ink-muted">
          {cycle.period_label} · supervisor due {formatDate(cycle.supervisor_due_on)}
        </p>
      </div>

      <KpiRow>
        <KpiCard label="In this round" value={list.length} caption="workers" />
        <KpiCard label="Both sides in" value={bothIn} caption="ready for review" tone="final" />
        <KpiCard label="Still waiting" value={waiting} caption="one or both outstanding" tone="lead" />
      </KpiRow>

      <div className="overflow-hidden rounded-card border border-rule">
        <table className="w-full">
          <thead>
            <tr className="border-b border-rule bg-surface-mute">
              {["Worker", "Supervisor", "Worker's sheet", "Supervisor's sheet", "Stage", "Overall"].map(
                (h) => (
                  <th key={h} scope="col" className="type-label px-4 py-2.5 text-left text-ink">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 font-sans text-body-sm text-ink-muted">
                  Nobody is in this round.
                </td>
              </tr>
            ) : (
              list.map((row) => (
                <tr key={row.id} className="border-b border-rule last:border-b-0">
                  <td className="px-4 py-3 font-sans text-body-sm text-ink">
                    {nameOf.get(row.worker_id) ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-sans text-body-sm text-ink-muted">
                    {row.supervisor_id ? (nameOf.get(row.supervisor_id) ?? "—") : "—"}
                  </td>
                  {/* -- BOTH sides shown, because this screen is HR's.
                        §5 keeps each side from the OTHER, not from HR — they are
                        the one party entitled to see both, and chasing a round
                        is impossible without knowing which half is missing. -- */}
                  <td className="px-4 py-3 font-sans text-body-sm text-ink-muted">
                    {row.self_submitted_at ? formatDate(row.self_submitted_at) : "Not yet"}
                  </td>
                  <td className="px-4 py-3 font-sans text-body-sm text-ink-muted">
                    {row.supervisor_submitted_at ? formatDate(row.supervisor_submitted_at) : "Not yet"}
                  </td>
                  <td className="px-4 py-3 font-sans text-body-sm text-ink">
                    {STAGE_WORD[row.status] ?? row.status}
                  </td>
                  <td className="px-4 py-3 font-sans text-body-sm text-ink">
                    {/* §11: the worker's overall is the supervisor's tick, never
                        a mean. Blank until they submit. */}
                    {row.overall_tick
                      ? row.overall_tick.replace(/_/g, " ").toLowerCase()
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

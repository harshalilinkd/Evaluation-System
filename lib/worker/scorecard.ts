"use server";

/** A production worker's own appraisal history. Their outcomes, not the detail. */

import { createClient } from "@/lib/supabase/server";

export type WorkerScorecardRound = {
  evaluationId: string;
  cycleName: string;
  periodLabel: string;
  status: string;
  /** §11: on this track the overall IS the supervisor's tick, not a mean. */
  overallTick: string | null;
  supervisorDueOn: string | null;
  closedAt: string | null;
};

export type WorkerScorecard = {
  rounds: WorkerScorecardRound[];
};

/**
 * WHY THIS IS SEPARATE FROM THE STAFF SCORECARD
 *
 * §7's isolation rule: never refactor a staff function to serve the worker
 * module. The staff card is built from P16's six views, every one of which
 * filters `track = 'STAFF'` (P16-6) — so a worker opening `/scorecard` got a
 * page of em dashes, which reads as broken rather than as "you are on the other
 * form". This is that page's other half, and it shares nothing but the route.
 *
 * WHAT IT SHOWS, AND WHY NOT MORE
 *
 * Their rounds and their overall tick. NOT the per-quality ticks and NOT the
 * supervisor's comment — 0047's policy admits a worker to the SELF layer only,
 * and the supervisor's layer is readable by the supervisor, HR and the MD. That
 * is a disclosure decision already made in the database, and this reads through
 * the authenticated client so it could not widen it even by mistake (P16-9).
 *
 * NOT the salary block either: 0064 leaves `worker_evaluation_decisions`
 * readable by HR and the MD alone, and it is not queried here at all — an
 * absence that is structural rather than a filter somebody has to remember
 * (§5, and the reasoning P19-2 used for the employee's own employment dates).
 */
export async function getWorkerScorecard(profileId: string): Promise<WorkerScorecard> {
  const supabase = await createClient();

  /* -- One literal select string, never a concatenation: supabase-js infers the
        row type from it at compile time and degrades everything to an error type
        on anything it cannot statically parse (P3-11). -- */
  /* -- TWO QUERIES, MERGED HERE, rather than an embedded join.
        The hand-authored `types/database.ts` (P1-6 — Docker is unavailable, so
        it is maintained by hand) declares no relationship between these two
        tables, and supabase-js resolves an embed at COMPILE time from exactly
        that. Adding a Relationships entry to satisfy one query would be editing
        a generated-shaped file to describe something the next `db:types` run
        would rewrite. Merging in TypeScript is what P3-7 already does for the
        same class of problem.

        The due date is on the CYCLE, not the evaluation: a production round runs
        to one deadline for everybody in it, unlike a staff cycle where 0022 gave
        each evaluation its own. -- */
  const { data: evaluations } = await supabase
    .from("worker_evaluations")
    .select("id, cycle_id, status, overall_tick, closed_at")
    .eq("worker_id", profileId)
    .order("created_at", { ascending: false });

  if (!evaluations || evaluations.length === 0) return { rounds: [] };

  const { data: cycles } = await supabase
    .from("worker_cycles")
    .select("id, name, period_label, supervisor_due_on, deleted_at")
    .in("id", evaluations.map((e) => e.cycle_id));

  const byId = new Map((cycles ?? []).map((c) => [c.id, c] as const));

  const rounds = evaluations
    // A binned round is hidden everywhere else (FIX-17); a person's own history
    // is not the place it should reappear. A cycle we could not read at all is
    // dropped for the same reason — RLS said no, and a row with no name is not
    // something to render.
    .filter((row) => {
      const cycle = byId.get(row.cycle_id);
      return cycle !== undefined && cycle.deleted_at === null;
    })
    .map((row) => {
      const cycle = byId.get(row.cycle_id);
      return {
        evaluationId: row.id,
        cycleName: cycle?.name ?? "Appraisal",
        periodLabel: cycle?.period_label ?? "",
        status: row.status,
        overallTick: row.overall_tick,
        supervisorDueOn: cycle?.supervisor_due_on ?? null,
        closedAt: row.closed_at,
      };
    });

  return { rounds };
}

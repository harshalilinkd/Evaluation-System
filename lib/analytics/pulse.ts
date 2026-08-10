/** What the system is DOING right now. The operational half of the dashboard. */

import "server-only";

import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { createClient } from "@/lib/supabase/server";

/**
 * WHY THIS EXISTS ALONGSIDE `getAnalytics`.
 *
 * `queries.ts` answers "what do the numbers say" — averages by section, by
 * department, by lead. That is a research question, and the dashboard was built
 * entirely out of it: six panels of company-wide means for an audience whose
 * actual question is "what is happening, and what needs me today".
 *
 * This answers the second one. Counts of work in each state, what finished this
 * month against last, what is coming, and who scored well — the shape of the
 * process rather than the distribution of its output.
 *
 * HR AND THE MD ONLY, and the caller enforces it. Every read here crosses
 * people: a leaderboard names colleagues and their scores, and §9 gives an
 * employee nothing about anyone else. RLS would already reduce most of it to
 * the caller's own row, but a panel that silently degrades to "you are the top
 * performer" is worse than one that is never rendered.
 *
 * NO SALARY FIGURES. §5 confines amounts to HR and the MD, and while this data
 * is HR/MD-only anyway, the increment panel deliberately carries a COUNT and a
 * date — never an amount. A dashboard is a screen people read over each other's
 * shoulders.
 */

export type PulseUpcoming = {
  profileId: string;
  name: string;
  milestone: string;
  dueOn: string;
  /** Negative when already past due. */
  daysAway: number;
};

export type PulsePerformer = {
  profileId: string;
  name: string;
  department: string | null;
  initials: string;
  /** The settled figure — final where one exists, else the lead's (§11). */
  score: number;
  /** Which layer produced it, so the number never claims an authority it lacks. */
  basis: "final" | "lead";
  cycleLabel: string;
};

export type SystemPulse = {
  /** Both sides still filling in. */
  inProgress: number;
  /** Both sides in, waiting for HR to read it. */
  awaitingHr: number;
  /** HR has sent it on. */
  withMd: number;
  /* -- The MD has read it and nobody has finished it.
        This state had no counter anywhere until today, on this screen or on the
        reports queue — so the moment the MD did their job the record fell out of
        every total and read as "nothing outstanding" while it sat there. It is
        the one bucket where work stalls silently, because both parties think
        the other has it. INTERVIEW_DONE counts too: an increment stops there
        only if the close was interrupted. -- */
  readyToClose: number;
  completedThisMonth: number;
  completedLastMonth: number;
  /** Pay changes recorded this month. A COUNT — never an amount (§5). */
  incrementsThisMonth: number;
  /** Scheduled work not yet turned into an evaluation, soonest first. */
  upcoming: PulseUpcoming[];
  /** How many more there are beyond the ones listed. */
  upcomingMore: number;
  topPerformers: PulsePerformer[];
  /** True when a performer list would name fewer than two people. */
  performersThin: boolean;
};

const MILESTONE_WORDS: Record<string, string> = {
  MONTH_1: "First month review",
  MONTH_6: "Six month review",
  ANNUAL: "Annual evaluation",
  INCREMENT: "Increment due",
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/** Midnight on the first of a month, N months back, as an ISO date. */
function monthStart(from: Date, monthsBack: number): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - monthsBack, 1));
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000,
  );
}

export async function getSystemPulse(): Promise<CycleResult<SystemPulse>> {
  const supabase = await createClient();

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const thisMonth = monthStart(now, 0);
  const lastMonth = monthStart(now, 1);
  /* Ninety days is the horizon HR plans against — far enough to prepare, near
     enough that everything on the list is still real. */
  const horizon = new Date(now.getTime() + 90 * 86_400_000).toISOString().slice(0, 10);

  /* -- Issued together. None of the seven depends on another's result, and
        this is the landing page — sequentially they would be seven full round
        trips before anything rendered (the FIX-8 lesson, applied at the point
        the queries are written rather than after somebody notices). -- */
  const [
    inProgress,
    awaitingHr,
    withMd,
    readyToClose,
    doneThisMonth,
    doneLastMonth,
    increments,
    dueRows,
    history,
  ] = await Promise.all([
    /* -- `!inner` on the cycle throughout, so a BINNED cycle is excluded.
          0032 gave cycles a `deleted_at`; anything counting evaluations without
          it reports work nobody is doing on a cycle nobody can open. -- */
    countEvaluations(supabase, ["OPEN"]),
    countEvaluations(supabase, ["PENDING_HR_REVIEW"]),
    countEvaluations(supabase, ["HR_APPROVED"]),
    countEvaluations(supabase, ["MD_REVIEWED", "INTERVIEW_DONE"]),

    /* -- Finished, by WHEN it finished.
          `closed_at` rather than the status alone: "completed this month" is a
          question about a date, and counting rows at CLOSED would return every
          evaluation ever closed under a heading that says this month. -- */
    supabase
      .from("evaluations")
      .select("id, evaluation_cycles!inner(deleted_at)", { count: "exact", head: true })
      .not("closed_at", "is", null)
      .gte("closed_at", thisMonth)
      .is("excluded_at", null)
      .is("evaluation_cycles.deleted_at", null),

    supabase
      .from("evaluations")
      .select("id, evaluation_cycles!inner(deleted_at)", { count: "exact", head: true })
      .not("closed_at", "is", null)
      .gte("closed_at", lastMonth)
      .lt("closed_at", thisMonth)
      .is("excluded_at", null)
      .is("evaluation_cycles.deleted_at", null),

    /* -- Pay changes recorded this month. HEAD + count, so not one figure
          crosses the wire — §5, and the panel only ever shows how many. -- */
    supabase
      .from("salary_history")
      .select("id", { count: "exact", head: true })
      .gte("effective_from", thisMonth),

    supabase
      .from("due_items")
      .select("id, profile_id, milestone_type, due_on")
      .eq("status", "PENDING")
      .lte("due_on", horizon)
      .order("due_on", { ascending: true })
      .limit(25),

    /* -- Who scored well. Read from the history view, which is
          `security_invoker` — so this is subject to the same policies as a
          direct select and cannot become a back door around §9. -- */
    supabase
      .from("v_employee_history")
      .select("profile_id, cycle_name, period_label, starts_on, lead_overall, final_overall")
      .or("final_overall.not.is.null,lead_overall.not.is.null")
      .order("starts_on", { ascending: false })
      .limit(200),
  ]);

  /* ---------- Upcoming ---------- */
  const upcomingRaw = dueRows.data ?? [];
  const dueProfileIds = [...new Set(upcomingRaw.map((r) => r.profile_id))];

  /* ---------- Performers ----------
     One row per PERSON, their most recent scored cycle. The view returns every
     cycle they have been through, so without this the same name appears three
     times and a leaderboard of five is two people. */
  const historyRows = history.data ?? [];
  const bestPerPerson = new Map<
    string,
    { score: number; basis: "final" | "lead"; cycleLabel: string }
  >();

  for (const row of historyRows) {
    // §11's precedence: the final figure where one was agreed, else the lead's.
    // The employee's own score is deliberately NOT a fallback — a leaderboard
    // built partly on self-assessment ranks confidence, not performance.
    const final = row.final_overall === null ? null : Number(row.final_overall);
    const lead = row.lead_overall === null ? null : Number(row.lead_overall);
    const score = final ?? lead;
    if (score === null) continue;

    // Rows arrive newest first, so the first one seen for a person is their
    // most recent — later ones are older cycles and are skipped.
    if (bestPerPerson.has(row.profile_id)) continue;

    bestPerPerson.set(row.profile_id, {
      score,
      basis: final === null ? "lead" : "final",
      cycleLabel: `${row.cycle_name} · ${row.period_label}`,
    });
  }

  const performerIds = [...bestPerPerson.keys()];

  /* -- Names and departments for both lists, in ONE pass rather than one
        lookup per row. -- */
  const wantedIds = [...new Set([...dueProfileIds, ...performerIds])];

  const [{ data: people }, { data: departments }] =
    wantedIds.length > 0
      ? await Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name, department_id")
            .in("id", wantedIds),
          supabase.from("departments").select("id, name"),
        ])
      : [{ data: [] }, { data: [] }];

  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const deptIdOf = new Map((people ?? []).map((p) => [p.id, p.department_id]));
  const deptName = new Map((departments ?? []).map((d) => [d.id, d.name]));

  const upcoming: PulseUpcoming[] = upcomingRaw
    // A person who has since been removed leaves an item pointing at nobody.
    // Skipped rather than rendered as "Unknown", which reads as a data fault.
    .filter((r) => nameOf.has(r.profile_id))
    .slice(0, 6)
    .map((r) => ({
      profileId: r.profile_id,
      name: nameOf.get(r.profile_id) ?? "",
      milestone: MILESTONE_WORDS[r.milestone_type] ?? r.milestone_type,
      dueOn: r.due_on,
      daysAway: daysBetween(today, r.due_on),
    }));

  const topPerformers: PulsePerformer[] = performerIds
    .map((id) => {
      const entry = bestPerPerson.get(id)!;
      const name = nameOf.get(id) ?? "";
      const deptId = deptIdOf.get(id) ?? null;
      return {
        profileId: id,
        name,
        department: deptId ? (deptName.get(deptId) ?? null) : null,
        initials: initialsOf(name),
        score: entry.score,
        basis: entry.basis,
        cycleLabel: entry.cycleLabel,
      };
    })
    .filter((p) => p.name !== "")
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    ok: true,
    data: {
      inProgress: inProgress ?? 0,
      awaitingHr: awaitingHr ?? 0,
      withMd: withMd ?? 0,
      readyToClose: readyToClose ?? 0,
      completedThisMonth: doneThisMonth.count ?? 0,
      completedLastMonth: doneLastMonth.count ?? 0,
      incrementsThisMonth: increments.count ?? 0,
      upcoming,
      upcomingMore: Math.max(0, upcomingRaw.length - upcoming.length),
      topPerformers,
      /* -- A "top performers" list of one is not a ranking, it is somebody's
            score under a heading that implies competition. The panel says so
            instead of drawing a podium for a single person. -- */
      performersThin: topPerformers.length < 2,
    },
  };
}

/** One status count, with the binned-cycle exclusion applied consistently. */
async function countEvaluations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  /* -- An ARRAY, because one bucket is two statuses. `in` with a single-item
        list is the same query `eq` was making, so every existing caller is
        unchanged in behaviour as well as in shape. -- */
  status: ReadonlyArray<"OPEN" | "PENDING_HR_REVIEW" | "HR_APPROVED" | "MD_REVIEWED" | "INTERVIEW_DONE">,
): Promise<number> {
  const { count } = await supabase
    .from("evaluations")
    .select("id, evaluation_cycles!inner(deleted_at)", { count: "exact", head: true })
    .in("status", [...status])
    .is("excluded_at", null)
    .is("evaluation_cycles.deleted_at", null);
  return count ?? 0;
}

export { cycleError };

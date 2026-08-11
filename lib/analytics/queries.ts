/** Dashboard and scorecard reads. Every one goes through the views. CLAUDE.md §9. */

import "server-only";

import type { AppRole } from "@/lib/auth/roles";
import { cycleError, type CycleResult } from "@/lib/cycles/schema";
import { createClient } from "@/lib/supabase/server";
import { scoreValue } from "@/lib/evaluations/scoring";
import type { FormQuestion } from "@/lib/forms/types";
import type { Enums, Views } from "@/types/database";

/**
 * NOTHING HERE AGGREGATES IN THE BROWSER.
 *
 * P16: "all aggregation in SQL, none in the browser" and "no dashboard query
 * runs in the browser over raw rows". Every figure below comes out of a view
 * that already did the grouping — so the browser never receives the rows the
 * average was computed from, which is a privacy property as much as a
 * performance one. An employee's dashboard cannot contain a colleague's score
 * even in a payload nobody renders.
 *
 * The views are `security_invoker`, so these reads are subject to the same RLS
 * as a direct select. That is what makes one query safe to run for every role
 * rather than needing a different query per audience.
 */

export type CycleProgress = Views<"v_cycle_progress">;
export type DepartmentScore = Views<"v_department_scores">;
export type SectionScore = Views<"v_section_scores">;
export type LeadVariance = Views<"v_variance_by_lead">;
export type RatingBucket = Views<"v_rating_distribution">;
export type HistoryRow = Views<"v_employee_history">;

export type DashboardAudience = "hr" | "md" | "lead" | "employee";

/** §9's matrix, reduced to the one question this screen asks. */
export function audienceFor(roles: readonly AppRole[]): DashboardAudience {
  if (roles.includes("HR_ADMIN")) return "hr";
  if (roles.includes("MD")) return "md";
  if (roles.includes("HOD") || roles.includes("SUPERVISOR")) return "lead";
  return "employee";
}

export type Analytics = {
  audience: DashboardAudience;
  activeCycle: { id: string; name: string; periodLabel: string } | null;
  /**
   * EVERY open cycle, so the screen can say which one it is showing.
   *
   * The figures below are per-cycle and stay that way. Averaging an EVALUATION
   * cycle together with an INCREMENT one would produce a company score that
   * describes neither exercise — the same objection P16-4 makes about Job
   * Specific Skills across departments, and §11 keeps a score inside the cycle
   * it was given in.
   *
   * What was wrong was not that one cycle is shown. It is that one was shown
   * with nothing to say another existed, so a reader could not tell whether
   * they were looking at the company or at half of it.
   */
  activeCycles: Array<{ id: string; name: string; periodLabel: string }>;
  progress: CycleProgress | null;
  departments: DepartmentScore[];
  /** Comparable sections only — Job Specific Skills is excluded by the view's flag. */
  sections: SectionScore[];
  variance: LeadVariance[];
  distribution: RatingBucket[];
  /** The signed-in person's own history, for the employee trend. */
  ownHistory: HistoryRow[];
  /**
   * How the cycle filled up, day by day. Administrators only.
   *
   * CUMULATIVE, not per-day counts. The question a dashboard is asked here is
   * "are we going to land this by the due date" — which is a level and a slope,
   * not a bar chart of Tuesday. A per-day series of a 40-person cycle is also
   * mostly zeroes with two spikes, which reads as noise.
   *
   * Both layers are counted SEPARATELY and never summed into one line. Under
   * blind parallel rating they are two independent populations filling in at
   * once (§1); adding them would produce a curve out of two unrelated things
   * and hide the case that actually matters — one side racing ahead while the
   * other has not started.
   *
   * Empty for an employee and for a lead: it is a company-wide readout, and §9
   * gives an employee nothing about anyone else. A lead seeing their team's
   * submission curve would also make the employees' side observable, which is
   * exactly what §5's blindness forbids.
   */
  timeline: Array<{
    /** ISO date, ascending. */
    day: string;
    /** Cumulative self layers submitted on or before this day. */
    self: number;
    /** Cumulative lead layers submitted on or before this day. */
    lead: number;
  }>;
  /** Overdue people, oldest first. HR and leads only — an employee sees none. */
  needsAttention: Array<{
    evaluationId: string;
    name: string;
    initials: string;
    department: string | null;
    daysLate: number;
  }>;
};

export async function getAnalytics(
  profileId: string,
  roles: readonly AppRole[],
  /** Which open cycle to describe. Defaults to the most recent. */
  cycleId?: string,
): Promise<CycleResult<Analytics>> {
  const supabase = await createClient();
  const audience = audienceFor(roles);

  const { data: cycles, error: cycleReadError } = await supabase
    .from("evaluation_cycles")
    .select("id, name, period_label, self_due_on, lead_due_on")
    .eq("status", "ACTIVE")
    // A binned cycle is still ACTIVE — 0032's recycle bin is a `deleted_at`.
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (cycleReadError) return cycleError("QUERY_FAILED", cycleReadError.message);

  const allCycles = cycles ?? [];
  const activeCycles = allCycles.map((c) => ({
    id: c.id,
    name: c.name,
    periodLabel: c.period_label,
  }));

  /* -- The one being described. `cycleId` lets the reader switch; without it
        the newest wins, which is what this always did — the difference is that
        the others are now reachable rather than invisible. An id that is not
        open falls back rather than rendering an empty dashboard. -- */
  const cycle = (cycleId ? allCycles.find((c) => c.id === cycleId) : null) ?? allCycles[0] ?? null;

  if (!cycle) {
    // A fresh install is not a broken one. Every list comes back empty and the
    // screen says so — P16: "a fresh install looks intentional, not broken."
    return {
      ok: true,
      data: {
        audience,
        activeCycle: null,
        activeCycles,
        progress: null,
        departments: [],
        sections: [],
        variance: [],
        distribution: [],
        ownHistory: [],
        timeline: [],
        needsAttention: [],
      },
    };
  }

  const [progress, departments, sections, variance, distribution, history] = await Promise.all([
    supabase.from("v_cycle_progress").select("*").eq("cycle_id", cycle.id).maybeSingle(),
    supabase.from("v_department_scores").select("*").eq("cycle_id", cycle.id),
    // is_comparable is the view's own flag: Job Specific Skills is a different
    // set of questions per department, so it never shares an axis with another
    // department's. Filtered here so no chart has to remember.
    supabase.from("v_section_scores").select("*").eq("cycle_id", cycle.id).eq("is_comparable", true),
    supabase.from("v_variance_by_lead").select("*").eq("cycle_id", cycle.id),
    supabase.from("v_rating_distribution").select("*").eq("cycle_id", cycle.id),
    supabase.from("v_employee_history").select("*").eq("profile_id", profileId).order("starts_on"),
  ]);

  /* -- How the cycle filled up -- */
  //
  // Administrators only, for the reason on the type: a submission curve is a
  // readout of a whole population's progress, and under blind rating showing a
  // lead the employees' curve would tell them how their own reports are doing
  // (§5). The query is SKIPPED rather than fetched and hidden — a filter is
  // something somebody can forget, an absent request is not.
  const timeline: Analytics["timeline"] = [];

  if (audience === "hr" || audience === "md") {
    const { data: submitted } = await supabase
      .from("evaluations")
      .select("self_submitted_at, lead_submitted_at")
      .eq("cycle_id", cycle.id)
      .is("excluded_at", null);

    const perDay = new Map<string, { self: number; lead: number }>();
    const bump = (at: string | null, layer: "self" | "lead") => {
      if (!at) return;
      const day = at.slice(0, 10);
      const cell = perDay.get(day) ?? { self: 0, lead: 0 };
      cell[layer] += 1;
      perDay.set(day, cell);
    };

    for (const row of submitted ?? []) {
      bump(row.self_submitted_at, "self");
      bump(row.lead_submitted_at, "lead");
    }

    if (perDay.size > 0) {
      /* -- Every day between the first submission and today, INCLUDING the ones
            nobody submitted on. Plotting only the days that have a value draws
            a straight line across a fortnight of silence and makes a stalled
            cycle look like steady progress — the flat stretch IS the finding. -- */
      const days = [...perDay.keys()].sort();
      const from = Date.parse(`${days[0]}T00:00:00Z`);
      const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      const to = Math.max(from, today);

      let self = 0;
      let lead = 0;
      for (let t = from; t <= to; t += 86_400_000) {
        const day = new Date(t).toISOString().slice(0, 10);
        const cell = perDay.get(day);
        self += cell?.self ?? 0;
        lead += cell?.lead ?? 0;
        timeline.push({ day, self, lead });
      }
    }
  }

  /* -- Needs attention -- */
  //
  // Deliberately empty for an employee: a list of who is late is information
  // about colleagues, and §9 gives an employee nothing about anyone else. RLS
  // would already reduce it to themselves, which would be a "needs attention"
  // list of one person nagging them — so it is skipped outright.
  const needsAttention: Analytics["needsAttention"] = [];

  if (audience !== "employee") {
    const today = new Date().toISOString().slice(0, 10);
    const { data: late } = await supabase
      .from("evaluations")
      .select("id, evaluatee_id, department_id, status, self_submitted_at, lead_submitted_at, due_self_on, due_lead_on")
      .eq("cycle_id", cycle.id)
      .is("excluded_at", null)
      // AMEND-3: OPEN is the only status with work outstanding. The two named
      // here were retired, so this matched nothing and "needs chasing" was
      // permanently empty.
      .eq("status", "OPEN");

    const rows = late ?? [];
    if (rows.length > 0) {
      /* -- Together: the names depend on `rows`, the departments on nothing at
            all, and neither depends on the other. Sequentially they cost two
            full round trips on the landing page. -- */
      const [{ data: people }, { data: depts }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", rows.map((r) => r.evaluatee_id)),
        supabase.from("departments").select("id, name"),
      ]);

      const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));
      const deptOf = new Map((depts ?? []).map((d) => [d.id, d.name]));

      /* -- Under blind rating there is no "whose turn". Both sides are open at
            once, so a record is late when EITHER side is past its own date and
            has not submitted. The earlier of the two outstanding deadlines is
            what makes it late.

            This says nothing about WHICH side — the list is HR's and the MD's
            (§9 gives an employee nothing about anyone else), and it names a
            record rather than a person's progress. -- */
      const lateness = (row: {
        self_submitted_at: string | null;
        lead_submitted_at: string | null;
        due_self_on: string | null;
        due_lead_on: string | null;
      }): string | null => {
        const dates: string[] = [];
        if (!row.self_submitted_at) {
          const d = row.due_self_on ?? cycle.self_due_on;
          if (d) dates.push(d);
        }
        if (!row.lead_submitted_at) {
          const d = row.due_lead_on ?? cycle.lead_due_on;
          if (d) dates.push(d);
        }
        return dates.sort()[0] ?? null;
      };

      for (const row of rows) {
        const deadline = lateness(row);
        if (!deadline || deadline >= today) continue;
        needsAttention.push({
          evaluationId: row.id,
          name: nameOf.get(row.evaluatee_id) ?? "Unknown",
          initials: initialsOf(nameOf.get(row.evaluatee_id) ?? "?"),
          department: row.department_id ? (deptOf.get(row.department_id) ?? null) : null,
          daysLate: Math.round(
            (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${deadline}T00:00:00Z`)) / 86_400_000,
          ),
        });
      }
      needsAttention.sort((a, b) => b.daysLate - a.daysLate);
    }
  }

  return {
    ok: true,
    data: {
      audience,
      activeCycle: { id: cycle.id, name: cycle.name, periodLabel: cycle.period_label },
      activeCycles,
      progress: progress.data ?? null,
      departments: departments.data ?? [],
      sections: sections.data ?? [],
      variance: variance.data ?? [],
      distribution: distribution.data ?? [],
      ownHistory: history.data ?? [],
      timeline,
      needsAttention,
    },
  };
}

/* ---------- The scorecard ---------- */

/** One rated question, as all three layers answered it. */
export type ScorecardQuestion = {
  questionId: string;
  text: string;
  section: Enums<"question_section">;
  sortOrder: number;
  self: number | null;
  lead: number | null;
  final: number | null;
};

/** Where the person's newest evaluation actually stands, scored or not. */
export type ScorecardCurrent = {
  evaluationId: string;
  cycleName: string;
  periodLabel: string;
  status: Enums<"evaluation_status">;
  selfDueOn: string | null;
  leadDueOn: string | null;
  mdDueOn: string | null;
};

export type Scorecard = {
  profile: {
    id: string;
    name: string;
    initials: string;
    designation: string | null;
    department: string | null;
    dateOfJoining: string | null;
  };
  history: HistoryRow[];
  /** The latest cycle's DEPARTMENT profile — everyone's average, not theirs. */
  latestSections: SectionScore[];
  /**
   * THIS PERSON'S own answers for the latest cycle, per question.
   *
   * The section breakdown used to come from `v_section_scores`, which is a
   * department average — on a personal scorecard headed "By section" that reads
   * as the person's own profile and is not. Their sections are derived from
   * these rows instead, so the number under their name is theirs.
   */
  questions: ScorecardQuestion[];
  /** The newest evaluation, so an in-flight one has something to say. */
  current: ScorecardCurrent | null;
  /** True when the viewer is the employee and the policy withholds detail. */
  redacted: boolean;
};

/**
 * One person's history.
 *
 * There is no role check here, and that is deliberate rather than an oversight:
 * every read below goes through RLS or a security_invoker view, so a person who
 * may not see this profile's evaluations gets an empty history and the page says
 * so. The route adds the guard on top for a clean redirect — but if that guard
 * were deleted the page would look broken, not leak.
 */
export async function getScorecard(
  profileId: string,
  viewerId: string,
): Promise<CycleResult<Scorecard>> {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, designation, department_id, date_of_joining")
    .eq("id", profileId)
    .maybeSingle();

  if (!profile) return cycleError("NOT_FOUND", "That person is not on the system.");

  const { data: department } = profile.department_id
    ? await supabase.from("departments").select("name").eq("id", profile.department_id).maybeSingle()
    : { data: null };

  const { data: history } = await supabase
    .from("v_employee_history")
    .select("*")
    .eq("profile_id", profileId)
    .order("starts_on", { ascending: true });

  const rows = history ?? [];
  const latest = rows[rows.length - 1];

  /* -- The newest cycle and the newest RATED cycle are not the same row, and
        conflating them is what made this card show "not rated" beside a table
        of real scores.

        `v_employee_history` is ordered by start date, so `latest` is whatever
        is happening NOW — frequently a draft nobody has opened. That is the
        right row for "where this cycle stands" and the wrong one for every
        number on the page: a person's Self/Lead/Final, their section profile
        and their verdict all describe the last appraisal that actually
        produced a score, not the one that has yet to start.

        Falls back to `latest` so a person with no scores at all still gets a
        card built around their live cycle rather than around nothing. -- */
  const rated =
    [...rows]
      .reverse()
      .find(
        (r) =>
          r.self_overall !== null || r.lead_overall !== null || r.final_overall !== null,
      ) ?? latest;

  const { data: sections } = rated
    ? await supabase
        .from("v_section_scores")
        .select("*")
        .eq("cycle_id", rated.cycle_id)
        .eq("department_id", profile.department_id ?? "")
        .eq("is_comparable", true)
    : { data: [] };

  /* -- The newest evaluation, whatever state it is in.
        `v_employee_history` is ordered by start date, so `latest` is it. A card
        for somebody mid-cycle used to be a page of em dashes; this is what lets
        it say where they actually are instead. -- */
  const { data: currentRow } = latest
    ? await supabase
        .from("evaluation_cycles")
        .select("name, period_label, self_due_on, lead_due_on, md_due_on")
        .eq("id", latest.cycle_id)
        .maybeSingle()
    : { data: null };

  const current: ScorecardCurrent | null =
    latest && currentRow
      ? {
          evaluationId: latest.evaluation_id,
          cycleName: currentRow.name,
          periodLabel: currentRow.period_label,
          status: latest.status,
          selfDueOn: currentRow.self_due_on,
          leadDueOn: currentRow.lead_due_on,
          mdDueOn: currentRow.md_due_on,
        }
      : null;

  /* -- The person's OWN answers, per question.
        Read through the authenticated client, so RLS decides which layers this
        viewer may see: an employee whose cycle withholds detail simply gets no
        LEAD column, rather than the page reimplementing §9's disclosure rules a
        second time and eventually disagreeing with the policy. -- */
  const questions: ScorecardQuestion[] = [];

  if (rated) {
    const [{ data: snapshot }, { data: responses }] = await Promise.all([
      supabase
        .from("evaluation_questions")
        .select("question_id, text, section, response_type, sort_order")
        .eq("evaluation_id", rated.evaluation_id)
        .order("sort_order"),
      supabase
        .from("evaluation_responses")
        .select("layer, answers")
        .eq("evaluation_id", rated.evaluation_id),
    ]);

    const answersFor = (layer: string) =>
      ((responses ?? []).find((r) => r.layer === layer)?.answers ?? {}) as Record<string, unknown>;
    const selfAnswers = answersFor("SELF");
    const leadAnswers = answersFor("LEAD");
    const mdAnswers = answersFor("MD");

    for (const row of snapshot ?? []) {
      // scoreValue is §11's ONE implementation — only SCALE_0_5 counts, and
      // TICK_3 converts through the 5/3/1 mapping. A second numeric reading
      // here would eventually disagree with the stored overall.
      const asQuestion = {
        responseType: row.response_type,
        minValue: null,
        maxValue: null,
      } as FormQuestion;

      const self = scoreValue(asQuestion, selfAnswers[row.question_id]);
      const lead = scoreValue(asQuestion, leadAnswers[row.question_id]);
      const final = scoreValue(asQuestion, mdAnswers[row.question_id]);

      // A question nobody scored carries no information on this screen.
      if (self === null && lead === null && final === null) continue;

      questions.push({
        questionId: row.question_id,
        text: row.text,
        section: row.section,
        sortOrder: row.sort_order,
        self,
        lead,
        final,
      });
    }
  }

  // §9: the employee sees their own result only as far as the cycle's policy
  // allows. Somebody looking at their own card under NONE gets the shape of
  // their history without the numbers behind the decision.
  // Judged on the cycle whose numbers are being shown, not on a later draft
  // whose policy says nothing about them.
  const redacted = viewerId === profileId && rated?.disclosure === "NONE";

  return {
    ok: true,
    data: {
      profile: {
        id: profile.id,
        name: profile.full_name,
        initials: initialsOf(profile.full_name),
        designation: profile.designation,
        department: department?.name ?? null,
        dateOfJoining: profile.date_of_joining,
      },
      history: rows,
      latestSections: sections ?? [],
      questions,
      current,
      redacted,
    },
  };
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

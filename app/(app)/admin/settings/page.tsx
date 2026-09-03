/** /admin/settings — General, Users, salary history, evaluation periods, messages, departments, team review and the recycle bin. */

import type { Metadata } from "next";

import {
  DepartmentsClient,
  type DepartmentRow,
} from "@/app/(app)/admin/departments/departments-client";
import { PeopleClient, type PersonRow as TeamReviewRow } from "@/app/(app)/admin/people/people-client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScheduleTab } from "@/app/(app)/admin/settings/schedule-tab";
import { getEvaluationSchedule } from "@/lib/due/schedule";
import {
  UsersTab,
  type DepartmentOption,
  type PersonRow,
} from "@/app/(app)/admin/settings/users-tab";
import { SalaryHistoryTab } from "@/app/(app)/admin/settings/salary-history-tab";
import { getEmploymentHistoryGrid } from "@/lib/employment/history-grid";
import { GeneralTab } from "@/app/(app)/admin/settings/general-tab";
import { NotificationsTab } from "@/app/(app)/admin/settings/notifications-tab";
import { BinnedRounds } from "@/app/(app)/admin/settings/binned-rounds";
import { RecycleBinTab } from "@/app/(app)/admin/settings/recycle-bin-tab";
import { listBinnedCycles } from "@/lib/cycles/queries";
import {
  coReviewerScoreByEvaluation,
  managerFigure,
  managerOverallByEvaluation,
} from "@/lib/evaluations/manager-overall";
import { getMessageLog, getOutboundState } from "@/lib/notify/settings";
import { listTemplates } from "@/lib/notify/template-actions";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

/**
 * The gutters the five non-grid tabs used to get from the shell.
 *
 * With `data-full-bleed` now on the page rather than on three of its tabs,
 * `.app-main` drops its padding for ALL of them — which is right for the tabs
 * that hold a grid and wrong for the ones that hold a form, whose content would
 * otherwise start at the very edge of the screen. Given back here, at the same
 * `px-4 lg:px-8` the shell was applying, so nothing about those five moves
 * horizontally; only the tabs that were already flush stay flush.
 *
 * The bottom padding comes back too: the full-bleed rule replaces the shell's
 * `pb-8 + nav` with the nav reservation alone, so without this the last control
 * on a long settings form would sit against the bottom of the page.
 */
const PANEL = "px-4 pb-8 lg:px-8";

// "periods" was missing here despite having its own trigger and panel below —
// an unknown `?tab=periods` silently fell back to Users. "team-review" is new:
// Team review moved in from the sidebar, beside Recycle bin (both are "look at
// today's roster" screens).
const TABS = [
  "general",
  "users",
  "salary-history",
  "periods",
  "team-review",
  "messages",
  "departments",
  "recycle-bin",
] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; find?: string; cycle?: string }>;
}) {
  // §9: the guard is the first statement. A non-HR user is redirected before
  // any markup is produced, never shown and then hidden.
  const { profile, roles } = await requireRole(ADMIN_ROLES);

  // `searchParams` is a promise in Next 16. Unknown values fall back rather
  // than rendering a Tabs with no panel showing.
  const params = await searchParams;
  const requested = params.tab;
  const activeTab = TABS.includes(requested as (typeof TABS)[number]) ? requested! : "users";

  const supabase = await createClient();

  const [outboundState, logState, binState, binnedRoundRows] = await Promise.all([
    getOutboundState(),
    getMessageLog(),
    listBinnedCycles(),
    /* -- Production rounds in the bin. Read here rather than through a worker
          query module because it is four columns and one filter — and read on
          the ADMIN's own session, so RLS decides (0047 admits HR and the MD).
          §7: no staff function is reused, and no worker function is bent to
          serve this screen. -- */
    supabase
      .from("worker_cycles")
      .select("id, name, period_label, status")
      .not("deleted_at", "is", null)
      .order("created_at", { ascending: false }),
  ]);
  const binnedCycles = binState.ok ? binState.data : [];
  /* -- How many appraisals each binned round holds, so the delete
        confirmation can name what will be destroyed rather than saying
        "everything in it". One query for all of them, counted in TypeScript:
        a count per round would be a round trip per row on a screen that
        usually has none. -- */
  const binnedRoundIds = (binnedRoundRows.data ?? []).map((r) => r.id);
  const { data: binnedRoundEvaluations } = binnedRoundIds.length
    ? await supabase
        .from("worker_evaluations")
        .select("cycle_id")
        .in("cycle_id", binnedRoundIds)
    : { data: [] };

  const appraisalsIn = new Map<string, number>();
  for (const row of binnedRoundEvaluations ?? []) {
    appraisalsIn.set(row.cycle_id, (appraisalsIn.get(row.cycle_id) ?? 0) + 1);
  }

  const binnedRounds = (binnedRoundRows.data ?? []).map((r) => ({
    ...r,
    appraisals: appraisalsIn.get(r.id) ?? 0,
  }));
  const outbound = outboundState.ok
    ? outboundState.data
    : { paused: false, pausedByName: null, pausedAt: null, reason: null };
  const messageLog = logState.ok
    ? logState.data
    : { rows: [], total: 0, failed: 0, queued: 0, templates: [] };
  // 0073: HR’s own wording where they have written some, the shipped default
  // where they have not. `listTemplates` reads both.
  const templatePreviews = await listTemplates();
  const schedule = await getEvaluationSchedule();
  // The whole-company salary sheet (asked for directly, alongside the roster
  // above) — its own query, since it needs every real salary_history row per
  // person rather than the roster's single "current figure".
  const historyGrid = await getEmploymentHistoryGrid();

  // P21 stored these and P23 finally renders the editor.
  const { data: incrementSettings } = await supabase
    .from("increment_settings")
    .select("hike_bands")
    .eq("id", true)
    .maybeSingle();
  const hikeBands = (incrementSettings?.hike_bands ?? [5, 10, 15]).map(Number);

  /* -- The signer's own signature. Read here rather than in the tab so the tab
        stays a client component with no query in it — and `.eq("id", …)` on
        their own row means an HR administrator opening Settings sees theirs,
        never somebody else's (§9). -- */
  const { data: me } = await supabase
    .from("profiles")
    .select("signature_image")
    .eq("id", profile.id)
    .maybeSingle();

  const [
    { data: profiles },
    { data: departments },
    { data: roleRows },
    { data: employment },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, full_name, email, employee_code, track, phone_e164, work_email, work_phone_e164, designation, date_of_joining, department_id, reports_to, co_reviewer_id, is_active, departments(name)",
      )
      .order("full_name"),
    supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
    supabase.from("user_roles").select("profile_id, role"),
    // §5 salary confinement: HR and the MD only. This page is already guarded to
    // exactly those two roles, and RLS refuses the read for anybody else — so a
    // guard bug cannot surface a figure that the policy would have withheld.
    supabase
      .from("employment_records")
      .select(
        "profile_id, employment_type, confirmation_date, current_ctc, joining_ctc, last_increment_date, next_increment_date, increment_frequency_months",
      ),
  ]);

  const rolesByProfile = new Map<string, PersonRow["roles"]>();
  for (const row of roleRows ?? []) {
    rolesByProfile.set(row.profile_id, [...(rolesByProfile.get(row.profile_id) ?? []), row.role]);
  }

  const employmentByProfile = new Map(
    (employment ?? []).map((row) => [row.profile_id, row] as const),
  );

  // Who reports to whom, resolved to a name here rather than on the client: the
  // row already holds the id, and a second round trip per row to turn it into a
  // name is how a list of forty people becomes forty queries.
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name] as const));

  const people: PersonRow[] = (profiles ?? []).map((p) => {
    // PostgREST returns an embedded to-one as an object; normalise defensively
    // so a shape change cannot crash the page.
    const dept = p.departments as unknown;
    const name = Array.isArray(dept)
      ? ((dept[0] as { name?: string } | undefined)?.name ?? null)
      : ((dept as { name?: string } | null)?.name ?? null);

    const job = employmentByProfile.get(p.id);

    return {
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      employee_code: p.employee_code,
      track: p.track,
      phone_e164: p.phone_e164,
      work_email: p.work_email,
      work_phone_e164: p.work_phone_e164,
      designation: p.designation,
      date_of_joining: p.date_of_joining,
      department: name,
      department_id: p.department_id,
      reports_to: p.reports_to,
      reports_to_name: p.reports_to ? (nameById.get(p.reports_to) ?? null) : null,
      co_reviewer_id: p.co_reviewer_id,
      employment_type: job?.employment_type ?? null,
      confirmation_date: job?.confirmation_date ?? null,
      current_ctc: job?.current_ctc ?? null,
      joining_ctc: job?.joining_ctc ?? null,
      last_increment_date: job?.last_increment_date ?? null,
      next_increment_date: job?.next_increment_date ?? null,
      increment_frequency_months: job?.increment_frequency_months ?? null,
      roles: rolesByProfile.get(p.id) ?? [],
      is_active: p.is_active,
    };
  });

  const departmentOptions: DepartmentOption[] = (departments ?? []).map((d) => ({
    id: d.id,
    name: d.name,
  }));

  /* -- The Departments tab. It was its own sidebar entry called "Departments &
        Form Builder", a name that promised a builder it did not contain. The
        list itself is unchanged and the client component is reused as-is —
        only where you reach it moved. -- */
  const [{ data: allDepartments }, { data: deptPeople }, { data: deptMappings }] = await Promise.all([
    supabase.from("departments").select("id, name, code, description, is_active").order("name"),
    supabase.from("profiles").select("department_id").eq("is_active", true),
    // Only ACTIVE questions count: a department whose only mapped question has
    // been retired is as unlaunchable as one with none.
    supabase.from("department_questions").select("department_id, questions!inner(is_active)"),
  ]);

  const deptHeadcount = new Map<string, number>();
  for (const person of deptPeople ?? []) {
    if (!person.department_id) continue;
    deptHeadcount.set(person.department_id, (deptHeadcount.get(person.department_id) ?? 0) + 1);
  }

  const deptQuestionCount = new Map<string, number>();
  for (const mapping of deptMappings ?? []) {
    const question = mapping.questions as unknown;
    const isActive = Array.isArray(question)
      ? ((question[0] as { is_active?: boolean } | undefined)?.is_active ?? false)
      : ((question as { is_active?: boolean } | null)?.is_active ?? false);
    if (!isActive) continue;
    deptQuestionCount.set(
      mapping.department_id,
      (deptQuestionCount.get(mapping.department_id) ?? 0) + 1,
    );
  }

  const departmentRows: DepartmentRow[] = (allDepartments ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    code: d.code,
    description: d.description,
    is_active: d.is_active,
    headcount: deptHeadcount.get(d.id) ?? 0,
    questionCount: deptQuestionCount.get(d.id) ?? 0,
  }));

  /* -- The Team review tab. Its own queries, kept apart from the ones above —
        the same call Departments already makes (`allDepartments` does not
        reuse the Users tab's `departments`): this list is read for a different
        shape than the roster editor's, and the department name lookup here
        deliberately carries every department, retired ones included, so
        somebody assigned to one still shows a name instead of a blank. This
        was ONE CYCLE FRAMING THE SCREEN in its own right (`/admin/people`'s own
        history explains why: an Evaluation round and an Increment round are two
        different exercises, and §11 keeps a score inside the cycle it was given
        in, so this switches between them rather than averaging both). -- */
  const { data: allTeamCycles } = await supabase
    .from("evaluation_cycles")
    .select("id, name, period_label, status")
    .in("status", ["ACTIVE", "CLOSED"])
    .is("deleted_at", null)
    .order("starts_on", { ascending: false });

  const teamCycles = allTeamCycles ?? [];
  const teamCycle =
    (params.cycle ? teamCycles.find((c) => c.id === params.cycle) : null) ?? teamCycles[0] ?? null;

  const [{ data: teamPeople }, { data: teamDepartments }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, full_name, employee_code, designation, department_id, reports_to, co_reviewer_id, is_active, track",
      )
      .order("full_name"),
    supabase.from("departments").select("id, name").order("name"),
  ]);

  // Every read here goes through the AUTHENTICATED client, so RLS decides what
  // this person may see (§9) — the role guard above is the clean exit, not the
  // protection (P16-9).
  const { data: teamEvaluations } = teamCycle
    ? await supabase
        .from("evaluations")
        .select("id, evaluatee_id, status, self_overall, lead_overall, final_overall, excluded_at")
        .eq("cycle_id", teamCycle.id)
    : { data: [] };

  const teamEvaluationIds = (teamEvaluations ?? []).map((e) => e.id);
  const [teamManagerOveralls, teamCoReviewerScores] = await Promise.all([
    managerOverallByEvaluation(supabase, teamEvaluationIds),
    // The second reviewer's OWN figure, never blended into the HOD column —
    // a second query rather than reaching into the blended one above, because
    // that one's whole job is to throw the per-layer breakdown away.
    coReviewerScoreByEvaluation(supabase, teamEvaluationIds),
  ]);

  const teamDepartmentName = new Map((teamDepartments ?? []).map((d) => [d.id, d.name]));
  const teamLeadName = new Map((teamPeople ?? []).map((p) => [p.id, p.full_name]));
  const teamByPerson = new Map((teamEvaluations ?? []).map((e) => [e.evaluatee_id, e]));

  const teamRows: TeamReviewRow[] = (teamPeople ?? []).map((p) => {
    const evaluation = teamByPerson.get(p.id) ?? null;
    return {
      id: p.id,
      fullName: p.full_name,
      employeeCode: p.employee_code,
      designation: p.designation,
      departmentName: p.department_id ? (teamDepartmentName.get(p.department_id) ?? null) : null,
      leadName: p.reports_to ? (teamLeadName.get(p.reports_to) ?? null) : null,
      // Reuses teamLeadName (id -> full_name over every profile) rather than a
      // second lookup — a second reviewer is a profile like any other, and the
      // map already has everybody in it.
      coReviewerName: p.co_reviewer_id ? (teamLeadName.get(p.co_reviewer_id) ?? null) : null,
      isActive: p.is_active,
      track: p.track,
      // A withdrawn participant (P10-6) is not "in progress" — the
      // organisation stopped asking. Reporting it as a status would put them
      // in the chase list for a form nobody is waiting on.
      status: evaluation?.excluded_at ? null : (evaluation?.status ?? null),
      excluded: Boolean(evaluation?.excluded_at),
      self: evaluation?.self_overall ?? null,
      // The MANAGER figure (0087), so a designer's column is both of theirs.
      lead: evaluation
        ? managerFigure(evaluation.id, evaluation.lead_overall, teamManagerOveralls)
        : null,
      // The second reviewer's OWN score, separate from the blended figure
      // above — null for anybody with no second reviewer.
      coReviewerScore: evaluation ? (teamCoReviewerScores.get(evaluation.id) ?? null) : null,
      final: evaluation?.final_overall ?? null,
    };
  });

  return (
    /* -- FULL BLEED ON THE PAGE, not on three of its eight tabs.
          `data-full-bleed` drops the shell's 1180px cap and its gutters, and it
          was carried by Users, Salary history and Team review — the three that
          hold a grid — while General, Evaluation periods, Messages, Departments
          and Recycle bin sat in the centred column. Since `TabsContent` unmounts
          the inactive panel, the attribute appeared and disappeared as somebody
          switched tabs: the page changed width under them and the TAB STRIP
          ITSELF jumped from flush-left to a 240px indent, which is what was
          reported as "some sub screens are utilising full screen and some are
          centred". The chrome is the one part of a tabbed screen that must not
          move when the tab does.

          Held here so it is true of every tab, at the owner's instruction to
          make them all match Users. The three grid tabs keep their own
          `data-full-bleed` — nested, redundant and harmless — because each is
          also reachable in its own right, and a panel that only lays out
          correctly inside this page would be a trap for the next caller.
          The five that had been relying on the shell's gutters get that padding
          back explicitly below (`PANEL`), so dropping it here cannot leave their
          content against the edge of the screen. -- */
    <Tabs defaultValue={activeTab} data-full-bleed className="space-y-6">
      {/* -- THE STRIP SCROLLS; THE PAGE DOES NOT.
            Eight tabs in an `inline-flex` that neither wraps nor scrolls is
            about 900px of tab — so on a phone it was the widest thing on the
            page and the DOCUMENT scrolled sideways to fit it. That is what was
            reported as "grids moving and data not visible": nothing was wrong
            with the grid. The page itself was scrolled right, so the topbar
            shifted, the tab strip started mid-way through, and every row label
            in the list sat off the left edge with only its value showing.

            `overflow-x-auto` moves that scroll inside the strip, where it
            belongs and where it is the normal way to reach a ninth tab.
            `justify-start` because the primitive centres its children, which
            with a scroller would park the strip mid-list rather than at the
            first tab. Each trigger gets `shrink-0` so they scroll at full size
            instead of being crushed into unreadable slivers. -- */}
      <TabsList
        className={cn(
          "flex max-w-full justify-start overflow-x-auto bg-surface-mute",
          /* The strip sits where the Users tab's toolbar sits, so the left edge
             of the chrome is one line down the whole screen. */
          "mx-3 lg:mx-6",
        )}
      >
        <TabsTrigger value="general" className="shrink-0 font-sans text-body">
          General
        </TabsTrigger>
        <TabsTrigger value="users" className="shrink-0 font-sans text-body">
          Users
        </TabsTrigger>
        <TabsTrigger value="salary-history" className="shrink-0 font-sans text-body">
          Salary history
        </TabsTrigger>
        <TabsTrigger value="periods" className="shrink-0 font-sans text-body">
          Evaluation periods
        </TabsTrigger>
        <TabsTrigger value="messages" className="shrink-0 font-sans text-body">
          Messages
        </TabsTrigger>
        <TabsTrigger value="departments" className="shrink-0 font-sans text-body">
          Departments
        </TabsTrigger>
        {/* -- MOVED IN FROM THE SIDEBAR, at the owner's instruction, beside
              Recycle bin: both are "look at what exists today" screens, the
              same reasoning that put Departments beside Users. -- */}
        <TabsTrigger value="team-review" className="shrink-0 font-sans text-body">
          Team review
        </TabsTrigger>
        <TabsTrigger value="recycle-bin" className="shrink-0 font-sans text-body">
          Recycle bin
        </TabsTrigger>
      </TabsList>

      {/* 0076: how everybody's review dates are worked out. HR writes it, the
          MD reads it — the tab renders for both and `save_evaluation_schedule`
          re-checks `is_hr()` in SQL, because a rendered form is not a permission. */}
      <TabsContent value="periods" className={PANEL}>
        <ScheduleTab schedule={schedule} />
      </TabsContent>

      <TabsContent value="general" className={PANEL}>
        <GeneralTab
          hikeBands={hikeBands}
          signature={me?.signature_image ?? null}
          canSign={roles.includes("MD")}
        />
      </TabsContent>

      <TabsContent value="users">
        <UsersTab
          people={people}
          departments={departmentOptions}
          currentProfileId={profile.id}
          /* `?find=` seeds the roster search, so a link from another screen
             lands on the one person it is about. */
          initialSearch={params.find}
        />
      </TabsContent>

      <TabsContent value="departments" className={PANEL}>
        <DepartmentsClient departments={departmentRows} />
      </TabsContent>

      {/* -- ASKED FOR DIRECTLY: the roster shows one "Current salary" per
            person because it is a roster, not a ledger, and a fixed set of
            columns cannot hold history that keeps growing. This is the whole
            company's salary_history, one sheet, columns growing sideways as
            increments happen. -- */}
      <TabsContent value="salary-history">
        {historyGrid.ok ? (
          <SalaryHistoryTab rows={historyGrid.data.rows} />
        ) : (
          <p className="text-body-sm text-critical">{historyGrid.error.message}</p>
        )}
      </TabsContent>

      {/* The staff roster, and the way into a scorecard. Its own tab rather
          than folded into Users: Users edits who exists, this reads how they
          are doing — two different jobs that happen to share a table. */}
      <TabsContent value="team-review">
        <PeopleClient
          rows={teamRows}
          departments={(teamDepartments ?? []).map((d) => d.name)}
          cycleLabel={teamCycle ? `${teamCycle.name} · ${teamCycle.period_label}` : null}
          cycles={teamCycles.map((c) => ({ id: c.id, name: c.name, periodLabel: c.period_label }))}
          cycleId={teamCycle?.id ?? null}
        />
      </TabsContent>

      {/* 0032: deleting a cycle marks the row rather than removing it, because
          §5 does not permit destroying the frozen question sets it contains. */}
      <TabsContent value="recycle-bin" className={PANEL}>
        <RecycleBinTab cycles={binnedCycles} />
        {/* Their own section, not merged into the table above: §7 keeps the two
            modules from sharing a function, and a merged list would need one
            restore that branches on which module a row came from. */}
        <BinnedRounds rounds={binnedRounds} />
      </TabsContent>

      {/* P23: the pause switch, the message log and the wording preview. The
          engine has existed since P17; until now nothing rendered it, so
          silencing every outbound message meant a SQL console. */}
      <TabsContent value="messages" className={PANEL}>
        <NotificationsTab state={outbound} log={messageLog} templates={templatePreviews} />
      </TabsContent>
    </Tabs>
  );
}

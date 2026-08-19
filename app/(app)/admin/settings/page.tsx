/** /admin/settings — General and Users. */

import type { Metadata } from "next";

import {
  DepartmentsClient,
  type DepartmentRow,
} from "@/app/(app)/admin/departments/departments-client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScheduleTab } from "@/app/(app)/admin/settings/schedule-tab";
import { getEvaluationSchedule } from "@/lib/due/schedule";
import {
  UsersTab,
  type DepartmentOption,
  type PersonRow,
} from "@/app/(app)/admin/settings/users-tab";
import { GeneralTab } from "@/app/(app)/admin/settings/general-tab";
import { NotificationsTab } from "@/app/(app)/admin/settings/notifications-tab";
import { BinnedRounds } from "@/app/(app)/admin/settings/binned-rounds";
import { RecycleBinTab } from "@/app/(app)/admin/settings/recycle-bin-tab";
import { listBinnedCycles } from "@/lib/cycles/queries";
import { getMessageLog, getOutboundState } from "@/lib/notify/settings";
import { listTemplates } from "@/lib/notify/template-actions";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

const TABS = ["general", "users", "departments", "messages", "recycle-bin"] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; find?: string }> }) {
  // §9: the guard is the first statement. A non-HR user is redirected before
  // any markup is produced, never shown and then hidden.
  const { profile } = await requireRole(ADMIN_ROLES);

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
  const binnedRounds = binnedRoundRows.data ?? [];
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

  return (
    <Tabs defaultValue={activeTab} className="space-y-6">
      <TabsList className="bg-surface-mute">
        <TabsTrigger value="general" className="font-sans text-body">
          General
        </TabsTrigger>
        <TabsTrigger value="users" className="font-sans text-body">
          Users
        </TabsTrigger>
        <TabsTrigger value="periods" className="font-sans text-body">
          Evaluation periods
        </TabsTrigger>
        <TabsTrigger value="messages" className="font-sans text-body">
          Messages
        </TabsTrigger>
        <TabsTrigger value="departments" className="font-sans text-body">
          Departments
        </TabsTrigger>
        <TabsTrigger value="recycle-bin" className="font-sans text-body">
          Recycle bin
        </TabsTrigger>
      </TabsList>

      {/* 0076: how everybody's review dates are worked out. HR writes it, the
          MD reads it — the tab renders for both and `save_evaluation_schedule`
          re-checks `is_hr()` in SQL, because a rendered form is not a permission. */}
      <TabsContent value="periods">
        <ScheduleTab schedule={schedule} />
      </TabsContent>

      <TabsContent value="general">
        <GeneralTab hikeBands={hikeBands} signature={me?.signature_image ?? null} />
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

      <TabsContent value="departments">
        <DepartmentsClient departments={departmentRows} />
      </TabsContent>

      {/* 0032: deleting a cycle marks the row rather than removing it, because
          §5 does not permit destroying the frozen question sets it contains. */}
      <TabsContent value="recycle-bin">
        <RecycleBinTab cycles={binnedCycles} />
        {/* Their own section, not merged into the table above: §7 keeps the two
            modules from sharing a function, and a merged list would need one
            restore that branches on which module a row came from. */}
        <BinnedRounds rounds={binnedRounds} />
      </TabsContent>

      {/* P23: the pause switch, the message log and the wording preview. The
          engine has existed since P17; until now nothing rendered it, so
          silencing every outbound message meant a SQL console. */}
      <TabsContent value="messages">
        <NotificationsTab state={outbound} log={messageLog} templates={templatePreviews} />
      </TabsContent>
    </Tabs>
  );
}

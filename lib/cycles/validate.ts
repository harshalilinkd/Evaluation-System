/** The launch readiness report. P10 guard list. CLAUDE.md §5, §8. */

import "server-only";

import { cycleError, plural, today, type CycleResult, type ReadinessIssue, type ReadinessReport } from "@/lib/cycles/schema";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

/** One participant, flattened from the DRAFT evaluation and their profile. */
export type ParticipantSnapshot = {
  evaluationId: string;
  profileId: string;
  name: string;
  employeeCode: string | null;
  designation: string | null;
  departmentId: string | null;
  departmentName: string | null;
  leadId: string | null;
  leadName: string | null;
  track: Enums<"track_type">;
  isActive: boolean;
  email: string | null;
  phone: string | null;
  /** The HOD's own contact details — they are a recipient now (item 9). */
  leadEmail: string | null;
  leadPhone: string | null;
};

/**
 * The live participant list for a cycle.
 *
 * Participants ARE draft evaluations. §8's first transition is
 * DRAFT -> CYCLE_ACTIVE, which means the evaluation row must already exist
 * before launch — so there is no separate participants table, and the roster HR
 * builds in step 3 of the wizard is literally the set of rows that will be
 * transitioned. That removes the whole class of bug where the roster and the
 * evaluations drift apart between building and launching.
 *
 * `excluded_at is null` everywhere: a withdrawn person keeps their row (§5) but
 * is no longer part of the cycle.
 */
export async function loadCycleParticipants(
  cycleId: string,
): Promise<CycleResult<ParticipantSnapshot[]>> {
  const supabase = await createClient();

  const { data: evaluations, error } = await supabase
    .from("evaluations")
    .select("id, evaluatee_id, lead_id, department_id, track, status, excluded_at")
    .eq("cycle_id", cycleId)
    .is("excluded_at", null);

  if (error) return cycleError("QUERY_FAILED", `Could not read participants: ${error.message}`);
  if (!evaluations || evaluations.length === 0) return { ok: true, data: [] };

  // Both the evaluatees and the leads, in one round trip. Read separately from
  // the evaluations rather than as an embedded join because evaluations has two
  // foreign keys into profiles, and a select string that has to disambiguate
  // them is one typo away from silently resolving the wrong one.
  const profileIds = new Set<string>();
  for (const row of evaluations) {
    profileIds.add(row.evaluatee_id);
    if (row.lead_id) profileIds.add(row.lead_id);
  }

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, employee_code, designation, department_id, track, is_active, email, phone_e164")
    .in("id", [...profileIds]);

  if (profileError) {
    return cycleError("QUERY_FAILED", `Could not read people: ${profileError.message}`);
  }

  const { data: departments, error: departmentError } = await supabase
    .from("departments")
    .select("id, name");

  if (departmentError) {
    return cycleError("QUERY_FAILED", `Could not read departments: ${departmentError.message}`);
  }

  const byProfile = new Map((profiles ?? []).map((p) => [p.id, p]));
  const byDepartment = new Map((departments ?? []).map((d) => [d.id, d.name]));

  const out: ParticipantSnapshot[] = [];
  for (const row of evaluations) {
    const person = byProfile.get(row.evaluatee_id);
    if (!person) continue; // a profile deleted under us; the guards below catch it

    out.push({
      evaluationId: row.id,
      profileId: row.evaluatee_id,
      name: person.full_name,
      employeeCode: person.employee_code,
      designation: person.designation,
      // From the evaluation, not the profile: 0003 copies department_id at
      // creation precisely so a transfer mid-cycle does not retroactively move
      // the appraisal to another department.
      departmentId: row.department_id,
      departmentName: row.department_id ? (byDepartment.get(row.department_id) ?? null) : null,
      leadId: row.lead_id,
      leadName: row.lead_id ? (byProfile.get(row.lead_id)?.full_name ?? null) : null,
      track: row.track,
      isActive: person.is_active,
      email: person.email,
      phone: person.phone_e164,
      // The HOD's own details. They receive a form at launch now, so "can this
      // person be reached" is asked of both sides (item 9).
      leadEmail: row.lead_id ? (byProfile.get(row.lead_id)?.email ?? null) : null,
      leadPhone: row.lead_id ? (byProfile.get(row.lead_id)?.phone_e164 ?? null) : null,
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, data: out };
}

/**
 * Which departments have at least one active Job Specific Skills question.
 *
 * Counted from department_questions joined to questions rather than from the
 * mapping table alone: a mapping row pointing at a retired question is not a
 * question anybody will be asked, and launching on the strength of one would
 * freeze a snapshot that is missing the whole section.
 */
export async function jobSkillCountsByDepartment(): Promise<CycleResult<Map<string, number>>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("department_questions")
    .select("department_id, questions!inner(id, is_active, section)")
    .eq("questions.is_active", true)
    .eq("questions.section", "DEPARTMENT_SPECIFIC");

  if (error) {
    return cycleError("QUERY_FAILED", `Could not read Job Specific Skills mappings: ${error.message}`);
  }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.department_id, (counts.get(row.department_id) ?? 0) + 1);
  }
  return { ok: true, data: counts };
}

/* ---------- The report ---------- */

/**
 * P10's guard list, evaluated against the database.
 *
 * Called twice on every launch: once by the wizard to render step 4, and again
 * inside launchCycle before anything is written. The second call is the one
 * that matters — the first is a courtesy. Between HR reading step 4 and
 * pressing the button, somebody can retire the last question in a department or
 * deactivate an employee, and only a server-side re-check catches that.
 *
 * Blocking issues stop the launch. Warnings are real situations that HR may
 * legitimately intend, so they are shown and acknowledged rather than fixed —
 * a system that refuses to launch because a department head leads themselves is
 * a system HR works around.
 */
export async function buildReadinessReport(cycleId: string): Promise<CycleResult<ReadinessReport>> {
  const supabase = await createClient();

  const { data: cycle, error: cycleErrorRow } = await supabase
    .from("evaluation_cycles")
    .select("id, name, status, starts_on, self_due_on, lead_due_on, md_due_on, track_scope")
    .eq("id", cycleId)
    .maybeSingle();

  if (cycleErrorRow) return cycleError("QUERY_FAILED", `Could not read cycle: ${cycleErrorRow.message}`);
  if (!cycle) return cycleError("CYCLE_NOT_FOUND", "That cycle no longer exists.");

  const participantsResult = await loadCycleParticipants(cycleId);
  if (!participantsResult.ok) return participantsResult;
  const participants = participantsResult.data;

  const skillCounts = await jobSkillCountsByDepartment();
  if (!skillCounts.ok) return skillCounts;

  const blocking: ReadinessIssue[] = [];
  const warnings: ReadinessIssue[] = [];

  /* -- 3. Zero participants. Listed first: it makes the rest moot. -- */
  if (participants.length === 0) {
    blocking.push({
      code: "NO_PARTICIPANTS",
      message: "This cycle has nobody in it. Add people before launching.",
      subjects: [],
      href: `/admin/cycles/${cycleId}/edit`,
      hrefLabel: "Add people",
    });
  }

  /* -- 1. No lead assigned. -- */
  const leaderless = participants.filter((p) => !p.leadId);
  if (leaderless.length > 0) {
    blocking.push({
      code: "NO_LEAD",
      message: `${plural(leaderless.length, "person")} ${leaderless.length === 1 ? "has" : "have"} no lead assigned.`,
      subjects: leaderless.map((p) => p.name),
      href: `/admin/cycles/${cycleId}/edit`,
      hrefLabel: "Assign leads",
    });
  }

  /* -- 5. Inactive, or on the WORKER track. -- */
  const inactive = participants.filter((p) => !p.isActive);
  if (inactive.length > 0) {
    blocking.push({
      code: "INACTIVE_PARTICIPANT",
      message: `${plural(inactive.length, "person")} in this cycle ${inactive.length === 1 ? "is" : "are"} no longer active.`,
      subjects: inactive.map((p) => p.name),
      href: `/admin/cycles/${cycleId}/edit`,
      hrefLabel: "Remove them",
    });
  }

  // §5 module boundary: "Never write a WORKER row into a core evaluation
  // table." The UI has no track selector at all, so reaching this means a
  // profile's track changed after they were added — worth naming rather than
  // silently dropping them.
  const workers = participants.filter((p) => p.track !== "STAFF");
  if (workers.length > 0) {
    blocking.push({
      code: "WORKER_IN_STAFF_CYCLE",
      message: `${plural(workers.length, "person")} ${workers.length === 1 ? "is" : "are"} on the worker track. Workers are appraised in their own module.`,
      subjects: workers.map((p) => p.name),
      href: `/admin/cycles/${cycleId}/edit`,
      hrefLabel: "Remove them",
    });
  }

  /* -- 2. A department with no Job Specific Skills questions. -- */
  //
  // Per department rather than per person, so twelve people in Accounts produce
  // one issue naming Accounts rather than twelve naming individuals who have
  // done nothing wrong.
  const departmentsInCycle = new Map<string, string>();
  for (const p of participants) {
    if (p.departmentId) departmentsInCycle.set(p.departmentId, p.departmentName ?? "Unnamed department");
  }

  const unmapped = [...departmentsInCycle.entries()].filter(
    ([id]) => (skillCounts.data.get(id) ?? 0) === 0,
  );

  for (const [departmentId, departmentName] of unmapped) {
    const affected = participants.filter((p) => p.departmentId === departmentId);
    blocking.push({
      code: "DEPARTMENT_NOT_MAPPED",
      // Named, per the acceptance criterion: "the message names the department".
      message: `${departmentName} has no Job Specific Skills questions, so its ${plural(affected.length, "person")} cannot be launched.`,
      subjects: affected.map((p) => p.name),
      href: `/admin/departments/${departmentId}`,
      hrefLabel: `Map questions for ${departmentName}`,
    });
  }

  /* -- 3. Nobody at all in a department. --
        The check above is keyed on `departmentId`, so somebody who has NONE
        falls straight through it — neither blocked nor warned. Their form
        would launch with the Job Specific Skills section EMPTY, which is the
        precise failure P9-7 exists to prevent, arrived at from the one
        direction that check does not cover.

        §1 makes that section the defining idea of the form: every employee
        answers the same questions except this one part, which is mapped to
        their department. A participant with no department is not a person
        with a thin form; it is a person the form cannot be assembled for. -- */
  const departmentless = participants.filter((p) => !p.departmentId);
  if (departmentless.length > 0) {
    blocking.push({
      code: "PERSON_HAS_NO_DEPARTMENT",
      message: `${plural(departmentless.length, "person")} ${
        departmentless.length === 1 ? "has" : "have"
      } no department, so there are no Job Specific Skills questions to ask them.`,
      subjects: departmentless.map((p) => p.name),
      href: `/admin/settings?tab=users`,
      hrefLabel: "Set their department",
    });
  }

  /* -- 4. Dates. -- */
  const dateIssues: string[] = [];
  if (!cycle.starts_on || !cycle.self_due_on || !cycle.lead_due_on || !cycle.md_due_on) {
    dateIssues.push("All four dates must be set.");
  } else {
    if (cycle.self_due_on < cycle.starts_on) dateIssues.push("The employee deadline is before the cycle opens.");
    if (cycle.lead_due_on < cycle.self_due_on) dateIssues.push("The lead deadline is before the employee deadline.");
    if (cycle.md_due_on < cycle.lead_due_on) dateIssues.push("The MD deadline is before the lead deadline.");
    if (cycle.self_due_on < today()) dateIssues.push("The employee deadline has already passed.");
  }

  if (dateIssues.length > 0) {
    blocking.push({
      code: "DATES_INVALID",
      message: "The dates do not work.",
      subjects: dateIssues,
      href: `/admin/cycles/${cycleId}/edit`,
      hrefLabel: "Fix the dates",
    });
  }

  /* -- 6. A lead with more than 12 people. -- */
  const perLead = new Map<string, { name: string; count: number }>();
  for (const p of participants) {
    if (!p.leadId) continue;
    const entry = perLead.get(p.leadId) ?? { name: p.leadName ?? "A lead", count: 0 };
    entry.count += 1;
    perLead.set(p.leadId, entry);
  }

  /* -- THE APP-URL WARNING WAS HERE AND IS REMOVED, at the owner's instruction.
        Recorded rather than deleted silently, because it was doing a real job
        and somebody will wonder where it went.

        P28 added it: `absoluteUrl` refuses to build a link with no reachable
        site in front of it, and before this warning existed that refusal
        arrived as a runtime error thrown AFTER the launch had committed — HR
        saw a crash on a cycle that was in fact live. It also caught the quieter
        case: an invite built on a localhost address sends, `notifications_log`
        says Sent, and the message arrives as plain text no phone can open.

        WHAT IT COST: it fires on every launch from a development machine, where
        `NEXT_PUBLIC_APP_URL` is localhost by definition and the warning is
        never news. In production it is self-suppressing — a deployed app has a
        real address and it never appeared.

        WHAT IS NOT LOST: the guard that matters is untouched.
        `sendEvaluationLink` still refuses to send with an unreachable URL
        (P28-1), and `dispatchLaunchInvites` still cannot throw (PW-2, PR-11) —
        it returns `blocked` and the launch confirmation states it. So a bad URL
        still cannot produce a link that opens nothing; it is simply reported
        when somebody tries to send rather than before they launch. */

  const overloaded = [...perLead.values()].filter((l) => l.count > 12);
  if (overloaded.length > 0) {
    warnings.push({
      code: "LEAD_OVERLOADED",
      message: "Some leads are reviewing a lot of people. Reviews tend to arrive late, or thin.",
      subjects: overloaded.map((l) => `${l.name} — ${plural(l.count, "review")}`),
      href: `/admin/cycles/${cycleId}/edit`,
      hrefLabel: "Rebalance",
    });
  }

  /* -- 7. Their own HOD — now a BLOCK (item 10). -- */
  //
  // P10-7 dropped the database constraint precisely so this case could be
  // REACHED and named rather than failing as a raw constraint violation. Under
  // AMEND-3 it is no longer merely odd: a person who is their own HOD fills
  // both sides and sees both, which breaks §5's blindness invariant outright.
  const selfLed = participants.filter((p) => p.leadId && p.leadId === p.profileId);
  if (selfLed.length > 0) {
    blocking.push({
      code: "SELF_LED",
      message:
        "Some people are recorded as their own Manager. Under blind rating nobody can rate themselves — assign a different rater.",
      subjects: selfLed.map((p) => p.name),
      href: `/admin/cycles/${cycleId}/edit`,
      hrefLabel: "Assign a rater",
    });
  }

  /* -- 8. No way to reach them. -- */
  //
  // §10 sends the invite over WhatsApp and/or email. Somebody with neither
  // still gets a valid evaluation — HR can hand them the link — but nothing
  // will reach them automatically, and finding that out on the due date is too
  // late.
  /* -- 8. No way to reach them — now BLOCKING for both sides (item 11). -- */
  //
  // It was a warning while only the employee received a link at launch and HR
  // could hand it over. Both people are recipients now, and a HOD who cannot
  // receive their form cannot rate at all — so the cycle would launch into a
  // half-answered state nobody notices until the due date.
  const unreachable = participants.filter((p) => !p.email && !p.phone);
  if (unreachable.length > 0) {
    blocking.push({
      code: "NO_CONTACT",
      message: "Some employees have neither an email address nor a phone number, so no link can be sent to them.",
      subjects: unreachable.map((p) => p.name),
      href: "/admin/settings?tab=users",
      hrefLabel: "Add contact details",
    });
  }

  const leadUnreachable = participants.filter(
    (p) => p.leadId && p.leadId !== p.profileId && !p.leadEmail && !p.leadPhone,
  );
  if (leadUnreachable.length > 0) {
    blocking.push({
      code: "NO_LEAD_CONTACT",
      message:
        "Some HODs have neither an email address nor a phone number, so their half of the form cannot reach them.",
      subjects: [...new Set(leadUnreachable.map((p) => p.leadName ?? "Unknown"))],
      href: "/admin/settings?tab=users",
      hrefLabel: "Add contact details",
    });
  }

  return {
    ok: true,
    data: {
      cycleId,
      participantCount: participants.length,
      blocking,
      warnings,
      canLaunch: blocking.length === 0,
    },
  };
}

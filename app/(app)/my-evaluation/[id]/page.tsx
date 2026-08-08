/** /my-evaluation/[id] — where an invite link lands. Scoped to that one evaluation. */

import type { Metadata } from "next";

import { OutcomeCard } from "@/app/(app)/my-evaluation/[id]/outcome-card";
import { getEmployeeOutcome } from "@/lib/increment/queries";
import { SelfForm, type SelfFormMeta } from "@/app/(app)/my-evaluation/[id]/self-form";
import { ErrorState } from "@/components/appraise/states";
import { requireEvaluationAccess } from "@/lib/auth/guards";
import { getEvaluationForm } from "@/lib/forms/get-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My Evaluation" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // §10: an invite grants exactly one evaluation. This guard is what makes that
  // true after sign-in — the token is spent by now and confers nothing, so
  // access is re-derived from who the person is. Someone who signed in through
  // a link and then edits the id in the address bar is redirected, not shown
  // another employee's appraisal.
  const { evaluation, profile } = await requireEvaluationAccess(id, "self");

  // The frozen snapshot (§5), filtered to the SELF layer. Never the live bank:
  // reading that would show questions the employee was never asked the moment
  // HR edits one.
  const supabase = await createClient();

  /* -- Everything the page needs, ISSUED TOGETHER.
        These ran one after another and each paid a full round trip before the
        next was sent — eight of them, on the screen most of the company sees
        first. Not one depends on what another returns: they are all keyed by
        the evaluation, the cycle or the person, and all three ids are already
        known from the guard above. RLS still judges every query on its own, so
        nothing here widens what anybody can read; only the waiting is shared.

        The department is the one genuine dependency (it needs `me`), so it
        stays behind — one round trip after this batch instead of seven. -- */
  const [form, { data: cycle }, { data: lead }, { data: me }, { data: returned }, outcome] =
    await Promise.all([
      // The frozen snapshot (§5), filtered to the SELF layer. Never the live
      // bank: reading that would show questions the employee was never asked
      // the moment HR edits one.
      getEvaluationForm(id, "SELF"),

      supabase
        .from("evaluation_cycles")
        // cycle_type decides whether the salary block belongs on this form at
        // all. Read here rather than inferred from the questions: a cycle with
        // the expectation question retired is still an increment cycle.
        .select("name, period_label, self_due_on, cycle_type")
        .eq("id", evaluation.cycle_id)
        .maybeSingle(),

      evaluation.lead_id
        ? supabase.from("profiles").select("full_name").eq("id", evaluation.lead_id).maybeSingle()
        : Promise.resolve({ data: null }),

      supabase
        .from("profiles")
        .select("designation, department_id")
        .eq("id", profile.id)
        .maybeSingle(),

      /* -- Was this returned? --
            §8's return unlocks the SELF layer without leaving a status that
            says so, and the audit log is the only place the fact survives —
            which is exactly what §12 keeps it for.

            AMEND-3 renamed both ends of this move: a return is now
            PENDING_HR_REVIEW -> OPEN, and HR owns it. Filtering on the retired
            pair matched nothing, so the employee was never told WHY their form
            came back — the entire content of a return (§8 requires the reason). */
      supabase
        .from("audit_log")
        .select("reason, created_at")
        .eq("entity", "evaluation")
        .eq("entity_id", id)
        .eq("from_status", "PENDING_HR_REVIEW")
        .eq("to_status", "OPEN")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      /* -- P21: what they are told once it closes.
            §9 and the cycle's disclosure policy, and NO MORE. `getEmployeeOutcome`
            returns a shape that carries only what they may see — never the lead's
            ratings, never the gap, never HR's or the MD's remarks — so there is
            nothing here for a screen to render by mistake. -- */
      getEmployeeOutcome(id),
    ]);

  if (!form.ok) {
    return <ErrorState title="Could not load your form" body={form.error.message} />;
  }

  /* -- The department and, on an increment cycle only, what they are on now.
        Batched together: the department needs `me`, so this trip was happening
        anyway (FIX-8), and the salary rides along rather than adding a third.

        INCREMENT ONLY, deliberately. An ordinary evaluation has no salary
        conversation in it, and putting a CTC on that form would be showing a
        figure for no reason — §5 relaxed once, for one purpose, not generally.

        `v_my_current_salary` (0040) returns the caller's own row and one money
        column. It cannot return anybody else's, so this needs no filter and no
        check of its own. -- */
  const isIncrement = cycle?.cycle_type === "INCREMENT";

  const [{ data: dept }, { data: myPay }] = await Promise.all([
    me?.department_id
      ? supabase.from("departments").select("name").eq("id", me.department_id).maybeSingle()
      : Promise.resolve({ data: null }),
    isIncrement
      ? supabase.from("v_my_current_salary").select("current_ctc").maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const meta: SelfFormMeta = {
    evaluateeName: profile.full_name,
    leadName: lead?.full_name ?? null,
    departmentName: dept?.name ?? null,
    designation: me?.designation ?? null,
    cycleName: cycle?.name ?? "",
    periodLabel: cycle?.period_label ?? "",
    selfDueOn: cycle?.self_due_on ?? null,
    // Only shown while the form is open again — once resubmitted it is history.
    returnedReason: evaluation.status === "OPEN" ? (returned?.reason ?? null) : null,
    returnedAt: evaluation.status === "OPEN" ? (returned?.created_at ?? null) : null,
    // null on an evaluation cycle, and null when nobody has recorded a figure —
    // the form says which rather than printing a zero (§11: missing is not 0).
    currentCtc: myPay?.current_ctc ?? null,
    isIncrement,
  };

  return (
    <div className="space-y-6">
      {outcome.ok && outcome.data.completed ? <OutcomeCard outcome={outcome.data} /> : null}
      <SelfForm form={form.data} meta={meta} />
    </div>
  );
}

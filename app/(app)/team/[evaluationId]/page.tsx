/** /team/[evaluationId] — the lead's own rating. Blind: no self answers, ever. */

import type { Metadata } from "next";

import { ReviewScreen, type ReviewMeta } from "@/app/(app)/team/[evaluationId]/review-screen";
import { ErrorState } from "@/components/appraise/states";
import { requireEvaluationAccess } from "@/lib/auth/guards";
import { getEvaluationForm } from "@/lib/forms/get-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review" };

export default async function Page({ params }: { params: Promise<{ evaluationId: string }> }) {
  const { evaluationId } = await params;

  // "lead" means the lead named on THIS evaluation, not anybody holding the HOD
  // role. A lead who edits the id in the address bar to a colleague's report is
  // redirected with ?error=forbidden — and the row is read through the
  // authenticated client first, so one they cannot see is indistinguishable from
  // one that does not exist.
  //
  // It is also what makes a mid-cycle reassignment take effect immediately: the
  // check is against evaluations.lead_id, so the moment HR moves it the previous
  // lead loses the screen. Their draft stays on the LEAD layer untouched.
  const { evaluation, ...session } = await requireEvaluationAccess(evaluationId, "lead");

  /* -- AMEND-3: the LEAD form, and ONLY the LEAD form.
        This page used to load both layers and hand them to a paired renderer.
        It cannot any more, and not merely because the screen changed: 0021
        revoked the lead's SELF-layer read, so `getEvaluationForm(id, "SELF")`
        would come back empty for them now. Asking for it would be asking a
        question whose answer is guaranteed to be nothing.

        There is also no longer a "wait until the employee submits" gate. Both
        layers are open together (§8), so the lead can start the moment the
        cycle is launched — which is the whole point of rating in parallel. -- */
  /* -- WHICH manager form. The same person can be the reporting lead of one
        report and the SECOND reviewer of another, so this is decided per
        evaluation from who is signed in — never from a role, and never from
        anything the browser sent. `requireEvaluationAccess` has already refused
        anybody who is neither. -- */
  const layer = evaluation.co_lead_id === session.profile.id ? "LEAD_2" : "LEAD";

  const leadForm = await getEvaluationForm(evaluationId, layer);
  if (!leadForm.ok) {
    return <ErrorState title="Could not load this review" body={leadForm.error.message} />;
  }

  const supabase = await createClient();

  const [{ data: employee }, { data: cycle }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, employee_code, designation, department_id")
      .eq("id", evaluation.evaluatee_id)
      .maybeSingle(),
    supabase
      .from("evaluation_cycles")
      // cycle_type decides how the manager WALKS the form: an evaluation
      // cycle is a short sequence and gets the guided flow, the same as the
      // employee's side of it. Both sides of one form should not be two
      // different experiences of it.
      .select("name, period_label, lead_due_on, cycle_type")
      .eq("id", evaluation.cycle_id)
      .maybeSingle(),
  ]);

  const { data: department } = employee?.department_id
    ? await supabase.from("departments").select("name").eq("id", employee.department_id).maybeSingle()
    : { data: null };

  const fullName = employee?.full_name ?? "This employee";

  const meta: ReviewMeta = {
    evaluationId,
    employeeName: fullName,
    // The first name, for the one-line explanation under the header. A full
    // name there reads as a form field rather than as a sentence.
    employeeFirstName: fullName.split(/\s+/)[0] ?? "They",
    employeeCode: employee?.employee_code ?? null,
    designation: employee?.designation ?? null,
    departmentName: department?.name ?? null,
    periodLabel: cycle?.period_label ?? "",
    leadDueOn: cycle?.lead_due_on ?? null,
    isIncrement: cycle?.cycle_type === "INCREMENT",
    status: leadForm.data.evaluationStatus,
    // The LEAD layer's own timestamp — never the record's status, and never
    // anything about the other side. §8: a layer locks on its own submission.
    // THIS reviewer's own timestamp — never the record's status, never the
    // other manager's, and never anything about the employee. §8: a layer locks
    // on its own submission (A3-3).
    leadSubmittedAt:
      layer === "LEAD_2" ? evaluation.co_lead_submitted_at : evaluation.lead_submitted_at,
    isSecondReviewer: layer === "LEAD_2",
  };

  return <ReviewScreen form={leadForm.data} meta={meta} />;
}

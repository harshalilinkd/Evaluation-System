/** The worker ticks their own sheet on the supervisor's device. */

import type { Metadata } from "next";

import { HandoverSheet } from "@/app/(app)/worker-team/[evaluationId]/handover/handover-sheet";
import { ErrorState } from "@/components/appraise/states";
import { requireAuth } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Hand over the form" };

export default async function Page({ params }: { params: Promise<{ evaluationId: string }> }) {
  const session = await requireAuth();
  const { evaluationId } = await params;
  const supabase = await createClient();

  const { data: evaluation } = await supabase
    .from("worker_evaluations")
    .select("id, worker_id, supervisor_id, status, self_submitted_at, self_skipped")
    .eq("id", evaluationId)
    .maybeSingle();

  if (!evaluation) {
    return <ErrorState title="Not available" body="That appraisal is not available to you." />;
  }

  /* -- Checked here AND in the database. This page only decides what to draw;
        `submit_worker_self_handover` re-checks every one of these before it
        writes, because a screen is not a permission (§9). -- */
  if (evaluation.supervisor_id !== session.profile.id) {
    return (
      <ErrorState
        title="Not your team"
        body="Only this worker's own supervisor can hand them the form."
      />
    );
  }

  if (evaluation.self_submitted_at) {
    return (
      <ErrorState
        title="Already answered"
        body="This worker has given their answers. They cannot be changed, and you cannot see them — only HR and management read both sides."
      />
    );
  }

  if (evaluation.status !== "OPEN" || evaluation.self_skipped) {
    return <ErrorState title="Not open" body="This appraisal is no longer open for answers." />;
  }

  const [{ data: worker }, { data: snapshot }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", evaluation.worker_id).maybeSingle(),
    supabase
      .from("worker_evaluation_questions")
      .select("question_id, text, help_text, is_required, is_overall, sort_order")
      .eq("evaluation_id", evaluationId)
      .order("sort_order"),
  ]);

  return (
    <HandoverSheet
      evaluationId={evaluationId}
      workerName={worker?.full_name ?? "This worker"}
      /* -- The OVERALL quality is the supervisor's alone (§11), so it is not on
            the worker's sheet at all — not rendered and skipped, not rendered.
            No stored answers are passed either: there are none until they
            submit, and there is no draft to resume, so nothing the worker ticks
            can be read off this screen afterwards. -- */
      questions={(snapshot ?? [])
        .filter((q) => !q.is_overall)
        .map((q) => ({
          questionId: q.question_id,
          text: q.text,
          helpText: q.help_text,
          isRequired: q.is_required,
        }))}
    />
  );
}

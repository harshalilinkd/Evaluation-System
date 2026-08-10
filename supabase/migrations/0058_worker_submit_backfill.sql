-- 0058 · Repair sheets that were submitted before 0057 existed.
--
-- THE STUCK STATE. Until 0057, submitting a worker sheet wrote the answers
-- through RLS (which worked) and then stamped `supervisor_submitted_at` on
-- `worker_evaluations` from the submitter's session — which is HR-only, so it
-- matched no rows and reported success.
--
-- That leaves two rows disagreeing about the same fact:
--
--   worker_evaluation_responses.submitted_at   SET     → the sheet is locked
--   worker_evaluations.supervisor_submitted_at NULL    → the board says "Not yet"
--
-- And nothing can move it. The sheet is read-only, so it cannot be submitted
-- again; the board is waiting for a submission that has already happened. 0057
-- fixes every submission from now on and cannot reach the ones already in that
-- state.
--
-- The response row is the truthful one: somebody pressed Submit and their
-- answers were stored. This copies that fact onto the evaluation.
--
-- Idempotent, and safe whether or not 0057 has been applied — it only ever
-- fills a NULL from a non-null, so a second run changes nothing.

begin;

/* ---------- The worker's side ---------- */

update public.worker_evaluations e
   set self_submitted_at = r.submitted_at
  from public.worker_evaluation_responses r
 where r.evaluation_id = e.id
   and r.layer = 'SELF'
   and r.submitted_at is not null
   and e.self_submitted_at is null;

/* ---------- The supervisor's side, and §11's overall ---------- */
--
-- The overall tick is copied at the same time and from the same place 0057
-- reads it: the FROZEN sheet, never the live bank. An evaluation repaired here
-- must end up indistinguishable from one submitted after 0057, or the two
-- paths would disagree about what a finished appraisal looks like.

update public.worker_evaluations e
   set supervisor_submitted_at = r.submitted_at,
       overall_tick = coalesce(
         e.overall_tick,
         (
           select r.answers ->> q.question_id::text
             from public.worker_evaluation_questions q
            where q.evaluation_id = e.id
              and q.is_overall
            limit 1
         )
       )
  from public.worker_evaluation_responses r
 where r.evaluation_id = e.id
   and r.layer = 'SUPERVISOR'
   and r.submitted_at is not null
   and e.supervisor_submitted_at is null;

/* ---------- Anything now complete goes to review ---------- */
--
-- A skipped layer counts as in, the same rule 0057 applies — HR advanced past
-- it deliberately, and waiting for a submission that will never arrive would
-- strand the record.

update public.worker_evaluations
   set status = 'PENDING_REVIEW'
 where status = 'OPEN'
   and (self_submitted_at is not null or self_skipped)
   and (supervisor_submitted_at is not null or supervisor_skipped);

/* ---------- Say what moved ---------- */
--
-- A silent repair is indistinguishable from one that found nothing, and this
-- one exists precisely because a silent no-op went unnoticed for a week.

do $$
declare v_ready int;
begin
  select count(*) into v_ready
    from public.worker_evaluations
   where status = 'PENDING_REVIEW';
  raise notice '0058: % worker appraisal(s) are now with HR for review.', v_ready;
end;
$$;

commit;

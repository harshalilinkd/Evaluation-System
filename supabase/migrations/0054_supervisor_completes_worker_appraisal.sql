-- 0054 — the supervisor's sheet alone completes a worker appraisal.
--
-- AT THE OWNER'S INSTRUCTION the shop floor keeps one action: Rate them. The
-- hand-over — where the supervisor passes their device to the worker to tick a
-- sheet of their own — is no longer the way a round is run.
--
-- That returns the module to what §7 and P3 described before it was built:
-- "a WORKER-track person has no self form: every worker question is LEAD_ONLY,
-- because the Worker Performance Appraisal is a supervisor-filled tick sheet."
-- The paper form has one rater and one signature block.
--
-- ============================================================================
-- WITHOUT THIS MIGRATION, REMOVING THE BUTTON STRANDS EVERY ROUND.
--
-- `submitWorkerSheet` advances to PENDING_REVIEW only `if (selfIn && supervisorIn)`.
-- With no hand-over the worker's side never lands, so every appraisal sits at
-- OPEN for ever and HR never sees it. The UI change alone would have quietly
-- broken the module rather than simplified it.
--
-- AND IT WAS ALREADY BROKEN, which is worth recording separately. That advance
-- is a plain `.update()` on `worker_evaluations`, and the only write policy on
-- that table is `worker_evaluations_hr_write` — `for all ... using is_hr()`.
-- A supervisor's update therefore matched zero rows. PostgREST does not treat
-- that as an error, so the submit reported success and the status never moved:
-- an appraisal with both sheets in would still have read OPEN. The hand-over
-- path hid it, because 0048 does its own advance inside a definer function.
-- ============================================================================

begin;

/* -- SECURITY DEFINER because the supervisor may not write this table, and
      should not be given a policy that lets them: `worker_evaluations` carries
      the assignment itself, and a supervisor who could update it could
      reassign an appraisal to somebody else. One narrow capability instead —
      "my sheet is in, move it to review" — with the relationship re-checked
      here rather than trusted from the caller. -- */
create or replace function public.complete_worker_appraisal(p_evaluation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row    record;
  v_actor  uuid := (select auth.uid());
begin
  select id, supervisor_id, status, self_submitted_at, supervisor_submitted_at,
         self_skipped, supervisor_skipped
    into v_row
    from public.worker_evaluations
   where id = p_evaluation_id;

  if not found then
    return false;
  end if;

  -- The assigned rater, or an administrator. Not "any supervisor".
  if v_actor is not null
     and v_actor <> v_row.supervisor_id
     and not (public.is_hr() or public.is_md()) then
    raise exception 'Only the assigned supervisor or an administrator may complete this appraisal.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Nothing to do unless the supervisor's own sheet is actually in.
  if v_row.supervisor_submitted_at is null and not v_row.supervisor_skipped then
    return false;
  end if;

  if v_row.status <> 'OPEN' then
    return false;
  end if;

  /* -- The worker's sheet is marked SKIPPED, not pretended in.
        §17 forbids recording a fill-on-behalf as though the worker submitted
        themselves, and the same honesty applies to a sheet nobody collected:
        the row must say the worker's own answers were not taken, so a reader
        two years later can tell "not asked" from "answered". `self_skipped`
        is the column §8 already has for exactly this, and every count in the
        product already treats it as done (F11-3). -- */
  update public.worker_evaluations
     set self_skipped = case
                          when self_submitted_at is null then true
                          else self_skipped
                        end,
         status = 'PENDING_REVIEW'
   where id = p_evaluation_id;

  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (
    v_actor, 'worker_evaluation', p_evaluation_id, 'worker.ready_for_review',
    jsonb_build_object(
      'self_collected', v_row.self_submitted_at is not null,
      'from_status', v_row.status));

  return true;
end;
$$;

revoke all on function public.complete_worker_appraisal(uuid) from public;
grant execute on function public.complete_worker_appraisal(uuid) to authenticated;

/* ---------- The rounds already stranded ----------
   Any appraisal whose supervisor has submitted but which never moved, because
   the update that should have moved it matched zero rows. */
do $backfill$
declare
  v_n int;
begin
  update public.worker_evaluations
     set self_skipped = case when self_submitted_at is null then true else self_skipped end,
         status       = 'PENDING_REVIEW'
   where status = 'OPEN'
     and (supervisor_submitted_at is not null or supervisor_skipped);

  get diagnostics v_n = row_count;
  raise notice '0054: % worker appraisal(s) were rated but stuck at OPEN; they are now with HR.', v_n;
end;
$backfill$;

commit;

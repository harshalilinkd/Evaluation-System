-- 0057 · Submitting a worker sheet actually records the submission.
--
-- THE BUG. A supervisor filled and submitted their sheet, and HR's board still
-- said "Not yet". Nothing errored.
--
-- 0047 gives `worker_evaluations` an UPDATE policy for HR alone. That is right
-- — the status, the supervisor, the exclusion are all HR's to move. But
-- `submitWorkerSheet` also stamped `supervisor_submitted_at` on that row, from
-- the SUPERVISOR's session, so the update matched no rows and returned no
-- error: PostgREST reports "0 rows affected" as success, because it is.
--
-- The answers were saved. The fact that they had been submitted was not. The
-- worker's own submit had the identical hole.
--
-- WHY A FUNCTION AND NOT A WIDER POLICY. "Each side may update
-- worker_evaluations" would let them write `status`, `supervisor_id` and
-- `excluded_at` too — RLS grants a row, not a column. The capability that is
-- actually needed is "stamp my own timestamp, once", and that is small enough
-- to be a function. The same call P10-4 made for `launch_cycle` and 0048 for
-- the hand-over.
--
-- It also makes the submission ATOMIC, which the TypeScript never was: the
-- timestamp, §11's overall tick and the move to PENDING_REVIEW were three
-- round trips that could half-happen.

begin;

create or replace function public.submit_worker_layer(
  p_evaluation_id uuid,
  p_layer public.worker_rating_layer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller  uuid := (select auth.uid());
  v_row     public.worker_evaluations%rowtype;
  v_answers jsonb;
  v_overall uuid;
  v_tick    text;
begin
  if v_caller is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.worker_evaluations
   where id = p_evaluation_id for update;

  if not found then
    raise exception 'That appraisal no longer exists.' using errcode = 'no_data_found';
  end if;

  -- The caller must own the layer they are submitting. Not "is involved in this
  -- appraisal": a supervisor submitting the SELF layer is the hand-over, which
  -- has its own function and its own record of having happened (0048, §17).
  if (p_layer = 'SELF' and v_row.worker_id is distinct from v_caller)
     or (p_layer = 'SUPERVISOR' and v_row.supervisor_id is distinct from v_caller) then
    raise exception 'That is not your side of this appraisal.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_row.status <> 'OPEN' then
    raise exception 'This appraisal is no longer open.' using errcode = 'invalid_parameter_value';
  end if;

  if (p_layer = 'SELF' and (v_row.self_submitted_at is not null or v_row.self_skipped))
     or (p_layer = 'SUPERVISOR' and (v_row.supervisor_submitted_at is not null or v_row.supervisor_skipped)) then
    raise exception 'This side has already been submitted.' using errcode = 'invalid_parameter_value';
  end if;

  /* -- Lock the layer. The answers are already there: the response row is
        written through RLS by the person filling it, which works and should
        keep working. This stamps the fact of submission, which is the part
        their session cannot write. -- */
  update public.worker_evaluation_responses
     set submitted_at = now(),
         submitted_by = v_caller
   where evaluation_id = p_evaluation_id
     and layer = p_layer
   returning answers into v_answers;

  /* -- §11: a worker's overall is the SUPERVISOR's "Overall Performance" tick,
        never a mean. Read from the FROZEN sheet rather than the live bank, and
        stored now rather than recomputed on read (§5). -- */
  if p_layer = 'SUPERVISOR' then
    select question_id into v_overall
      from public.worker_evaluation_questions
     where evaluation_id = p_evaluation_id and is_overall
     limit 1;

    if v_overall is not null then
      v_tick := v_answers ->> v_overall::text;
    end if;
  end if;

  update public.worker_evaluations
     set self_submitted_at =
           case when p_layer = 'SELF' then now() else self_submitted_at end,
         supervisor_submitted_at =
           case when p_layer = 'SUPERVISOR' then now() else supervisor_submitted_at end,
         overall_tick =
           case when p_layer = 'SUPERVISOR' then v_tick else overall_tick end,
         /* -- Both sides in? Then it goes to review. A SKIPPED layer counts as
               in — HR advanced past it deliberately, and waiting for a
               submission that will never come would strand the record (F11-3
               made the same call for staff). -- */
         status =
           case
             when p_layer = 'SELF'
               and (supervisor_submitted_at is not null or supervisor_skipped)
               then 'PENDING_REVIEW'::public.worker_evaluation_status
             when p_layer = 'SUPERVISOR'
               and (self_submitted_at is not null or self_skipped)
               then 'PENDING_REVIEW'::public.worker_evaluation_status
             else status
           end
   where id = p_evaluation_id;

  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (
    v_caller,
    'worker_evaluation',
    p_evaluation_id,
    case when p_layer = 'SELF' then 'worker.self_submit' else 'worker.supervisor_submit' end,
    jsonb_build_object('layer', p_layer)
  );
end;
$$;

comment on function public.submit_worker_layer(uuid, public.worker_rating_layer) is
  'Locks one side of a worker appraisal and stamps its timestamp. SECURITY DEFINER because worker_evaluations is UPDATE-able by HR alone (0047) and each side must be able to record its own submission without gaining the power to move the status, the supervisor or the exclusion (0057).';

revoke all on function public.submit_worker_layer(uuid, public.worker_rating_layer) from public;
grant execute on function public.submit_worker_layer(uuid, public.worker_rating_layer) to authenticated;

commit;

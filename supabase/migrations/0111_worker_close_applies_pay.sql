-- 0111 · Approving a production appraisal puts the approved salary on the record.
--
-- Reported as: "after completing appraisal cycle of employee their updated
-- approved salary not showing as their current salary and in their employment
-- salary history". Correct, and it never had: `close_worker_appraisal` stamped
-- the decision and closed the appraisal, and nothing anywhere wrote the figure
-- management approved into `salary_history` or `employment_records`. The staff
-- increment flow has always done this (`confirm_increment`, 0030); the
-- production flow stopped one step short, so every approved rise was a number
-- on a closed sheet that nobody was being paid.
--
-- THE CLOSE AND THE PAY CHANGE ARE ONE TRANSACTION. A close that went through
-- while the pay did not is exactly the reported state, so if the figure cannot
-- be applied the close is refused with a sentence saying why, and nothing moves.
--
-- WHAT IS APPLIED: the rise that takes the worker from what the record says
-- they are paid TODAY to the salary management approved. Measured against the
-- record rather than against HR's `old_ctc`, so their current salary ends up
-- exactly the approved figure — which is what "approved salary showing as their
-- current salary" means. Written through 0109's `record_increment`, the one
-- implementation of a rise: it appends the row and `rebuild_salary_chain`
-- re-derives the current salary and the increment clock from it.
--
-- EFFECTIVE FROM the approval date, in India time — the decision carries no
-- other date. `salary_history.evaluation_id` references STAFF evaluations only,
-- so the production appraisal is named in the note instead.
--
-- No figure reaches the audit diff (§5, P19-10): it records that pay was
-- applied, never the amount.
--
-- Written against `public.` like every migration before it; applied to the
-- `evaluation` schema the deployment uses.

begin;

create or replace function public.close_worker_appraisal(
  p_evaluation_id uuid,
  p_remarks text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_status   public.worker_evaluation_status;
  v_worker   uuid;
  v_actor    uuid := auth.uid();
  v_now      timestamptz := now();
  v_changed  boolean;
  v_new      numeric;
  v_current  numeric;
  v_has_rec  boolean;
  v_rise     numeric;
  v_applied  boolean := false;
begin
  if not public.is_md() then
    raise exception 'Only management can approve and close a production appraisal.'
      using errcode = 'insufficient_privilege';
  end if;

  select status, worker_id into v_status, v_worker
    from public.worker_evaluations
   where id = p_evaluation_id
     for update;

  if v_status is null then
    raise exception 'That appraisal no longer exists.';
  end if;

  if v_status = 'CLOSED' then
    raise exception 'This appraisal is already closed.'
      using errcode = 'check_violation';
  end if;

  if v_status <> 'REVIEWED' then
    raise exception 'This is still with HR. It can be approved once they send it up.'
      using errcode = 'check_violation';
  end if;

  if p_remarks is not null and length(trim(p_remarks)) > 0 then
    insert into public.worker_evaluation_decisions
      (evaluation_id, md_remarks, decided_by, decided_at)
    values
      (p_evaluation_id, trim(p_remarks), v_actor, v_now)
    on conflict (evaluation_id) do update
      set md_remarks = excluded.md_remarks,
          decided_by = excluded.decided_by,
          decided_at = excluded.decided_at;
  else
    insert into public.worker_evaluation_decisions
      (evaluation_id, decided_by, decided_at)
    values
      (p_evaluation_id, v_actor, v_now)
    on conflict (evaluation_id) do update
      set decided_by = excluded.decided_by,
          decided_at = excluded.decided_at;
  end if;

  -- ---------------------------------------------------------------- 0111 --
  -- The approved salary, onto the worker's pay record.
  select salary_changed, new_ctc into v_changed, v_new
    from public.worker_evaluation_decisions
   where evaluation_id = p_evaluation_id;

  if coalesce(v_changed, false) and v_new is not null then
    select true, current_ctc into v_has_rec, v_current
      from public.employment_records
     where profile_id = v_worker;

    if v_has_rec is null or v_current is null then
      raise exception 'Their current salary is not on record, so the approved figure has nowhere to go. Add their salary on their Employment tab, then approve again.'
        using errcode = 'check_violation';
    end if;

    v_rise := round(v_new - v_current, 2);

    if v_rise < 0 then
      raise exception 'The approved salary is lower than what they are paid now. Send it back to HR to correct the figure.'
        using errcode = 'check_violation';
    end if;

    -- Equal is not an error: the record already says what was approved.
    if v_rise > 0 then
      perform public.record_increment(
        v_worker,
        (v_now at time zone 'Asia/Kolkata')::date,
        v_rise,
        'ANNUAL_INCREMENT',
        'Production appraisal approved by management.',
        null
      );
      v_applied := true;
    end if;
  end if;

  update public.worker_evaluations
     set status         = 'CLOSED',
         md_reviewed_at = v_now,
         closed_at      = v_now
   where id = p_evaluation_id;

  insert into public.audit_log
    (actor_id, entity, entity_id, action, from_status, to_status, diff)
  values
    (v_actor, 'worker_evaluation', p_evaluation_id,
     'worker.closed', 'REVIEWED', 'CLOSED',
     jsonb_build_object(
       'remarks_recorded', p_remarks is not null and length(trim(p_remarks)) > 0,
       'pay_applied', v_applied));
end;
$$;

-- Verification: the close now applies pay.
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = current_schema() and p.proname = 'close_worker_appraisal'
                    and pg_get_functiondef(p.oid) like '%record_increment(%') then
    raise exception '0111: close_worker_appraisal does not apply the approved salary';
  end if;
end;
$$;

commit;

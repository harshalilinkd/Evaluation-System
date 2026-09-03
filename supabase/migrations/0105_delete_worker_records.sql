-- 0105: deleting a production appraisal actually clears its bell entries.
--
-- ============================================================================
-- A BUG I SHIPPED, caught by testing the thing rather than reading it.
--
-- Both delete paths cleared `app_notifications` first, on the reasoning F17-8
-- records: that table's `evaluation_id` carries no foreign key (P3-2), so
-- nothing cascades it — leave the rows and somebody opens the app to "A
-- production appraisal is open for you" pointing at a record that is gone.
--
-- The clearing did nothing. 0059 gives `app_notifications` NO DELETE POLICY FOR
-- ANYONE, deliberately (N1-9: a bell that can be emptied is a record that can
-- be made never to have existed). So the delete ran through the authenticated
-- client, matched zero rows, and returned no error — the silent-write class
-- this log has now recorded nine times: a refused DELETE or UPDATE succeeds
-- having done nothing, while a refused INSERT raises.
--
-- The absence of that policy is right and is not touched. What was wrong is
-- reaching for it from a session that cannot have it. Both deletions move into
-- SECURITY DEFINER functions instead — the same device `launch_cycle` (0009)
-- and `log_admin_action` (0007) use for a capability that belongs to one narrow
-- audited path rather than to a policy.
--
-- ATOMIC, which the TypeScript versions were not. Each moves an audit row, a
-- set of bell entries and the record itself; three round trips could half-apply
-- and leave a trail asserting a deletion that did not happen (P14-1, P10-2).
-- ============================================================================

begin;

/* ---------- One appraisal, leaving the round and everybody else ---------- */

create or replace function public.delete_worker_appraisal(p_evaluation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_caller uuid := (select auth.uid());
  v_row    public.worker_evaluations%rowtype;
  v_worker text;
  v_frozen integer;
begin
  if not public.is_hr() then
    raise exception 'Only HR can delete a production appraisal.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.worker_evaluations where id = p_evaluation_id;
  if not found then
    raise exception 'That appraisal no longer exists.' using errcode = 'no_data_found';
  end if;

  select full_name into v_worker from public.profiles where id = v_row.worker_id;
  select count(*) into v_frozen
    from public.worker_evaluation_questions where evaluation_id = p_evaluation_id;

  /* -- §12, written BEFORE the row goes. `audit_log.entity_id` carries no
        foreign key, so this outlives everything it describes and is the only
        remaining record that the appraisal existed. No figure in the diff:
        0013 lets a lead read the trail for their own reports, so a salary here
        would walk past §5 (P19-10). -- */
  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (v_caller, 'worker_evaluation', p_evaluation_id,
          'worker_evaluation.deleted_forever',
          jsonb_build_object(
            'worker', coalesce(v_worker, 'unknown'),
            'status', v_row.status,
            'frozen_questions', v_frozen
          ));

  delete from public.app_notifications where evaluation_id = p_evaluation_id;

  -- The frozen sheet, both response rows and the decision row all cascade.
  delete from public.worker_evaluations where id = p_evaluation_id;
end;
$fn$;

revoke all on function public.delete_worker_appraisal(uuid) from public;
grant execute on function public.delete_worker_appraisal(uuid) to authenticated;

/* ---------- A whole round, once it is in the bin ---------- */

create or replace function public.delete_worker_round(p_cycle_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_caller uuid := (select auth.uid());
  v_row    public.worker_cycles%rowtype;
  v_count  integer;
begin
  if not public.is_hr() then
    raise exception 'Only HR can delete a production round.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.worker_cycles where id = p_cycle_id;
  if not found then
    raise exception 'That round no longer exists.' using errcode = 'no_data_found';
  end if;

  /* -- STILL THE SECOND STEP. Bin it first: one press on a list should not be
        able to destroy a round, and the bin is where somebody has already
        decided they do not want it. -- */
  if v_row.deleted_at is null then
    raise exception 'Move it to the recycle bin first. Deleting for good is a second, separate step.'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_count from public.worker_evaluations where cycle_id = p_cycle_id;

  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (v_caller, 'worker_cycle', p_cycle_id, 'worker_cycle.deleted_forever',
          jsonb_build_object(
            'name', v_row.name,
            'period_label', v_row.period_label,
            'status', v_row.status,
            'appraisals_destroyed', v_count
          ));

  delete from public.app_notifications
   where evaluation_id in (select id from public.worker_evaluations where cycle_id = p_cycle_id);

  -- Evaluations cascade from the cycle, and everything else cascades from them.
  delete from public.worker_cycles where id = p_cycle_id;

  return v_count;
end;
$fn$;

revoke all on function public.delete_worker_round(uuid) from public;
grant execute on function public.delete_worker_round(uuid) to authenticated;

commit;

do $chk$
begin
  -- The absence 0059 relies on is untouched: still no DELETE policy for anyone.
  if exists (
    select 1 from pg_policy pol join pg_class c on c.oid = pol.polrelid
     where c.relname = 'app_notifications' and pol.polcmd = 'd'
  ) then
    raise exception '0105: a DELETE policy was added to app_notifications. N1-9 says the absence IS the enforcement.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('delete_worker_appraisal', 'delete_worker_round')
       and p.prosecdef
  ) then
    raise exception '0105: the delete functions are missing or are not SECURITY DEFINER.';
  end if;

  raise notice '0105 applied. A deleted appraisal takes its bell entries with it.';
end;
$chk$;

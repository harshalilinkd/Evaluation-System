-- 0070 · The MD can actually close a production appraisal.
--
-- REPORTED AS: "Somebody else moved this appraisal on while you were reading
-- it. Reload the page to see where it stands now. but still aprrove button is
-- active and cycle not moved to close this is not correct."
--
-- Nobody had moved anything. `worker_evaluations` carries exactly one write
-- policy — `worker_evaluations_hr_write` (0047), `for all ... using
-- (public.is_hr())`. The MD is not HR, so the UPDATE issued by "Approve and
-- close" matched ZERO ROWS, and a PostgREST write that matches no row is a
-- SUCCESS that did nothing. The application correctly noticed the zero rows and
-- reported the only cause it knew of — a lost race — which was both untrue and
-- unactionable.
--
-- This is the eighth appearance of that class in this codebase (FIX-14's role
-- write, F15-14's worker ticks, 0066, 0069, and the rest). It is the first time
-- the misleading message reached a person: the MD has never been able to close
-- a production appraisal, and was told each time that somebody else had.
--
-- THE FIX IS A FUNCTION, NOT A POLICY. Widening `worker_evaluations` to admit
-- the MD for UPDATE would also let them rewrite the worker, the supervisor, the
-- cycle and the snapshot pointer on any appraisal in the system. The capability
-- that is actually needed is one status move. 0054's `complete_worker_appraisal`
-- and 0057's `submit_worker_layer` are the same shape for the same reason
-- (W1-4), and 0064's `return_worker_to_hr` is its exact mirror — the MD sending
-- one back. This is the arm that was never built.

/* ---------- The MD approves and closes ---------- */

create or replace function public.close_worker_appraisal(
  p_evaluation_id uuid,
  p_remarks       text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.worker_evaluation_status;
  v_actor  uuid := auth.uid();
  v_now    timestamptz := now();
begin
  -- §9 as amended by AMEND-2: HR prepares and reviews, the MD approves. A
  -- second pair of eyes on a pay decision only exists if this is the MD's alone,
  -- and a hidden button is not a permission (§9 — client code is never the only
  -- guard), so the rule is restated here rather than trusted from the screen.
  if not public.is_md() then
    raise exception 'Only management can approve and close a production appraisal.'
      using errcode = 'insufficient_privilege';
  end if;

  -- `for update`, so two people pressing Approve at the same instant cannot both
  -- read REVIEWED and both proceed (P14-7). The second waits, re-reads CLOSED
  -- and is refused by name below.
  select status into v_status
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

  -- §8's worker table: MD_FINALIZED comes from SUPERVISOR_REVIEWED. In this
  -- module's own vocabulary (0047) that is REVIEWED — the stage HR sends it to.
  -- Closing something still with HR would skip the review the MD is signing off.
  if v_status <> 'REVIEWED' then
    raise exception 'This is still with HR. It can be approved once they send it up.'
      using errcode = 'check_violation';
  end if;

  /* -- The remarks go on the DECISIONS row, never the evaluation.
        `worker_evaluations` is readable by the worker and their supervisor
        (0047, 0053); management's remarks are neither's to read, and RLS cannot
        withhold a column — which is the whole reason 0050 put them on a
        separate row in the first place.

        Written only when there are some, and `coalesce`d on conflict, so
        approving without remarks cannot blank remarks somebody left earlier. -- */
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
    -- Still stamp WHO approved and WHEN, even with nothing to say. The printed
    -- sheet's signature block is gated on `decided_by` being set (W1 / P34-9),
    -- so without this an approval with no remarks would print unsigned.
    insert into public.worker_evaluation_decisions
      (evaluation_id, decided_by, decided_at)
    values
      (p_evaluation_id, v_actor, v_now)
    on conflict (evaluation_id) do update
      set decided_by = excluded.decided_by,
          decided_at = excluded.decided_at;
  end if;

  update public.worker_evaluations
     set status         = 'CLOSED',
         md_reviewed_at = v_now,
         closed_at      = v_now
   where id = p_evaluation_id;

  -- §12: every transition writes an audit row. No figure in it — `audit_log` is
  -- readable by a lead for their own reports (0013), so a salary here would walk
  -- straight past §5's confinement (P19-10).
  insert into public.audit_log
    (actor_id, entity, entity_id, action, from_status, to_status, diff)
  values
    (v_actor, 'worker_evaluation', p_evaluation_id,
     'worker.closed', 'REVIEWED', 'CLOSED',
     jsonb_build_object('remarks_recorded', p_remarks is not null and length(trim(p_remarks)) > 0));
end;
$$;

revoke all on function public.close_worker_appraisal(uuid, text) from public;
grant execute on function public.close_worker_appraisal(uuid, text) to authenticated;

comment on function public.close_worker_appraisal(uuid, text) is
  'The MD approves and closes a production appraisal. SECURITY DEFINER because '
  'worker_evaluations admits only HR for UPDATE (0047) — the MD needs one status '
  'move, not write access to the row.';

/* ---------- Notice ---------- */

do $$
begin
  raise notice '0070: close_worker_appraisal created. The MD could not close a '
               'production appraisal before this — the update matched no rows and '
               'reported a lost race.';
end;
$$;

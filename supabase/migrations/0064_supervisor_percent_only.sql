-- 0064: the production supervisor records a percentage and never sees a salary.
--
-- Phase 4, at the owner's explicit instruction: "supervisor will add only hike
-- percent as they dont know the salary of employees."
--
-- ============================================================================
-- THIS PARTLY REVERSES 0051, AND THAT IS A TIGHTENING.
--
-- 0051's header reads "THIS AMENDS §5's SALARY CONFINEMENT, AT THE OWNER'S
-- EXPLICIT INSTRUCTION", and gave the supervisor read and write on the whole
-- salary block. This moves the worker module BACK toward §5 as written: the
-- supervisor keeps the percentage, which is theirs to recommend, and loses the
-- amounts, which were never theirs to know.
--
-- Worth recording, because it changes what was lost: THE AUTO-FILL NEVER
-- WORKED. `lib/worker/form.ts` reads `employment_records` on the supervisor's
-- own session, and 0023 admits only HR and the MD — so that query has never
-- once returned a row for a supervisor. The old salary they have been typing
-- was recalled from memory and checked against nothing.
--
-- WHY A VIEW AND NOT A NARROWER POLICY. RLS is row-level: any policy that lets
-- a supervisor read their row hands over `old_ctc` and `new_ctc` with it,
-- because a policy cannot mask a column. So the direct read goes entirely and a
-- salary-free view takes its place — the absence is then structural rather than
-- something a future policy edit could widen (P19-2 made the same call for the
-- employee's own employment dates).
--
-- WHY A TRIGGER FOR THE WRITE. Same reason in reverse: the supervisor must
-- still write `increment_pct`, and an UPDATE policy admitting that row admits
-- every column on it. The trigger is what keeps the amounts out of their reach
-- — the device 0029 and 0030 already use to split HR's half of a row from the
-- MD's.
-- ============================================================================

begin;

/* ---------- 1 · The supervisor's read becomes a salary-free view ---------- */

drop policy if exists worker_decisions_supervisor_read on public.worker_evaluation_decisions;

-- Only what they wrote. No amount appears in the select list at all, so there
-- is no column here for a later change to expose.
create or replace view public.v_worker_supervisor_decision
with (security_invoker = true) as
select
  d.evaluation_id,
  d.salary_changed,
  d.increment_pct
from public.worker_evaluation_decisions d;

comment on view public.v_worker_supervisor_decision is
  'The supervisor''s own half of the worker salary block. Carries NO amount by construction (§5).';

grant select on public.v_worker_supervisor_decision to authenticated;

/* ---------- 2 · Their write is limited to the percentage ---------- */

create or replace function public.worker_decisions_guard_columns()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- HR and the MD own the amounts. A caller who is neither may change the
  -- percentage and the Same/New flag and nothing else.
  if public.is_hr() or public.is_md() then
    return new;
  end if;

  if new.old_ctc     is distinct from old.old_ctc
     or new.new_ctc  is distinct from old.new_ctc
     or new.md_remarks is distinct from old.md_remarks
     or new.decided_by is distinct from old.decided_by then
    raise exception
      'A supervisor records the recommended percentage. The salary figures are set by HR.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists worker_decisions_guard on public.worker_evaluation_decisions;
create trigger worker_decisions_guard
  before update on public.worker_evaluation_decisions
  for each row execute function public.worker_decisions_guard_columns();

-- An INSERT by a supervisor must not carry amounts either: the guard above is
-- BEFORE UPDATE and has no `old` row to compare against on insert.
create or replace function public.worker_decisions_guard_insert()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if public.is_hr() or public.is_md() then
    return new;
  end if;

  if new.old_ctc is not null or new.new_ctc is not null then
    raise exception
      'A supervisor records the recommended percentage. The salary figures are set by HR.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists worker_decisions_guard_ins on public.worker_evaluation_decisions;
create trigger worker_decisions_guard_ins
  before insert on public.worker_evaluation_decisions
  for each row execute function public.worker_decisions_guard_insert();

/* ---------- 3 · The MD may send it back to HR ---------- */

-- REVIEWED is with the MD. Sending it back returns it to PENDING_REVIEW, which
-- is HR's. A reason is required, for the same purpose §8 requires one on every
-- other return: the person receiving it has to know what to change.
create or replace function public.return_worker_to_hr(
  p_evaluation_id uuid,
  p_reason        text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.worker_evaluation_status;
  v_actor  uuid := auth.uid();
begin
  if not public.is_md() then
    raise exception 'Only management can send a worker appraisal back to HR.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_reason is null or length(trim(p_reason)) < 10 then
    raise exception 'Say what needs changing — at least ten characters.'
      using errcode = 'check_violation';
  end if;

  select status into v_status
    from public.worker_evaluations where id = p_evaluation_id;

  if v_status is null then
    raise exception 'That appraisal no longer exists.';
  end if;

  if v_status <> 'REVIEWED' then
    raise exception 'Only an appraisal that is with management can be sent back. This one is at %.', v_status
      using errcode = 'check_violation';
  end if;

  update public.worker_evaluations
     set status = 'PENDING_REVIEW'
   where id = p_evaluation_id;

  insert into public.audit_log (actor_id, entity, entity_id, action, from_status, to_status, reason)
  values (v_actor, 'worker_evaluation', p_evaluation_id,
          'worker_evaluation.returned_to_hr', 'REVIEWED', 'PENDING_REVIEW', p_reason);
end;
$$;

revoke all on function public.return_worker_to_hr(uuid, text) from public;
grant execute on function public.return_worker_to_hr(uuid, text) to authenticated;

/* ---------- 4 · Every salary change after a return is recorded ---------- */

-- The owner's requirement: "if MD send back to HR and hr will change the new
-- salary ... all this activies should be log."
--
-- A trigger, not a call in the action, so it cannot be forgotten by a second
-- write path — and it records the BEFORE and AFTER, which is what makes the
-- trail answer "what did HR change" rather than only "HR touched this".
--
-- §12 note: audit_log's insert policy is gated on `in_transition`, so this runs
-- SECURITY DEFINER as the owner, which is exempt. The actor still comes from
-- the session, never from an argument (P8-5).
create or replace function public.log_worker_salary_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.old_ctc is not distinct from old.old_ctc
     and new.new_ctc is not distinct from old.new_ctc
     and new.increment_pct is not distinct from old.increment_pct then
    return new;
  end if;

  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (
    auth.uid(),
    'worker_evaluation',
    new.evaluation_id,
    'worker_salary.changed',
    jsonb_build_object(
      -- §5 keeps an AMOUNT out of a diff a lead can read (P19-10), and 0013
      -- lets a lead read audit_log for their own reports. A worker supervisor
      -- is not a lead of a staff evaluation, so that policy does not reach
      -- these rows — but the same discipline applies: what changed, not what to.
      'changed', (
        case when new.old_ctc is distinct from old.old_ctc then 'old_ctc ' else '' end ||
        case when new.new_ctc is distinct from old.new_ctc then 'new_ctc ' else '' end ||
        case when new.increment_pct is distinct from old.increment_pct then 'increment_pct' else '' end
      ),
      'pct_from', old.increment_pct,
      'pct_to',   new.increment_pct
    )
  );

  return new;
end;
$$;

drop trigger if exists worker_decisions_log_change on public.worker_evaluation_decisions;
create trigger worker_decisions_log_change
  after update on public.worker_evaluation_decisions
  for each row execute function public.log_worker_salary_change();

commit;

/* ============================================================================
   Confirm
   ==========================================================================
   `supervisor_can_read_amounts` must be false — that policy is the whole point
   of this migration. */

select
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'worker_evaluation_decisions'
       and policyname = 'worker_decisions_supervisor_read')          as supervisor_read_revoked,
  to_regclass('public.v_worker_supervisor_decision') is not null     as salary_free_view,
  (select count(*) = 0
     from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v_worker_supervisor_decision'
      and column_name in ('old_ctc', 'new_ctc'))                     as view_carries_no_amount,
  (select count(*) from pg_trigger
    where tgname in ('worker_decisions_guard', 'worker_decisions_guard_ins',
                     'worker_decisions_log_change'))                 as guards_present,
  to_regprocedure('public.return_worker_to_hr(uuid, text)') is not null as md_can_return;

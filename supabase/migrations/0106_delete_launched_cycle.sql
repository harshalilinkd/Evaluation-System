-- 0106: a cycle in the recycle bin can be destroyed, launched or not.
--
-- ============================================================================
-- REVERSES P10-8, AT THE OWNER'S EXPLICIT INSTRUCTION.
--
-- 0009 put the block in the DATABASE rather than the action, and its reasoning
-- was sound: `evaluation_cycles` cascades to `evaluations` cascades to
-- `evaluation_questions`, so one stray DELETE takes the frozen question set of
-- everybody in the cycle with it — the thing §5 exists to protect. A guard
-- against a STRAY delete is what that trigger was.
--
-- The owner asked for a deliberate one: "i should able to delete any cycle from
-- recycle bin even if its completed". §0.9 — the concern was stated and the
-- instruction repeated, so it is theirs to take, and this records it rather
-- than absorbing it silently.
--
-- WHAT IS ACTUALLY DESTROYED, so nobody has to work it out later: the
-- evaluations, every answer and comment on both sides, the stored scores, the
-- frozen question set each person was given, their HR review and MD decision,
-- the increment proposal, and the invite links. An employee's scorecard loses
-- that cycle, because the rows it reads are gone.
--
-- WHAT SURVIVES, and why each one has to:
--   · audit_log      — §12 makes it append-only for every caller, and its
--                      entity_id carries no foreign key (P3-2) precisely so it
--                      outlives what it describes. After this it is the only
--                      remaining record the cycle existed.
--   · salary_history — a pay ledger is evidence of what somebody was paid
--                      (P19-3), and a cycle being deleted is not a reason
--                      anybody stopped being paid it. Its link is cleared; the
--                      figures, dates and reasons are untouched.
--   · employment_records, increment_reminders — the person's own schedule,
--                      which outlives any one cycle.
--
-- Two deliberate acts are KEPT. Bin first, destroy second — this only lifts the
-- launched-or-not restriction, not the requirement that somebody has already
-- decided they do not want the cycle (F17-5).
-- ============================================================================

begin;

/* ---------- 1 · The guard now tests the bin, not the launch ---------- */

create or replace function public.guard_cycle_delete()
returns trigger
language plpgsql
as $$
begin
  /* -- P10-8's real subject was a STRAY delete, and that danger has not gone
        away: one careless statement still takes every frozen question set in
        the cycle. What changes is the test. "Has it been launched" refused the
        deliberate case along with the careless one; "is it in the recycle bin"
        refuses only the careless one, because nothing reaches the bin without
        somebody putting it there and reading what it says. -- */
  if old.deleted_at is null then
    raise exception
      'Cycle "%" is not in the recycle bin. Move it there first — deleting for good is a second, separate step.',
      old.name
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

/* ---------- 2 · The two references that would refuse the delete ---------- */
--
-- Everything else already cascades or clears itself. These two are NO ACTION,
-- so a completed increment cycle — exactly the kind the owner wants to be able
-- to remove — would have been refused by a foreign key with a message naming a
-- constraint rather than a fact.

alter table public.salary_history
  drop constraint if exists salary_history_evaluation_id_fkey;

alter table public.salary_history
  add constraint salary_history_evaluation_id_fkey
  foreign key (evaluation_id) references public.evaluations(id) on delete set null;

alter table public.increment_reminders
  drop constraint if exists increment_reminders_evaluation_id_fkey;

alter table public.increment_reminders
  add constraint increment_reminders_evaluation_id_fkey
  foreign key (evaluation_id) references public.evaluations(id) on delete set null;

/* ---------- 3 · Append-only, with one narrow hole ---------- */
--
-- SET NULL is performed as an UPDATE, so it fires `salary_history_no_update`
-- and is refused — by the guarantee that nobody may rewrite pay history, which
-- is worth keeping and is not what this needs.
--
-- The exemption is written so that it CANNOT be used to change a figure: the
-- only permitted update is `evaluation_id` going from a value to null, with
-- every other column identical. It needs no GUC and no window to be opened
-- correctly, so there is no state anybody can leave in the wrong position — the
-- rule is provable from this body alone.

create or replace function public.salary_history_is_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and old.evaluation_id is not null
     and new.evaluation_id is null
     and new.id                is not distinct from old.id
     and new.profile_id        is not distinct from old.profile_id
     and new.effective_from    is not distinct from old.effective_from
     and new.previous_ctc      is not distinct from old.previous_ctc
     and new.new_ctc           is not distinct from old.new_ctc
     and new.hike_amount       is not distinct from old.hike_amount
     and new.hike_pct          is not distinct from old.hike_pct
     and new.reason            is not distinct from old.reason
     and new.note              is not distinct from old.note
     and new.recorded_by       is not distinct from old.recorded_by
  then
    -- Detaching from a deleted evaluation. No figure moves.
    return new;
  end if;

  raise exception
    'Salary history is append-only. Record a correction with reason CORRECTION instead of editing % .',
    tg_op
    using errcode = 'restrict_violation';
end;
$$;

/* ---------- 4 · One audited path, because three writes must not half-apply -- */

create or replace function public.delete_cycle_forever(p_cycle_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_caller uuid := (select auth.uid());
  v_row    public.evaluation_cycles%rowtype;
  v_people integer;
begin
  if not public.is_hr() then
    raise exception 'Only HR can delete a cycle for good.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.evaluation_cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'That cycle no longer exists.' using errcode = 'no_data_found';
  end if;

  if v_row.deleted_at is null then
    raise exception 'Move it to the recycle bin first. Deleting for good is a second, separate step.'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_people from public.evaluations where cycle_id = p_cycle_id;

  /* -- §12, written BEFORE the row goes, because afterwards this is the only
        evidence the cycle existed. `audit_log.entity_id` carries no foreign
        key (P3-2), so it outlives everything it describes. No figure in the
        diff: 0013 lets a lead read the trail for their own reports, so a
        salary here would walk straight past §5 (P19-10). -- */
  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (v_caller, 'evaluation_cycle', p_cycle_id, 'cycle.deleted_forever',
          jsonb_build_object(
            'name',                 v_row.name,
            'period_label',         v_row.period_label,
            'status',               v_row.status,
            'cycle_type',           v_row.cycle_type,
            'evaluations_destroyed', v_people
          ));

  /* -- The bell has NO foreign key onto evaluations (P3-2), so nothing
        cascades it away. Left behind, every employee opens the app to "Your
        evaluation is open" pointing at a form that no longer exists — the most
        confusing possible end state for a deliberate clean-out, and the exact
        gap FIX-17 and FIX-58 each had to close on a different path. -- */
  delete from public.app_notifications
   where evaluation_id in (select id from public.evaluations where cycle_id = p_cycle_id);

  -- Evaluations cascade from the cycle, and everything else cascades from them.
  delete from public.evaluation_cycles where id = p_cycle_id;

  return v_people;
end;
$fn$;

revoke all on function public.delete_cycle_forever(uuid) from public;
grant execute on function public.delete_cycle_forever(uuid) to authenticated;

commit;

do $chk$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'guard_cycle_delete';

  if v_def is null or v_def not like '%deleted_at is null%' then
    raise exception '0106: guard_cycle_delete still tests the launch rather than the bin.';
  end if;

  -- The bin requirement is the half that stays. A guard that let a live cycle
  -- be destroyed in one press would be a worse product than the one this
  -- replaces, not a freer one.
  if v_def like '%old.status <> ''DRAFT''%' then
    raise exception '0106: the launched-cycle test is still in place.';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'salary_history_is_append_only';

  if v_def not like '%new.new_ctc%is not distinct from%old.new_ctc%' then
    raise exception '0106: the pay-history exemption does not pin the figures.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'delete_cycle_forever' and p.prosecdef
  ) then
    raise exception '0106: delete_cycle_forever is missing or is not SECURITY DEFINER.';
  end if;

  raise notice '0106 applied. A binned cycle can be destroyed; a live one still cannot.';
end;
$chk$;

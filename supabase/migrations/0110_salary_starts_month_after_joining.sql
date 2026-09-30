-- 0110 · A joining salary counts from the 1st of the month after joining.
--
-- At the owner's instruction, asked and answered with examples: "1st of the
-- next month" — joined 15 Jul 2026 → salary from 1 Aug 2026; joined ON the
-- 1st moves a month too (joined 1 Aug 2026 → 1 Sep 2026). Chosen knowingly
-- over "the joining date itself" and over "unless they join on the 1st".
--
-- AND "DON'T OVERWRITE WHAT IS ALREADY THERE", also at the owner's
-- instruction. So this rule only ever FILLS an empty date. Every existing
-- `salary_effective_from` is left exactly as it is, including the 34 that
-- still carry the date of an increment cleared by 0109 — that was put to the
-- owner and they chose to keep them.
--
-- WHY THE DATE WAS EMPTY. `employment_records.salary_effective_from` answers
-- "since when have they been on this figure". It is set by a RISE
-- (`rebuild_salary_chain` takes the newest one), and for somebody with no rise
-- it was set only by the create dialog and the import, which wrote the joining
-- DAY. `record_joining_salary` (0069) and `set_joining_salary` (0075) — the
-- Employment tab, the roster and the salary sheet — never set it at all, so a
-- joining salary entered there left the date blank. That matters beyond the
-- screen: a blank date makes the next CORRECTION overwrite today's pay
-- unconditionally rather than fixing the past (P19-9).
--
-- ONE IMPLEMENTATION. The rule is `salary_start_for_joining`, and the only
-- thing that writes it is `fill_salary_start`. The two joining-salary
-- functions call it; the create dialog and the import call it over RPC after
-- they write the record. Nothing restates the arithmetic.
--
-- Written against `public.` like every migration before it; applied to the
-- `evaluation` schema the deployment uses.

begin;

-- ---------------------------------------------------------------------------
-- 1 · The rule
-- ---------------------------------------------------------------------------

create or replace function public.salary_start_for_joining(p_joined date)
returns date
language sql
immutable
as $$
  -- Null in, null out: no joining date is no answer, never a guess.
  select (date_trunc('month', p_joined) + interval '1 month')::date
$$;

comment on function public.salary_start_for_joining(date) is
  'When a joining salary counts from: the 1st of the month after joining (0110).';

-- ---------------------------------------------------------------------------
-- 2 · The only writer — fills an EMPTY date, never replaces one
-- ---------------------------------------------------------------------------

create or replace function public.fill_salary_start(p_profile_id uuid)
returns date
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := (select auth.uid());
  v_on     date;
begin
  -- SECURITY DEFINER, gated like `rebuild_salary_chain`: HR or the MD, or no
  -- session at all (this migration, a cron). Definer rather than invoker
  -- because `employment: hr updates` admits HR alone, and an MD's call would
  -- otherwise match nothing and report success — the silent write 0069 was
  -- written to end.
  if v_caller is not null and not (public.is_hr() or public.is_md()) then
    raise exception 'Only HR or management can change what somebody is paid.'
      using errcode = 'insufficient_privilege';
  end if;

  -- EVERY CONDITION IS A REASON NOT TO WRITE, and each is load-bearing:
  --   · the date is empty         — the owner's rule: never overwrite
  --   · there is a joining salary — no figure, nothing to date
  --   · there is a joining date   — no date, nothing to count from
  --   · there is no rise          — with a rise, the date belongs to the rise
  --                                 and `rebuild_salary_chain` sets it
  update public.employment_records e
     set salary_effective_from = public.salary_start_for_joining(p.date_of_joining)
    from public.profiles p
   where e.profile_id = p_profile_id
     and p.id = e.profile_id
     and e.salary_effective_from is null
     and e.joining_ctc is not null
     and p.date_of_joining is not null
     and not exists (
       select 1 from public.salary_history h
        where h.profile_id = e.profile_id
          and h.reason <> 'JOINING'
     );

  select salary_effective_from into v_on
    from public.employment_records
   where profile_id = p_profile_id;

  return v_on;
end;
$$;

revoke all on function public.fill_salary_start(uuid) from public;
grant execute on function public.fill_salary_start(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3 · The two joining-salary functions call it
--
-- Recreated from the LIVE definitions, unchanged but for one line each: the
-- `perform public.fill_salary_start(p_profile_id);` after the record is
-- written. Nothing else about either function moves — in particular
-- `set_joining_salary` still leaves `current_ctc` alone where rises exist;
-- that is a separate question and not this change.
-- ---------------------------------------------------------------------------

create or replace function public.record_joining_salary(p_profile_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_existing  numeric;
  v_current   numeric;
  v_revisions int;
  v_seeded    boolean := false;
begin
  if not (public.is_hr() or public.is_md()) then
    raise exception 'Only HR or management can record a joining salary.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'A joining salary has to be more than zero.'
      using errcode = 'check_violation';
  end if;

  select joining_ctc, current_ctc into v_existing, v_current
    from public.employment_records
   where profile_id = p_profile_id;

  if not found then
    raise exception 'This person has no employment record yet. Add their joining details first.'
      using errcode = 'no_data_found';
  end if;

  if v_existing is not null then
    raise exception 'A joining salary is already recorded. It is the baseline every later rise is measured against, so it does not change once set.'
      using errcode = 'unique_violation';
  end if;

  select count(*) into v_revisions
    from public.salary_history
   where profile_id = p_profile_id
     and reason <> 'JOINING';

  update public.employment_records
     set joining_ctc             = p_amount,
         joining_ctc_recorded_by = auth.uid(),
         joining_ctc_recorded_at = now(),
         current_ctc             = case
                                     when v_revisions = 0 and v_current is null then p_amount
                                     else current_ctc
                                   end
   where profile_id = p_profile_id;

  if not found then
    raise exception 'The employment record could not be updated.';
  end if;

  -- 0110: the salary counts from the 1st of the month after joining, where
  -- nothing has dated it yet.
  perform public.fill_salary_start(p_profile_id);

  v_seeded := (v_revisions = 0 and v_current is null);
  return jsonb_build_object('seeded_current', v_seeded);
end;
$$;

create or replace function public.set_joining_salary(p_profile_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_existing   numeric;
  v_current    numeric;
  v_revisions  int;
  v_seeded     boolean;
begin
  if not (public.is_hr() or public.is_md()) then
    raise exception 'Only HR or management can set a joining salary.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'A joining salary has to be more than zero.'
      using errcode = 'check_violation';
  end if;

  select joining_ctc, current_ctc into v_existing, v_current
    from public.employment_records
   where profile_id = p_profile_id;

  if not found then
    raise exception 'This person has no employment record yet. Add their joining details first.'
      using errcode = 'no_data_found';
  end if;

  select count(*) into v_revisions
    from public.salary_history
   where profile_id = p_profile_id
     and reason <> 'JOINING';

  update public.employment_records
     set joining_ctc             = p_amount,
         joining_ctc_recorded_by = auth.uid(),
         joining_ctc_recorded_at = now(),
         current_ctc             = case
                                     when v_revisions = 0 then p_amount
                                     else current_ctc
                                   end
   where profile_id = p_profile_id;

  -- 0110: the salary counts from the 1st of the month after joining, where
  -- nothing has dated it yet. A correction never moves an existing date.
  perform public.fill_salary_start(p_profile_id);

  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (
    auth.uid(),
    'employment',
    p_profile_id,
    case when v_existing is null then 'joining_salary.recorded' else 'joining_salary.corrected' end,
    jsonb_build_object(
      'had_a_baseline', v_existing is not null,
      'revisions_on_record', v_revisions,
      'current_salary_moved_with_it', v_revisions = 0
    )
  );

  v_seeded := (v_revisions = 0);
  return jsonb_build_object('seeded_current', v_seeded, 'corrected', v_existing is not null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4 · Fill the dates that are empty today — and ONLY those
--
-- Snapshot every existing date first, so section 5 can prove not one of them
-- moved. Run as the migration (no session), which the gate admits.
-- ---------------------------------------------------------------------------

create temporary table _0110_before on commit drop as
  select profile_id, salary_effective_from
    from public.employment_records
   where salary_effective_from is not null;

select public.fill_salary_start(e.profile_id)
  from public.employment_records e
 where e.salary_effective_from is null
   and e.joining_ctc is not null;

-- ---------------------------------------------------------------------------
-- 5 · Verification — raises, and rolls the whole migration back, on any miss
-- ---------------------------------------------------------------------------

do $$
declare
  v_moved   int;
  v_blank   int;
begin
  -- The rule, on the examples the owner was shown.
  if public.salary_start_for_joining('2026-07-15') <> date '2026-08-01' then
    raise exception '0110: 15 Jul should start 1 Aug';
  end if;
  if public.salary_start_for_joining('2026-08-01') <> date '2026-09-01' then
    raise exception '0110: joining ON the 1st should still move a month (1 Aug -> 1 Sep)';
  end if;
  if public.salary_start_for_joining('2026-12-31') <> date '2027-01-01' then
    raise exception '0110: 31 Dec should start 1 Jan of the next year';
  end if;
  if public.salary_start_for_joining(null) is not null then
    raise exception '0110: no joining date must give no start date, never a guess';
  end if;

  -- The owner's instruction: nothing that was there has moved.
  select count(*) into v_moved
    from _0110_before b
    join public.employment_records e using (profile_id)
   where e.salary_effective_from is distinct from b.salary_effective_from;
  if v_moved > 0 then
    raise exception '0110: % existing start date(s) changed — it must only fill empty ones', v_moved;
  end if;

  -- Nobody with a joining salary, a joining date and no rise is left undated.
  select count(*) into v_blank
    from public.employment_records e
    join public.profiles p on p.id = e.profile_id
   where e.salary_effective_from is null
     and e.joining_ctc is not null
     and p.date_of_joining is not null
     and not exists (select 1 from public.salary_history h
                      where h.profile_id = e.profile_id and h.reason <> 'JOINING');
  if v_blank > 0 then
    raise exception '0110: % record(s) still have a joining salary and no start date', v_blank;
  end if;

  -- Both joining-salary functions call the filler.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = current_schema() and p.proname = 'set_joining_salary'
                    and pg_get_functiondef(p.oid) like '%fill_salary_start(p_profile_id)%') then
    raise exception '0110: set_joining_salary does not call fill_salary_start';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = current_schema() and p.proname = 'record_joining_salary'
                    and pg_get_functiondef(p.oid) like '%fill_salary_start(p_profile_id)%') then
    raise exception '0110: record_joining_salary does not call fill_salary_start';
  end if;
end;
$$;

commit;

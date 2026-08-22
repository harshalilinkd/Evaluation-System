-- 0094 · A fifth salary reason: THREE_MONTH_INCREMENT.
--
-- AT THE OWNER'S EXPLICIT INSTRUCTION. "3 month increment is not applicable
-- for all employees — for some employees management promise to increase
-- salary after 3 months based on their performance for them we need to give
-- this option." Not a company-wide schedule change (P37's evaluation
-- milestones are untouched) — a reason that applies only where it was
-- promised, alongside the existing four, never replacing one.
--
-- Counted as a RISE, same as ANNUAL_INCREMENT/PROMOTION/MARKET_ADJUSTMENT —
-- money genuinely paid moves the increment clock exactly as a later annual
-- rise would (0068's rule). Only CORRECTION and JOINING stay excluded from
-- that, because neither is a new figure actually paid.
--
-- 0068 and 0093 ARE NOT EDITED (§0.8) — this `create or replace`s both, same
-- device A1-5/P19B-17/F2-3 use throughout: each differs from its predecessor
-- by one literal, so the whole body is restated rather than patched, because
-- a targeted string-replace against 0093's much longer function is exactly
-- the kind of edit that has silently matched nothing before (FIX-10's
-- addendum, 0056).
--
-- SAFE TO RE-RUN.

begin;

alter table public.salary_history drop constraint if exists salary_history_reason_valid;
alter table public.salary_history add constraint salary_history_reason_valid
  check (reason in (
    'JOINING', 'ANNUAL_INCREMENT', 'PROMOTION', 'CORRECTION', 'MARKET_ADJUSTMENT',
    'THREE_MONTH_INCREMENT'
  ));

/* ---------- apply_salary_to_record (0068), restated with the fifth reason ---------- */

create or replace function public.apply_salary_to_record(
  p_profile_id     uuid,
  p_new_ctc        numeric,
  p_effective_from date,
  p_reason         text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_latest date;
  v_moved  boolean := false;
  v_clock  boolean := false;
  v_last   date;
  v_before date;
begin
  if not (public.is_hr() or public.is_md()) then
    raise exception 'Only HR or management can record a pay change.'
      using errcode = 'insufficient_privilege';
  end if;

  select salary_effective_from, last_increment_date
    into v_latest, v_before
    from public.employment_records
   where profile_id = p_profile_id;

  if not found then
    raise exception 'This person has no employment record yet. Add their joining details first.'
      using errcode = 'no_data_found';
  end if;

  if v_latest is null or p_effective_from >= v_latest then
    update public.employment_records
       set current_ctc = p_new_ctc,
           salary_effective_from = p_effective_from
     where profile_id = p_profile_id;
    v_moved := true;
  end if;

  select max(h.effective_from) into v_last
    from public.salary_history h
   where h.profile_id = p_profile_id
     and h.reason in ('ANNUAL_INCREMENT', 'PROMOTION', 'MARKET_ADJUSTMENT', 'THREE_MONTH_INCREMENT');

  if v_last is not null and v_last is distinct from v_before then
    update public.employment_records
       set last_increment_date = v_last
     where profile_id = p_profile_id;
    v_clock := true;
  end if;

  return jsonb_build_object('figure_moved', v_moved, 'clock_moved', v_clock);
end;
$$;

revoke all on function public.apply_salary_to_record(uuid, numeric, date, text) from public;
grant execute on function public.apply_salary_to_record(uuid, numeric, date, text) to authenticated;

/* ---------- correct_salary_history_entry (0093), restated with the fifth reason ---------- */

create or replace function public.correct_salary_history_entry(
  p_id             uuid,
  p_new_ctc        numeric,
  p_effective_from date,
  p_reason         text,
  p_note           text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old         public.salary_history%rowtype;
  v_before_from date;
  v_before_reason text;
  v_chain_prev  numeric;
  v_row         public.salary_history%rowtype;
  v_new_prev    numeric;
  v_new_amt     numeric;
  v_new_pct     numeric;
  v_current_ctc numeric;
  v_current_from date;
  v_clock       date;
  v_figure_moved boolean := false;
  v_clock_moved  boolean := false;
begin
  if not (public.is_hr() or public.is_md()) then
    raise exception 'Only HR or management can correct a pay record.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_old from public.salary_history where id = p_id;
  if not found then
    raise exception 'That entry no longer exists.' using errcode = 'no_data_found';
  end if;

  if p_reason not in (
    'ANNUAL_INCREMENT', 'PROMOTION', 'CORRECTION', 'MARKET_ADJUSTMENT', 'THREE_MONTH_INCREMENT'
  ) then
    raise exception 'That is not a recognised reason.' using errcode = 'check_violation';
  end if;
  if v_old.reason = 'JOINING' then
    raise exception 'The joining salary is corrected from the Current pay card, not here.'
      using errcode = 'restrict_violation';
  end if;
  if p_new_ctc is null or p_new_ctc <= 0 then
    raise exception 'The salary must be greater than zero.' using errcode = 'check_violation';
  end if;
  if p_effective_from is null then
    raise exception 'An effective-from date is required.' using errcode = 'check_violation';
  end if;

  v_before_from := v_old.effective_from;
  v_before_reason := v_old.reason;

  perform set_config('app.salary_history_correction', 'true', true);

  update public.salary_history
     set new_ctc        = p_new_ctc,
         effective_from = p_effective_from,
         reason         = p_reason,
         note           = p_note,
         corrected_by   = (select auth.uid()),
         corrected_at   = now()
   where id = p_id;

  select joining_ctc into v_chain_prev
    from public.employment_records
   where profile_id = v_old.profile_id;

  for v_row in
    select * from public.salary_history
     where profile_id = v_old.profile_id
       and reason <> 'JOINING'
     order by effective_from asc, recorded_at asc
  loop
    v_new_prev := v_chain_prev;
    v_new_amt  := case when v_new_prev is null then null
                       else round((v_row.new_ctc - v_new_prev)::numeric, 2) end;
    v_new_pct  := case when v_new_prev is null or v_new_prev = 0 then null
                       else round(((v_row.new_ctc - v_new_prev) / v_new_prev) * 100, 2) end;

    if v_row.previous_ctc is distinct from v_new_prev
       or v_row.hike_amount is distinct from v_new_amt
       or v_row.hike_pct is distinct from v_new_pct
    then
      update public.salary_history
         set previous_ctc = v_new_prev, hike_amount = v_new_amt, hike_pct = v_new_pct
       where id = v_row.id;
    end if;

    v_chain_prev := v_row.new_ctc;
  end loop;

  select h.new_ctc, h.effective_from
    into v_current_ctc, v_current_from
    from public.salary_history h
   where h.profile_id = v_old.profile_id
     and h.reason <> 'JOINING'
   order by h.effective_from desc, h.recorded_at desc
   limit 1;

  if v_current_ctc is not null then
    update public.employment_records
       set current_ctc = v_current_ctc,
           salary_effective_from = v_current_from
     where profile_id = v_old.profile_id
       and (current_ctc is distinct from v_current_ctc
         or salary_effective_from is distinct from v_current_from);
    if found then v_figure_moved := true; end if;
  end if;

  select max(h.effective_from) into v_clock
    from public.salary_history h
   where h.profile_id = v_old.profile_id
     and h.reason in ('ANNUAL_INCREMENT', 'PROMOTION', 'MARKET_ADJUSTMENT', 'THREE_MONTH_INCREMENT');

  update public.employment_records
     set last_increment_date = v_clock
   where profile_id = v_old.profile_id
     and last_increment_date is distinct from v_clock;
  if found then v_clock_moved := true; end if;

  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (
    (select auth.uid()),
    'salary_history',
    p_id,
    'salary.corrected',
    jsonb_build_object(
      'before', jsonb_build_object('reason', v_before_reason, 'effective_from', v_before_from),
      'after',  jsonb_build_object('reason', p_reason,        'effective_from', p_effective_from)
    )
  );

  return jsonb_build_object('figure_moved', v_figure_moved, 'clock_moved', v_clock_moved);
end;
$$;

revoke all on function public.correct_salary_history_entry(uuid, numeric, date, text, text) from public;
grant execute on function public.correct_salary_history_entry(uuid, numeric, date, text, text) to authenticated;

commit;

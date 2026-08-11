-- 0068: the pay ledger decides when somebody was last given a rise.
--
-- Reported: an employee whose salary history shows an annual increment
-- effective 01-09-2025 still had `last_increment_date` reading 01-09-2026.
--
-- ============================================================================
-- 0066's FORWARD-ONLY RULE WAS THE RIGHT WORRY AND THE WRONG MECHANISM.
--
-- It moved the clock only when the new entry was LATER than the stored date:
--
--     and (last_increment_date is null or p_effective_from > last_increment_date)
--
-- The worry behind that is real — entering an old rise after a newer one must
-- not drag the clock backwards and make somebody due again immediately. But
-- comparing against the STORED DATE assumes the stored date came from a rise,
-- and in the reported case it had not: it was hand-typed, and it was three
-- weeks in the FUTURE. Nobody had been given that increment. The guard then
-- treated an unverified guess as authoritative and refused to correct it with
-- the recorded fact.
--
-- `last_increment_date` answers "when were they last given a rise". Once there
-- is a ledger of rises, THE LEDGER IS THAT ANSWER. A typed date is a stand-in
-- for history that predates the system — a bootstrap, not a competing source of
-- truth — and it should stand only until a real entry exists.
--
-- Taking the MAX over the ledger keeps the original protection for free:
-- inserting an older rise cannot lower a maximum. So history entered out of
-- order still cannot drag anybody backwards, and the mechanism no longer
-- depends on what somebody typed before the ledger existed.
--
-- WHAT STILL DOES NOT MOVE IT: JOINING, because that is the baseline rather
-- than a rise; and CORRECTION, because it fixes an earlier entry whose own
-- increment already moved the clock.
-- ============================================================================

begin;

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
  -- §9: the pay decision belongs to HR and the MD. Checked here rather than
  -- through the table policy, because this function runs as its owner and RLS
  -- therefore has no say at all.
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

  /* -- A CORRECTION dated before today's figure is fixing the past and must
        not move what somebody is being paid now (P19-9). -- */
  if v_latest is null or p_effective_from >= v_latest then
    update public.employment_records
       set current_ctc = p_new_ctc,
           salary_effective_from = p_effective_from
     where profile_id = p_profile_id;
    v_moved := true;
  end if;

  /* -- THE CLOCK, FROM THE LEDGER RATHER THAN FROM THIS ENTRY.

        Read AFTER the caller has inserted the history row, so this entry is
        already included — `addSalaryChange` inserts and then calls this.

        The MAX is what makes it order-independent: adding an older rise cannot
        lower it, so history entered out of sequence still cannot make somebody
        due again immediately, which was 0066's whole concern. -- */
  select max(h.effective_from) into v_last
    from public.salary_history h
   where h.profile_id = p_profile_id
     and h.reason in ('ANNUAL_INCREMENT', 'PROMOTION', 'MARKET_ADJUSTMENT');

  if v_last is not null and v_last is distinct from v_before then
    update public.employment_records
       set last_increment_date = v_last
     where profile_id = p_profile_id;
    v_clock := true;
  end if;

  -- `next_increment_date` is NOT written here. 0023's trigger recomputes it
  -- from the date above and the frequency, and stays the one implementation of
  -- that rule (P21-11).
  return jsonb_build_object('figure_moved', v_moved, 'clock_moved', v_clock);
end;
$$;

revoke all on function public.apply_salary_to_record(uuid, numeric, date, text) from public;
grant execute on function public.apply_salary_to_record(uuid, numeric, date, text) to authenticated;

/* ---------- Correct everybody the old rule left behind ---------- */

-- 0066's repair carried the same forward-only clause, so it skipped exactly
-- the people this migration exists for. No direction test now: where there is a
-- ledger of rises, its latest entry is the answer.
--
-- Anybody with NO recorded rise keeps whatever was typed — that is the
-- bootstrap case, and there is nothing better to replace it with.
do $$
declare
  v_n int := 0;
begin
  with last_rise as (
    select h.profile_id, max(h.effective_from) as on_date
      from public.salary_history h
     where h.reason in ('ANNUAL_INCREMENT', 'PROMOTION', 'MARKET_ADJUSTMENT')
     group by h.profile_id
  )
  update public.employment_records e
     set last_increment_date = l.on_date
    from last_rise l
   where l.profile_id = e.profile_id
     and e.last_increment_date is distinct from l.on_date;

  get diagnostics v_n = row_count;
  raise notice '0068: % record(s) had the increment clock set from the ledger.', v_n;
end;
$$;

commit;

/* ============================================================================
   Confirm
   ==========================================================================
   `disagreeing` must be 0: somebody whose ledger records a rise on a date their
   employment record does not carry. `typed_but_unrecorded` is NOT an error — it
   is the bootstrap case, people whose last increment predates the system. */

select
  (select count(*)
     from public.employment_records e
     join (select profile_id, max(effective_from) d
             from public.salary_history
            where reason in ('ANNUAL_INCREMENT','PROMOTION','MARKET_ADJUSTMENT')
            group by profile_id) l on l.profile_id = e.profile_id
    where e.last_increment_date is distinct from l.d)                as disagreeing,
  (select count(*)
     from public.employment_records e
    where e.last_increment_date is not null
      and not exists (
        select 1 from public.salary_history h
         where h.profile_id = e.profile_id
           and h.reason in ('ANNUAL_INCREMENT','PROMOTION','MARKET_ADJUSTMENT')))
                                                                     as typed_but_unrecorded,
  (select count(*) from public.employment_records
    where last_increment_date > current_date)                        as dated_in_the_future;

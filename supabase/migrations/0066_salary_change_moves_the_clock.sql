-- 0066: recording a pay change moves the money AND the increment clock,
--       for whoever is entitled to record one.
--
-- Two defects, reported as "last increment date not getting change".
--
-- ============================================================================
-- 1 · THE CLOCK WAS NEVER MOVED
--
-- `addSalaryChange` writes `current_ctc` and `salary_effective_from` and has
-- never touched `last_increment_date`. So recording an annual increment moved
-- the pay and left the increment cycle where it was — and because
-- `next_increment_date` is DERIVED from `last_increment_date` by 0023's
-- trigger, the calendar, the reminder and the nightly due sweep all went on
-- chasing the old date.
--
-- `confirm_increment` (0030) has always set it. The manual path on the
-- Employment tab never did, so the two ways of recording the same event
-- disagreed about what it meant.
--
-- 2 · AND THE RECORD UPDATE SILENTLY DID NOTHING FOR THE MD
--
-- `employment: hr updates` (0023) is `using (public.is_hr())`. The MD is not
-- HR. So when the MD recorded a pay change:
--
--   · the `salary_history` insert SUCCEEDED — 0023 lets HR and the MD both
--     append to the ledger;
--   · the `employment_records` update matched ZERO ROWS;
--   · and PostgREST reports zero rows as success, so the screen said the
--     change was recorded while `current_ctc` stayed null.
--
-- That is the third appearance of this exact class — FIX-14's role write and
-- the worker sheet's ratings were the other two. A write that cannot fail is
-- not a write, and the reason it keeps recurring is that nothing in the client
-- ever asks how many rows moved.
--
-- 0023's split is not itself wrong: §9 gives HR the employment record. But it
-- gives the MD the pay decision, and 0023 already lets them append the ledger —
-- so a state where the MD may write the history and not the figure it implies
-- is an inconsistency inside 0023, not a rule worth preserving.
--
-- THE FIX FOR BOTH IS ONE FUNCTION. Ledger and record move together or not at
-- all, which is what stops a history row existing beside a figure that
-- contradicts it. Same shape as `confirm_increment`, and for the same reason.
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
  v_latest   date;
  v_moved    boolean := false;
  v_clock    boolean := false;
begin
  -- §9: the pay decision belongs to HR and the MD. Checked here rather than
  -- relying on the table policy, because this function runs as its owner and
  -- RLS therefore has no say at all.
  if not (public.is_hr() or public.is_md()) then
    raise exception 'Only HR or management can record a pay change.'
      using errcode = 'insufficient_privilege';
  end if;

  select salary_effective_from into v_latest
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

  /* -- WHICH REASONS MOVE THE CLOCK.

        `last_increment_date` answers "when were they last given a rise", and
        `next_increment_date` is derived from it — so the question is not "did
        the money change" but "does the increment cycle restart".

          ANNUAL_INCREMENT · PROMOTION · MARKET_ADJUSTMENT → yes. Each is a
            rise, and the next review is due a cycle after it.
          JOINING → no. It is the baseline, not a rise (P19D-6).
          CORRECTION → no. It fixes an earlier entry; the increment it
            corrects already moved the clock when it was recorded, and moving
            it again would push the next review out for a typo.

        Only ever FORWARD. A rise backdated before the recorded last increment
        is history being entered out of order, and letting it drag the clock
        backwards would make somebody due again immediately. -- */
  if p_reason in ('ANNUAL_INCREMENT', 'PROMOTION', 'MARKET_ADJUSTMENT') then
    update public.employment_records
       set last_increment_date = p_effective_from
     where profile_id = p_profile_id
       and (last_increment_date is null or p_effective_from > last_increment_date);

    if found then
      v_clock := true;
    end if;
  end if;

  -- `next_increment_date` is NOT set here. 0023's trigger recomputes it from
  -- the date above and the frequency, and that stays the one implementation of
  -- the rule (P21-11).
  return jsonb_build_object('figure_moved', v_moved, 'clock_moved', v_clock);
end;
$$;

revoke all on function public.apply_salary_to_record(uuid, numeric, date, text) from public;
grant execute on function public.apply_salary_to_record(uuid, numeric, date, text) to authenticated;

/* ---------- Repair the records this has already stranded ---------- */

-- Anybody whose ledger says they were paid something their employment record
-- does not know about. A migration that fixes the mechanism and leaves the
-- cohort that motivated it stranded is half a fix (F11-6).
do $$
declare
  v_fig int := 0;
  v_clk int := 0;
begin
  with newest as (
    select distinct on (h.profile_id)
           h.profile_id, h.new_ctc, h.effective_from
      from public.salary_history h
     where h.reason <> 'JOINING'
     order by h.profile_id, h.effective_from desc, h.recorded_at desc
  )
  update public.employment_records e
     set current_ctc = n.new_ctc,
         salary_effective_from = n.effective_from
    from newest n
   where n.profile_id = e.profile_id
     and (e.salary_effective_from is null or n.effective_from > e.salary_effective_from
          or e.current_ctc is distinct from n.new_ctc);
  get diagnostics v_fig = row_count;

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
     and (e.last_increment_date is null or l.on_date > e.last_increment_date);
  get diagnostics v_clk = row_count;

  raise notice '0066: % record(s) had their figure corrected, % had the increment clock moved.', v_fig, v_clk;
end;
$$;

commit;

/* ============================================================================
   Confirm
   ==========================================================================
   `figure_behind` must be 0: somebody whose ledger records a later salary than
   their employment record carries. `clock_behind` likewise. */

select
  (select count(*)
     from public.employment_records e
     join (select distinct on (profile_id) profile_id, new_ctc, effective_from
             from public.salary_history where reason <> 'JOINING'
            order by profile_id, effective_from desc, recorded_at desc) n
       on n.profile_id = e.profile_id
    where e.current_ctc is distinct from n.new_ctc)                    as figure_behind,
  (select count(*)
     from public.employment_records e
     join (select profile_id, max(effective_from) d from public.salary_history
            where reason in ('ANNUAL_INCREMENT','PROMOTION','MARKET_ADJUSTMENT')
            group by profile_id) l on l.profile_id = e.profile_id
    where e.last_increment_date is null or l.d > e.last_increment_date)  as clock_behind,
  to_regprocedure('public.apply_salary_to_record(uuid, numeric, date, text)') is not null
                                                                        as function_present;

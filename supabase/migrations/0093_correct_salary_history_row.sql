-- 0093 · HR/MD may correct a salary_history ROW IN PLACE.
--
-- AT THE OWNER'S EXPLICIT INSTRUCTION, and it goes further than 0075 did.
-- 0075 let the JOINING baseline be corrected — but that figure was never a
-- ledger row (P19E-1: it is `employment_records.joining_ctc`, a column). This
-- migration is the first time any actual `salary_history` row becomes
-- editable, by anyone, for any reason — a genuine narrowing of 0023's own
-- guarantee: "salary_history is append-only by trigger for every caller
-- including a superuser and a migration... pay history that can be
-- rewritten is not evidence."
--
-- THE CHOICE, PUT TO THE OWNER DIRECTLY.
--
-- The system already had a designed answer to "I typed the wrong figure":
-- append a NEW row with reason CORRECTION, which is already excluded from
-- every hike/percentage/increment-clock calculation. That would have cost
-- nothing architecturally. The owner was shown both options and chose this
-- one explicitly: "no new row will add that same row will get corrected."
-- §0.9 requires exactly that exchange before a documented invariant is
-- narrowed, and this file is the record of it.
--
-- WHAT IS STILL TRUE AFTERWARDS.
--
--   - DELETE remains impossible for every caller, with no exception, ever.
--   - A raw UPDATE from anywhere else — the app, an operator's SQL console,
--     a future migration — is still refused exactly as before. The ONLY door
--     is `correct_salary_history_entry`, gated on a transaction-local flag
--     that nothing outside this function ever sets, and `set_config` is a
--     pg_catalog builtin that PostgREST does not expose as an RPC route, so
--     a client cannot open the door itself even indirectly.
--   - `id`, `profile_id`, `evaluation_id`, `recorded_by` and `recorded_at`
--     cannot move even through the one door that exists — the trigger checks
--     them independently of the function, so WHO first entered a figure and
--     WHICH evaluation it belongs to survive a correction unchanged. Only
--     `new_ctc`, `effective_from`, `reason` and `note` may change, plus two
--     new columns recording that a correction happened.
--
-- THE RIPPLE. `previous_ctc`/`hike_amount`/`hike_pct` are never accepted from
-- the caller (P19-7 — "a client that could send its own previous figure
-- could write a history that disagrees with the record it came from"), so
-- they are recomputed, not for the corrected row alone but for the WHOLE
-- chain: correcting one row's figure or date changes what every LATER row's
-- own previous-figure lookup would find, and leaving those stale would mean
-- the ledger disagreeing with itself the moment anybody reads two adjacent
-- rows together.
--
-- SAFE TO RE-RUN.

begin;

/* ============================================================================
   1. Provenance for a correction — separate from who first recorded it
   ========================================================================== */
--
-- `recorded_by`/`recorded_at` describe the ORIGINAL entry and the trigger
-- pins them; they must not start meaning "whoever last touched this row"
-- once a correction is possible. A correction gets its own pair, mirroring
-- 0044's `joining_ctc_recorded_by`/`_at` — null until a correction happens.

alter table public.salary_history
  add column if not exists corrected_by uuid references public.profiles(id);
alter table public.salary_history
  add column if not exists corrected_at timestamptz;

/* ============================================================================
   2. The trigger gains ONE narrow door
   ========================================================================== */

create or replace function public.salary_history_is_append_only()
returns trigger
language plpgsql
as $$
begin
  /* -- THE ONLY EXCEPTION. Every clause below has to hold, not just the flag:
        the flag alone would make this door as wide as "call set_config first",
        and the identity/provenance columns are what stay true even then. -- */
  if tg_op = 'UPDATE'
     and current_setting('app.salary_history_correction', true) = 'true'
     and new.id = old.id
     and new.profile_id = old.profile_id
     and new.evaluation_id is not distinct from old.evaluation_id
     and new.recorded_by is not distinct from old.recorded_by
     and new.recorded_at = old.recorded_at
  then
    return new;
  end if;

  raise exception
    'Salary history is append-only outside a correction. Use correct_salary_history_entry, or (for the joining baseline) set_joining_salary — % is not permitted directly.',
    tg_op
    using errcode = 'restrict_violation';
end;
$$;

/* ============================================================================
   3. correct_salary_history_entry — the one door
   ========================================================================== */

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
  -- §9: the pay decision belongs to HR and the MD. Checked here rather than
  -- through a table policy, because this function runs as its owner and RLS
  -- therefore has no say at all — the same reasoning 0068 and 0075 give.
  if not (public.is_hr() or public.is_md()) then
    raise exception 'Only HR or management can correct a pay record.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_old from public.salary_history where id = p_id;
  if not found then
    raise exception 'That entry no longer exists.' using errcode = 'no_data_found';
  end if;

  -- JOINING is not a ledger reason to retype INTO — it is the baseline
  -- column's own reason, reserved for legacy rows copied from it (P19E-1),
  -- and a revision row wearing it would render as a second baseline.
  if p_reason not in ('ANNUAL_INCREMENT', 'PROMOTION', 'CORRECTION', 'MARKET_ADJUSTMENT') then
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

  /* -- OPEN THE DOOR, then walk straight through it. Transaction-local
        (`is_local => true`), so it clears on its own at commit or rollback —
        nothing outside this one statement's transaction can ever see it set. -- */
  perform set_config('app.salary_history_correction', 'true', true);

  update public.salary_history
     set new_ctc        = p_new_ctc,
         effective_from = p_effective_from,
         reason         = p_reason,
         note           = p_note,
         corrected_by   = (select auth.uid()),
         corrected_at   = now()
   where id = p_id;

  /* -- THE RIPPLE. previous_ctc/hike_amount/hike_pct are recomputed for the
        WHOLE chain, not the corrected row alone — correcting one row's figure
        or date can change what every row chronologically after it should have
        found as its own predecessor. Seeded from the baseline column, exactly
        as `addSalaryChange` seeds a fresh entry (P19E-2). Only rows whose
        stored figures would actually change are written, so an untouched
        chain re-derives to the same numbers and nothing is rewritten for no
        reason. -- */
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

  /* -- TODAY'S FIGURE, RE-DERIVED FROM THE LEDGER'S TRUE LATEST ROW — not from
        a before/after comparison against what USED to be recorded.
        `apply_salary_to_record`'s guard (`p_effective_from >= v_latest`) is
        right for a fresh insert, which can only ever add a row at or after
        what exists; a correction can move a row's date in either direction,
        including past what used to be the newest entry, so only re-reading
        the chain's actual maximum is safe here. -- */
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

  /* -- THE INCREMENT CLOCK, same rule 0068 gave it: the ledger's latest RISE
        wins, re-read fresh rather than assumed to be whatever the corrected
        row now says (a correction can change a row's REASON as easily as its
        date, moving it into or out of the reasons that count as a rise). -- */
  select max(h.effective_from) into v_clock
    from public.salary_history h
   where h.profile_id = v_old.profile_id
     and h.reason in ('ANNUAL_INCREMENT', 'PROMOTION', 'MARKET_ADJUSTMENT');

  update public.employment_records
     set last_increment_date = v_clock
   where profile_id = v_old.profile_id
     and last_increment_date is distinct from v_clock;
  if found then v_clock_moved := true; end if;

  -- §12, and NO FIGURE in the diff — 0013 lets a lead read audit_log for
  -- their own reports, so a salary here would walk straight past §5's
  -- confinement invariant. Dates and the reason are enough to find the row
  -- and say what kind of correction it was.
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

/* ============================================================================
   Confirm
   ==========================================================================
   Not a runtime probe against real data — this migration has none to test
   against, and an empty-match UPDATE would not fire the row-level trigger at
   all, which would make a "confirmation" here prove nothing while claiming
   to. The guarantee is in the trigger body itself: `tg_op = 'UPDATE'` is
   required before the flag is even consulted, so DELETE has no path through
   it under any condition, and the flag is transaction-local and set only
   inside `correct_salary_history_entry` — nothing else in the system ever
   calls `set_config('app.salary_history_correction', ...)`. */

do $$
begin
  raise notice '0093: correct_salary_history_entry is the only door into salary_history. '
               'A raw UPDATE or DELETE from anywhere else still raises restrict_violation.';
end;
$$;

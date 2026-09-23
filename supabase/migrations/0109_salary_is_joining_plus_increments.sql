-- 0109 — A salary is what somebody joined on, plus every rise since.
--
-- AT THE OWNER'S EXPLICIT INSTRUCTION. §0.2 and §0.4 require that to be said
-- before a stored meaning changes, and this changes one:
--
--   "currently we are doing like this joining salary 18000 then person get
--    2000 increment so in increment 1 we are adding 20000 but its wrong as per
--    hr we are just need to mention increment amount means only 2000 and then
--    current salary will get calculated by adding joining salary plus all
--    increments till date … currently we are taking last increment as current
--    salary but now we need to change logic"
--
-- WHAT THE COLUMNS MEAN FROM HERE.
--
--   employment_records.joining_ctc   the baseline — TYPED
--   salary_history.hike_amount       the rise      — TYPED
--   salary_history.previous_ctc      derived: joining + every earlier rise
--   salary_history.new_ctc           derived: previous + this rise
--   salary_history.hike_pct          derived: rise ÷ previous
--   employment_records.current_ctc   derived: joining + every rise to DATE
--
-- Before this, `new_ctc` was the typed figure and the rise was derived from it.
-- Both models are arithmetically equivalent on a complete ledger; they differ
-- on WHICH NUMBER A PERSON TYPES, and HR types the rise. The old direction
-- turned a ₹2,000 rise typed into a box labelled "Amount" into a salary of
-- ₹2,000, and the screens then reported the last rise as somebody's pay.
--
-- §0.8: 0093 and 0108 are applied and are not edited. 0093's correction
-- function keeps working — it corrects a row by its NEW SALARY, which is still
-- a legitimate way to say the same thing, and it re-derives the rest of the
-- chain exactly as it always did.

begin;

/* ============================================================================
   1. THE ONE IMPLEMENTATION OF "joining + every rise"

   Everything that touches pay calls this and nothing recomputes it for itself.
   A second answer to what somebody is paid is the whole reason this migration
   exists.
   ========================================================================== */

create or replace function public.rebuild_salary_chain(p_profile_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_joining   numeric;
  v_running   numeric;
  v_row       record;
  v_prev      numeric;
  v_new       numeric;
  v_pct       numeric;
  v_current   numeric;
  v_from      date;
  v_clock     date;
  v_caller    uuid := (select auth.uid());
begin
  /* -- §9: the pay decision belongs to HR and the MD. Checked here rather than
        through the table policy, because this function runs as its OWNER and
        RLS therefore has no say at all.

        A caller with NO JWT is the system actor — a migration, the seed, a
        cron sweep. P5-6 caught the same guard misfiring on exactly those, and
        a gate that refuses a migration is a bug rather than strictness. -- */
  if v_caller is not null and not (public.is_hr() or public.is_md()) then
    raise exception 'Only HR or management can change what somebody is paid.'
      using errcode = 'insufficient_privilege';
  end if;

  select joining_ctc into v_joining
    from public.employment_records
   where profile_id = p_profile_id;

  if not found then
    raise exception 'This person has no employment record yet. Add their joining details first.'
      using errcode = 'no_data_found';
  end if;

  /* -- OPEN THE DOOR, then walk straight through it. Transaction-local, so it
        clears on its own at commit or rollback — nothing outside this
        statement's transaction can ever see it set (0093, restored by 0108). -- */
  perform set_config('app.salary_history_correction', 'true', true);

  /* -- FORWARD FROM THE BASELINE, which is the direction the owner described.

        `composeOpeningPay` used to walk BACKWARDS from today's figure, and its
        comment gave the reason: joining 25,000 plus a recorded rise of 5,000
        comes to 30,000, and if the record says 32,000 today the newest row
        would contradict the record beside it. That reasoning held while
        `current_ctc` was a fact somebody typed. It is not one any more — it is
        this sum — so there is nothing left for the chain to contradict. -- */
  v_running := v_joining;

  for v_row in
    select * from public.salary_history
     where profile_id = p_profile_id
       and reason <> 'JOINING'
     order by effective_from asc, recorded_at asc
  loop
    v_prev := v_running;
    v_new  := case when v_prev is null then null
                   else round((v_prev + coalesce(v_row.hike_amount, 0))::numeric, 2) end;
    v_pct  := case when v_prev is null or v_prev = 0 or v_row.hike_amount is null then null
                   else round((v_row.hike_amount / v_prev) * 100, 2) end;

    -- Only rows whose stored figures would actually change are written, so a
    -- chain that already re-derives to the same numbers is left alone.
    if v_row.previous_ctc is distinct from v_prev
       or v_row.new_ctc is distinct from v_new
       or v_row.hike_pct is distinct from v_pct
    then
      update public.salary_history
         set previous_ctc = v_prev,
             new_ctc      = coalesce(v_new, v_row.new_ctc),
             hike_pct     = v_pct
       where id = v_row.id;
    end if;

    v_running := coalesce(v_new, v_running);
  end loop;

  /* -- TODAY'S FIGURE COUNTS THE RISES THAT HAVE TAKEN EFFECT.

        "all increments till date", literally. A rise HR enters in advance is a
        real record of a decision and belongs in the ledger; it is not part of
        what somebody is paid until its own date arrives. Counting it early
        would overstate a salary, which is the direction that costs money. -- */
  select v_joining + coalesce(sum(h.hike_amount), 0), max(h.effective_from)
    into v_current, v_from
    from public.salary_history h
   where h.profile_id = p_profile_id
     and h.reason <> 'JOINING'
     and h.effective_from <= current_date;

  if v_current is null then v_current := v_joining; end if;

  update public.employment_records
     set current_ctc = v_current,
         salary_effective_from = coalesce(v_from, salary_effective_from)
   where profile_id = p_profile_id
     and (current_ctc is distinct from v_current
       or salary_effective_from is distinct from coalesce(v_from, salary_effective_from));

  /* -- THE INCREMENT CLOCK, unchanged: 0068's rule, that the ledger's latest
        RISE wins. Re-read rather than assumed, because a correction can move a
        row's date in either direction. -- */
  select max(h.effective_from) into v_clock
    from public.salary_history h
   where h.profile_id = p_profile_id
     and h.reason in ('ANNUAL_INCREMENT', 'PROMOTION', 'MARKET_ADJUSTMENT', 'THREE_MONTH_INCREMENT');

  update public.employment_records
     set last_increment_date = v_clock
   where profile_id = p_profile_id
     and last_increment_date is distinct from v_clock;

  return v_current;
end;
$$;

revoke all on function public.rebuild_salary_chain(uuid) from public;
grant execute on function public.rebuild_salary_chain(uuid) to authenticated;

/* ============================================================================
   2. RECORDING A RISE, BY ITS AMOUNT

   `addSalaryChange` takes a NEW SALARY and derives the rise. This takes the
   rise and derives the salary — which is the same event, entered the way HR
   states it. Both remain; nothing that already worked is taken away.
   ========================================================================== */

create or replace function public.record_increment(
  p_profile_id     uuid,
  p_effective_from date,
  p_amount         numeric,
  p_reason         text default 'ANNUAL_INCREMENT',
  p_note           text default null,
  p_evaluation_id  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id     uuid;
  v_caller uuid := (select auth.uid());
begin
  if v_caller is not null and not (public.is_hr() or public.is_md()) then
    raise exception 'Only HR or management can record a pay change.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_effective_from is null then
    raise exception 'An effective-from date is required.' using errcode = 'check_violation';
  end if;
  /* -- ZERO IS REFUSED, and that is not pedantry: a rise of nothing moves the
        increment clock as surely as a real one, so the next review would be
        counted from a raise that never happened (F56-6's rule, at the point of
        entry rather than at import). A pay CUT is refused for the same reason
        an "increment" that lowers pay was refused at P14-13 — it is either a
        typo or a decision that should not be recorded under this label. -- */
  if p_amount is null or p_amount <= 0 then
    raise exception 'An increment has to be more than zero.' using errcode = 'check_violation';
  end if;
  if p_reason not in ('ANNUAL_INCREMENT', 'PROMOTION', 'CORRECTION', 'MARKET_ADJUSTMENT', 'THREE_MONTH_INCREMENT') then
    raise exception 'That is not a recognised reason.' using errcode = 'check_violation';
  end if;

  insert into public.salary_history (
    profile_id, effective_from, previous_ctc, new_ctc, hike_amount, hike_pct,
    reason, evaluation_id, recorded_by, note
  ) values (
    p_profile_id, p_effective_from, null, p_amount, p_amount, null,
    p_reason, p_evaluation_id, v_caller, p_note
  )
  returning id into v_id;

  -- Every derived figure on the row, and the record beside it, in one place.
  perform public.rebuild_salary_chain(p_profile_id);
  return v_id;
end;
$$;

revoke all on function public.record_increment(uuid, date, numeric, text, text, uuid) from public;
grant execute on function public.record_increment(uuid, date, numeric, text, text, uuid) to authenticated;

/* ============================================================================
   3. CORRECTING A RISE, BY ITS AMOUNT

   0093 corrects a row by its NEW SALARY and is untouched. This is its sibling
   for the figure HR now types. Both end in the same rebuild, so they cannot
   disagree about what the rest of the chain becomes.
   ========================================================================== */

create or replace function public.correct_increment(
  p_id             uuid,
  p_effective_from date,
  p_amount         numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old    record;
  v_caller uuid := (select auth.uid());
  v_new    numeric;
begin
  if v_caller is not null and not (public.is_hr() or public.is_md()) then
    raise exception 'Only HR or management can change what somebody is paid.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_old from public.salary_history where id = p_id;
  if not found then
    raise exception 'That pay entry no longer exists.' using errcode = 'no_data_found';
  end if;
  if v_old.reason = 'JOINING' then
    raise exception 'The joining salary is corrected from the Current pay card, not here.'
      using errcode = 'restrict_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'An increment has to be more than zero.' using errcode = 'check_violation';
  end if;
  if p_effective_from is null then
    raise exception 'An effective-from date is required.' using errcode = 'check_violation';
  end if;

  perform set_config('app.salary_history_correction', 'true', true);

  update public.salary_history
     set hike_amount    = p_amount,
         effective_from = p_effective_from,
         corrected_by   = v_caller,
         corrected_at   = now()
   where id = p_id;

  v_new := public.rebuild_salary_chain(v_old.profile_id);

  /* -- §12, and NO FIGURE in the diff. 0013 lets a lead read `audit_log` for
        their own reports, so a salary here would walk straight past §5's
        confinement invariant (P19-10). -- */
  perform public.log_admin_action(
    'employment', v_old.profile_id, 'salary.increment_corrected', null, null,
    jsonb_build_object('entry', p_id, 'effective_from', p_effective_from)
  );

  return jsonb_build_object('current_ctc', v_new);
end;
$$;

revoke all on function public.correct_increment(uuid, date, numeric) from public;
grant execute on function public.correct_increment(uuid, date, numeric) to authenticated;

/* ============================================================================
   3b. A THIRD WINDOW, SO A MIS-KEYED RISE CAN BE REMOVED

   0108's body is REPRODUCED HERE CLAUSE FOR CLAUSE and a third window added.
   That is not tidiness — 0106 recreated this function from the wrong ancestor
   and silently deleted 0093's correction window, and every salary correction
   in the product was dead until 0108 put it back. So the verification below
   asserts ALL THREE windows survive, not only the one this migration adds.

   The new window is as narrow as the other two: DELETE only, and only while
   `delete_increment` holds the transaction-local flag open. There is no way to
   reach it except through that function, which is HR/MD-gated and audits the
   row before it goes.
   ========================================================================== */

create or replace function public.salary_history_is_append_only()
returns trigger
language plpgsql
as $$
begin
  /* ---------- 0093's window: a correction, through the one door ---------- */
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

  /* ---------- 0106's window: detaching from a deleted evaluation ---------- */
  if tg_op = 'UPDATE'
     and old.evaluation_id is not null
     and new.evaluation_id is null
     and new.id             is not distinct from old.id
     and new.profile_id     is not distinct from old.profile_id
     and new.effective_from is not distinct from old.effective_from
     and new.previous_ctc   is not distinct from old.previous_ctc
     and new.new_ctc        is not distinct from old.new_ctc
     and new.hike_amount    is not distinct from old.hike_amount
     and new.hike_pct       is not distinct from old.hike_pct
     and new.reason         is not distinct from old.reason
     and new.note           is not distinct from old.note
     and new.recorded_by    is not distinct from old.recorded_by
  then
    return new;
  end if;

  /* ---------- 0109's window: removing a rise that describes nothing --------
        A row entered against the wrong person, or an import that filed a
        salary as a rise. The ledger is evidence of what somebody was PAID;
        a line describing an event that never happened is not evidence, it is
        noise that every later figure is then computed against. Same flag as
        the correction window, so it is equally transaction-local and equally
        unreachable from outside the function that opens it. */
  if tg_op = 'DELETE'
     and current_setting('app.salary_history_correction', true) = 'true'
  then
    return old;
  end if;

  raise exception
    'Salary history is append-only outside a correction. Use correct_salary_history_entry, or (for the joining baseline) set_joining_salary — % is not permitted directly.',
    tg_op
    using errcode = 'restrict_violation';
end;
$$;

/* ============================================================================
   4. REMOVING A RISE THAT WAS NEVER ONE

   Not a convenience. The grid can add and correct; with no way to remove, a
   row entered against the wrong person stays on their record for ever, and
   §17's "never delete a submitted layer" is about evaluation layers, not about
   a mis-keyed pay line that describes nothing that happened.

   Audited before the row goes, because afterwards the audit row is the only
   remaining evidence it existed (F5-3).
   ========================================================================== */

create or replace function public.delete_increment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old    record;
  v_caller uuid := (select auth.uid());
begin
  if v_caller is not null and not (public.is_hr() or public.is_md()) then
    raise exception 'Only HR or management can change what somebody is paid.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_old from public.salary_history where id = p_id;
  if not found then return; end if;
  if v_old.reason = 'JOINING' then
    raise exception 'The joining salary is not removed from here.' using errcode = 'restrict_violation';
  end if;
  if v_old.evaluation_id is not null then
    raise exception 'This rise came from a closed increment cycle and is part of that record.'
      using errcode = 'restrict_violation';
  end if;

  perform public.log_admin_action(
    'employment', v_old.profile_id, 'salary.increment_removed', null, null,
    jsonb_build_object('entry', p_id, 'effective_from', v_old.effective_from)
  );

  perform set_config('app.salary_history_correction', 'true', true);
  delete from public.salary_history where id = p_id;

  perform public.rebuild_salary_chain(v_old.profile_id);
end;
$$;

revoke all on function public.delete_increment(uuid) from public;
grant execute on function public.delete_increment(uuid) to authenticated;

/* ============================================================================
   5. THE 19-08-2026 IMPORT IS CLEARED

   AT THE OWNER'S EXPLICIT INSTRUCTION — asked, and answered "logic badlo, phir
   main sheet dobara upload karungi".

   Those 58 rows were written by an importer that read HR's `increment_N_amount`
   column as a NEW SALARY. The damage is not a rounding error: Nandkishor Desai
   joined on ₹48,000 a month, was given ₹10,000 and then ₹7,000, and the record
   said he was being paid ₹7,000 — with two pay CUTS of −79% and −30% filed as
   evidence. Twelve rows across the company carry a negative rise.

   They cannot be repaired by arithmetic. HR's own sheet for Anand Saraswat
   shows four increments and a joining salary of ₹20,000; the import carried two
   increments and ₹30,000. What is missing was never in the file.

   So they go, and the corrected sheet is re-imported — which works precisely
   because F61-1 fills a ledger only when it is EMPTY.

   THE TWO ROWS THAT ARE NOT FROM THE IMPORT ARE KEPT. One was confirmed at a
   real increment interview and belongs to a closed cycle; the other was typed
   in the app and is internally correct. Both already mean what this migration
   says they mean, and both survive the rebuild unchanged.
   ========================================================================== */

do $$
declare
  v_import integer;
  v_kept   integer;
begin
  select count(*) into v_import
    from public.salary_history
   where note = 'Recorded when the account was created.';

  select count(*) into v_kept
    from public.salary_history
   where note is distinct from 'Recorded when the account was created.';

  if v_import = 0 then
    raise notice '0109: no import rows to clear (already done, or a fresh database).';
  else
    -- Through the same door `delete_increment` uses, rather than by switching
    -- the guard off. A migration that disables a trigger leaves a window in
    -- which ANY write is permitted; this one only ever admits a DELETE.
    perform set_config('app.salary_history_correction', 'true', true);

    delete from public.salary_history
     where note = 'Recorded when the account was created.';

    perform set_config('app.salary_history_correction', 'false', true);

    raise notice '0109: cleared % imported pay rows, kept %.', v_import, v_kept;
  end if;

  -- §12. No figure in the diff (§5, P19-10) — a count is not an amount.
  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (
    null, 'employment', gen_random_uuid(), 'salary.import_ledger_cleared',
    jsonb_build_object('rows', v_import, 'kept', v_kept,
                       'why', 'increment amounts had been stored as new salaries')
  );
end;
$$;

/* ============================================================================
   6. EVERY CHAIN RE-DERIVED

   Including the people whose ledger is now empty: their current salary becomes
   what they joined on, which is the honest answer until the rises are
   re-entered.
   ========================================================================== */

do $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  for v_id in select profile_id from public.employment_records loop
    perform public.rebuild_salary_chain(v_id);
    v_count := v_count + 1;
  end loop;
  raise notice '0109: re-derived % employment records.', v_count;
end;
$$;

/* ============================================================================
   7. VERIFICATION — the migration proves its own claims

   0056 reported a success it had not achieved because its check shared the
   flaw it was checking. These assert the STATE, which cannot be satisfied by
   the migration merely having run.
   ========================================================================== */

do $$
declare
  v_bad     integer;
  v_neg     integer;
  v_missing integer;
  v_def     text;
begin
  -- Every record's current figure IS joining + the rises that have taken effect.
  select count(*) into v_bad
    from public.employment_records e
   where e.joining_ctc is not null
     and e.current_ctc is distinct from (
       e.joining_ctc + coalesce((
         select sum(h.hike_amount) from public.salary_history h
          where h.profile_id = e.profile_id
            and h.reason <> 'JOINING'
            and h.effective_from <= current_date
       ), 0));
  if v_bad > 0 then
    raise exception '0109: % records do not equal joining + rises to date.', v_bad;
  end if;

  -- No fabricated pay cut survives.
  select count(*) into v_neg from public.salary_history where hike_amount < 0;
  if v_neg > 0 then
    raise exception '0109: % rows still carry a negative rise.', v_neg;
  end if;

  -- The four functions exist and are callable.
  select count(*) into v_missing
    from (values ('rebuild_salary_chain'), ('record_increment'), ('correct_increment'), ('delete_increment')) t(n)
   where not exists (
     select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = current_schema() and p.proname = t.n);
  if v_missing > 0 then
    raise exception '0109: % of the four functions were not created.', v_missing;
  end if;

  /* -- ALL THREE WINDOWS, not only the one this migration added. 0106 passed
        its own verification while having destroyed 0093's, because it asserted
        only its own clause (F/0108). This is that lesson, applied. -- */
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = current_schema() and p.proname = 'salary_history_is_append_only';
  if v_def is null then
    raise exception '0109: salary_history_is_append_only is missing.';
  end if;
  if v_def not like '%app.salary_history_correction%' then
    raise exception '0109: the correction window (0093) is missing.';
  end if;
  if v_def not like '%new.evaluation_id is null%' then
    raise exception '0109: the detach window (0106) is missing.';
  end if;
  if v_def not like '%tg_op = ''DELETE''%' then
    raise exception '0109: the removal window (0109) is missing.';
  end if;

  raise notice '0109: verified — every current salary is joining + rises to date.';
end;
$$;

commit;

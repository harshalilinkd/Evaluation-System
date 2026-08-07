-- 0028_employment_import.sql
-- The bulk employment import P19 asked for, and P19's own log recorded as
-- "not started".
--
-- WHY THIS IS SQL AND NOT A TYPESCRIPT LOOP
--
-- The brief says "import all or nothing". P19-C's *user* import could not honour
-- that and said so: creating an auth account is an Admin API call, not a
-- database write, so a half-finished run cannot be unwound and the honest design
-- there was a per-row report.
--
-- This import is different in exactly the way that matters. Every write is a
-- database write — an `employment_records` upsert and an optional
-- `salary_history` append against people who already exist. So all-or-nothing is
-- actually achievable, and the only way to achieve it is one transaction, which
-- means one function.
--
-- The split is P10-2's: **TypeScript decides, SQL commits.** The CSV is parsed,
-- every row validated and every employee code resolved to a profile id in
-- TypeScript — none of which belongs in PL/pgSQL — and the function receives a
-- payload it either writes entirely or not at all.
--
-- SAFE TO RE-RUN.

begin;

create or replace function public.import_employment(p_rows jsonb, p_file text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor    uuid := (select auth.uid());
  v_batch    uuid := gen_random_uuid();
  v_row      jsonb;
  v_rows     int := 0;
  v_salary   int := 0;
  v_ctc      numeric(12, 2);
  v_previous numeric(12, 2);
  v_when     date;
  v_reason   text;
begin
  -- §9 as amended: HR writes the employment record; the MD reads it. This is a
  -- write, so it is HR alone. `is_admin()` is deliberately not used — AMEND-2
  -- retired it for every salary gate (P19-4).
  if v_actor is not null and not public.is_hr() then
    raise exception 'Only HR can import employment data.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'There is nothing to import.'
      using errcode = 'invalid_parameter_value';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    if v_row ->> 'profile_id' is null then
      -- Should be impossible: the caller resolves every code before sending.
      -- Raising rather than skipping is the point of the phase — a row that
      -- silently did not import is the thing all-or-nothing exists to prevent.
      raise exception 'A row reached the database with no person attached.'
        using errcode = 'invalid_parameter_value';
    end if;

    /* -- The joining date lives on `profiles` (0024). One joining date; the
          copy this table used to carry disagreed with it. -- */
    if v_row ->> 'date_of_joining' is not null then
      update public.profiles
         set date_of_joining = (v_row ->> 'date_of_joining')::date
       where id = (v_row ->> 'profile_id')::uuid;
    end if;

    v_ctc := nullif(v_row ->> 'current_ctc', '')::numeric;

    insert into public.employment_records as e (
      profile_id, last_increment_date, increment_frequency_months,
      employment_type, current_ctc, salary_effective_from
    )
    values (
      (v_row ->> 'profile_id')::uuid,
      nullif(v_row ->> 'last_increment_date', '')::date,
      coalesce(nullif(v_row ->> 'increment_frequency_months', '')::int, 12),
      coalesce(nullif(v_row ->> 'employment_type', ''), 'PERMANENT'),
      v_ctc,
      -- The CTC is effective from the last increment where there is one, and
      -- otherwise from the day they joined.
      coalesce(
        nullif(v_row ->> 'last_increment_date', '')::date,
        nullif(v_row ->> 'date_of_joining', '')::date)
    )
    on conflict (profile_id) do update set
      last_increment_date        = excluded.last_increment_date,
      increment_frequency_months = excluded.increment_frequency_months,
      employment_type            = excluded.employment_type,
      -- A blank CTC column in the file means "not in this file", never "set it
      -- to nothing". Wiping a salary because a column was left empty is the
      -- most expensive thing this import could do.
      current_ctc                = coalesce(excluded.current_ctc, e.current_ctc),
      salary_effective_from      = coalesce(excluded.salary_effective_from, e.salary_effective_from);

    /* -- Provenance for the figure.
          A `current_ctc` with no history behind it is a number nobody can
          account for. The row composed here is the same one the Employment tab
          would have written (P19C-2): ANNUAL_INCREMENT at the last increment
          date, or JOINING at the joining date when there has not been one.

          `previous_ctc` and the hike are left null rather than guessed — an
          initial load knows today's figure, not the one before it, and P19-7
          forbids accepting a previous figure from the caller. -- */
    if v_ctc is not null then
      v_when := coalesce(
        nullif(v_row ->> 'last_increment_date', '')::date,
        nullif(v_row ->> 'date_of_joining', '')::date);
      v_reason := case
        when nullif(v_row ->> 'last_increment_date', '') is not null then 'ANNUAL_INCREMENT'
        else 'JOINING'
      end;

      if v_when is not null then
        -- Nothing is overwritten: the table has no UPDATE path for anyone
        -- (§18 P19-3). A re-import of the same file appends nothing new only
        -- because the guard below checks for an identical row first.
        select s.new_ctc into v_previous
          from public.salary_history s
         where s.profile_id = (v_row ->> 'profile_id')::uuid
           and s.effective_from = v_when
           and s.new_ctc = v_ctc
         limit 1;

        if v_previous is null then
          insert into public.salary_history (
            profile_id, effective_from, previous_ctc, new_ctc,
            hike_amount, hike_pct, reason, recorded_by, note
          )
          values (
            (v_row ->> 'profile_id')::uuid, v_when, null, v_ctc,
            null, null, v_reason, v_actor,
            'Bulk import: ' || coalesce(p_file, 'unnamed file'));
          v_salary := v_salary + 1;
        end if;
        v_previous := null;
      end if;
    end if;

    v_rows := v_rows + 1;
  end loop;

  /* -- ONE audit row for the batch, per the brief.
        It names the file and the count and carries NO figure — §5 confinement,
        and 0013 lets a lead read audit_log for their own reports, so a CTC here
        would walk straight past it (P19-10). `salary_rows` is a count of rows
        written, not an amount. -- */
  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (
    v_actor, 'employment_import', v_batch, 'employment.imported',
    jsonb_build_object(
      'file', coalesce(p_file, 'unnamed file'),
      'rows', v_rows,
      'salary_rows', v_salary));

  return jsonb_build_object('batch_id', v_batch, 'rows', v_rows, 'salary_rows', v_salary);
end;
$$;

comment on function public.import_employment(jsonb, text) is
  'All-or-nothing bulk employment import (P19). TypeScript parses and validates; this commits, or nothing commits. Writes ONE audit row naming the file and the row count, and never a salary figure (§5).';

revoke all on function public.import_employment(jsonb, text) from public;
grant execute on function public.import_employment(jsonb, text) to authenticated;

commit;

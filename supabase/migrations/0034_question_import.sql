-- 0034_question_import.sql
-- Departments for the role mapping, and a transactional bulk question import.
--
-- The blueprint (ROLE_QUESTIONS.md) proposed `0019_role_profiles.sql` and a new
-- role_profiles table. 0019 is `0019_departments_reconcile.sql` and is applied,
-- so §0.8 makes this 0034 — the same call as 0010, 0017, 0021, 0022, 0023,
-- 0028, 0029 and 0030.
--
-- The role/department decision was the owner's, made explicitly: departments
-- carry the questions, and the roles that need their own question set become
-- departments of their own. Recorded in §18 rather than absorbed silently.

/* ============================================================================
   1. The rename — EXPLICITLY INSTRUCTED
   ========================================================================== */
--
-- §0.2 freezes a department name once created. The owner named this one
-- directly ("rename MIS as data analyst"), which is the explicit instruction
-- §0.2 requires. The CODE is deliberately untouched: `department_questions`,
-- `profiles` and every launched `evaluations` row join on the id, so nothing
-- moves — but the code is what scripts and fixtures resolve by, and changing
-- both at once would break `rls.sql`'s lookup for no gain (F1-4).

update public.departments
   set name = 'Data Analyst'
 where code = 'MISSYS'
   and name <> 'Data Analyst';

/* ============================================================================
   2. The new departments
   ========================================================================== */
--
-- Six roles from the source sheet need their own Job Specific Skills set and
-- have no department that fits. Idempotent on the code, so a second run adds
-- nothing.

insert into public.departments (name, code, is_active)
values
  ('Sales Coordinator',  'SALESCOORD', true),
  ('Design Coordinator', 'DESIGNCOORD', true),
  ('Process Coordinator','PROCCOORD',  true),
  ('Executive Assistant','EA',         true),
  ('Supervisor',         'SUPERVISOR', true),
  ('SAB Operator',       'SABOPS',     true)
on conflict (code) do nothing;

/* ============================================================================
   3. import_questions
   ========================================================================== */
--
-- All-or-nothing, so it is one PL/pgSQL function rather than a loop of
-- PostgREST calls — the same split P10-2, P14-1 and P19D-2 make: TypeScript
-- parses the file, validates every row and resolves every department, none of
-- which belongs in PL/pgSQL; the function receives a payload it writes
-- entirely or not at all.
--
-- SECURITY DEFINER with an internal is_hr() gate, like `launch_cycle` (P10-4):
-- it creates departments and questions on behalf of a caller whose own policies
-- would allow it, but the capability is worth confining to one audited path.
-- §9 as amended gives the write to HR and the read to the MD, so the MD is
-- refused here even though they may look at the bank.

create or replace function public.import_questions(
  p_rows        jsonb,
  p_file        text,
  p_create_departments boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller       uuid := (select auth.uid());
  v_row          jsonb;
  v_dept_name    text;
  v_dept_id      uuid;
  v_key          text;
  v_question_id  uuid;
  v_created      int := 0;
  v_mapped       int := 0;
  v_new_depts    int := 0;
  v_next_sort    int;
  v_departments  text[] := '{}';
  -- Questions created during THIS run, keyed by normalised text. A question
  -- shared by several roles ("Timely Completion of Assigned Work") appears once
  -- per role in the file and must become ONE row mapped several times.
  v_new_ids      jsonb := '{}'::jsonb;
begin
  if v_caller is null or not public.is_hr() then
    raise exception 'Only HR can import questions.' using errcode = 'insufficient_privilege';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'The import payload must be an array of rows.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The section's current high-water mark. New questions are appended rather
  -- than interleaved, so an import never reorders what HR has already arranged.
  select coalesce(max(sort_order), 0) into v_next_sort
    from public.questions
   where section = 'DEPARTMENT_SPECIFIC';

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_dept_name := btrim(v_row ->> 'department');
    v_key       := lower(regexp_replace(btrim(v_row ->> 'text'), '\s+', ' ', 'g'));

    if v_dept_name is null or v_dept_name = '' or v_key = '' then
      raise exception 'A row arrived with no department or no question text.'
        using errcode = 'invalid_parameter_value';
    end if;

    /* -- The department. -- */
    select id into v_dept_id
      from public.departments
     where lower(name) = lower(v_dept_name)
     limit 1;

    if v_dept_id is null then
      if not p_create_departments then
        raise exception 'There is no "%" department. Confirm creating it, or correct the file.', v_dept_name
          using errcode = 'invalid_parameter_value';
      end if;
      -- Code derived from the name: upper case, letters and digits only, capped.
      -- `departments.code` is unique, so a collision falls back to the name.
      insert into public.departments (name, code, is_active)
      values (
        v_dept_name,
        left(upper(regexp_replace(v_dept_name, '[^A-Za-z0-9]', '', 'g')), 12),
        true
      )
      returning id into v_dept_id;
      v_new_depts := v_new_depts + 1;
    end if;

    if not (v_dept_name = any (v_departments)) then
      v_departments := array_append(v_departments, v_dept_name);
    end if;

    /* -- The question. Four cases, in order of preference:
          the caller resolved it; it was created earlier in THIS import; it is
          already in the bank under the same text; or it is genuinely new. -- */
    v_question_id := nullif(v_row ->> 'existing_id', '')::uuid;

    if v_question_id is null then
      v_question_id := nullif(v_new_ids ->> v_key, '')::uuid;
    end if;

    /* -- The lookup by text is NOT redundant with the caller's `existing_id`.
          The action layer resolves it and passes it in, but this function is
          granted to `authenticated` and is callable straight through PostgREST
          with a payload of the caller's choosing — so relying on that field
          would make "re-importing the same file creates nothing" a property of
          the CALLER rather than of the import. Found by the suite: the same
          file twice, with existing_id left null, duplicated every question.
          Matches `questionKey()` in lib/questions/import.ts — trim, lower,
          collapse whitespace — so both halves agree on what "the same question"
          means. Retired questions are excluded deliberately: a re-import must
          not quietly bring one back onto a form. -- */
    if v_question_id is null then
      select id into v_question_id
        from public.questions
       where is_active
         and lower(regexp_replace(btrim(text), '\s+', ' ', 'g')) = v_key
       limit 1;
    end if;

    if v_question_id is null then
      v_next_sort := v_next_sort + 10;
      insert into public.questions (
        text, help_text, section, response_type, category, track,
        answered_by, is_required, is_active, sort_order, cycle_scope
      )
      values (
        btrim(v_row ->> 'text'),
        nullif(btrim(coalesce(v_row ->> 'help_text', '')), ''),
        'DEPARTMENT_SPECIFIC',
        (v_row ->> 'response_type')::public.response_type,
        'DEPARTMENT',
        'STAFF',
        (v_row ->> 'answered_by')::public.answered_by,
        coalesce((v_row ->> 'is_required')::boolean, true),
        true,
        v_next_sort,
        'BOTH'
      )
      returning id into v_question_id;

      v_new_ids := v_new_ids || jsonb_build_object(v_key, v_question_id::text);
      v_created := v_created + 1;
    end if;

    /* -- The mapping. `on conflict do nothing` so re-importing the same file is
          a genuine no-op rather than a unique violation — the brief's own
          acceptance criterion. -- */
    insert into public.department_questions (department_id, question_id, sort_order)
    values (
      v_dept_id,
      v_question_id,
      coalesce((v_row ->> 'sort_order')::int, 0)
    )
    on conflict (department_id, question_id) do nothing;

    if found then v_mapped := v_mapped + 1; end if;
  end loop;

  /* -- One audit row for the batch (P19D-8): the file, the counts and the
        departments touched. `entity_id` is not null, so the batch takes a
        generated id — it is a real event and deserves one. -- */
  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (
    v_caller,
    'question_import',
    gen_random_uuid(),
    'questions.imported',
    jsonb_build_object(
      'file', p_file,
      'rows', jsonb_array_length(p_rows),
      'questions_created', v_created,
      'mappings_added', v_mapped,
      'departments_created', v_new_depts,
      'departments', to_jsonb(v_departments)
    )
  );

  return jsonb_build_object(
    'questions_created', v_created,
    'mappings_added', v_mapped,
    'departments_created', v_new_depts
  );
end;
$$;

revoke all on function public.import_questions(jsonb, text, boolean) from public;
grant execute on function public.import_questions(jsonb, text, boolean) to authenticated;

comment on function public.import_questions(jsonb, text, boolean) is
  'Bulk Job Specific Skills import. HR only, all-or-nothing, one audit row per batch. Shared text becomes ONE question row mapped to several departments.';

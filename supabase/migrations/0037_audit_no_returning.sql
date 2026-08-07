-- 0037_audit_no_returning.sql
-- The employee could not submit. INSERT ... RETURNING needs a SELECT policy.
--
-- THE BUG, and why it hit one side and not the other.
--
-- `apply_evaluation_transition` finishes by writing the §12 audit row:
--
--     insert into public.audit_log (...) values (...) returning id into v_audit_id;
--
-- Under row-level security, `INSERT ... RETURNING` reads the row back, so it
-- requires a **SELECT** policy as well as the INSERT one. Postgres reports the
-- failure as "new row violates row-level security policy for table audit_log",
-- which points at the WITH CHECK and is thoroughly misleading — the insert
-- itself was permitted.
--
-- Who has a SELECT policy on audit_log:
--   HR and the MD            0005
--   a LEAD, for their own reports   0013  (P13-5, added so the queue could say
--                                          "returned on {date}")
--   the EVALUATEE            nobody
--
-- So a HOD submitting their review passes — they are the lead of that
-- evaluation — and the employee submitting their own self-evaluation fails.
-- Exactly the asymmetry that was reported: "HOD submitted employees form but
-- employee not able to submit his self evaluation form."
--
-- THE FIX, and the one that was NOT taken.
--
-- The obvious repair is to give the evaluatee a SELECT on audit rows for their
-- own evaluation. That would be a blindness leak (§5): the transition rows for
-- that evaluation include the LEAD's submission, so an employee reading them
-- would learn their manager had rated them and when. AMEND-3 exists to prevent
-- precisely that.
--
-- So the id is generated before the insert instead, and RETURNING is dropped.
-- The function returns the same value it always did, nothing about who may READ
-- the audit trail changes, and §12's append-only guarantee is untouched.
--
-- Patched rather than restated (A1-5, P19B-17, F2-3): the body is long and
-- already tested, and every replacement below verifies it matched.

do $patch$
declare
  v_src text;
  v_new text;
  v_pairs text[][] := array[
    -- Generate the id up front, so there is nothing to read back.
    array[
      '  insert into public.audit_log (',
      '  v_audit_id := gen_random_uuid();' || E'\n\n' || '  insert into public.audit_log ('
    ],
    array[
      '    actor_id, entity, entity_id, action, from_status, to_status, diff, reason',
      '    id, actor_id, entity, entity_id, action, from_status, to_status, diff, reason'
    ],
    array[
      '    p_actor_id, ''evaluation'', p_evaluation_id, p_action,',
      '    v_audit_id, p_actor_id, ''evaluation'', p_evaluation_id, p_action,'
    ],
    /* -- And drop the read-back.
          Deliberately a SINGLE-LINE target. The first attempt matched across
          the newline before it — `E')\n  returning id into v_audit_id;'` — and
          failed on the real database while passing every test, because the
          stored body has CRLF line endings (this repository has been rewritten
          to CRLF by an editing pass before: see AMEND-1's note) and the test
          fixture was built from LF text.
          `values (...)` followed by a newline and a bare `;` is valid SQL, so
          there is nothing to tidy up after the token goes. -- */
    array[
      'returning id into v_audit_id;',
      ';'
    ]
  ];
  v_i int;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'apply_evaluation_transition';

  if v_src is null then
    raise exception '0037: public.apply_evaluation_transition does not exist.';
  end if;

  -- Already done? Then there is nothing to patch and nothing to complain about.
  if v_src not like '%returning id into v_audit_id%' then
    raise notice '0037: apply_evaluation_transition already writes its audit row without RETURNING. Nothing to do.';
    return;
  end if;

  v_new := v_src;

  for v_i in 1 .. array_length(v_pairs, 1) loop
    if strpos(v_new, v_pairs[v_i][1]) = 0 then
      raise exception
        '0037: apply_evaluation_transition does not contain "%". Its body is not what this migration expects — inspect it before proceeding.',
        v_pairs[v_i][1];
    end if;
    v_new := replace(v_new, v_pairs[v_i][1], v_pairs[v_i][2]);
  end loop;

  execute v_new;
end;
$patch$;


/* ---------- Proof, in the same transaction ---------- */

do $patch$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'apply_evaluation_transition';

  if v_src like '%returning id into v_audit_id%' then
    raise exception '0037 failed: the audit row is still read back.';
  end if;
  if v_src not like '%v_audit_id := gen_random_uuid()%' then
    raise exception '0037 failed: the audit id is no longer generated.';
  end if;

  raise notice '0037: the audit row is written without reading it back. An employee can submit their own evaluation again.';
end;
$patch$;

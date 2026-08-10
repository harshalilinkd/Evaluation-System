-- 0056 — HR may approve the figure and close an increment.
--
-- ============================================================================
-- THIS REMOVES THE SECOND PAIR OF EYES ON A PAY DECISION.
--
-- At the owner's explicit instruction, asked twice: "either MD will do this or
-- HR", then "give it close option to hr also".
--
-- What is being given up, stated plainly rather than discovered later.
-- AMEND-1 merged HR_ADMIN and MD and recorded the consequence: "there is no
-- longer a second pair of eyes on a pay decision. Whoever authors the questions
-- can also launch the cycle, write the final scores and set the increment."
-- AMEND-2 reversed that on purpose — the v3 flow has HR prepare and propose and
-- the MD approve, and P21-6 built the column-split trigger so that "HR could not
-- award themselves the approved figure" and the MD could not rewrite HR's
-- justification.
--
-- After this migration HR can do both halves. One person can propose a rise,
-- approve it, and close it onto somebody's pay record without anybody else
-- touching the record.
--
-- WHAT IS KEPT, because it is what makes the change answerable rather than
-- invisible:
--   · The MD's columns stay separate columns. HR writing them is recorded AS
--     HR writing them — `audit_log` takes its actor from the session, so the
--     row says who really pressed it.
--   · The MD may still not rewrite HR's proposal or the employee's
--     expectation. That half of the trigger is untouched: this widens one
--     direction only.
--   · Nobody else gains anything. A HOD or an employee is refused exactly as
--     before.
--
-- TO REVERSE: restore the `is_hr()` branch below to its 0030 form, put
-- `actors: ["MD"]` back on the HR_APPROVED -> MD_REVIEWED row in
-- `lib/evaluations/transitions.ts`, and restore `requireMd` on `saveApproval`,
-- `mdApprove` and `approveAndClose`.
-- ============================================================================

begin;

/* ---------- 1. §8: HR may record the MD's review ---------- */

do $mig$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_evaluation_transition'
   limit 1;

  if v_def is null then
    raise exception '0056: apply_evaluation_transition does not exist. Apply 0021 first.';
  end if;

  if v_def like '%HR_APPROVED%MD_REVIEWED%is_hr() or public.is_md()%' then
    raise notice '0056: §8 arm already widened.';
  else
    /* `\s+` rather than a literal newline: the stored body is CRLF on this
       project and a patch that only matched LF has failed here before
       (FIX-10 addendum). */
    v_new := regexp_replace(
      v_def,
      'when p_from_status = ''HR_APPROVED'' and p_to_status = ''MD_REVIEWED''\s+then public\.is_md\(\)',
      'when p_from_status = ''HR_APPROVED'' and p_to_status = ''MD_REVIEWED'''
        || E'\n      then public.is_hr() or public.is_md()'
    );

    if v_new = v_def then
      raise exception
        '0056: could not find the HR_APPROVED -> MD_REVIEWED arm. Nothing was changed.';
    end if;

    execute v_new;
  end if;
end;
$mig$;

/* ---------- 2. The column guard: HR may set the approved figure ---------- */

do $guard$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'guard_increment_review_columns'
   limit 1;

  if v_def is null then
    raise exception '0056: guard_increment_review_columns does not exist. Apply 0030 first.';
  end if;

  if v_def not like '%HR may not award themselves%' then
    raise notice '0056: the HR branch is already widened.';
    return;
  end if;

  /* -- The whole `if public.is_hr() then ... end if;` block collapses to a
        permit. Matched on the raise's own message, which appears once.

        HR's branch used to refuse `md_approved_ctc`, `md_approved_hike_pct`
        and `md_remarks`. It now permits them. The MD's branch below is left
        exactly as it was, so this opens one direction and not the other. -- */
  v_new := regexp_replace(
    v_def,
    'if public\.is_hr\(\) then.*?return new;\s*end if;',
    'if public.is_hr() then'
      || E'\n    -- 0056: HR may set the approved figure, at the owner''s instruction.'
      || E'\n    -- The audit row records HR as the actor, so the record still says'
      || E'\n    -- who really pressed it.'
      || E'\n    return new;'
      || E'\n  end if;',
    'n'  -- `.` matches newlines, so the multi-line block is reachable
  );

  if v_new = v_def then
    raise exception '0056: could not find the HR branch of the column guard. Nothing was changed.';
  end if;

  execute v_new;
end;
$guard$;

/* ---------- 3. Prove both took ---------- */

do $chk$
declare
  v_t text;
  v_g text;
begin
  select pg_get_functiondef(oid) into v_t from pg_proc
   where proname = 'apply_evaluation_transition'
     and pronamespace = 'public'::regnamespace limit 1;

  select pg_get_functiondef(oid) into v_g from pg_proc
   where proname = 'guard_increment_review_columns'
     and pronamespace = 'public'::regnamespace limit 1;

  if v_t not like '%HR_APPROVED%MD_REVIEWED%is_hr() or public.is_md()%' then
    raise exception '0056: verification failed — HR still cannot record the MD review.';
  end if;

  if v_g like '%HR may not award themselves%' then
    raise exception '0056: verification failed — the column guard still refuses HR.';
  end if;

  -- The half that must NOT have moved.
  if v_g not like '%HR''s proposal and the employee''s expectation are not the MD''s to edit%' then
    raise exception
      '0056: the MD''s branch was altered. It must not be — this widens one direction only.';
  end if;

  raise notice '0056: HR may now approve and close an increment. The MD''s restrictions are unchanged.';
end;
$chk$;

commit;

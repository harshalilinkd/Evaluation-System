-- 0045 — the MD may close an increment they have just confirmed.
--
-- THE BUG, AND WHY IT ONLY SHOWED AT THE VERY LAST STEP.
--
-- `confirm_increment` (0030) is granted to HR *or* the MD and performs BOTH
-- closing transitions inside one transaction:
--
--     MD_REVIEWED    -> INTERVIEW_DONE     is_hr() or is_md()
--     INTERVIEW_DONE -> CLOSED             is_hr() or <system>
--
-- So the MD was admitted to the first and refused the second. The function is
-- atomic, so the whole thing rolled back and reported, correctly:
--
--     Nothing was changed: You are not permitted to move this evaluation
--     from INTERVIEW_DONE to CLOSED.
--
-- That is an incoherent grant rather than a policy: a role allowed to start an
-- indivisible operation must be allowed to finish it, or it can never run at
-- all. Nobody hit it earlier because HR had always been the one to confirm.
--
-- At the owner's explicit instruction the MD now approves AND closes. §8's row
-- gains MD alongside HR; HR keeps the power and the system actor still holds it
-- for the cron path. Nothing else about the table moves.
--
-- P5-1 duplicated §8 into SQL deliberately and noted both halves must change
-- together: `lib/evaluations/transitions.ts` is updated in the same change.

begin;

do $$
declare
  v_def  text;
  v_new  text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'apply_evaluation_transition'
   limit 1;

  if v_def is null then
    raise exception '0045: apply_evaluation_transition does not exist. Apply 0021 first.';
  end if;

  -- Already patched — safe to re-run.
  if v_def like '%INTERVIEW_DONE%is_md() or v_is_system%' then
    raise notice '0045: already applied, nothing to do.';
    return;
  end if;

  /* -- MATCHED WITH `\s+`, NOT A LITERAL NEWLINE.
        The stored body is CRLF on this project — a patch-in-place migration
        that only ever matched LF failed against the real database once already
        (FIX-10 addendum), and it failed on the single replacement that spanned
        a line break. `\s+` matches either ending and any indentation.

        The pattern is anchored on the INTERVIEW_DONE arm specifically: the
        clause `then public.is_hr() or v_is_system` appears twice in this
        function, so replacing it alone would be ambiguous and would silently
        widen the wrong row. -- */
  v_new := regexp_replace(
    v_def,
    'when p_from_status = ''INTERVIEW_DONE'' and p_to_status = ''CLOSED''\s+then public\.is_hr\(\) or v_is_system',
    'when p_from_status = ''INTERVIEW_DONE'' and p_to_status = ''CLOSED'''
      || E'\n      then public.is_hr() or public.is_md() or v_is_system'
  );

  if v_new = v_def then
    raise exception
      '0045: could not find the INTERVIEW_DONE -> CLOSED arm in apply_evaluation_transition. Nothing was changed.';
  end if;

  execute v_new;
end;
$$;

-- Read the rewritten body back and prove the change took. A patch-in-place
-- migration that reports success without verifying is how a fix ships and does
-- nothing.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'apply_evaluation_transition'
   limit 1;

  if v_def not like '%INTERVIEW_DONE%is_md() or v_is_system%' then
    raise exception '0045: verification failed — the MD is still refused INTERVIEW_DONE -> CLOSED.';
  end if;

  raise notice '0045: the MD may now close an increment.';
end;
$$;

commit;

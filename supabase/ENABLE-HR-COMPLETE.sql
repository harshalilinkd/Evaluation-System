-- =============================================================================
-- ENABLE "APPROVE AND COMPLETE"  —  paste this whole file into the Supabase
-- SQL editor and press Run.
--
-- WHAT IT DOES
--   Lets HR finish an EVALUATION cycle without the MD:
--
--       PENDING_HR_REVIEW  ->  CLOSED        HR_ADMIN, evaluation cycles only
--
--   The button already exists on /reports/[id]. Until this runs, pressing it
--   fails with "You are not permitted to move this evaluation from
--   PENDING_HR_REVIEW to CLOSED" — that message comes from the database, not
--   the app, which is why no amount of application code can route around it.
--   §8's transition table is duplicated in SQL on purpose (P5-1): the function
--   is granted to `authenticated` and callable straight through PostgREST, so
--   a rule that lived only in TypeScript would not be a rule.
--
-- WHAT IT DOES NOT DO
--   An INCREMENT cycle still cannot be closed without the MD. AMEND-2 split HR
--   and MD apart precisely so a PAY decision gets a second pair of eyes, and
--   HR proposing and approving the same increment is the thing that split
--   exists to prevent. The `cycle_type` test below is what enforces it, and the
--   check at the bottom refuses to leave the function in place without it.
--
-- SAFE TO RUN TWICE. It detects its own work and says so.
--
-- This is the same content as supabase/migrations/0039_hr_close_evaluation.sql,
-- kept separately so it can be pasted in one go without hunting through the
-- migrations folder.
-- =============================================================================

do $$
declare
  v_src  text;
  v_from text;
  v_to   text;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'apply_evaluation_transition';

  if v_src is null then
    raise exception
      'apply_evaluation_transition does not exist. Apply 0021_blind_rating.sql first.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'evaluation_cycles'
      and column_name = 'cycle_type'
  ) then
    raise exception
      'evaluation_cycles.cycle_type is missing. Apply 0022_cycle_type.sql first — '
      'without it this cannot tell an evaluation from an increment, and would hand '
      'HR the power to close a pay decision.';
  end if;

  -- Already done?
  if position('p_from_status = ''PENDING_HR_REVIEW'' and p_to_status = ''CLOSED''' in v_src) > 0 then
    raise notice 'Already applied — nothing to do.';
    return;
  end if;

  /* -- ONE SINGLE-LINE ANCHOR, and that is deliberate.
        The stored function body carries CRLF line endings on this project, so
        a search string spanning a newline matches in testing and silently
        fails against the real database (that is exactly how 0037 failed the
        first time). This anchor contains no newline. -- */
  v_from := '    when p_from_status = ''MD_REVIEWED'' and p_to_status = ''CLOSED''';

  if position(v_from in v_src) = 0 then
    raise exception
      'Could not find the MD_REVIEWED -> CLOSED branch in apply_evaluation_transition. '
      'The function has been rewritten since 0021 — re-derive the anchor before re-running.';
  end if;

  v_to :=
    '    -- HR closes an EVALUATION outright. The MD is optional on this track' || E'\n' ||
    '    -- and required on the other, which the cycle_type test enforces.'     || E'\n' ||
    '    when p_from_status = ''PENDING_HR_REVIEW'' and p_to_status = ''CLOSED''' || E'\n' ||
    '      then public.is_hr() and exists ('                                     || E'\n' ||
    '        select 1'                                                           || E'\n' ||
    '        from public.evaluations e2'                                         || E'\n' ||
    '        join public.evaluation_cycles c2 on c2.id = e2.cycle_id'            || E'\n' ||
    '        where e2.id = p_evaluation_id and c2.cycle_type = ''EVALUATION'''   || E'\n' ||
    '      )'                                                                    || E'\n' ||
    v_from;

  execute replace(v_src, v_from, v_to);
  raise notice 'Done. HR can now complete an evaluation cycle without the MD.';
end $$;


-- Read the function back and prove the branch survived, rather than trusting
-- that `replace` matched something.
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'apply_evaluation_transition';

  if position('p_from_status = ''PENDING_HR_REVIEW'' and p_to_status = ''CLOSED''' in v_src) = 0 then
    raise exception 'The new branch is not in the rewritten function.';
  end if;

  if position('c2.cycle_type = ''EVALUATION''' in v_src) = 0 then
    raise exception
      'The branch is present but its EVALUATION-only test is not. Refusing to leave '
      'HR able to close an increment without the MD.';
  end if;

  raise notice 'Verified: the branch is in place and is scoped to EVALUATION cycles.';
end $$;

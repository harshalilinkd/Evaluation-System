-- =============================================================================
-- 0039_hr_close_evaluation.sql
--
-- HR MAY CLOSE AN EVALUATION CYCLE WITHOUT THE MD.
--
-- Adds one row to §8's staff state machine:
--
--     PENDING_HR_REVIEW -> CLOSED     HR_ADMIN, EVALUATION cycles only
--
-- The MD stops being a required step and becomes an optional one. Both endings
-- exist side by side:
--
--   HR reviews -> completes                      (discussed orally; the common case)
--   HR reviews -> sends to MD -> MD approves     (when a second reading is wanted)
--
-- ⚠ THIS DIVERGES FROM §8, AT THE OWNER'S EXPLICIT INSTRUCTION. The constitution
-- has one path to CLOSED for an evaluation and it runs through MD_REVIEWED.
--
-- WHAT IS DELIBERATELY *NOT* CHANGED, and why it is the whole point of the
-- `cycle_type` condition below: an INCREMENT cycle still cannot reach CLOSED
-- without the MD. AMEND-2 un-merged HR and MD precisely so that a pay decision
-- has a second pair of eyes, and AMEND-1 recorded what merging them cost. HR
-- proposing and HR approving the same increment is exactly what that separation
-- exists to prevent, so the new row refuses anything but EVALUATION.
--
-- P5-1: `apply_evaluation_transition` duplicates §8's table in SQL because the
-- function is granted to `authenticated` and callable straight through
-- PostgREST. The TypeScript table alone would not be a guard. Both halves must
-- change together, and this is the SQL half.
--
-- Requires: 0021 (the blind-rating state machine), 0022 (`cycle_type`).
-- =============================================================================

do $$
declare
  v_src  text;
  v_new  text;
  v_from text;
  v_to   text;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'apply_evaluation_transition';

  if v_src is null then
    raise exception '0039: apply_evaluation_transition does not exist. Apply 0021 first.';
  end if;

  -- 0022 added `cycle_type`. Without it the new row cannot tell an evaluation
  -- from an increment, and would hand HR the power to close a pay decision.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'evaluation_cycles'
      and column_name = 'cycle_type'
  ) then
    raise exception '0039: evaluation_cycles.cycle_type is missing. Apply 0022 first.';
  end if;

  /* -- ONE SINGLE-LINE ANCHOR.
        FIX-10 landed this lesson the hard way: the stored function body carries
        CRLF line endings on this machine, so a search string that spans a
        newline matches in the test harness and fails against the real database.
        The anchor below contains no newline. The replacement introduces them,
        which is fine — only the SEARCH has to be newline-free. -- */
  v_from := '    when p_from_status = ''MD_REVIEWED'' and p_to_status = ''CLOSED''';

  v_to :=
    '    -- 0039: HR closes an EVALUATION outright. The MD is optional on this' || E'\n' ||
    '    -- track and required on the other, which is what the cycle_type test' || E'\n' ||
    '    -- enforces — an INCREMENT still has to go through MD_REVIEWED.' || E'\n' ||
    '    when p_from_status = ''PENDING_HR_REVIEW'' and p_to_status = ''CLOSED''' || E'\n' ||
    '      then public.is_hr() and exists (' || E'\n' ||
    '        select 1' || E'\n' ||
    '        from public.evaluations e2' || E'\n' ||
    '        join public.evaluation_cycles c2 on c2.id = e2.cycle_id' || E'\n' ||
    '        where e2.id = p_evaluation_id and c2.cycle_type = ''EVALUATION''' || E'\n' ||
    '      )' || E'\n' ||
    v_from;

  if position(v_from in v_src) > 0 then
    v_new := replace(v_src, v_from, v_to);
    execute v_new;
    raise notice '0039: PENDING_HR_REVIEW -> CLOSED added for EVALUATION cycles.';
  elsif position('p_to_status = ''CLOSED''' in v_src) > 0
    and position('p_from_status = ''PENDING_HR_REVIEW'' and p_to_status = ''CLOSED''' in v_src) > 0
  then
    -- Idempotent: a second run finds its own work and leaves it alone.
    raise notice '0039: already applied, nothing to do.';
  else
    raise exception
      '0039: could not find the MD_REVIEWED -> CLOSED branch in apply_evaluation_transition. '
      'The function has been rewritten since 0021 — re-derive the anchor before re-running.';
  end if;
end $$;

-- Read it back and prove the branch is really there, rather than trusting that
-- `replace` matched something.
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'apply_evaluation_transition';

  if position('p_from_status = ''PENDING_HR_REVIEW'' and p_to_status = ''CLOSED''' in v_src) = 0 then
    raise exception '0039: the new branch is not in the rewritten function.';
  end if;
  if position('c2.cycle_type = ''EVALUATION''' in v_src) = 0 then
    raise exception '0039: the branch is present but its EVALUATION-only test is not. Refusing to leave HR able to close an increment.';
  end if;
end $$;

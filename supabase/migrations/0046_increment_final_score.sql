-- 0046 — an increment records a final score, like an evaluation already does.
--
-- THE GAP. `final_overall` is written in exactly one place: the patch
-- `apply_evaluation_transition` applies when HR closes an EVALUATION cycle
-- (0039). An INCREMENT closes through `confirm_increment`, which handles money
-- and status and never touches the score — so a closed increment showed FINAL
-- as "—" for ever, with no stage at which anybody could have supplied one.
--
-- HOW IT IS DERIVED, AND WHY IT IS DERIVED AT ALL.
--
-- At the owner's instruction the figure is CALCULATED rather than typed: the
-- mean of the two overall scores already stored on the response rows, which HR
-- or the MD then confirm by closing. That is deliberately not an override —
-- §17 forbids rewriting a submitted question score, and nothing here does. Both
-- layers stay exactly as submitted, every answer is untouched, and the report
-- still carries both averages and the gap. This is one headline number for the
-- record, computed from numbers that were already there.
--
-- ⚠ THE TWO LAYERS ARE **SELF** AND **LEAD**. The instruction said "self and MD
-- average ratings"; there is no MD rating in this system to average. AMEND-3
-- removed the MD's rating role outright and §11 states there is no MD override,
-- so no MD response row is ever written and `evaluation_responses` carries a
-- score for SELF and LEAD only. The mean is therefore over those two — the
-- employee's own average and their manager's. Say so if something else was
-- meant; changing the arm below is a one-line edit.
--
-- NO SIGNATURE CHANGE, deliberately. Adding a parameter would create a second
-- overload of `confirm_increment` and every call would then be ambiguous, and
-- dropping the original to avoid that would mean restating 130 lines of applied,
-- tested body from memory (A1-5 warns about exactly this). The score is computed
-- inside the function instead, which is also what "HR or the MD only confirms
-- it" asks for.
--
-- The write rides `p_evaluation_patch` on the CLOSE transition. `evaluations`
-- is UPDATE-able only inside the window that function opens (P5-2), so this is
-- the only legitimate way to set the column — and it lands in the same
-- transaction as the close, so a closed increment can never lack its score.

begin;

do $mig$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'confirm_increment'
   limit 1;

  if v_def is null then
    raise exception '0046: confirm_increment does not exist. Apply 0030 first.';
  end if;

  if v_def like '%p_evaluation_patch%' then
    raise notice '0046: already applied, nothing to do.';
    return;
  end if;

  /* -- `\s+` rather than literal newlines: the stored body is CRLF on this
        project and a patch that only matched LF has failed against the real
        database once already (FIX-10 addendum).

        Anchored on `evaluation.closed_after_interview`, which appears once.
        The other `apply_evaluation_transition` call in this function is the
        INTERVIEW_DONE one, and patching that instead would write the score a
        step early — before the close can be refused. -- */
  v_new := regexp_replace(
    v_def,
    'p_action\s+:= ''evaluation\.closed_after_interview'',\s+p_diff\s+:= jsonb_build_object\(''effective_from'', p_effective_from\)\);',
    'p_action        := ''evaluation.closed_after_interview'','
      || E'\n    p_diff          := jsonb_build_object(''effective_from'', p_effective_from),'
      /* The mean of the two layers that actually carry a score, to two decimals
         like every other stored average (§11). `filter` on not-null rather than
         coalescing to zero: a layer HR skipped has no score, and averaging it
         as 0 would drag a real appraisal down by half. */
      || E'\n    p_evaluation_patch := jsonb_build_object('
      || E'\n      ''final_overall'','
      || E'\n      (select round(avg(r.overall_score)::numeric, 2)'
      || E'\n         from public.evaluation_responses r'
      || E'\n        where r.evaluation_id = p_evaluation_id'
      || E'\n          and r.layer in (''SELF'', ''LEAD'')'
      || E'\n          and r.overall_score is not null)));'
  );

  if v_new = v_def then
    raise exception
      '0046: could not find the closing transition in confirm_increment. Nothing was changed.';
  end if;

  execute v_new;
end;
$mig$;

-- Prove the rewrite took. A patch-in-place migration that reports success
-- without reading the body back is how a fix ships and does nothing.
do $chk$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'confirm_increment'
   limit 1;

  if v_def not like '%final_overall%' then
    raise exception '0046: verification failed — confirm_increment still does not set final_overall.';
  end if;

  raise notice '0046: an increment now records its final score on close.';
end;
$chk$;

commit;

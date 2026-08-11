-- 0060: apply what 0056 reported it had applied.
--
-- 0056 WAS A NO-OP ON EVERY DATABASE IT RAN ON, and it said so cheerfully.
--
-- Its guard was:
--
--   if v_def like '%HR_APPROVED%MD_REVIEWED%is_hr() or public.is_md()%' then
--     raise notice '0056: §8 arm already widened.';
--
-- `LIKE '%A%B%C%'` asks only that A, B and C appear IN THAT ORDER SOMEWHERE in
-- the string. `apply_evaluation_transition` is a long CASE over §8's whole
-- table, and 0021 already put all three in it, in that order, in three
-- unrelated arms:
--
--   line 369  when p_from_status = 'HR_APPROVED' and p_to_status = 'PENDING_HR_REVIEW'
--   line 371  when p_from_status = 'HR_APPROVED' and p_to_status = 'MD_REVIEWED'
--   line 379  when p_from_status = 'MD_REVIEWED' and p_to_status = 'INTERVIEW_DONE'
--               then public.is_hr() or public.is_md()      <-- matched here
--
-- So the pattern matched the UNPATCHED function. 0056 skipped its own work and
-- reported success. Its verification block used the same pattern and passed.
-- `supabase/whats-applied.sql` uses the same pattern and reports 0056 applied.
-- Three checks, one flaw, shared — so the failure is invisible from every angle
-- somebody would think to look from.
--
-- THE CONSEQUENCE: HR pressing "Approve and close" on an INCREMENT is still
-- refused with "You are not permitted to move this evaluation from HR_APPROVED
-- to MD_REVIEWED" — the exact error 0056 was written to remove.
--
-- This migration is safe to run whether or not 0056 ran, and safe to re-run.

begin;

do $$
declare
  v_def text;
  v_new text;
  -- The arm, and ONLY the arm. Anchored to the two statuses that identify it,
  -- so no other arm's predicate can satisfy it — which is the whole lesson.
  --
  -- `\s+` rather than a literal newline: the stored body is CRLF on this
  -- project and a patch that only matched LF has failed here before
  -- (FIX-10 addendum).
  c_arm    constant text :=
    'when p_from_status = ''HR_APPROVED'' and p_to_status = ''MD_REVIEWED''\s+then\s+public\.is_md\(\)';
  c_widened constant text :=
    'when p_from_status = ''HR_APPROVED'' and p_to_status = ''MD_REVIEWED''\s+then\s+public\.is_hr\(\) or public\.is_md\(\)';
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_evaluation_transition'
   limit 1;

  if v_def is null then
    raise exception '0060: apply_evaluation_transition does not exist. Apply 0021 first.';
  end if;

  -- The precise question: does THAT arm already carry the widened predicate?
  if v_def ~ c_widened then
    raise notice '0060: the HR_APPROVED -> MD_REVIEWED arm is already widened. Nothing to do.';
    return;
  end if;

  if v_def !~ c_arm then
    raise exception
      '0060: could not find the HR_APPROVED -> MD_REVIEWED arm to widen. The function has been changed by something this migration does not know about — inspect it before proceeding.';
  end if;

  v_new := regexp_replace(
    v_def,
    c_arm,
    'when p_from_status = ''HR_APPROVED'' and p_to_status = ''MD_REVIEWED'''
      || E'\n      then public.is_hr() or public.is_md()'
  );

  if v_new = v_def then
    raise exception '0060: the replacement changed nothing. Refusing to report success.';
  end if;

  execute v_new;
  raise notice '0060: HR may now move HR_APPROVED -> MD_REVIEWED (§9 as amended by AMEND-2).';
end;
$$;

/* ---------- Verify, against the arm rather than the whole body ---------- */

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_evaluation_transition'
   limit 1;

  if v_def !~ 'when p_from_status = ''HR_APPROVED'' and p_to_status = ''MD_REVIEWED''\s+then\s+public\.is_hr\(\) or public\.is_md\(\)' then
    raise exception '0060: verification failed — the arm is still MD-only.';
  end if;

  -- The second pair of eyes must survive the widening. AMEND-2 restored the
  -- HR/MD split precisely so a pay decision has two people in it; widening the
  -- wrong arm would hand HR the MD's review as well as their own.
  if v_def !~ 'when p_from_status = ''PENDING_HR_REVIEW'' and p_to_status = ''HR_APPROVED''' then
    raise exception '0060: verification failed — §8''s HR review arm is missing.';
  end if;

  raise notice '0060: verified.';
end;
$$;

commit;

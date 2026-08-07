-- 0025_reassign_lead_blind.sql
-- `reassign_evaluation_lead` still gates on the pre-AMEND-3 statuses.
--
-- WHAT IS BROKEN
--
-- 0009 wrote the guard as:
--
--   if v_eval.status not in ('CYCLE_ACTIVE', 'SELF_SUBMITTED') then
--     raise 'The lead can only be changed before the review is written.
--            This evaluation is at %.', v_eval.status
--
-- AMEND-3 retired all four of those statuses. 0021 migrated the data, replaced
-- the transition RPC and added `evaluations_status_current` to stop any new row
-- using one — but it did not touch this function. Every live evaluation is now
-- at OPEN, which is in neither list, so the guard refuses all of them:
--
--   "The lead can only be changed before the review is written.
--    This evaluation is at OPEN."
--
-- Self-contradictory, and it means **HR cannot reassign a lead at all**. Anyone
-- who leaves, changes team or is entered against the wrong HOD strands their
-- reports' evaluations with no way to correct them from the product.
--
-- WHY THE NEW GUARD IS NOT SIMPLY status = 'OPEN'
--
-- 0009's cut-off was never really about the status; it was about whether the
-- lead had written their review. Under the old sequential machine those were
-- the same fact, because a submitted review moved the row to LEAD_REVIEWED.
-- Under blind parallel rating they are not: both layers are filled during OPEN
-- and submission is recorded on `lead_submitted_at` (AMEND-3), so an evaluation
-- can sit at OPEN with the review already written and locked.
--
-- So the condition is translated to what the comment always said it meant. The
-- reason it matters is unchanged and worth restating: a submitted LEAD layer
-- carries its author in `submitted_by`, and moving `lead_id` afterwards would
-- attribute one person's written review to another.
--
-- Everything else about the function — the HR check, the reason requirement,
-- the row lock, the audit row — is untouched. The body is patched by targeted
-- replacement rather than restated, so nothing else can drift (A1-5).
--
-- SAFE TO RE-RUN.

begin;

do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'reassign_evaluation_lead';

  if v_src is null then
    raise exception 'reassign_evaluation_lead is missing — apply 0009 first.';
  end if;

  -- Already patched (a re-run, or applied out of order). Nothing to do.
  if v_src like '%lead_submitted_at is not null%' then
    return;
  end if;

  v_new := replace(
    v_src,
    'if v_eval.status not in (''CYCLE_ACTIVE'', ''SELF_SUBMITTED'') then',
    'if v_eval.status <> ''OPEN'' or v_eval.lead_submitted_at is not null then');

  if v_new = v_src then
    raise exception
      'reassign_evaluation_lead does not carry the expected status guard — patch it by hand rather than guessing.';
  end if;

  -- The message named the status, which is now the least useful half of the
  -- answer: "at OPEN" reads as though nothing were wrong. Name the real reason.
  v_new := replace(
    v_new,
    'The lead can only be changed before the review is written. This evaluation is at %.'', v_eval.status',
    'The lead can only be changed before their review is written. %'', case when v_eval.lead_submitted_at is not null then ''That review has already been submitted.'' else ''This evaluation is at '' || v_eval.status || ''.'' end');

  execute v_new;
end $$;

comment on function public.reassign_evaluation_lead(uuid, uuid, text) is
  'Reassigns an evaluation''s lead (P10). Permitted while the evaluation is OPEN and the LEAD layer is unsubmitted — a submitted review carries its author in submitted_by, and moving lead_id afterwards would attribute it to somebody else. Status list corrected for AMEND-3 in 0025.';

commit;

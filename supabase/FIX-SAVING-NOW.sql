-- FIX-SAVING-NOW.sql
--
-- Paste this whole file into the Supabase SQL editor and press Run.
-- It takes a second and fixes "This evaluation is not ready for a lead review."
--
-- WHAT IT DOES
-- `merge_evaluation_answers` is the only way any rating form saves. It still
-- checks three statuses that AMEND-3 retired, and no row can hold any of them,
-- so every save is refused:
--     the employee's form wanted  CYCLE_ACTIVE
--     the HOD's form wanted       SELF_SUBMITTED
--     the MD's layer wanted       LEAD_REVIEWED
-- This rewrites those three checks in place, leaving the rest of the function
-- exactly as it is. It is the same change as
-- supabase/migrations/0033_parallel_layer_writes.sql, cut down so it can be
-- pasted in one go; applying either is enough, and applying both is harmless.
--
-- It refuses rather than half-applying if the function is not what it expects.

do $$
declare v_src text;
begin
  /* -- 0021 FIRST.
        The new gates call self_open() and lead_open(), which 0021 creates. A
        plpgsql body is not resolved at CREATE time, so without this check the
        patch would apply cleanly and then fail at runtime with "function
        public.self_open does not exist" — a new, more confusing error than the
        one it was meant to fix. -- */
  if to_regprocedure('public.self_open(uuid)') is null
     or to_regprocedure('public.lead_open(uuid)') is null then
    raise exception
      'STOP. This database has not had 0021_blind_rating.sql applied, so it is still running the OLD sequential state machine. Apply 0020_blind_rating_enum.sql then 0021_blind_rating.sql first, then run this. See supabase/whats-applied.sql.';
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'merge_evaluation_answers';

  v_src := replace(v_src, 'if v_eval.status <> ''CYCLE_ACTIVE'' then',
                          'if v_eval.status <> ''OPEN'' or not public.self_open(p_evaluation_id) then');
  v_src := replace(v_src, 'if v_eval.status <> ''SELF_SUBMITTED'' then',
                          'if v_eval.status <> ''OPEN'' or not public.lead_open(p_evaluation_id) then');
  v_src := replace(v_src, 'if v_eval.status <> ''LEAD_REVIEWED'' then',
                          'if v_eval.status <> ''HR_APPROVED'' then');
  v_src := replace(v_src, 'This evaluation is not ready for a lead review.',
                          'This review is no longer open for editing.');

  if v_src like '%SELF_SUBMITTED%' then
    raise exception 'Patch did not match. Do not proceed — send this message back.';
  end if;
  execute v_src;
  raise notice 'Done. Both layers can now save while the record is OPEN.';
end $$;

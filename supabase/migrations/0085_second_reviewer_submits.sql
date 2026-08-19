-- 0085 · §8 lets the second reviewer submit.
--
-- Requires 0083. 0084 opens the third form and 0084's autosave arm lets them
-- WRITE it; this is what lets them FINISH it. Without this the coordinator
-- fills in a whole review and the Submit button raises "You are not permitted
-- to move this evaluation from OPEN to OPEN" — a message about a transition,
-- shown to somebody who pressed Submit.
--
-- Two things are missing from `apply_evaluation_transition`, and they fail
-- differently, which is why both are here:
--
--   1 · the actor CASE has no arm for a LEAD_2 lock, so the call is REFUSED.
--   2 · the evaluation patch is a whitelist of column names, and
--       `co_lead_submitted_at` is not in it — so even once permitted, the
--       timestamp would be dropped SILENTLY. The response row would lock, the
--       evaluation would not know, and 0083's completion trigger would wait for
--       a submission that had already happened. That is the silent-write class
--       this log has recorded eight times, in a new costume: not an UPDATE
--       matching no row, but a patch key matching no column.
--
-- Short, whitespace-tolerant anchors, asserted to occur exactly once, each
-- printing what it looked at on failure — 0084's first version matched a
-- six-line literal copied from the migration that created the function and
-- found nothing in the body Postgres was holding.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'evaluations'
      and column_name = 'co_lead_submitted_at'
  ) then
    raise exception '0085 requires 0083 (evaluations.co_lead_submitted_at). Apply it first.';
  end if;
end $$;

do $$
declare
  v_def     text;
  v_pattern text;
  v_hits    integer;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'apply_evaluation_transition';

  if v_def is null then
    raise exception '0085: apply_evaluation_transition not found. Apply 0004 and 0021 first.';
  end if;

  v_def := replace(v_def, chr(13), '');

  if position('co_lead_submitted_at' in v_def) > 0 then
    raise notice '0085: the transition function already knows the second reviewer. Nothing to do.';
    return;
  end if;

  /* ---- 1 · The actor rule ----
     Read with a subselect rather than a new variable: adding one would mean
     editing the DECLARE block and the SELECT ... INTO as well, and each extra
     anchor is another line that has to still look the way I think it looks.
     One arm, one anchor.

     `v_caller = co_lead_id` and nothing else — not "is a HOD", not "is HR".
     §8's Who column mixes roles and RELATIONSHIPS, and P4-7 settled that a
     pure role check would let any HOD in the company submit any review. The
     same reasoning holds here with more force: a second opinion signed by the
     wrong person is worse than no second opinion. */
  v_pattern := 'then\s+v_caller\s*=\s*v_lead\y';
  v_hits := array_length(regexp_split_to_array(v_def, v_pattern), 1) - 1;
  if v_hits <> 1 then
    raise exception '0085: expected exactly one LEAD actor rule, found %.
Looked in: %', v_hits, substr(v_def, greatest(1, position('p_lock_layer' in v_def) - 300), 1000);
  end if;

  v_def := regexp_replace(v_def, v_pattern,
    'then v_caller = v_lead
    when p_from_status = ''OPEN'' and p_to_status = ''OPEN'' and p_lock_layer = ''LEAD_2''
      then v_caller = (select e2.co_lead_id from public.evaluations e2 where e2.id = p_evaluation_id)');

  /* ---- 2 · The patch whitelist ----
     Spliced BEFORE `returned_to`, which is the last entry, so the new columns
     sit with `self_skipped` and `lead_skipped` — the two they are the third of.

     `co_lead_skipped` is not optional extra: §8 lets HR advance past a layer
     that never came in, and a second reviewer is exactly the layer most likely
     to be missing. Without it a designer whose coordinator never answered could
     not be advanced at all, because 0083's completion rule waits for a
     submission or a skip and HR would have no way to record either. */
  v_pattern := 'returned_to\s*=\s*case\s+when\s+p_evaluation_patch\s*\?\s*''returned_to''';
  v_hits := array_length(regexp_split_to_array(v_def, v_pattern), 1) - 1;
  if v_hits <> 1 then
    raise exception '0085: expected exactly one returned_to patch entry, found %.
Looked in: %', v_hits, substr(v_def, greatest(1, position('self_skipped' in v_def) - 200), 1200);
  end if;

  v_def := regexp_replace(v_def, v_pattern,
    'co_lead_submitted_at = case when p_evaluation_patch ? ''co_lead_submitted_at''
        then (p_evaluation_patch ->> ''co_lead_submitted_at'')::timestamptz else e.co_lead_submitted_at end,
      co_lead_skipped = case when p_evaluation_patch ? ''co_lead_skipped''
        then (p_evaluation_patch ->> ''co_lead_skipped'')::boolean else e.co_lead_skipped end,
      returned_to = case when p_evaluation_patch ? ''returned_to''');

  execute v_def;
  raise notice '0085: the second reviewer can submit, and their timestamp is recorded.';
end $$;

-- The response-row lock needed nothing: it is written generically from
-- `p_lock_layer`, so it has accepted a third layer since the day it was
-- written. Recorded because it is the half somebody will go looking for.
do $$
begin
  raise notice '0085 applied. A second reviewer can now finish their review.';
end $$;

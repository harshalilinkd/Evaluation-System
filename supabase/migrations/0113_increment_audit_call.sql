-- 0113 · Correcting or removing an increment fails on its own audit call.
--
-- Reported from Settings › Salary history as "I'm not able to edit salary
-- history". Every correction and every removal of an existing increment was
-- refused with
--
--   function evaluation.log_admin_action(unknown, uuid, unknown, unknown,
--   unknown, jsonb) does not exist
--
-- 0109's `correct_increment` and `delete_increment` call `log_admin_action`
-- with SIX arguments (entity, id, action, null, null, diff), as though it took
-- a from- and to-status. It takes FOUR (0007/0012: entity, id, action, diff).
-- So the audit row could never be written, and because it is written in the
-- same transaction as the change, the change was rolled back with it: no
-- existing increment could be edited or removed from anywhere in the product.
-- Recording a NEW rise was unaffected — `record_increment` does not log.
--
-- THE FIX DROPS THE TWO NULLS and nothing else. Patched from the LIVE body,
-- not restated: 0106 once recreated a salary function from the wrong ancestor
-- and silently deleted a correction window (0108). Each replacement must match
-- exactly once, or the migration raises and changes nothing.
--
-- Written against `public.` like every migration before it; applied to the
-- `evaluation` schema the deployment uses.

begin;

do $mig$
declare
  v_fn   text;
  v_def  text;
  v_new  text;
  v_pat  constant text :=
    '(log_admin_action\(\s*''[^'']*''\s*,\s*[^,]+,\s*''[^'']*''\s*,)\s*null\s*,\s*null\s*,';
begin
  foreach v_fn in array array['correct_increment', 'delete_increment'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = current_schema() and p.proname = v_fn;

    if v_def is null then
      raise exception '0113: % does not exist. Apply 0109 first.', v_fn;
    end if;

    if (select count(*) from regexp_matches(v_def, v_pat, 'g')) = 0 then
      raise notice '0113: % already calls log_admin_action correctly.', v_fn;
      continue;
    end if;

    if (select count(*) from regexp_matches(v_def, v_pat, 'g')) <> 1 then
      raise exception '0113: expected exactly one six-argument audit call in %, found more. Nothing was changed.', v_fn;
    end if;

    v_new := regexp_replace(v_def, v_pat, '\1 ');
    execute v_new;
  end loop;
end;
$mig$;

-- Read both bodies back: no six-argument call may survive.
do $chk$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = current_schema()
       and p.proname in ('correct_increment', 'delete_increment')
       and pg_get_functiondef(p.oid) ~ 'log_admin_action\(\s*''[^'']*''\s*,\s*[^,]+,\s*''[^'']*''\s*,\s*null\s*,\s*null\s*,'
  ) then
    raise exception '0113: verification failed — a six-argument audit call is still present.';
  end if;
end;
$chk$;

commit;

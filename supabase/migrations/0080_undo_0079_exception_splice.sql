-- 0080 — undo 0079's third block. It broke create_milestone_evaluation.
--
--   Nothing was created: control reached end of function without RETURN
--
-- MY FAULT, and the mechanism is worth writing down because I reasoned about it
-- and got it wrong in the migration's own comment.
--
-- 0079 part 1 (a rolling cycle per milestone) and part 2 (passing the milestone
-- along) are CORRECT and are not touched here. Part 3 was a nicety: it spliced
--
--     exception when unique_violation then
--       raise exception '% already has this review in the % cycle. …'
--
-- in immediately after `returning id into v_eval;`, so that a collision would
-- read as a sentence rather than a constraint name.
--
-- In PL/pgSQL an `exception` clause TERMINATES the statement list of its
-- enclosing BEGIN. There was no inner BEGIN, so it terminated the FUNCTION's
-- block: everything below it — the frozen snapshot loop, both response rows,
-- the two invite tokens, the due-item update and the `return` — stopped being
-- part of the normal path. The happy path then ran off the end of the block
-- without reaching a RETURN, which is exactly the error above.
--
-- I anticipated it not compiling and wrapped the splice in its own exception
-- handler for that. It DID compile. A guard against the wrong failure mode is
-- not a guard, and "it compiled" is not "it works" for a language whose control
-- flow is punctuation.
--
-- Removing the splice restores the function to what 0079 part 2 left, which is
-- 0031's body with one argument added. Nothing else about it changes, and no
-- evaluation created since is affected — the function either completed or
-- raised, and a raise rolled its own transaction back.
--
-- Requires 0079. Safe to run when 0079 part 3 never applied.

do $$
declare
  v_src text;
  v_new text;
  v_splice constant text :=
'
  exception when unique_violation then
    raise exception ''% already has this review in the % cycle. Skip this item, or close the earlier one first.'',
      v_profile.full_name, public.financial_year_label(v_item.due_on)
      using errcode = ''invalid_parameter_value'';';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_milestone_evaluation';

  if v_src is null then
    raise exception '0080: create_milestone_evaluation is missing. Apply 0031 and 0079 first.';
  end if;

  if position(v_splice in v_src) = 0 then
    raise notice '0080: the splice is not present — nothing to undo.';
  else
    v_new := replace(v_src, v_splice, '');
    execute v_new;
    raise notice '0080: removed the exception splice; the function reaches its RETURN again.';
  end if;
end;
$$;

/* ======================================================== the proof it works ==
   0079 part 3 shipped because "it compiled" was taken as "it works". This
   checks the thing that actually matters — that the normal path reaches a
   RETURN — rather than that the definition parses.

   Read-only: it inspects the stored body. Running the function for real needs a
   due item, a profile and a department, which a migration must not invent. */
do $$
declare
  v_src  text;
  v_tail text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_milestone_evaluation';

  -- Everything after the evaluation is inserted must still be in the normal
  -- path. If an `exception` clause sits between the insert and the return, it
  -- is not.
  v_tail := substr(v_src, position('returning id into v_eval' in v_src));

  if v_tail !~* '\mreturn\M' then
    raise exception '0080: create_milestone_evaluation still has no RETURN after the insert.';
  end if;

  if v_tail ~* '\mexception\s+when\M' then
    raise exception '0080: an exception clause still sits between the insert and the return, '
                    'so the normal path does not reach it.';
  end if;

  raise notice '0080: verified — the insert is followed by the rest of the work and a RETURN.';
end;
$$;

/* ==================================================== what 0079 still fixes ==
   The duplicate that started all this is handled by parts 1 and 2, which stand:
   each milestone has its own rolling cycle, so a person's 3-month and 9-month
   reviews no longer collide on (cycle_id, evaluatee_id).

   A collision is now genuinely unexpected, and it will report the constraint
   name. That is a worse message than the sentence part 3 was trying to give —
   and a worse message is a far smaller problem than a function that cannot
   finish. If it is worth doing later it belongs in an inner BEGIN…END around
   the insert, which is the construct part 3 should have used. */

do $$
begin
  raise notice '0080: 0079 parts 1 and 2 are unchanged — a rolling cycle per milestone, '
               'and create_milestone_evaluation passing the milestone to it.';
end;
$$;

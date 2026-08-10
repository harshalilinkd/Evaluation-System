-- SHOW-INCREMENT-GUARD.sql
--
-- Read-only. Prints the `increment_reviews_guard_columns` function as it exists
-- in the database right now, and reports which of the three sentences 0056
-- looks for are present.
--
-- WHY. 0056 raised "the MD's branch was altered", and the version of that
-- function in `0030_increment.sql` plainly contains the sentence it says is
-- missing. So the stored function is not what 0030 wrote — either something
-- patched it since, or an earlier run of 0056 got half way.
--
-- 0056 IS wrapped in one begin/commit, so a failed run rolls everything back
-- and cannot have left the function half-patched. That rules out the obvious
-- explanation and leaves the awkward one: the stored function differs from
-- what 0030's file says, or the rewrite matched more than the HR branch.
--
-- Either way the answer is in the function itself, not in the migration files.
-- Reading it is the only way to say what happened rather than what should
-- have.

/* ---------- 1. Which sentences are there ---------- */

select
  -- Present in 0030. 0056 REMOVES this — its absence means HR's branch was
  -- already rewritten by a previous run.
  pg_get_functiondef(oid) like '%HR may not award themselves%'
    as hr_branch_still_original,

  -- 0056 ADDS this. Present means a previous run got as far as the rewrite.
  pg_get_functiondef(oid) like '%0056: HR may set the approved figure%'
    as already_patched_by_0056,

  -- 0030's MD branch. 0056 requires this to survive untouched, and says it
  -- did not.
  pg_get_functiondef(oid) like '%are not the MD''s to edit%'
    as md_branch_intact,

  -- Belt and braces: is the MD branch there at all?
  pg_get_functiondef(oid) like '%if public.is_md() then%'
    as has_md_branch
from pg_proc
where proname = 'increment_reviews_guard_columns'
  and pronamespace = 'public'::regnamespace;


/* ---------- 2. The whole thing, to read ----------
   Copy this output into the chat. It is the only way to say what actually
   happened rather than what should have. It contains no data — a function
   definition is code, not rows. */

select pg_get_functiondef(oid) as current_definition
from pg_proc
where proname = 'increment_reviews_guard_columns'
  and pronamespace = 'public'::regnamespace;

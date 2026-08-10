-- Did 0056 actually take? Paste this and read the two rows.
--
-- The error "You are not permitted to move this evaluation from HR_APPROVED to
-- MD_REVIEWED" is raised by `apply_evaluation_transition` and by nothing else,
-- so if it is still appearing after 0056 was run, one of three things is true
-- and this tells you which:
--
--   · the patch did not match, so the arm still reads `then public.is_md()`
--   · it matched, but something replaced the function afterwards
--   · it is applied and the caller is not HR at all
--
-- Read-only. Nothing here changes anything.

select
  'transition arm' as what,
  case
    when pg_get_functiondef(p.oid) like '%HR_APPROVED%MD_REVIEWED%is_hr() or public.is_md()%'
      then 'OK — HR may record the MD review'
    when pg_get_functiondef(p.oid) like '%HR_APPROVED%MD_REVIEWED%'
      then 'NOT APPLIED — the arm is still MD-only. Re-run 0056.'
    else 'MISSING — no HR_APPROVED -> MD_REVIEWED arm at all. Apply 0021 first.'
  end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'apply_evaluation_transition'

union all

select
  'column guard',
  case
    when pg_get_functiondef(p.oid) like '%HR may not award themselves%'
      then 'NOT APPLIED — HR still cannot write the approved figure. Re-run 0056.'
    else 'OK — HR may set the approved figure'
  end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'increment_reviews_guard_columns'

union all

-- Who you are signed in as, and whether the database agrees you are HR.
-- A perfectly applied 0056 still refuses somebody the database does not
-- consider HR_ADMIN, and that is the third possibility.
select
  'your roles',
  coalesce(
    (select string_agg(ur.role::text, ', ' order by ur.role::text)
       from public.user_roles ur
      where ur.profile_id = (select auth.uid())),
    'none — this query is running without a signed-in session, which is normal in the SQL editor'
  );

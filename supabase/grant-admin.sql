-- =============================================================================
-- Grant HR_ADMIN to an existing account. Paste into the Supabase SQL editor.
--
-- This is the psql-free twin of bootstrap-admin.sql. That file uses \set, which
-- is a psql meta-command: pasted into the web SQL editor it fails with a syntax
-- error on line 1, which looks like the script being broken rather than being
-- run in the wrong place.
--
-- Everything below is plain SQL. Change the address on the next line and run
-- the whole file.
-- =============================================================================

/* ---------- 1. Who am I granting to? ---------- */
--            ↓↓↓ CHANGE THIS ↓↓↓
create temporary table _target as
select 'harshali.linkd@gmail.com'::text as admin_email;


/* ---------- 2. Does the account exist, and did the profile trigger fire? ---------- */
select
  u.email,
  u.email_confirmed_at is not null                   as confirmed,
  p.id is not null                                   as has_profile,
  coalesce(string_agg(r.role::text, ', '), '(none)') as roles_now
from _target t
left join auth.users        u on u.email = t.admin_email
left join public.profiles   p on p.id = u.id
left join public.user_roles r on r.profile_id = u.id
group by u.email, u.email_confirmed_at, p.id;

-- Read that result before going on:
--   • no row at all   -> the address is wrong, or the account was never created
--   • confirmed false -> they cannot sign in; see step 4 below
--   • has_profile false -> migrations were never applied to this project.
--     Run `npx supabase db push`, then delete and recreate the account so the
--     on_auth_user_created trigger fires.


/* ---------- 3. Grant the roles ---------- */
--
-- EMPLOYEE as well as HR_ADMIN. §9's simultaneous-roles case: HR fills in their
-- own appraisal like everybody else, so they need both. Granting only HR_ADMIN
-- would hide "My Evaluation" from the person most likely to be testing it.
insert into public.user_roles (profile_id, role)
select p.id, r.role
from _target t
join public.profiles p on p.email = t.admin_email
cross join (values
  ('EMPLOYEE'::public.app_role),
  ('HR_ADMIN'::public.app_role)
) as r(role)
on conflict (profile_id, role) do nothing;


/* ---------- 4. Only if `confirmed` came back false ---------- */
--
-- An unconfirmed account cannot sign in at all. Uncomment and run.
--
-- update auth.users
-- set email_confirmed_at = coalesce(email_confirmed_at, now())
-- where email = (select admin_email from _target);


/* ---------- 5. Confirm ---------- */
select
  p.full_name,
  p.email,
  string_agg(r.role::text, ', ' order by r.role::text) as roles
from _target t
join public.profiles   p on p.email = t.admin_email
join public.user_roles r on r.profile_id = p.id
group by p.full_name, p.email;

-- Expect: HR_ADMIN, EMPLOYEE
--
-- Then just RELOAD the page. getRoles() queries user_roles on every request
-- (React cache() dedupes it within one render, nothing longer), so the grant
-- takes effect immediately — no sign-out needed.

drop table _target;

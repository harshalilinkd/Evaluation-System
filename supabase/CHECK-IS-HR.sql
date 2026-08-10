-- Does the database consider you HR? Read-only.
--
-- CHECK-0056 confirmed both halves of 0056 are applied, and the refusal is
-- raised by `apply_evaluation_transition` and by nothing else. So if it is
-- still happening on a fresh attempt, the remaining possibility is that
-- `is_hr()` returns false for whoever pressed the button.
--
-- `is_hr()` reads `auth.uid()`, which is null in the SQL editor — so it cannot
-- be called directly here and tell you anything. This asks the question the
-- other way round: what roles does that account actually hold?
--
-- Change the address on the next line if you are testing as somebody else.

with who as (select 'harshali.linkd@gmail.com'::text as email)

select
  p.full_name,
  p.email,
  coalesce(
    (select string_agg(ur.role::text, ', ' order by ur.role::text)
       from public.user_roles ur
      where ur.profile_id = p.id),
    '(no roles at all)'
  ) as roles_held,
  case
    when exists (
      select 1 from public.user_roles ur
       where ur.profile_id = p.id and ur.role = 'HR_ADMIN'
    ) then 'OK — is_hr() will be true for this account'
    else 'THIS IS THE PROBLEM — no HR_ADMIN grant, so is_hr() is false and the transition is correctly refused'
  end as verdict
from public.profiles p, who
where lower(p.email) = lower(who.email);

-- If the row above comes back empty, that address has no profile at all — check
-- the spelling against Settings › Users.

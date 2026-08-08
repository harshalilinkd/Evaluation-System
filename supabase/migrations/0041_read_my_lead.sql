-- 0041 · An employee may read the name of the person rating them.
--
-- THE BUG. "Evaluated by —" on every self-evaluation form, on a field the
-- source paper form carries and HR had filled in correctly.
--
-- 0005's read policy admits: yourself, anybody whose `reports_to` is you, and
-- everything for HR and the MD. What it does not admit is the person YOU report
-- to — `reports_to = auth.uid()` matches people who report to you, the opposite
-- direction. So the lead's name came back null and the field rendered an em
-- dash, and it looked like HR had missed a step in the wizard.
--
-- WHY THIS IS NOT A CONFIDENTIALITY CHANGE. Knowing who is appraising you is
-- not a disclosure — it is the premise of the exercise, it is printed on the
-- form, and §5's blindness invariant is about ANSWERS, not identities. Nothing
-- here exposes a rating: `evaluation_responses` is untouched, and the employee
-- still cannot read the LEAD layer at any status (0021).
--
-- Salary is not on `profiles` at all (P19-1 asserts the column does not exist),
-- so admitting the row cannot leak a figure.

begin;

/* ---------- is_my_lead ---------- */
--
-- SECURITY DEFINER, and it has to be. A policy on `profiles` that queried
-- `evaluations` directly would run that query under the caller's own RLS, and
-- `evaluations`' policies read `profiles` — the two would recurse (P5-7 records
-- the same trap from the other side). Running as the owner breaks the cycle.
--
-- `pg_temp` is pinned in the search path, not just `public`: with it absent
-- Postgres still searches it FIRST for relation names, so a caller could shadow
-- a table with a temp one and subvert a definer check (P1-3).

create or replace function public.is_my_lead(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    -- The person named on one of my evaluations. The precise relationship,
    -- rather than "my manager" in general: it stays true for a past cycle
    -- whose lead has since changed, which is what makes an old form still
    -- render the name it was signed under.
    select 1
    from public.evaluations e
    where e.evaluatee_id = (select auth.uid())
      and e.lead_id = p_profile_id
  )
  or exists (
    -- And my current lead, so the name is right on a form that has only just
    -- been created and before any evaluation exists.
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.reports_to = p_profile_id
  );
$$;

comment on function public.is_my_lead(uuid) is
  'Whether that profile is the caller''s lead — on any of their evaluations, or on their profile today. SECURITY DEFINER to avoid recursing through evaluations'' own policies, which read profiles (0041).';

grant execute on function public.is_my_lead(uuid) to authenticated;

/* ---------- The policy ---------- */
--
-- Replaced rather than added alongside: two SELECT policies on one table are
-- OR-ed, which works, but it leaves the answer to "who can read a profile"
-- split across two migrations. One policy, one place to read.

drop policy if exists "profiles: read self, reports, or all as HR/MD" on public.profiles;

create policy "profiles: read self, reports, my lead, or all as HR/MD" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_hr()
    or public.is_md()
    or reports_to = (select auth.uid())
    or public.is_my_lead(id)
  );

commit;

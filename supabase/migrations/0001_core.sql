-- =============================================================================
-- 0001_core.sql — Departments, people and the role model.
-- Phase P1. CLAUDE.md §4 (naming), §5 (data model), §7 (tracks).
-- =============================================================================
--
-- The defining decision in this migration: **a role is a row, not a column.**
-- `user_roles` is many-to-many because one person is routinely both EMPLOYEE and
-- HOD — they fill in their own appraisal, then review their reports' (CLAUDE.md
-- §9). A single `role` column on `profiles` would force a choice between the two
-- and every downstream policy would need a special case.
--
-- !! SECURITY: RLS IS NOT ENABLED IN THIS MIGRATION. !!
-- Policies land in P5. Until then, Supabase's default grants make every table in
-- `public` readable and writable by any authenticated user. Do not point a
-- production project at this schema before P5 is applied.
-- =============================================================================


/* ---------- Extensions ---------- */

-- gen_random_uuid() is built in from Postgres 13, but pgcrypto is also what
-- P4's invite tokens will use for digest(); creating it here keeps the
-- dependency explicit rather than implicit.
create extension if not exists pgcrypto;


/* ---------- Shared trigger: keep updated_at honest ---------- */

-- Applied to every table below that carries an updated_at column. Doing this in
-- the database rather than in application code means a direct SQL fix, an admin
-- panel edit and a Server Action all leave the same trail.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


/* ---------- Enums ---------- */
-- CLAUDE.md §4: enum values are SCREAMING_SNAKE_CASE.

-- CLAUDE.md §7. A question, a cycle and a person each carry a track; 'BOTH' on a
-- question means it applies to either track.
create type public.track_type as enum ('STAFF', 'WORKER', 'BOTH');

create type public.app_role as enum ('HR_ADMIN', 'MD', 'HOD', 'SUPERVISOR', 'EMPLOYEE');


/* ---------- departments ---------- */

create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  code        text not null unique,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

comment on table public.departments is
  'Organisational units. Drives which department questions an evaluatee is asked (P2).';
comment on column public.departments.code is
  'Short stable handle used by seeds and imports so they never hard-code a uuid.';


/* ---------- profiles ---------- */

-- Mirrors auth.users. The id IS the auth uid — not a separate key with a
-- lookup — so every RLS policy in P5 can compare against auth.uid() directly
-- without a join.
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text not null,
  employee_code   text unique,
  email           text not null,
  phone_e164      text,
  department_id   uuid references public.departments(id),
  designation     text,
  date_of_joining date,
  track           public.track_type not null default 'STAFF',
  -- Self-FK: the person who reviews this person (HOD for STAFF, SUPERVISOR for
  -- WORKER). This is the authoritative reporting line that is_lead_of() reads.
  reports_to      uuid references public.profiles(id),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Nobody reviews themselves. Cheap to enforce here, impossible to forget.
  constraint profiles_reports_to_not_self check (reports_to is null or reports_to <> id)
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

comment on column public.profiles.reports_to is
  'Reporting line. NULL for the MD and anyone reporting outside the system.';
comment on column public.profiles.track is
  'CLAUDE.md §7. STAFF gets the 0-5 form, WORKER gets the three-point tick sheet.';


/* ---------- user_roles ---------- */

-- Many-to-many on purpose (CLAUDE.md §5). One person holds EMPLOYEE and HOD
-- simultaneously; both sets of policies then apply at once in P5.
create table public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       public.app_role not null,

  constraint user_roles_profile_role_unique unique (profile_id, role)
);

comment on table public.user_roles is
  'Role grants. No timestamps by design — CLAUDE.md §12 records every role change in audit_log (P6).';


/* ---------- Indexes ---------- */

create index profiles_department_id_idx on public.profiles (department_id);
create index profiles_reports_to_idx    on public.profiles (reports_to);

-- Requested explicitly in the phase brief. Note that user_roles_profile_role_unique
-- already indexes profile_id as its leading column, so this is redundant and can
-- be dropped if index bloat ever matters.
create index user_roles_profile_id_idx on public.user_roles (profile_id);


/* ---------- Auth integration ---------- */

-- Creating a Supabase auth user creates the matching profile and grants the
-- baseline EMPLOYEE role. Everything above EMPLOYEE is granted deliberately by
-- HR — a new signup can never arrive holding HR_ADMIN or MD.
--
-- Both inserts are ON CONFLICT DO NOTHING so re-running against an existing
-- account is a no-op rather than an error, which keeps seeding idempotent.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    -- full_name is NOT NULL and the invite may not carry one yet; fall back to
    -- the local part of the email so HR has something readable to correct.
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    -- Deliberately not coalesced: auth is email OTP / magic link (CLAUDE.md §2),
    -- so a null email means something is wrong upstream and should fail loudly
    -- (CLAUDE.md §0.7) rather than create a profile nobody can contact.
    new.email
  )
  on conflict (id) do nothing;

  insert into public.user_roles (profile_id, role)
  values (new.id, 'EMPLOYEE')
  on conflict (profile_id, role) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();


/* ---------- Role helper functions ---------- */
--
-- All SECURITY DEFINER. Two reasons:
--   1. They read public.user_roles from inside policies that will themselves sit
--      on tables joined to user_roles; running as the owner breaks the recursion
--      before it starts (P5).
--   2. They must return the same answer regardless of what the caller can see.
--
-- search_path is pinned. `pg_temp` is listed LAST rather than omitted: when it is
-- absent from the list Postgres still searches it first for relation names, so a
-- caller could shadow public.user_roles with a temp table and subvert the check.
--
-- STABLE, not VOLATILE, so the planner evaluates them once per statement instead
-- of once per row — this matters a great deal once they appear in RLS policies.

-- The signed-in user's profile id, or NULL when there is no session or no
-- profile row. Reading through profiles (rather than returning auth.uid()
-- directly) means a deleted profile stops authorising anything immediately.
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
  from public.profiles p
  where p.id = (select auth.uid());
$$;

-- The parameter is named `role` to match the brief, which collides with
-- user_roles.role; `has_role.role` qualifies the parameter unambiguously.
create or replace function public.has_role(role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.profile_id = (select auth.uid())
      and ur.role = has_role.role
  );
$$;

create or replace function public.is_hr()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_role('HR_ADMIN');
$$;

create or replace function public.is_md()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_role('MD');
$$;

-- True when target_profile reports to the caller. Deliberately checks only the
-- reporting line, not the caller's role: P5 composes this with has_role('HOD')
-- or has_role('SUPERVISOR') so that revoking the role withdraws review access
-- without anyone having to rewire reports_to.
create or replace function public.is_lead_of(target_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = target_profile
      and p.reports_to = (select auth.uid())
  );
$$;


/* ---------- Grants ---------- */
-- Execute rights only. Table access is governed by Supabase's default grants
-- until RLS and explicit grants land in P5.

grant execute on function public.current_profile_id()            to authenticated;
grant execute on function public.has_role(public.app_role)       to authenticated;
grant execute on function public.is_hr()                         to authenticated;
grant execute on function public.is_md()                         to authenticated;
grant execute on function public.is_lead_of(uuid)                to authenticated;

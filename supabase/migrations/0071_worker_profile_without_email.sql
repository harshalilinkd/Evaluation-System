-- 0071 · A production worker's profile carries no email.
--
-- AT THE OWNER'S EXPLICIT INSTRUCTION: "for production teams profile should get
-- created without emails".
--
-- WHY THE COLUMN WAS NOT NULL, and why that reasoning has expired.
--
-- P1-5 made it NOT NULL deliberately and said so: auth was email OTP at the
-- time (§2, pre-P8), so every person signed in with an address and a profile
-- without one was a profile nobody could contact — "fail loudly rather than
-- create a profile nobody can reach" (§0.7).
--
-- Two things changed underneath that. P8 moved authentication to email +
-- password, and WORKER-1 established that a production worker NEVER SIGNS IN at
-- all: their supervisor fills the sheet and they open nothing. So for that
-- track the address is not a contact route, not a credential and not an
-- identifier — it is a column somebody has to invent a value for.
--
-- WHAT THIS DOES NOT CHANGE. `profiles.id` still references `auth.users(id)`,
-- and every RLS policy in the system compares `auth.uid()` against it. A worker
-- therefore still has an auth identity; the application gives it a derived
-- internal address on a `.invalid` domain (RFC 2606 reserves it so nothing can
-- ever be delivered there) and stores NULL on the profile. The identity is an
-- implementation detail of the foreign key; the PROFILE is what the product
-- reads, and it now honestly says "no address".
--
-- NOTHING IS SENT TO A NULL. Every outbound path already guards: `deliver`
-- builds no EMAIL channel without an address, the digests skip, and the
-- distribution screen reports the contact gap rather than attempting a send
-- (P11-11 — a `notifications_log` row means an attempt was made).

/* ---------- 1 · The column ---------- */

alter table public.profiles alter column email drop not null;

comment on column public.profiles.email is
  'The address they sign in with. NULL for a production worker, who never signs '
  'in (WORKER-1) — their auth identity carries a derived internal address that '
  'this column deliberately does not repeat.';

/* ---------- 2 · The trigger stops depending on one ---------- */
--
-- `handle_new_auth_user` fell back to the email's local part for `full_name`,
-- which is NOT NULL. That fallback only ever mattered for an invite carrying no
-- name; it now has to cope with there being no address to take a local part
-- from, or the insert fails on a NOT NULL column for a reason nobody would
-- guess from the message.
--
-- Replaced whole rather than patched: it is eight lines and the change is to
-- its reasoning, not to one token. The behaviour for a staff account is
-- identical.

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
    -- The name from the invite, then the address's local part, then a
    -- placeholder that is obviously a placeholder. A production worker arrives
    -- with a real name in the metadata, so the last two are for a staff invite
    -- that carried none.
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Unnamed — set their name'
    ),
    -- Whatever the identity carries. The application nulls this immediately
    -- afterwards for a worker; doing it here would mean this trigger deciding
    -- which module somebody is in, which it cannot see.
    new.email
  )
  on conflict (id) do nothing;

  insert into public.user_roles (profile_id, role)
  values (new.id, 'EMPLOYEE')
  on conflict (profile_id, role) do nothing;

  return new;
end;
$$;

/* ---------- 3 · Notice ---------- */

do $$
declare
  v_workers int;
begin
  select count(*) into v_workers
    from public.profiles
   where track = 'WORKER' and email like '%@production.%.invalid';

  raise notice '0071: profiles.email is now nullable. % existing worker profile(s) '
               'carry a derived internal address; they are left alone — this only '
               'changes what NEW imports write.', v_workers;
end;
$$;

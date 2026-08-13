-- 0074 · Google sign-in may sign somebody IN. It may never sign somebody UP.
--
-- ============================================================================
-- THIS AMENDS §2's AUTH ROW, AT THE OWNER'S EXPLICIT INSTRUCTION.
--
-- §2 reads "Supabase Auth — email + password (changed P8; was email OTP) +
-- signed invite tokens". Google is now a third way to authenticate. §0.2 needs
-- the instruction before a change like this and it was given: "I want to
-- implement continue with google login in this system".
--
-- WHAT DOES NOT CHANGE, and is the whole point of this file: §9 puts account
-- creation with HR. Google becomes another DOOR into an account HR already
-- made; it is never a way to make one.
-- ============================================================================
--
-- THE HOLE THIS CLOSES.
--
-- `handle_new_auth_user` fires `after insert on auth.users` and creates a
-- profile plus an EMPLOYEE role for whoever appears. That has been safe for
-- eleven phases because there was exactly one way to insert into `auth.users`:
-- `auth.admin.createUser`, from HR's screen, behind an HR guard (P8-2). There
-- is no `signUp` call anywhere in the application — checked, not assumed.
--
-- Enabling a social provider ends that. The owner has chosen an EXTERNAL,
-- published Google consent screen, because staff addresses are a mix of
-- @linkdprints.com and personal Gmail and HR enters whichever is real. So
-- Google itself filters nobody: any Google account on earth can authenticate
-- successfully and arrive at the callback. Without this migration the trigger
-- would then hand each one a profile and an EMPLOYEE role, and they would be
-- inside the appraisal system.
--
-- HOW THE TWO CASES ARE TOLD APART.
--
-- `raw_app_meta_data ->> 'provider'` is written by GoTrue at insert time:
--
--   'email'   an account HR created (`auth.admin.createUser`)   -> allowed
--   'google'  somebody who just authenticated with Google       -> REFUSED
--
-- A member of staff signing in with Google does NOT reach this trigger at all.
-- `provisionPerson` passes `email_confirm: true` (HR vouched for the address by
-- typing it), and Supabase links a social identity to an existing user when the
-- email is verified on both sides. Nothing is inserted into `auth.users`, so
-- there is nothing for this trigger to fire on — they simply sign in.
--
-- Only an email with NO existing account reaches the insert. That is exactly
-- the case that must not become an account.
--
-- WHY IT RAISES RATHER THAN SKIPPING THE PROFILE.
--
-- Returning without inserting would leave an `auth.users` row with no profile:
-- a real, signed-in session belonging to nobody, which every downstream guard
-- would have to be taught about, and a table of orphans nobody prunes. Raising
-- aborts the transaction, so the auth user is never created. GoTrue reports the
-- failure to the callback and `/auth/callback` turns it into the same sentence
-- the password form has always shown.
--
-- The message is deliberately the one an employee already sees and reveals
-- nothing about whether that address exists (P6-7: a login form that
-- distinguishes the two is a staff directory).
--
-- TO ADD ANOTHER LEGITIMATE PROVIDER LATER, widen the allow-list in the CASE
-- below. Do not remove the check — its absence is the hole.

/* ---------- 1 · The trigger, with self-signup refused ---------- */

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  /* -- §9: accounts are created by HR. An identity that arrived from a social
        provider has, by definition, not been created by anybody here — see the
        header for why a staff member signing in with Google never gets this
        far. -- */
  if coalesce(new.raw_app_meta_data ->> 'provider', 'email') <> 'email' then
    raise exception 'Accounts are created by HR.'
      using errcode = 'insufficient_privilege',
            hint    = 'Ask HR to add this person in Settings > Users first.';
  end if;

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

comment on function public.handle_new_auth_user() is
  'Creates the profile and EMPLOYEE role for an account HR created. REFUSES any identity whose provider is not ''email'' (0074): Google may sign somebody in to an existing account, never sign them up. §9 keeps account creation with HR.';

/* ---------- 2 · Prove it, rather than assume it ----------
      A trigger that silently stopped discriminating would look exactly like
      one that works, because the allowed path is the one anybody would test. */

do $$
declare
  v_src text := pg_get_functiondef('public.handle_new_auth_user()'::regprocedure);
begin
  if position('raw_app_meta_data' in v_src) = 0 then
    raise exception '0074: the provider check is not in the installed function.';
  end if;

  if position('Accounts are created by HR.' in v_src) = 0 then
    raise exception '0074: the refusal message is not in the installed function.';
  end if;

  raise notice '0074: self-signup refused for any provider other than email.';
  raise notice '0074: HR''s Settings > Users path is unchanged.';
end;
$$;

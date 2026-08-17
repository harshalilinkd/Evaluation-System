-- 0081 · A second contact pair, for administrative messages.
--
-- WHY
--
-- HR is an employee too. Her own self-evaluation, and the reviews she writes as
-- a manager, are about her as a person in the company; HR administration is her
-- job function. She wants the first on a personal number and address and the
-- second on official ones — and today `profiles` holds exactly one of each, so
-- every message goes to the same place whatever it is about.
--
-- WHAT THIS IS NOT
--
-- Not a second identity. `profiles.email` mirrors `auth.users.email` and is what
-- somebody signs in with; that is untouched, and delivery is a separate question
-- from identity. The invite link for her own appraisal arrives on her personal
-- WhatsApp and still asks her to sign in with whatever account she has.
--
-- WHY NULLABLE, AND WHY THAT IS THE WHOLE SAFETY ARGUMENT
--
-- Blank means "use the personal pair". So this is opt-in per person: filling it
-- in for one person changes nothing for the other fifty-seven, and a company
-- that never uses it behaves exactly as it does today. There is no backfill,
-- no data migration, and nothing to undo if it turns out to be a bad idea.
--
-- WHICH MESSAGE GOES WHERE is decided in TypeScript, from the template — see
-- `lib/notify/contacts.ts`. It is not a column, because it is not a property of
-- a person: the same person receives some messages personally and others in
-- their administrative capacity, and a flag on the row could not express that.

alter table public.profiles
  add column if not exists work_email text,
  add column if not exists work_phone_e164 text;

comment on column public.profiles.work_email is
  'Optional. Where administrative messages go — HR digests, report-ready, finalised. NULL falls back to `email`. Never a sign-in identity.';

comment on column public.profiles.work_phone_e164 is
  'Optional. E.164. Where administrative messages go. NULL falls back to `phone_e164`.';

/* -- E.164, checked the same way the rest of the product normalises it.
      `phone_e164` itself carries no constraint — it predates the normaliser and
      adding one now would refuse rows that are already stored. The new column
      has no history, so it can be right from the start rather than inheriting a
      gap. `normaliseToE164` produces exactly this shape.

      NOT VALID is deliberate on neither: there is nothing to validate against,
      the table being empty of this column a moment ago. -- */
alter table public.profiles
  drop constraint if exists profiles_work_phone_e164_shape;

alter table public.profiles
  add constraint profiles_work_phone_e164_shape
  check (work_phone_e164 is null or work_phone_e164 ~ '^\+[1-9][0-9]{7,14}$');

/* -- NO NEW POLICY, and that is deliberate.
      0005's policies are row-level and already decide who may read and write a
      profile. A column added to a table whose policies grant the whole row is
      governed by them from the moment it exists — adding a policy here would
      either duplicate one that already applies or, worse, look like it was
      needed and invite somebody to widen it.

      The guard trigger on `profiles` (P5-6) likewise governs self-updates
      already: these two columns are not in its protected list, so a person may
      set their own work contact, which is the intent. -- */

do $$
begin
  raise notice '0081: work_email and work_phone_e164 added to profiles. Both NULL for everybody — nothing changes until somebody fills one in.';
end $$;

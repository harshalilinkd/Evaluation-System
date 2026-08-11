-- 0065: a signature image, managed by its owner.
--
-- At the owner's explicit instruction: "an uploaded signature image and this
-- image will be managed by MD from their settings."
--
-- ============================================================================
-- STORED IN THE ROW AS A DATA URI, NOT IN SUPABASE STORAGE.
--
-- §2 does sanction Supabase Storage ("signed URLs only"), and this is the first
-- thing in the product that would have used it — there is not one reference to
-- `.storage` anywhere in the codebase. Introducing it for one small image means
-- a bucket, a second set of RLS policies on `storage.objects`, signed-URL
-- generation, and an upload path, all of which have to be right the first time
-- because the thing they protect is somebody's signature.
--
-- The deciding argument is the PRINT PACK, not the effort. P15-5 renders up to
-- 47 sheets server-side with bounded concurrency, precisely because each
-- document already issues five queries and the pooler queues beyond that. A
-- signed URL per sheet adds 47 more round trips inside that job. And a printed
-- page cannot fetch anything at print time: the image has to be inline or
-- already resolved by the time the browser lays the page out, which is exactly
-- what a data URI is.
--
-- The cost, stated: the column carries bytes, and a row that is usually a few
-- hundred of them can become a few hundred kilobytes. That is what the CHECK
-- below is for. If signatures ever become many — every manager, not one MD —
-- this is the decision to revisit, and Storage is where it goes.
--
-- WHO MAY SET IT. `profiles_guard_self_update` (0005) is an exclusion list: it
-- names the columns a person may NOT change about themselves. A new column is
-- therefore self-updatable by default, which is what "managed by MD from their
-- settings" asks for — and HR keeps the override it has on every other field.
-- ============================================================================

begin;

alter table public.profiles
  add column if not exists signature_image text;

comment on column public.profiles.signature_image is
  'The person''s signature as a data URI, shown on printed sheets they have signed. Set by the person themselves, or by HR.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_signature_is_image'
  ) then
    alter table public.profiles
      add constraint profiles_signature_is_image check (
        signature_image is null
        or (
          -- A real image, and only the three formats a browser will render on a
          -- printed page without a plugin. Refusing anything else here means a
          -- pasted script or an SVG with script in it cannot reach a document
          -- somebody signs.
          signature_image ~ '^data:image/(png|jpeg|gif);base64,[A-Za-z0-9+/=]+$'
          -- Roughly 300KB of image. A signature is a few tens of kilobytes; the
          -- cap is what stops a phone camera photograph being pasted into a
          -- column every profile read would then carry.
          and length(signature_image) <= 400000
        )
      );
  end if;
end;
$$;

commit;

/* ============================================================================
   Confirm
   ========================================================================== */

select
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'signature_image')                         as column_present,
  exists (
    select 1 from pg_constraint
     where conname = 'profiles_signature_is_image')                 as shape_and_size_checked,
  (select count(*) from public.profiles
    where signature_image is not null)                              as signatures_on_file;

-- 0029_reports.sql
-- `evaluation_reviews` — HR's and the MD's layer over a finished evaluation.
--
-- The brief names this 0016_reports.sql. 0016 is `0016_notification_settings.sql`
-- and is applied, so §0.8 makes it 0029 — the same call as 0010, 0017, 0021,
-- 0022, 0023 and 0028.
--
-- WHY THIS TABLE IS NOT `evaluation_decisions`
--
-- 0003 already has `evaluation_decisions`, and it would have been the obvious
-- place. It is not, for a reason worth stating: that table is the OUTCOME —
-- promotion, increment type, salary figures. This one is the REVIEW — did HR
-- read it, what did they conclude, did the MD agree. AMEND-2 separated those
-- two ideas when it split HR from the MD again, and putting them in one row
-- would mean one RLS policy governing both a summary the MD may write and a
-- salary figure only HR may set.
--
-- THE COLUMN-LEVEL SPLIT
--
-- §9 gives HR the review and the MD the remarks. RLS is row-level and cannot
-- express "the MD may write these four columns and not those five", so the
-- split is enforced by a BEFORE UPDATE trigger instead. A policy alone would
-- have let the MD rewrite HR's summary — which is exactly the second pair of
-- eyes AMEND-2 restored, undone.
--
-- SAFE TO RE-RUN.

begin;

create table if not exists public.evaluation_reviews (
  evaluation_id      uuid primary key
                       references public.evaluations(id) on delete cascade,

  -- HR's half.
  hr_reviewed_by     uuid references public.profiles(id),
  hr_reviewed_at     timestamptz,
  hr_summary         text,
  hr_recommendation  text,

  -- The MD's half.
  md_reviewed_by     uuid references public.profiles(id),
  md_reviewed_at     timestamptz,
  md_remarks         text,
  md_outcome         text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.evaluation_reviews
  drop constraint if exists evaluation_reviews_hr_recommendation_valid;
alter table public.evaluation_reviews
  add constraint evaluation_reviews_hr_recommendation_valid
  check (hr_recommendation is null
         or hr_recommendation in ('PROCEED', 'HOLD', 'NEEDS_DISCUSSION'));

alter table public.evaluation_reviews
  drop constraint if exists evaluation_reviews_md_outcome_valid;
alter table public.evaluation_reviews
  add constraint evaluation_reviews_md_outcome_valid
  check (md_outcome is null
         or md_outcome in ('APPROVED', 'RETURNED', 'DEFERRED'));

drop trigger if exists evaluation_reviews_set_updated_at on public.evaluation_reviews;
create trigger evaluation_reviews_set_updated_at
  before update on public.evaluation_reviews
  for each row execute function public.set_updated_at();

/* ============================================================================
   The column-level guard
   ========================================================================== */
--
-- §9: HR writes the review; the MD writes the remarks and the outcome. RLS
-- grants row access, not column access, so without this the MD's UPDATE policy
-- would also let them rewrite `hr_summary` — and a second pair of eyes that can
-- edit the first pair's words is not a second pair of eyes.
--
-- The exemption for a caller with no JWT is the P5-6 idiom: migrations, the seed
-- and cron have no `auth.uid()`, and a guard that misfires on them is a bug
-- rather than strictness.

create or replace function public.evaluation_reviews_guard_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_hr() or (select auth.uid()) is null then
    return new;
  end if;

  if public.is_md() then
    if new.hr_reviewed_by  is distinct from old.hr_reviewed_by
       or new.hr_reviewed_at    is distinct from old.hr_reviewed_at
       or new.hr_summary        is distinct from old.hr_summary
       or new.hr_recommendation is distinct from old.hr_recommendation then
      raise exception
        'The MD may record remarks and an outcome. HR''s review is HR''s to write.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  raise exception 'Only HR and the MD may write a review.'
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists evaluation_reviews_guard_columns on public.evaluation_reviews;
create trigger evaluation_reviews_guard_columns
  before update on public.evaluation_reviews
  for each row execute function public.evaluation_reviews_guard_columns();

/* ============================================================================
   RLS — HR full, MD read plus the md_ columns, nobody else at any status
   ========================================================================== */

alter table public.evaluation_reviews enable row level security;

drop policy if exists "reviews: hr all" on public.evaluation_reviews;
create policy "reviews: hr all" on public.evaluation_reviews
  for all to authenticated
  using (public.is_hr())
  with check (public.is_hr());

drop policy if exists "reviews: md reads" on public.evaluation_reviews;
create policy "reviews: md reads" on public.evaluation_reviews
  for select to authenticated
  using (public.is_md());

-- The MD may update the row; WHICH columns is the trigger's job above.
drop policy if exists "reviews: md updates own columns" on public.evaluation_reviews;
create policy "reviews: md updates own columns" on public.evaluation_reviews
  for update to authenticated
  using (public.is_md())
  with check (public.is_md());

-- No INSERT for the MD and no DELETE for anyone. The row is created by HR when
-- they first save, and a review that can be deleted is a review that can be
-- made to have never happened (§12).

grant select, insert, update on public.evaluation_reviews to authenticated;

comment on table public.evaluation_reviews is
  'HR''s and the MD''s layer over a finished evaluation (P20). HR writes the hr_ columns, the MD the md_ ones — enforced by a BEFORE UPDATE trigger, because RLS is row-level and cannot split columns. Readable by HR and the MD alone, at every status (§5, §9).';

commit;

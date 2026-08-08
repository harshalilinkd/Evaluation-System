-- 0044 · Who recorded the joining salary, and when.
--
-- 0043 made the joining salary a COLUMN so that filling it in retroactively
-- could not be read as a rise. That was right, and it cost something: a history
-- row carries `recorded_by` and `recorded_at`, and a column carries neither. So
-- the baseline renders as row 1 of the ledger with an empty "Recorded by" —
-- the one line in a pay record with nobody's name against it.
--
-- On a screen HR uses to answer "who set this figure", an em dash is not a
-- neutral blank. It is the question going unanswered.
--
-- WHY NOT READ IT FROM `audit_log`. `addJoiningSalary` writes an audit row and
-- that row does name the actor — but only for figures recorded THROUGH it.
-- Anything created by `provisionPerson`, imported from a spreadsheet, or
-- carried across by 0043 has no such row, so the column would still be empty
-- for most people while looking as though it were populated for some. The
-- provenance belongs beside the figure it describes.

begin;

alter table public.employment_records
  add column if not exists joining_ctc_recorded_by uuid references public.profiles(id),
  add column if not exists joining_ctc_recorded_at timestamptz;

comment on column public.employment_records.joining_ctc_recorded_by is
  'Who recorded the joining salary. Null where it predates 0044 or came from an import with no attributable actor — an honest blank, not a default (0044).';
comment on column public.employment_records.joining_ctc_recorded_at is
  'When the joining salary was recorded. Not the effective date — that is profiles.date_of_joining (0044).';

/* ============================================================================
   Backfill from the legacy history row, where one exists
   ========================================================================== */
--
-- A joining salary recorded the old way IS a `salary_history` row, and that row
-- has genuine provenance: who wrote it and when. 0043 carried the amount across
-- and left the attribution behind; this brings it with it.
--
-- Only where the amounts agree. If they differ, the column was set deliberately
-- by somebody after the fact and attributing it to whoever wrote the old row
-- would name the wrong person — which is worse than a blank, because a blank
-- says "unknown" and a name says "them".

update public.employment_records e
   set joining_ctc_recorded_by = j.recorded_by,
       joining_ctc_recorded_at = j.recorded_at
  from (
    select distinct on (profile_id)
           profile_id, new_ctc, recorded_by, recorded_at
      from public.salary_history
     where reason = 'JOINING'
     order by profile_id, effective_from asc, recorded_at asc
  ) j
 where j.profile_id = e.profile_id
   and e.joining_ctc_recorded_by is null
   and e.joining_ctc is not null
   and e.joining_ctc = j.new_ctc;

commit;

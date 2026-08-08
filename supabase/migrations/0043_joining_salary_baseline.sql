-- 0043 · The joining salary becomes a BASELINE, not a history row.
--
-- WHAT WAS WRONG, and it is an accounting fault rather than a display one.
--
-- P19C recorded a joining salary as the first row of `salary_history`. That
-- reads well and breaks the moment history is entered out of order — which is
-- the normal case, because HR knows today's salary before they get round to
-- digging out what somebody started on. Adding a joining salary to a person who
-- already had a current salary computed it as a REVISION against that figure:
-- ₹1,80,000 recorded against a stored ₹25,000 came out as a 620% rise, in the
-- one table whose entire purpose is to be evidence.
--
-- THE MODEL NOW. `employment_records.joining_ctc` is the baseline: one column,
-- one value, immutable, and structurally impossible to duplicate. The ledger
-- RENDERS it as row 1; it does not store a row for it. Which is what makes a
-- retroactive entry safe — there is no row for it to be compared against, and
-- nothing already in `salary_history` moves when it is filled in.
--
-- Hikes take their previous figure from the preceding history row, falling back
-- to `joining_ctc` when there is none. So the first revision after joining is
-- measured against what somebody started on, and every later one against the
-- revision before it, which is what both the spec and ordinary accounting say.
--
-- THIS MIGRATION only carries existing data across. The rules live in
-- `lib/employment/actions.ts`.

begin;

/* ============================================================================
   1. Carry legacy joining rows into the baseline column
   ========================================================================== */
--
-- Anybody whose joining salary was recorded the old way has it in
-- `salary_history` with reason 'JOINING' and nothing in `joining_ctc`. The
-- ledger now reads the column, so without this their baseline would simply
-- disappear from the screen — the row is still there, but it is filtered out of
-- the ledger to stop it appearing twice once the column is populated.
--
-- `salary_history` is NOT touched. It has no UPDATE or DELETE path for any
-- caller (P19-3) and that guard is not worth relaxing to tidy a duplicate the
-- display can simply not render.

update public.employment_records e
   set joining_ctc = j.new_ctc
  from (
    select distinct on (profile_id)
           profile_id, new_ctc
      from public.salary_history
     where reason = 'JOINING'
     order by profile_id, effective_from asc, recorded_at asc
  ) j
 where j.profile_id = e.profile_id
   -- Never overwrite a baseline somebody has already set deliberately.
   and e.joining_ctc is null;

/* ============================================================================
   2. Seed the baseline from the joining figure recorded at creation
   ========================================================================== */
--
-- `provisionPerson` has always written `current_ctc: input.current_ctc ??
-- input.joining_ctc`, so a person created with ONLY a joining salary has it
-- sitting in `current_ctc` and nothing in `joining_ctc` — which is exactly the
-- "it saved under current salary" that was reported.
--
-- Only where there is no revision history at all. If a salary change has been
-- recorded since, `current_ctc` is that revision and is not this person's
-- joining figure, so copying it would invent a baseline that is simply wrong.

update public.employment_records e
   set joining_ctc = e.current_ctc
 where e.joining_ctc is null
   and e.current_ctc is not null
   and not exists (
     select 1 from public.salary_history h
      where h.profile_id = e.profile_id
        and h.reason <> 'JOINING'
   );

/* ============================================================================
   3. One baseline per person, structurally
   ========================================================================== */
--
-- "Ledger validation: prevent duplicate baseline entries while permitting
-- retroactively populated initial salaries."
--
-- A column already gives the first half for free — there is one per row and a
-- second cannot exist. This adds the only other thing a baseline must satisfy:
-- it is money, so it cannot be zero or negative. A zero baseline would make
-- every first hike a division by zero (P21-3 hit the same edge from the
-- increment side).

alter table public.employment_records
  drop constraint if exists employment_joining_ctc_positive;

alter table public.employment_records
  add constraint employment_joining_ctc_positive
  check (joining_ctc is null or joining_ctc > 0);

comment on column public.employment_records.joining_ctc is
  'What they were paid when they joined. The BASELINE of their pay ledger: rendered as row 1 of the history but never stored as one, so filling it in retroactively cannot be read as a rise over a later salary. Immutable in practice — only the joining-salary form writes it. A hike with no preceding history row is measured against this (0043).';

commit;

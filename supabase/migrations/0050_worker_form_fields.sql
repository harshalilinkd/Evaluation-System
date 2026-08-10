-- 0050 · The rest of the worker form: the comment, the training tick, the salary block.
--
-- The paper form carries more than eight qualities, and only the qualities were
-- built (P24, 0047). Reading it against what ships, five things are missing:
--
--   1. the metadata band — worker, period, department, designation, supervisor
--   2. Supervisor Comment
--   3. Training Required · Yes / No
--   4. the salary block — Same/New, Old Salary, Increment %, New Salary
--   5. the three signature lines
--
-- (1) needs no schema: every field is already on `profiles` and the evaluation,
-- and P2-9 settled that seeding them as questions would let somebody type a
-- name that disagrees with the record it came from. (5) is print-only.
--
-- This migration is (2), (3) and (4), and they do not live in the same place.

begin;

/* ============================================================================
   1. The supervisor's comment and the training tick
   ==========================================================================
   ON THE RESPONSE ROW, not on `worker_evaluations`. That is the whole point:
   `worker_evaluations` is readable by the worker AND the supervisor, so a
   `supervisor_comment` column there would be a blindness breach the first time
   anybody selected the row — RLS is row-level and cannot mask a column (P19-2
   made the same call about salary on `profiles`).

   `worker_evaluation_responses` already refuses each side the other's layer, so
   putting them here means blindness costs nothing extra and cannot be undone by
   a later screen forgetting about it.

   Columns rather than keys inside `comments`: §5 fixes that shape as
   `{ question_id: text }`, and a reserved key that is not a question id would
   be the first exception to a rule worth keeping absolute. */

alter table public.worker_evaluation_responses
  add column if not exists overall_comment text,
  add column if not exists training_required boolean;

comment on column public.worker_evaluation_responses.overall_comment is
  'The supervisor''s written comment (paper form: "Supervisor Comment"). Null on the SELF layer — the worker''s sheet has no such field. Blind by inheritance: this table already refuses each side the other''s layer (0050).';
comment on column public.worker_evaluation_responses.training_required is
  'Paper form: "Training Required Yes/No". The supervisor''s answer, so it sits with their layer (0050).';

/* ============================================================================
   2. The salary block
   ==========================================================================
   ITS OWN TABLE, and this is not tidiness either.

   §5: "Salary figures are readable by HR_ADMIN and MD only. They never appear
   in a HOD-facing screen." A supervisor is the worker module's HOD. Putting
   these four figures on `worker_evaluations` would hand every one of them to
   the supervisor and to the WORKER, because both can read that row and RLS
   cannot withhold a column.

   So the figures go somewhere neither of them has any policy at all — the same
   structural answer P19-1 gave when salary was kept off `profiles`.

   P2-10 already ruled these are DECISION columns rather than questions, which
   is why none of them is in `worker_questions`: a salary field in a question
   bank is a pay figure somebody can edit as though it were a rating. */

create table if not exists public.worker_evaluation_decisions (
  evaluation_id   uuid primary key references public.worker_evaluations(id) on delete cascade,

  -- "Salary: Same / New" on the paper form.
  salary_changed  boolean not null default false,
  old_ctc         numeric(12, 2),
  increment_pct   numeric(6, 2),
  new_ctc         numeric(12, 2),

  -- Free text from whoever signs it off, kept apart from the supervisor's
  -- comment because they are different people saying different things.
  md_remarks      text,

  decided_by      uuid references public.profiles(id),
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- A rise that lowers pay is a typo or a decision that should not be filed
  -- under that word (P14-13 refused the same thing on the staff side).
  constraint worker_decisions_new_above_old check (
    new_ctc is null or old_ctc is null or new_ctc >= old_ctc
  )
);

drop trigger if exists worker_decisions_set_updated_at on public.worker_evaluation_decisions;
create trigger worker_decisions_set_updated_at
  before update on public.worker_evaluation_decisions
  for each row execute function public.set_updated_at();

alter table public.worker_evaluation_decisions enable row level security;

/* -- HR and the MD, and nobody else. No policy exists for the worker or the
      supervisor, and that ABSENCE is the enforcement (P5-9) — there is nothing
      to widen by accident, because there is nothing there. -- */
drop policy if exists worker_decisions_admin_read on public.worker_evaluation_decisions;
create policy worker_decisions_admin_read on public.worker_evaluation_decisions
  for select to authenticated
  using (public.is_hr() or public.is_md());

drop policy if exists worker_decisions_admin_write on public.worker_evaluation_decisions;
create policy worker_decisions_admin_write on public.worker_evaluation_decisions
  for all to authenticated
  using (public.is_hr() or public.is_md())
  with check (public.is_hr() or public.is_md());

grant select, insert, update on public.worker_evaluation_decisions to authenticated;

comment on table public.worker_evaluation_decisions is
  'The worker form''s salary block and sign-off. A SEPARATE table because worker_evaluations is readable by the worker and their supervisor, and §5 confines salary to HR and the MD — RLS cannot withhold a column, only a row (0050).';

commit;

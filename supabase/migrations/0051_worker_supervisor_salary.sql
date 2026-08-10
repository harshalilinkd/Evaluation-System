-- 0051 · The supervisor fills the salary block on the worker form.
--
-- ============================================================================
-- THIS AMENDS §5's SALARY CONFINEMENT, AT THE OWNER'S EXPLICIT INSTRUCTION,
-- AND ONLY FOR THE WORKER MODULE.
--
-- §5: "Salary figures are readable by HR_ADMIN and MD only. They never appear
-- in a HOD-facing screen, a lead export, an employee-facing report, or a
-- notification body." A supervisor is this module's HOD, so 0050 gave
-- `worker_evaluation_decisions` policies for HR and the MD and none at all for
-- anybody else.
--
-- The owner's instruction is that the supervisor fills the salary block while
-- completing the sheet, which is what the paper form does — Old Salary,
-- Increment %, New Salary and the Same/New tick sit directly above the
-- Supervisor Signature.
--
-- WHAT THIS COSTS, stated rather than glossed: a supervisor can now read and
-- write the pay figures of every worker who reports to them. That is a real
-- widening and it is the whole point of the change. It is confined as tightly
-- as the requirement allows:
--
--   · WORKERS ONLY. `evaluation_decisions` and `salary_history` are untouched.
--     A HOD still cannot see a staff member's salary, and nothing about the
--     staff module changes.
--   · THEIR OWN REPORTS ONLY. Scoped through `is_supervisor_of`, so a
--     supervisor sees the figures for the people they are rating and nobody
--     else's.
--   · NOT THE WORKER. No policy admits the worker to their own decisions row.
--     A worker being told their proposed increment before it is agreed is a
--     different decision, and nobody has made it.
--
-- To reverse: drop the two policies below. 0050's HR/MD policies stand alone
-- and the module returns to §5 as written.
-- ============================================================================

begin;

/* -- READ.
      Scoped through the same helper the sheet itself uses, so "may I see this
      appraisal" and "may I see its salary block" cannot drift apart. -- */
drop policy if exists worker_decisions_supervisor_read on public.worker_evaluation_decisions;
create policy worker_decisions_supervisor_read on public.worker_evaluation_decisions
  for select to authenticated
  using (public.is_supervisor_of(evaluation_id));

/* -- WRITE, and only while the appraisal is still OPEN.
      Once both sides are in, the figures belong to whoever signs it off. A
      supervisor who could still edit them afterwards would be changing a
      proposal that HR had already read — the same reasoning §8 uses to lock a
      layer on submission rather than on the record's status. -- */
drop policy if exists worker_decisions_supervisor_write on public.worker_evaluation_decisions;
create policy worker_decisions_supervisor_write on public.worker_evaluation_decisions
  for all to authenticated
  using (
    public.is_supervisor_of(evaluation_id)
    and exists (
      select 1 from public.worker_evaluations e
       where e.id = evaluation_id
         and e.status = 'OPEN'
         and e.supervisor_submitted_at is null
    )
  )
  with check (
    public.is_supervisor_of(evaluation_id)
    and exists (
      select 1 from public.worker_evaluations e
       where e.id = evaluation_id
         and e.status = 'OPEN'
         and e.supervisor_submitted_at is null
    )
  );

comment on table public.worker_evaluation_decisions is
  'The worker form''s salary block and sign-off. HR and the MD read and write it at any time; the SUPERVISOR of that worker may read it always and write it until they submit their sheet (0051, amending §5''s salary confinement for the worker module only, at the owner''s instruction). The worker themselves has no policy here.';

commit;

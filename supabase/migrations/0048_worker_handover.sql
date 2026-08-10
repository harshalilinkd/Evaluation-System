-- 0048 · The worker fills their own side on the supervisor's device.
--
-- THE REAL FLOW THIS REPLACES: HR prints the sheet, hands it to the supervisor,
-- and the supervisor carries it round the floor. Going digital does not give
-- every worker a phone, a login and an email address — so the device that comes
-- to the worker is the supervisor's, and the worker ticks their own side on it
-- and hands it back.
--
-- WHY THIS NEEDS A FUNCTION RATHER THAN A POLICY. 0047's write policy admits
-- the SELF layer only when `worker_id = auth.uid()`. During a hand-over the
-- session belongs to the SUPERVISOR, so that policy refuses — correctly, and it
-- must keep refusing, because widening it to "the supervisor may write the SELF
-- layer" would let a supervisor fill a worker's side quietly, from anywhere, at
-- any time.
--
-- So the capability goes to ONE narrow audited function instead of into a
-- policy — the same call P10-4 made for `launch_cycle`. What it can do is: one
-- evaluation, one layer, only where the caller is that worker's supervisor,
-- only while the record is OPEN, only once.
--
-- §17: "Never record a fill-on-behalf submission as though the worker submitted
-- it themselves." It does not. Every hand-over is stamped on the row, named in
-- the audit trail, and shown on the report.

begin;

/* ============================================================================
   1. How the worker's side was filled
   ========================================================================== */
--
-- Null until they submit. Then DIRECT (the worker signed in themselves) or
-- HANDOVER (they ticked it on their supervisor's device).
--
-- This is not bookkeeping. A reader comparing the two sides needs to know
-- whether the worker answered in private or with their supervisor standing
-- there, because the second is a weaker independence claim and the gap between
-- the columns means less. Recording it lets the report say so; not recording it
-- would let a hand-over pass as a private answer.

alter table public.worker_evaluations
  add column if not exists self_filled_via text
    check (self_filled_via is null or self_filled_via in ('DIRECT', 'HANDOVER')),
  add column if not exists self_filled_by uuid references public.profiles(id);

comment on column public.worker_evaluations.self_filled_via is
  'How the worker''s own side was filled: DIRECT (they signed in) or HANDOVER (they ticked it on their supervisor''s device). §17 — a fill-on-behalf is never recorded as though the worker submitted it independently (0048).';

/* ============================================================================
   2. The hand-over submit
   ========================================================================== */
--
-- SECURITY DEFINER, and deliberately tiny. It writes the SELF response row and
-- the two timestamps on the evaluation, and nothing else. It cannot touch the
-- SUPERVISOR layer, another worker, or a record that is not OPEN.

create or replace function public.submit_worker_self_handover(
  p_evaluation_id uuid,
  p_answers jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := (select auth.uid());
  v_row    public.worker_evaluations%rowtype;
begin
  if v_caller is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row
    from public.worker_evaluations
   where id = p_evaluation_id
   for update;

  if not found then
    raise exception 'That appraisal no longer exists.' using errcode = 'no_data_found';
  end if;

  /* -- THE ONLY PERSON WHO MAY HAND THE DEVICE OVER is the supervisor named on
        this appraisal. Not any supervisor, not HR: the worker is standing in
        front of the person who is about to rate them, and that specific pairing
        is the entire premise of the flow. -- */
  if v_row.supervisor_id is distinct from v_caller then
    raise exception 'Only this worker''s own supervisor can hand them the form.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_row.status <> 'OPEN' then
    raise exception 'This appraisal is no longer open.' using errcode = 'invalid_parameter_value';
  end if;

  -- ONCE. A second hand-over would let a supervisor replace an answer the
  -- worker already gave, which is the abuse this whole design is guarding
  -- against.
  if v_row.self_submitted_at is not null then
    raise exception 'This worker has already given their answers.'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_row.self_skipped then
    raise exception 'The worker''s side of this appraisal was skipped by HR.'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.worker_evaluation_responses
     set answers = p_answers,
         submitted_at = now(),
         /* -- `submitted_by` is the WORKER, because they are the one who ticked
               it — and `self_filled_via` beside it says the supervisor's device
               was used. Recording the supervisor here instead would say they
               answered; recording nothing would let it pass as a private
               submission. Both halves together are the truthful account. -- */
         submitted_by = v_row.worker_id
   where evaluation_id = p_evaluation_id
     and layer = 'SELF';

  update public.worker_evaluations
     set self_submitted_at = now(),
         self_filled_via = 'HANDOVER',
         self_filled_by = v_caller,
         -- Both sides in? Then it goes to review. A skipped supervisor layer
         -- counts as in, the same rule 0038 applies for staff.
         status = case
                    when supervisor_submitted_at is not null or supervisor_skipped
                      then 'PENDING_REVIEW'::public.worker_evaluation_status
                    else status
                  end
   where id = p_evaluation_id;

  /* -- §12, and the actor is the SUPERVISOR.
        The audit trail answers "who caused this to be recorded", and that is
        the person who opened the form and handed the device across. The worker
        gave the answers; the supervisor made the submission happen. -- */
  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (
    v_caller,
    'worker_evaluation',
    p_evaluation_id,
    'worker.self_submit_handover',
    jsonb_build_object('worker_id', v_row.worker_id, 'via', 'HANDOVER')
  );
end;
$$;

comment on function public.submit_worker_self_handover(uuid, jsonb) is
  'The worker ticks their own side on their supervisor''s device. SECURITY DEFINER because 0047''s policy admits the SELF layer only to the worker''s own session — and must keep doing so. Restricted to that worker''s named supervisor, an OPEN record, and one submission (0048).';

revoke all on function public.submit_worker_self_handover(uuid, jsonb) from public;
grant execute on function public.submit_worker_self_handover(uuid, jsonb) to authenticated;

/* ============================================================================
   3. A direct submission is stamped too
   ========================================================================== */
--
-- So the column means something on every row rather than only where a hand-over
-- happened. A null after submission would be ambiguous between "signed in
-- themselves" and "recorded before this column existed".

update public.worker_evaluations
   set self_filled_via = 'DIRECT'
 where self_submitted_at is not null
   and self_filled_via is null;

commit;

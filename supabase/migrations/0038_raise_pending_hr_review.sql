-- 0038_raise_pending_hr_review.sql
-- Both layers in → PENDING_HR_REVIEW. §8's system transition, which nothing ran.
--
-- §8: "OPEN | PENDING_HR_REVIEW | system | both self_submitted_at and
-- lead_submitted_at are set."
--
-- The row has existed in `transitions.ts` since AMEND-3 and `state-machine.ts`
-- takes a `bySystem` discriminator for it, but a grep for `bySystem: true`
-- returns NO call sites. So an evaluation with both sides submitted sat at OPEN
-- for ever and never reached HR — the whole point of collecting both.
--
-- WHY NOTHING COULD CALL IT.
-- 0021 defines the system actor as `v_caller is null`, i.e. no JWT at all, and
-- gates this move on `is_hr() or v_is_system`. The person who completes the pair
-- is an employee or a HOD, and neither is HR nor sessionless — so whoever
-- submits second is structurally incapable of raising it. It was never a
-- forgotten call; it was a move nobody present had the standing to make.
--
-- WHY A TRIGGER, NOT ANOTHER PATCH TO apply_evaluation_transition.
-- 0037 had to match text inside that function and failed on the real database
-- because the stored body has CRLF line endings. A trigger is self-contained:
-- it matches nothing, so it cannot miss. It also fires for EVERY path that sets
-- a submission timestamp — the two submits, HR advancing past a missing layer,
-- and anything added later — which is what "the system raises it" should mean.

create or replace function public.raise_pending_hr_review()
returns trigger
language plpgsql
-- SECURITY DEFINER because this IS the system actor §8 names. The status column
-- is writable only inside the transition window (P5-2) and `audit_log` only
-- while `in_transition` holds; a trigger firing as the employee would be
-- refused by both. What it can do is deliberately tiny: one status move, in one
-- direction, only when both sides are genuinely in.
security definer
set search_path = public, pg_temp
as $$
begin
  -- A skipped layer counts as in. §8 lets HR advance past a missing side, and
  -- that marks it skipped rather than setting a timestamp — so keying on the
  -- timestamps alone would leave those records stuck at OPEN for ever.
  if new.status = 'OPEN'
     and (new.self_submitted_at is not null or new.self_skipped)
     and (new.lead_submitted_at is not null or new.lead_skipped)
  then
    update public.evaluations
       set status = 'PENDING_HR_REVIEW'
     where id = new.id
       and status = 'OPEN';

    -- §12: every status change is audited, no exceptions. actor_id is NULL
    -- because nobody decided this — the record reached the condition §8 sets,
    -- and an audit row naming the employee who happened to submit second would
    -- attribute a system move to a person.
    insert into public.audit_log (
      actor_id, entity, entity_id, action, from_status, to_status, diff
    )
    values (
      null, 'evaluation', new.id, 'both_layers_in', 'OPEN', 'PENDING_HR_REVIEW',
      jsonb_build_object(
        'raised_by', 'system',
        'self_skipped', new.self_skipped,
        'lead_skipped', new.lead_skipped
      )
    );
  end if;

  return new;
end;
$$;

comment on function public.raise_pending_hr_review() is
  '§8: the system raises OPEN → PENDING_HR_REVIEW once both layers are in. Neither rater has the standing to do it themselves.';

/* -- Scoped to the four columns that can complete the pair.
      The inner UPDATE above changes only `status`, which is not among them, so
      it cannot re-enter this trigger — the recursion guard is the column list
      rather than a flag somebody has to remember to clear. -- */
drop trigger if exists evaluations_raise_pending_hr_review on public.evaluations;
create trigger evaluations_raise_pending_hr_review
  after update of self_submitted_at, lead_submitted_at, self_skipped, lead_skipped
  on public.evaluations
  for each row
  execute function public.raise_pending_hr_review();

/* -- Records already stranded.
      Anything that reached "both in" before this trigger existed is sitting at
      OPEN with nobody able to move it. Swept once, here, so applying the
      migration does not leave a cohort that needs a second manual fix. -- */
do $$
declare v_moved int;
begin
  with stranded as (
    update public.evaluations
       set status = 'PENDING_HR_REVIEW'
     where status = 'OPEN'
       and (self_submitted_at is not null or self_skipped)
       and (lead_submitted_at is not null or lead_skipped)
    returning id, self_skipped, lead_skipped
  )
  insert into public.audit_log (
    actor_id, entity, entity_id, action, from_status, to_status, diff
  )
  select null, 'evaluation', s.id, 'both_layers_in', 'OPEN', 'PENDING_HR_REVIEW',
         jsonb_build_object('raised_by', 'system', 'backfilled', true,
                            'self_skipped', s.self_skipped, 'lead_skipped', s.lead_skipped)
  from stranded s;

  get diagnostics v_moved = row_count;
  raise notice '0038: % evaluation(s) had both sides in and were stuck at OPEN. They are now with HR.', v_moved;
end;
$$;

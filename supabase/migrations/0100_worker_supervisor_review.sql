-- 0100: the production round gains a step — the team leader rates, their
-- supervisor reviews and decides, and only then does it reach HR.
--
-- ============================================================================
-- AT THE OWNER'S EXPLICIT INSTRUCTION. §0.4 forbids inventing a column without
-- one; this is it, in their words:
--
--   "HR will launch cycle then their TL will fill their appraisal form (they
--    will just fill ratings) and after filling this form they will submit it
--    and this form will go to Supervisors screen and then supervisor will
--    review the TLs ratings and then this fields will be fill by supervisor:
--    Supervisor comment, Training required, Salary. ... everything else is
--    same, only form is rated by TL and salary decision taken by Supervisor."
--
-- WHY `supervisor_id` IS NOT RENAMED, although it now holds the TEAM LEADER.
-- That column has meant "who fills the tick sheet" since 0047, and every policy,
-- every helper, `submit_worker_layer`, the print sheet and the blindness
-- invariant all read it that way. Renaming it is a rename §0.2 forbids without
-- an instruction, and — worse — it would silently change the MEANING of eight
-- applied migrations rather than fail. So the rater keeps the column and the
-- new person gets a new one, and the SCREENS carry the owner's vocabulary:
--
--     supervisor_id  ->  "Team leader"   · ticks the eight qualities
--     reviewer_id    ->  "Supervisor"    · reviews them, then decides
--
-- WHAT DOES NOT CHANGE, and was checked rather than assumed:
--   * §5's salary confinement. 0064 took the rupee amounts away from
--     supervisors and left them the percentage, at the owner's instruction, and
--     that stands — asked directly this round and confirmed. The reviewer
--     records Same/New and a percentage; HR prices it. No function here returns
--     an amount to anybody but HR and the MD, by construction rather than by a
--     policy somebody could widen (P19-2, and 0064's own reasoning).
--   * Blindness. The reviewer reads the SUPERVISOR layer — the ticks they were
--     brought in to review — and nothing else. No arm anywhere admits them to
--     the SELF layer, at any status.
--   * The snapshot rule. Nothing here writes `worker_evaluation_questions`.
-- ============================================================================

begin;

/* ============================================================================
   1 · The reviewer, on the evaluation
   ========================================================================== */
--
-- Per worker, not per round, at the owner's choice: one shop floor can have two
-- supervisors over different lines, and a round-wide setting cannot say so.
--
-- Copied at launch and never read live from `profiles`, exactly as
-- `supervisor_id` is (P3-6): a reassignment mid-round must not silently move an
-- appraisal somebody is halfway through reviewing.

alter table public.worker_evaluations
  add column if not exists reviewer_id           uuid references public.profiles(id),
  add column if not exists reviewer_submitted_at timestamptz,
  -- HR advancing past a supervisor who never got to it. A skipped reviewer is
  -- CLOSED, not merely un-submitted, or the step would stay writable for ever
  -- — the same distinction `self_skipped` draws in 0047.
  add column if not exists reviewer_skipped      boolean not null default false;

comment on column public.worker_evaluations.supervisor_id is
  'The TEAM LEADER: who fills the tick sheet. Named supervisor_id since 0047, when they were the only rater; the name is kept because eight migrations read it (0100).';
comment on column public.worker_evaluations.reviewer_id is
  'The SUPERVISOR: reviews the team leader''s ticks, then records the comment, the training tick and the recommended percentage (0100).';

create index if not exists worker_evaluations_reviewer_idx
  on public.worker_evaluations (reviewer_id)
  where reviewer_id is not null;

/* ============================================================================
   2 · The reviewer's two written fields move to the decisions table
   ========================================================================== */
--
-- `overall_comment` and `training_required` were put on the RESPONSE row by
-- 0050, which was right while one person did everything: they sat beside the
-- ticks they qualify. They cannot stay there now. A response row locks on its
-- own submission (§8), so the moment the team leader submits, the row holding
-- those two fields is read-only — and the person who has to fill them has not
-- started yet.
--
-- `worker_evaluation_decisions` is where they belong: it already holds the
-- salary block, it is already the table nobody but HR and the MD may read, and
-- 0064 already built the column-level split this needs.
--
-- THE OLD COLUMNS ARE NOT DROPPED. They carry the values of every appraisal
-- filed before today, and dropping a column is destroying a record. They are
-- backfilled across and then commented as superseded.

alter table public.worker_evaluation_decisions
  add column if not exists supervisor_comment text,
  add column if not exists training_required  boolean;

-- Backfill: whatever the old single-rater flow recorded becomes the reviewer's
-- half of the same appraisal. Only where the decisions row does not already
-- carry an answer, so a re-run cannot overwrite something typed since.
insert into public.worker_evaluation_decisions (evaluation_id, supervisor_comment, training_required)
select r.evaluation_id, r.overall_comment, r.training_required
  from public.worker_evaluation_responses r
 where r.layer = 'SUPERVISOR'
   and (r.overall_comment is not null or r.training_required is not null)
on conflict (evaluation_id) do update
   set supervisor_comment = coalesce(public.worker_evaluation_decisions.supervisor_comment,
                                     excluded.supervisor_comment),
       training_required  = coalesce(public.worker_evaluation_decisions.training_required,
                                     excluded.training_required);

comment on column public.worker_evaluation_responses.overall_comment is
  'SUPERSEDED by worker_evaluation_decisions.supervisor_comment (0100). Kept because it holds the record of every appraisal filed before the review step existed. Nothing reads it.';
comment on column public.worker_evaluation_responses.training_required is
  'SUPERSEDED by worker_evaluation_decisions.training_required (0100). Kept for the same reason. Nothing reads it.';

/* ============================================================================
   3 · Who the reviewer is, as a predicate
   ========================================================================== */
--
-- SECURITY DEFINER for the reason P5-7 records: a policy on
-- `worker_evaluations` that queried the same table would recurse.

create or replace function public.is_worker_reviewer_of(p_evaluation_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $fn$
  select exists (
    select 1 from public.worker_evaluations e
     where e.id = p_evaluation_id
       and e.reviewer_id = (select auth.uid())
  );
$fn$;

grant execute on function public.is_worker_reviewer_of(uuid) to authenticated;

/* -- The reviewer must be able to read the WORKER'S NAME.
      Extending 0053's helper rather than restating the six-arm profiles policy:
      a restatement that drops an arm REMOVES access silently rather than
      failing (SR2-5 caught exactly that in a view, CR1-3 in this policy), and
      there is no reason to run that risk for one clause.

      This is the COREVIEWER-1 fault, pre-empted: a reviewer who can open the
      appraisal and not the person renders "Unknown", which reads as broken data
      rather than as a missing policy. A name is not an answer — §5's blindness
      is about the LAYERS — so naming the worker discloses nothing. -- */
create or replace function public.is_my_worker(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
      from public.worker_evaluations we
     where we.worker_id = p_profile_id
       and (we.supervisor_id = (select auth.uid())
            or we.reviewer_id = (select auth.uid()))
       and we.excluded_at is null
  );
$fn$;

/* ============================================================================
   4 · What the reviewer may read
   ========================================================================== */
--
-- Three policies restated in full, every existing arm reproduced. The new arm
-- is one line in each and is marked.

drop policy if exists worker_evaluations_read on public.worker_evaluations;
create policy worker_evaluations_read on public.worker_evaluations
  for select to authenticated using (
    worker_id = (select auth.uid())
    or supervisor_id = (select auth.uid())
    or reviewer_id = (select auth.uid())        -- new (0100)
    or public.is_hr()
    or public.is_md()
  );

drop policy if exists worker_questions_snapshot_read on public.worker_evaluation_questions;
create policy worker_questions_snapshot_read on public.worker_evaluation_questions
  for select to authenticated using (
    public.is_worker_of(evaluation_id)
    or public.is_supervisor_of(evaluation_id)
    or public.is_worker_reviewer_of(evaluation_id)   -- new (0100)
    or public.is_hr()
    or public.is_md()
  );

/* -- THE BLINDNESS POLICY, still. The reviewer gains the SUPERVISOR layer and
      NOT the SELF layer — reviewing the team leader's ticks is the whole of the
      step they were added for, and the worker's own answers are no more theirs
      to read than they were before. -- */
drop policy if exists worker_responses_read on public.worker_evaluation_responses;
create policy worker_responses_read on public.worker_evaluation_responses
  for select to authenticated using (
    (layer = 'SELF'       and public.is_worker_of(evaluation_id))
    or (layer = 'SUPERVISOR' and public.is_supervisor_of(evaluation_id))
    or (layer = 'SUPERVISOR' and public.is_worker_reviewer_of(evaluation_id))  -- new (0100)
    or public.is_hr()
    or public.is_md()
  );

/* -- No write policy is added for the reviewer anywhere.
      They never touch a response row — they do not re-tick — and their three
      fields go through the two functions below rather than through a policy on
      `worker_evaluation_decisions`, which is row-level and would hand them
      `old_ctc` and `new_ctc` with it (§5, and 0064's own argument for a view). -- */

commit;

/* ============================================================================
   5 · The team leader's submit now knows where to send it
   ========================================================================== */
--
-- RECREATED IN FULL from 0057 rather than patched. A patch has to match text
-- inside a large body, and this log records both ways that goes wrong — 0056
-- matched three fragments from three unrelated arms and reported a success it
-- had not achieved, and 0037 missed on a newline because the stored body is
-- CRLF. Recreating means reproducing all of it, which is safe here because
-- 0057 is the ONLY definition (0070 mentions it in a comment and nowhere else)
-- and its full text is in the repository.
--
-- The one change is the destination: with a reviewer assigned it goes to them,
-- and without one it goes straight to HR exactly as it does today. That second
-- half is what keeps every round launched before this migration working.

begin;

create or replace function public.submit_worker_layer(
  p_evaluation_id uuid,
  p_layer public.worker_rating_layer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_caller  uuid := (select auth.uid());
  v_row     public.worker_evaluations%rowtype;
  v_answers jsonb;
  v_overall uuid;
  v_tick    text;
begin
  if v_caller is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.worker_evaluations
   where id = p_evaluation_id for update;

  if not found then
    raise exception 'That appraisal no longer exists.' using errcode = 'no_data_found';
  end if;

  if (p_layer = 'SELF' and v_row.worker_id is distinct from v_caller)
     or (p_layer = 'SUPERVISOR' and v_row.supervisor_id is distinct from v_caller) then
    raise exception 'That is not your side of this appraisal.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_row.status <> 'OPEN' then
    raise exception 'This appraisal is no longer open.' using errcode = 'invalid_parameter_value';
  end if;

  if (p_layer = 'SELF' and (v_row.self_submitted_at is not null or v_row.self_skipped))
     or (p_layer = 'SUPERVISOR' and (v_row.supervisor_submitted_at is not null or v_row.supervisor_skipped)) then
    raise exception 'This side has already been submitted.' using errcode = 'invalid_parameter_value';
  end if;

  update public.worker_evaluation_responses
     set submitted_at = now(),
         submitted_by = v_caller
   where evaluation_id = p_evaluation_id
     and layer = p_layer
   returning answers into v_answers;

  /* -- §11: a worker's overall is the tick sheet's "Overall Performance" row,
        never a mean. Read from the FROZEN sheet rather than the live bank, and
        stored now rather than recomputed on read (§5). -- */
  if p_layer = 'SUPERVISOR' then
    select question_id into v_overall
      from public.worker_evaluation_questions
     where evaluation_id = p_evaluation_id and is_overall
     limit 1;

    if v_overall is not null then
      v_tick := v_answers ->> v_overall::text;
    end if;
  end if;

  update public.worker_evaluations
     set self_submitted_at =
           case when p_layer = 'SELF' then now() else self_submitted_at end,
         supervisor_submitted_at =
           case when p_layer = 'SUPERVISOR' then now() else supervisor_submitted_at end,
         overall_tick =
           case when p_layer = 'SUPERVISOR' then v_tick else overall_tick end,
         /* -- Both rating sides in? Then it leaves OPEN. WHERE it goes is the
               0100 change: to the supervisor if one is assigned and still owes
               a review, otherwise to HR — which is every round launched before
               this migration, unchanged.

               A SKIPPED layer counts as in, as it always has: HR advanced past
               it deliberately, and waiting for a submission that will never
               come would strand the record (F11-3). -- */
         status =
           case
             when (p_layer = 'SELF'
                     and (supervisor_submitted_at is not null or supervisor_skipped))
               or (p_layer = 'SUPERVISOR'
                     and (self_submitted_at is not null or self_skipped))
             then case
                    when reviewer_id is not null
                     and reviewer_submitted_at is null
                     and not reviewer_skipped
                    then 'PENDING_SUPERVISOR'::public.worker_evaluation_status
                    else 'PENDING_REVIEW'::public.worker_evaluation_status
                  end
             else status
           end
   where id = p_evaluation_id;

  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (
    v_caller,
    'worker_evaluation',
    p_evaluation_id,
    case when p_layer = 'SELF' then 'worker.self_submit' else 'worker.supervisor_submit' end,
    jsonb_build_object('layer', p_layer)
  );
end;
$fn$;

/* ============================================================================
   6 · What the reviewer sees of the decision — and what they cannot
   ========================================================================== */
--
-- A FUNCTION, not a policy and not 0064's view.
--
-- 0064 built `v_worker_supervisor_decision` for this job and it cannot do it:
-- the view is `security_invoker`, and the same migration dropped the
-- supervisor's SELECT policy on the underlying table — so it returns nothing
-- for the very person it was written for. (Pre-existing, recorded here because
-- it is why this takes a different shape rather than reusing it.)
--
-- A SELECT policy is not the answer either: RLS is ROW-level, so any policy
-- admitting the reviewer to that row hands over `old_ctc` and `new_ctc` with it.
-- A definer function that names four columns cannot return a fifth — the
-- absence is structural, which is what §5 asks for here.

create or replace function public.worker_review_decision(p_evaluation_id uuid)
returns table (
  salary_changed     boolean,
  increment_pct      numeric,
  supervisor_comment text,
  training_required  boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not (public.is_worker_reviewer_of(p_evaluation_id) or public.is_hr() or public.is_md()) then
    raise exception 'That appraisal is not yours to review.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select d.salary_changed, d.increment_pct, d.supervisor_comment, d.training_required
      from public.worker_evaluation_decisions d
     where d.evaluation_id = p_evaluation_id;
end;
$fn$;

revoke all on function public.worker_review_decision(uuid) from public;
grant execute on function public.worker_review_decision(uuid) to authenticated;

/* ============================================================================
   7 · The reviewer's save
   ========================================================================== */
--
-- Four columns, and there is no parameter for an amount. `old_ctc`, `new_ctc`,
-- `md_remarks` and `decided_by` are never named, so a call cannot move them —
-- 0064's two guard triggers still run behind this as the backstop, but they are
-- not what is doing the work.

create or replace function public.save_worker_review(
  p_evaluation_id   uuid,
  p_salary_changed  boolean,
  p_increment_pct   numeric,
  p_comment         text,
  p_training        boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status public.worker_evaluation_status;
begin
  if not public.is_worker_reviewer_of(p_evaluation_id) then
    raise exception 'That appraisal is not yours to review.'
      using errcode = 'insufficient_privilege';
  end if;

  select status into v_status
    from public.worker_evaluations where id = p_evaluation_id;

  if v_status is null then
    raise exception 'That appraisal no longer exists.' using errcode = 'no_data_found';
  end if;

  if v_status <> 'PENDING_SUPERVISOR' then
    raise exception 'This appraisal is not with you — it is at %.', v_status
      using errcode = 'invalid_parameter_value';
  end if;

  if p_increment_pct is not null and (p_increment_pct <= 0 or p_increment_pct > 100) then
    raise exception 'A rise is between 0 and 100 per cent.' using errcode = 'check_violation';
  end if;

  insert into public.worker_evaluation_decisions
    (evaluation_id, salary_changed, increment_pct, supervisor_comment, training_required)
  values
    (p_evaluation_id, coalesce(p_salary_changed, false),
     -- "Same" means no figure, not a zero. A stored 0 would read as a rise of
     -- nothing rather than as a decision not to give one.
     case when coalesce(p_salary_changed, false) then p_increment_pct else null end,
     nullif(btrim(coalesce(p_comment, '')), ''), p_training)
  on conflict (evaluation_id) do update
     set salary_changed     = excluded.salary_changed,
         increment_pct      = excluded.increment_pct,
         supervisor_comment = excluded.supervisor_comment,
         training_required  = excluded.training_required;
end;
$fn$;

revoke all on function public.save_worker_review(uuid, boolean, numeric, text, boolean) from public;
grant execute on function public.save_worker_review(uuid, boolean, numeric, text, boolean) to authenticated;

/* ============================================================================
   8 · The reviewer closes, and it goes to HR
   ========================================================================== */
--
-- The completeness guard is FIX-41's, one step earlier in the chain: a
-- recommended rise with no percentage on it gives HR nothing to price and the
-- MD nothing to approve, so it is refused here rather than discovered three
-- screens later.

create or replace function public.submit_worker_review(p_evaluation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_caller uuid := (select auth.uid());
  v_row    public.worker_evaluations%rowtype;
  v_dec    public.worker_evaluation_decisions%rowtype;
begin
  if v_caller is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.worker_evaluations
   where id = p_evaluation_id for update;

  if not found then
    raise exception 'That appraisal no longer exists.' using errcode = 'no_data_found';
  end if;

  if v_row.reviewer_id is distinct from v_caller then
    raise exception 'That appraisal is not yours to review.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_row.status <> 'PENDING_SUPERVISOR' then
    raise exception 'This appraisal is not with you — it is at %.', v_row.status
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_dec from public.worker_evaluation_decisions
   where evaluation_id = p_evaluation_id;

  if v_dec.training_required is null then
    raise exception 'Say whether training is required before sending this to HR.'
      using errcode = 'check_violation';
  end if;

  if coalesce(v_dec.salary_changed, false)
     and (v_dec.increment_pct is null or v_dec.increment_pct <= 0) then
    raise exception 'You have recommended a new salary but no percentage. HR has nothing to price without one.'
      using errcode = 'check_violation';
  end if;

  update public.worker_evaluations
     set reviewer_submitted_at = now(),
         status = 'PENDING_REVIEW'
   where id = p_evaluation_id;

  /* -- §12. No amount in the diff: 0013 lets a lead read `audit_log` for their
        own reports, so a salary figure in a diff walks straight past §5
        (P19-10). The percentage is a recommendation rather than pay, and is
        recorded. -- */
  insert into public.audit_log
    (actor_id, entity, entity_id, action, from_status, to_status, diff)
  values (
    v_caller, 'worker_evaluation', p_evaluation_id,
    'worker.supervisor_review_submitted', 'PENDING_SUPERVISOR', 'PENDING_REVIEW',
    jsonb_build_object(
      'training_required', v_dec.training_required,
      'salary_changed',    coalesce(v_dec.salary_changed, false),
      'increment_pct',     v_dec.increment_pct
    )
  );
end;
$fn$;

revoke all on function public.submit_worker_review(uuid) from public;
grant execute on function public.submit_worker_review(uuid) to authenticated;

commit;

/* ============================================================================
   9 · Verification
   ========================================================================== */
--
-- Every claim asserted rather than assumed, and the one that matters most is
-- the negative one: no function added here can return a rupee amount.

do $chk$
declare
  v_cols integer;
  v_leak integer;
begin
  select count(*) into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and ((table_name = 'worker_evaluations'
             and column_name in ('reviewer_id', 'reviewer_submitted_at', 'reviewer_skipped'))
       or (table_name = 'worker_evaluation_decisions'
             and column_name in ('supervisor_comment', 'training_required')));

  if v_cols <> 5 then
    raise exception '0100: expected 5 new columns, found %.', v_cols;
  end if;

  -- `worker_review_decision` returns four named columns and none is an amount.
  select count(*) into v_leak
    from unnest(string_to_array(
           pg_get_function_result(
             (select oid from pg_proc where proname = 'worker_review_decision' limit 1)), ',')) c
   where c ~* '(old_ctc|new_ctc|ctc|salary_amount)';

  if v_leak > 0 then
    raise exception '0100: worker_review_decision returns a salary amount. Section 5.';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'worker_evaluation_responses'
       and policyname = 'worker_responses_read'
       and qual like '%is_worker_reviewer_of%'
  ) then
    raise exception '0100: the reviewer cannot read the ticks they were added to review.';
  end if;

  -- Blindness, from the other side: no arm gives the reviewer the SELF layer.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'worker_evaluation_responses'
       and policyname = 'worker_responses_read'
       and qual ~ 'SELF.{0,80}is_worker_reviewer_of'
  ) then
    raise exception '0100: the reviewer has been given the SELF layer. Section 5.';
  end if;

  raise notice '0100 applied. The team leader rates; their supervisor reviews and recommends; HR prices it.';
end;
$chk$;

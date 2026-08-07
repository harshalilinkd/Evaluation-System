-- =============================================================================
-- 0005_rls.sql — Row Level Security on every table. Phase P5. CLAUDE.md §9.
-- =============================================================================
--
-- §9: "Every table has RLS enabled. No table is left open." All twelve tables
-- from P1–P4 are covered below.
--
-- The case this migration is really written for: **a HOD is also an employee.**
-- Their own evaluation is reached by the evaluatee policies and their reports'
-- by the lead policies, and both apply at once because Postgres ORs permissive
-- policies together. Nothing switches on "which role is this person really" —
-- that question has no answer here, and any policy that asked it would be wrong.
--
-- Two structural decisions worth reading before the policies:
--
--   1. Helpers are SECURITY DEFINER. A policy on `evaluations` that called a
--      function which reads `evaluations` would recurse forever. Running as the
--      owner breaks the cycle. Consequently RLS is never FORCEd on these tables.
--
--   2. `evaluations.status` is writable only from inside
--      apply_evaluation_transition, gated on a transaction-local GUC that only
--      that function sets. §8's table stays the single write path, and it is now
--      enforced by the database rather than by convention.
-- =============================================================================


/* ---------- Helper functions ---------- */
-- is_hr() and is_md() already exist from 0001_core.sql.

-- Is the caller the person being evaluated?
create or replace function public.is_evaluatee(evaluation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.evaluations e
    where e.id = evaluation_id
      and e.evaluatee_id = (select auth.uid())
  );
$$;

-- Is the caller the lead assigned to THIS evaluation?
--
-- Named for the evaluation, not the profile, to sit alongside 0001's
-- is_lead_of(profile). The distinction matters: lead_id is copied onto the
-- evaluation at launch, so a mid-cycle reorganisation cannot hand an in-flight
-- review to somebody new, and cannot take it away from the person doing it.
create or replace function public.is_lead_of_evaluation(evaluation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.evaluations e
    where e.id = evaluation_id
      and e.lead_id = (select auth.uid())
  );
$$;

-- Everyone entitled to know this evaluation exists (§9): the employee, their
-- lead, HR and the MD. Not "everyone entitled to see every layer of it" — the
-- layers are gated separately on evaluation_responses.
create or replace function public.can_see_evaluation(evaluation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_hr()
      or public.is_md()
      or public.is_evaluatee(evaluation_id)
      or public.is_lead_of_evaluation(evaluation_id);
$$;

-- Status and disclosure, read past RLS so a policy can branch on them without
-- its subquery being filtered by the very policies it is helping to evaluate.
create or replace function public.evaluation_status_of(evaluation_id uuid)
returns public.evaluation_status
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.status from public.evaluations e where e.id = evaluation_id;
$$;

create or replace function public.evaluation_disclosure_of(evaluation_id uuid)
returns public.disclosure_policy
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.disclosure
  from public.evaluations e
  join public.evaluation_cycles c on c.id = e.cycle_id
  where e.id = evaluation_id;
$$;

-- True only while apply_evaluation_transition is running against this exact
-- evaluation. The GUC is transaction-local and nothing else sets it, so a
-- direct UPDATE from a client can never satisfy it.
create or replace function public.in_transition(evaluation_id uuid)
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.transition_evaluation', true), '') = evaluation_id::text;
$$;


/* ---------- The transition function re-checks its own authorisation ---------- */
--
-- Replaced rather than edited (§0.8: never edit an applied migration).
--
-- Two changes from 0004, both security-critical:
--
--   1. It sets the transaction-local GUC the policies below key on, so it is the
--      only path that can write evaluations.status.
--
--   2. **It re-checks who is allowed to make the move.** The function is granted
--      to `authenticated`, which means any signed-in user can call it directly
--      through PostgREST with whatever arguments they like. Without this check,
--      an employee could move their own evaluation straight to MD_FINALIZED and
--      the TypeScript state machine would never see it. §9 is explicit: client
--      code must never be the only guard.
--
-- The CASE below duplicates §8's table from lib/evaluations/transitions.ts on
-- purpose. Both must change together; supabase/tests/rls.sql asserts the
-- database half rejects what the TypeScript half rejects.

create or replace function public.apply_evaluation_transition(
  p_evaluation_id    uuid,
  p_from_status      public.evaluation_status,
  p_to_status        public.evaluation_status,
  p_actor_id         uuid,
  p_action           text,
  p_reason           text default null,
  p_diff             jsonb default null,
  p_evaluation_patch jsonb default '{}'::jsonb,
  p_lock_layer       public.rating_layer default null,
  p_unlock_layer     public.rating_layer default null,
  p_answers          jsonb default null,
  p_section_scores   jsonb default null,
  p_overall_score    numeric default null
)
returns uuid
language plpgsql
as $$
declare
  v_audit_id   uuid;
  v_updated    integer;
  v_caller     uuid := (select auth.uid());
  v_evaluatee  uuid;
  v_lead       uuid;
  v_status     public.evaluation_status;
  -- No JWT means the service role: cron and notification code, which §8 permits
  -- as "system" on the close step.
  v_is_system  boolean := v_caller is null;
  v_allowed    boolean;
begin
  select e.evaluatee_id, e.lead_id, e.status
    into v_evaluatee, v_lead, v_status
  from public.evaluations e
  where e.id = p_evaluation_id;

  if not found then
    raise exception 'No evaluation with id %.', p_evaluation_id
      using errcode = 'no_data_found';
  end if;

  -- You may only ever act as yourself.
  if not v_is_system and p_actor_id is distinct from v_caller then
    raise exception 'You cannot record a transition on behalf of another user.'
      using errcode = 'insufficient_privilege';
  end if;

  -- §8's table, re-checked in the database. The final ELSE is what rejects any
  -- transition not listed in §8 — there is no other branch.
  v_allowed := case
    when p_from_status = 'DRAFT'          and p_to_status = 'CYCLE_ACTIVE'   then public.is_hr() or v_is_system
    when p_from_status = 'CYCLE_ACTIVE'   and p_to_status = 'SELF_SUBMITTED' then v_caller = v_evaluatee
    when p_from_status = 'SELF_SUBMITTED' and p_to_status = 'CYCLE_ACTIVE'   then v_caller = v_lead
    when p_from_status = 'SELF_SUBMITTED' and p_to_status = 'LEAD_REVIEWED'  then v_caller = v_lead
    when p_from_status = 'LEAD_REVIEWED'  and p_to_status = 'SELF_SUBMITTED' then public.is_md()
    when p_from_status = 'LEAD_REVIEWED'  and p_to_status = 'MD_FINALIZED'   then public.is_md()
    when p_from_status = 'MD_FINALIZED'   and p_to_status = 'CLOSED'         then public.is_hr() or v_is_system
    else false
  end;

  if not v_allowed then
    raise exception 'You are not permitted to move this evaluation from % to %.', p_from_status, p_to_status
      using errcode = 'insufficient_privilege';
  end if;

  -- Opens the window the policies below check for. Transaction-local, so it is
  -- gone the moment this statement finishes.
  perform set_config('app.transition_evaluation', p_evaluation_id::text, true);

  -- Optimistic concurrency: someone may have moved it between the application
  -- deciding and this committing.
  update public.evaluations e
  set status = p_to_status,
      self_submitted_at = case when p_evaluation_patch ? 'self_submitted_at'
        then (p_evaluation_patch ->> 'self_submitted_at')::timestamptz else e.self_submitted_at end,
      lead_submitted_at = case when p_evaluation_patch ? 'lead_submitted_at'
        then (p_evaluation_patch ->> 'lead_submitted_at')::timestamptz else e.lead_submitted_at end,
      md_finalized_at = case when p_evaluation_patch ? 'md_finalized_at'
        then (p_evaluation_patch ->> 'md_finalized_at')::timestamptz else e.md_finalized_at end,
      closed_at = case when p_evaluation_patch ? 'closed_at'
        then (p_evaluation_patch ->> 'closed_at')::timestamptz else e.closed_at end,
      self_overall = case when p_evaluation_patch ? 'self_overall'
        then (p_evaluation_patch ->> 'self_overall')::numeric else e.self_overall end,
      lead_overall = case when p_evaluation_patch ? 'lead_overall'
        then (p_evaluation_patch ->> 'lead_overall')::numeric else e.lead_overall end,
      final_overall = case when p_evaluation_patch ? 'final_overall'
        then (p_evaluation_patch ->> 'final_overall')::numeric else e.final_overall end
  where e.id = p_evaluation_id
    and e.status = p_from_status;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception
      'Evaluation % is not in status % any more. Someone else may have moved it; reload and try again.',
      p_evaluation_id, p_from_status
      using errcode = 'serialization_failure';
  end if;

  if p_lock_layer is not null then
    insert into public.evaluation_responses (
      evaluation_id, layer, answers, submitted_at, submitted_by, section_scores, overall_score
    )
    values (
      p_evaluation_id, p_lock_layer, coalesce(p_answers, '{}'::jsonb),
      now(), p_actor_id, p_section_scores, p_overall_score
    )
    on conflict (evaluation_id, layer) do update set
      answers        = case when p_answers is null then public.evaluation_responses.answers else p_answers end,
      submitted_at   = now(),
      submitted_by   = p_actor_id,
      section_scores = excluded.section_scores,
      overall_score  = excluded.overall_score;
  end if;

  if p_unlock_layer is not null then
    update public.evaluation_responses
    set submitted_at = null, submitted_by = null, section_scores = null, overall_score = null
    where evaluation_id = p_evaluation_id and layer = p_unlock_layer;
  end if;

  insert into public.audit_log (
    actor_id, entity, entity_id, action, from_status, to_status, diff, reason
  )
  values (
    p_actor_id, 'evaluation', p_evaluation_id, p_action,
    p_from_status::text, p_to_status::text, p_diff, p_reason
  )
  returning id into v_audit_id;

  return v_audit_id;
end;
$$;


/* ---------- profiles: column-level guard ---------- */
--
-- §9 / P5 brief: "self may update phone only; HR may update everything." RLS is
-- row-level and cannot express that, so the column restriction is a trigger.
-- Without it, the self-update policy below would also let someone move
-- themselves into another department or reassign their own reporting line.

create or replace function public.profiles_guard_self_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- HR may change anything. So may a caller with no JWT at all: that is the
  -- service role, a migration, or a seed — none of which RLS applies to either
  -- (§0.5 already restricts where the service key may be used). Without this
  -- second clause the trigger would block supabase/seed.sql and every HR
  -- provisioning script, which is a guard misfiring, not a guard working.
  if public.is_hr() or (select auth.uid()) is null then
    return new;
  end if;

  if new.id              is distinct from old.id
     or new.full_name    is distinct from old.full_name
     or new.employee_code is distinct from old.employee_code
     or new.email        is distinct from old.email
     or new.department_id is distinct from old.department_id
     or new.designation  is distinct from old.designation
     or new.date_of_joining is distinct from old.date_of_joining
     or new.track        is distinct from old.track
     or new.reports_to   is distinct from old.reports_to
     or new.is_active    is distinct from old.is_active then
    raise exception
      'You can only change your own phone number. Ask HR to update anything else.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- Fires before profiles_set_updated_at (triggers run in name order), so it
-- compares the row as submitted rather than after the timestamp is stamped.
create trigger profiles_guard_self_update
  before update on public.profiles
  for each row execute function public.profiles_guard_self_update();


-- =============================================================================
-- Enable RLS — all twelve tables from P1 to P4
-- =============================================================================

alter table public.departments          enable row level security;
alter table public.profiles             enable row level security;
alter table public.user_roles           enable row level security;
alter table public.questions            enable row level security;
alter table public.question_options     enable row level security;
alter table public.department_questions enable row level security;
alter table public.evaluation_cycles    enable row level security;
alter table public.evaluations          enable row level security;
alter table public.evaluation_questions enable row level security;
alter table public.evaluation_responses enable row level security;
alter table public.evaluation_decisions enable row level security;
alter table public.audit_log            enable row level security;


-- =============================================================================
-- Config tables — readable by anyone signed in, writable by HR
--
-- Read-open is deliberate: an employee cannot render the form they are filling
-- in without the question text, and a lead cannot render their report's. The
-- questions are not confidential; the answers are.
-- =============================================================================

create policy "departments: read" on public.departments
  for select to authenticated using (true);
create policy "departments: hr writes" on public.departments
  for all to authenticated using (public.is_hr()) with check (public.is_hr());

create policy "questions: read" on public.questions
  for select to authenticated using (true);
create policy "questions: hr writes" on public.questions
  for all to authenticated using (public.is_hr()) with check (public.is_hr());

create policy "question_options: read" on public.question_options
  for select to authenticated using (true);
create policy "question_options: hr writes" on public.question_options
  for all to authenticated using (public.is_hr()) with check (public.is_hr());

create policy "department_questions: read" on public.department_questions
  for select to authenticated using (true);
create policy "department_questions: hr writes" on public.department_questions
  for all to authenticated using (public.is_hr()) with check (public.is_hr());

create policy "evaluation_cycles: read" on public.evaluation_cycles
  for select to authenticated using (true);
create policy "evaluation_cycles: hr writes" on public.evaluation_cycles
  for all to authenticated using (public.is_hr()) with check (public.is_hr());


-- =============================================================================
-- profiles
-- =============================================================================

-- A lead reads their direct reports through reports_to. Note this is the live
-- reporting line, which is what the People screen needs; an in-flight review is
-- scoped by evaluations.lead_id instead.
create policy "profiles: read self, reports, or all as HR/MD" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_hr()
    or public.is_md()
    or reports_to = (select auth.uid())
  );

-- Columns other than phone_e164 are blocked by profiles_guard_self_update.
create policy "profiles: self updates phone" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "profiles: hr updates anything" on public.profiles
  for update to authenticated
  using (public.is_hr()) with check (public.is_hr());

create policy "profiles: hr inserts" on public.profiles
  for insert to authenticated with check (public.is_hr());

create policy "profiles: hr deletes" on public.profiles
  for delete to authenticated using (public.is_hr());


-- =============================================================================
-- user_roles
-- =============================================================================

create policy "user_roles: read own, or all as HR/MD" on public.user_roles
  for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_hr() or public.is_md());

create policy "user_roles: hr writes" on public.user_roles
  for all to authenticated using (public.is_hr()) with check (public.is_hr());


-- =============================================================================
-- evaluations
-- =============================================================================

create policy "evaluations: read own, reports, or all as HR/MD" on public.evaluations
  for select to authenticated
  using (
    evaluatee_id = (select auth.uid())
    or lead_id = (select auth.uid())
    or public.is_hr()
    or public.is_md()
  );

create policy "evaluations: hr creates" on public.evaluations
  for insert to authenticated with check (public.is_hr());

-- The only UPDATE path. Everything §8 governs — status, the stage timestamps,
-- the stored overalls — moves through apply_evaluation_transition or not at all.
create policy "evaluations: update only inside a transition" on public.evaluations
  for update to authenticated
  using (public.in_transition(id))
  with check (public.in_transition(id));

-- No DELETE policy, for anyone. §17: a submitted layer is returned, never deleted.


-- =============================================================================
-- evaluation_questions — the frozen snapshot
-- =============================================================================

create policy "evaluation_questions: read if you can see the evaluation"
  on public.evaluation_questions
  for select to authenticated
  using (public.can_see_evaluation(evaluation_id));

-- The brief says "no client writes". Taken literally that would also block HR
-- from snapshotting at launch, which is the one legitimate write this table
-- ever receives (lib/forms/snapshot.ts, run by the HR user launching the
-- cycle). So: HR may INSERT, and **nobody** may UPDATE or DELETE. The absent
-- update policy is what actually enforces §5 — once frozen, a snapshot row
-- cannot be altered by any client, HR included.
create policy "evaluation_questions: hr snapshots" on public.evaluation_questions
  for insert to authenticated with check (public.is_hr());


-- =============================================================================
-- evaluation_responses — the sensitive table
--
-- Permissive policies are OR'd, so these read as: a row is visible if ANY
-- clause below admits it. Each layer is stated separately rather than as one
-- condition, because the three layers have genuinely different rules and a
-- combined expression would be unreadable and unreviewable.
-- =============================================================================

/* -- SELF layer -- */

-- Everyone who can see the evaluation can read the self answers: the employee
-- wrote them, the lead needs them to review, HR and the MD oversee.
create policy "responses: read SELF layer" on public.evaluation_responses
  for select to authenticated
  using (layer = 'SELF' and public.can_see_evaluation(evaluation_id));

create policy "responses: evaluatee drafts SELF" on public.evaluation_responses
  for insert to authenticated
  with check (
    layer = 'SELF'
    and public.is_evaluatee(evaluation_id)
    and public.evaluation_status_of(evaluation_id) = 'CYCLE_ACTIVE'
  );

-- Writable only while the cycle is open to them. The moment they submit, the
-- status moves to SELF_SUBMITTED and this policy stops matching — that is §8's
-- locking rule, enforced by the database rather than by the UI hiding a button.
create policy "responses: evaluatee edits SELF while open" on public.evaluation_responses
  for update to authenticated
  using (
    layer = 'SELF'
    and public.is_evaluatee(evaluation_id)
    and public.evaluation_status_of(evaluation_id) = 'CYCLE_ACTIVE'
  )
  with check (
    layer = 'SELF'
    and public.is_evaluatee(evaluation_id)
    and public.evaluation_status_of(evaluation_id) = 'CYCLE_ACTIVE'
  );

/* -- LEAD layer -- */

-- The employee does NOT see their lead's ratings or comments unless the cycle
-- discloses them in full and the evaluation is closed (§9: "never raw lead
-- comments" unless disclosure explicitly allows).
create policy "responses: read LEAD layer" on public.evaluation_responses
  for select to authenticated
  using (
    layer = 'LEAD'
    and (
      public.is_lead_of_evaluation(evaluation_id)
      or public.is_hr()
      or public.is_md()
      or (
        public.is_evaluatee(evaluation_id)
        and public.evaluation_disclosure_of(evaluation_id) = 'FULL'
        and public.evaluation_status_of(evaluation_id) = 'CLOSED'
      )
    )
  );

create policy "responses: lead drafts LEAD" on public.evaluation_responses
  for insert to authenticated
  with check (
    layer = 'LEAD'
    and public.is_lead_of_evaluation(evaluation_id)
    and public.evaluation_status_of(evaluation_id) = 'SELF_SUBMITTED'
  );

create policy "responses: lead edits LEAD while reviewing" on public.evaluation_responses
  for update to authenticated
  using (
    layer = 'LEAD'
    and public.is_lead_of_evaluation(evaluation_id)
    and public.evaluation_status_of(evaluation_id) = 'SELF_SUBMITTED'
  )
  with check (
    layer = 'LEAD'
    and public.is_lead_of_evaluation(evaluation_id)
    and public.evaluation_status_of(evaluation_id) = 'SELF_SUBMITTED'
  );

/* -- MD layer -- */

-- The brief asks for the evaluatee to see "scores only when disclosure allows".
-- RLS is row-level: admitting this row would also hand over its `comments`,
-- which RLS cannot mask, so under SCORE_ONLY the employee would receive more
-- than §9 permits. Resolved by NOT admitting the row below the FULL policy —
-- the score the employee is entitled to lives on evaluations.final_overall,
-- which they can already read, and the decision on evaluation_decisions.
-- Nothing is lost and nothing over-discloses. See §18 P5.
create policy "responses: read MD layer" on public.evaluation_responses
  for select to authenticated
  using (
    layer = 'MD'
    and (
      public.is_md()
      or public.is_hr()
      or (
        public.is_evaluatee(evaluation_id)
        and public.evaluation_disclosure_of(evaluation_id) = 'FULL'
        and public.evaluation_status_of(evaluation_id) = 'CLOSED'
      )
    )
  );

create policy "responses: md drafts MD" on public.evaluation_responses
  for insert to authenticated
  with check (
    layer = 'MD'
    and public.is_md()
    and public.evaluation_status_of(evaluation_id) = 'LEAD_REVIEWED'
  );

create policy "responses: md edits MD while finalising" on public.evaluation_responses
  for update to authenticated
  using (
    layer = 'MD'
    and public.is_md()
    and public.evaluation_status_of(evaluation_id) = 'LEAD_REVIEWED'
  )
  with check (
    layer = 'MD'
    and public.is_md()
    and public.evaluation_status_of(evaluation_id) = 'LEAD_REVIEWED'
  );

/* -- The transition function -- */

-- Locking a layer happens after evaluations.status has already moved, so by
-- then none of the client policies above match. These two admit the function's
-- own writes, and only its own: in_transition() keys on a transaction-local GUC
-- that nothing else sets.
create policy "responses: transition writes" on public.evaluation_responses
  for insert to authenticated with check (public.in_transition(evaluation_id));

create policy "responses: transition locks and unlocks" on public.evaluation_responses
  for update to authenticated
  using (public.in_transition(evaluation_id))
  with check (public.in_transition(evaluation_id));

-- No DELETE policy, for anyone (§17).


-- =============================================================================
-- evaluation_decisions — §9: MD writes, HR reads, employee reads on disclosure
-- =============================================================================

create policy "decisions: read" on public.evaluation_decisions
  for select to authenticated
  using (
    public.is_md()
    or public.is_hr()
    or (
      public.is_evaluatee(evaluation_id)
      and public.evaluation_status_of(evaluation_id) = 'CLOSED'
      and public.evaluation_disclosure_of(evaluation_id) in ('SCORE_AND_DECISION', 'FULL')
    )
  );

-- §9 gives HR "read" on decisions, not write. Only the MD records them.
create policy "decisions: md writes" on public.evaluation_decisions
  for insert to authenticated with check (public.is_md());

create policy "decisions: md updates" on public.evaluation_decisions
  for update to authenticated using (public.is_md()) with check (public.is_md());


-- =============================================================================
-- audit_log — §12
-- =============================================================================

create policy "audit_log: hr and md read" on public.audit_log
  for select to authenticated
  using (public.is_hr() or public.is_md());

-- Insertable only from inside apply_evaluation_transition.
--
-- P6 note: §12 also requires audit rows for question-bank edits, role changes
-- and token issue/use. None of those go through the transition function, so
-- each will need its own gated insert path — do not widen this policy to
-- "any authenticated user", which would let anyone forge history.
create policy "audit_log: transition writes" on public.audit_log
  for insert to authenticated
  with check (public.in_transition(entity_id));

-- §12: "no update or delete policy exists for anyone, including HR." There is
-- deliberately nothing here. The trigger from 0004 catches the service role too,
-- which RLS never sees.


-- =============================================================================
-- Grants
--
-- RLS decides which rows; grants decide which verbs. Both are required, and
-- Supabase's defaults are not relied on. `anon` receives nothing: this product
-- has no public surface.
-- =============================================================================

grant usage on schema public to authenticated;

grant select on public.departments, public.questions, public.question_options,
                public.department_questions, public.evaluation_cycles,
                public.profiles, public.user_roles, public.evaluations,
                public.evaluation_questions, public.evaluation_responses,
                public.evaluation_decisions, public.audit_log
  to authenticated;

grant insert, update, delete on public.departments, public.questions,
                                public.question_options, public.department_questions,
                                public.evaluation_cycles, public.profiles,
                                public.user_roles
  to authenticated;

grant insert, update on public.evaluations, public.evaluation_responses,
                        public.evaluation_decisions to authenticated;
grant insert on public.evaluation_questions to authenticated;

-- Append-only at the privilege level as well as by policy and by trigger.
grant insert on public.audit_log to authenticated;
revoke update, delete on public.audit_log from authenticated;

grant execute on function public.is_evaluatee(uuid)            to authenticated;
grant execute on function public.is_lead_of_evaluation(uuid)   to authenticated;
grant execute on function public.can_see_evaluation(uuid)      to authenticated;
grant execute on function public.evaluation_status_of(uuid)    to authenticated;
grant execute on function public.evaluation_disclosure_of(uuid) to authenticated;
grant execute on function public.in_transition(uuid)           to authenticated;

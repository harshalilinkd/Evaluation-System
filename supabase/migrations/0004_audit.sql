-- =============================================================================
-- 0004_audit.sql — The audit log, and the atomic transition primitive.
-- Phase P4. CLAUDE.md §8 (state machine), §11 (scoring), §12 (audit).
-- =============================================================================
--
-- §12: "Every transition writes an audit_log row. No exceptions. No shortcuts."
-- That is why the status change and the audit write happen inside one function
-- rather than as two round-trips from the application: if they were separate,
-- a crash between them would leave a status change with no record of who made
-- it, and the audit trail would be quietly incomplete rather than loudly broken.
--
-- Division of labour, deliberately:
--   • lib/evaluations decides WHETHER a transition is allowed. It needs the
--     assembled form, the answers and the visibility rules, none of which
--     belong in PL/pgSQL.
--   • This function COMMITS it. One statement from the application, one
--     transaction in the database, all four writes or none.
--
-- !! RLS IS STILL NOT ENABLED. Policies land in P5. !!
-- =============================================================================


/* ---------- audit_log ---------- */

create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),

  -- §12 requires the actor be retained. The FK has no ON DELETE clause on
  -- purpose: once someone has acted, their profile can no longer be deleted.
  -- In an audited system that is the correct behaviour — people are deactivated
  -- (profiles.is_active), never erased. See the note in §18 P4.
  actor_id    uuid references public.profiles(id),

  -- Generic on purpose. §12 logs transitions, MD overrides, decisions,
  -- question-bank edits, token issue/use and role changes — one shape for all
  -- of them, so nothing gets its own table and quietly escapes the trail.
  entity      text not null,
  entity_id   uuid not null,
  action      text not null,

  from_status text,
  to_status   text,

  -- { "before": {...}, "after": {...} }
  diff        jsonb,

  -- §8: return transitions carry a reason, which is shown to the person
  -- receiving the returned form.
  reason      text,

  created_at  timestamptz not null default now()
);

-- The read pattern is always "history of this thing, newest first".
create index audit_log_entity_idx on public.audit_log (entity, entity_id, created_at desc);

comment on table public.audit_log is
  'Insert-only (§12). Enforced by trigger as well as by RLS in P5, because the service-role key bypasses RLS entirely.';


/* ---------- Insert-only, enforced ---------- */

-- §12 says no update or delete policy exists for anyone. RLS alone would not
-- deliver that: the service-role client used by cron and notification code
-- bypasses RLS completely. A trigger holds for every caller, including that one.
create or replace function public.audit_log_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only: % is not permitted on an audit row.', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function public.audit_log_is_append_only();

create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function public.audit_log_is_append_only();


/* ---------- The transition primitive ---------- */
--
-- SECURITY INVOKER (the default), NOT security definer. Authorisation lives in
-- lib/evaluations, and P5's RLS must still apply to the rows this touches —
-- a definer function here would punch a hole straight through those policies.
--
-- P5 note: the audit_log insert policy must permit `authenticated`, or every
-- transition will fail at the last step.

create or replace function public.apply_evaluation_transition(
  p_evaluation_id    uuid,
  p_from_status      public.evaluation_status,
  p_to_status        public.evaluation_status,
  p_actor_id         uuid,
  p_action           text,
  p_reason           text default null,
  p_diff             jsonb default null,
  -- Only the keys present are written, so an explicit null clears a column and
  -- an absent key leaves it alone. `patch ? 'key'` is what distinguishes them.
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
  v_audit_id uuid;
  v_updated  integer;
begin
  -- Optimistic concurrency. The application read the evaluation, decided the
  -- move was legal, and is now committing it — but someone else may have moved
  -- it in between. Matching on the expected from-status makes that a loud
  -- failure rather than a silent double transition.
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

  -- §8 locking rule: a submitted layer is read-only until an explicit return.
  if p_lock_layer is not null then
    insert into public.evaluation_responses (
      evaluation_id, layer, answers, submitted_at, submitted_by, section_scores, overall_score
    )
    values (
      p_evaluation_id, p_lock_layer, coalesce(p_answers, '{}'::jsonb),
      now(), p_actor_id, p_section_scores, p_overall_score
    )
    on conflict (evaluation_id, layer) do update set
      -- Only replace the answers when the caller supplied them. The MD layer
      -- does (§11: the final score is written explicitly); self and lead
      -- submissions keep whatever the person already saved.
      answers        = case when p_answers is null then public.evaluation_responses.answers else p_answers end,
      submitted_at   = now(),
      submitted_by   = p_actor_id,
      section_scores = excluded.section_scores,
      overall_score  = excluded.overall_score;
  end if;

  -- A return clears the submission and the scores computed at submit time.
  -- Answers are deliberately left intact — the point of a return is that the
  -- person edits what they wrote and submits again.
  if p_unlock_layer is not null then
    update public.evaluation_responses
    set submitted_at   = null,
        submitted_by   = null,
        section_scores = null,
        overall_score  = null
    where evaluation_id = p_evaluation_id
      and layer = p_unlock_layer;
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

grant execute on function public.apply_evaluation_transition(
  uuid, public.evaluation_status, public.evaluation_status, uuid, text, text,
  jsonb, jsonb, public.rating_layer, public.rating_layer, jsonb, jsonb, numeric
) to authenticated;

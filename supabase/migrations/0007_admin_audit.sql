-- =============================================================================
-- 0007_admin_audit.sql — An audited write path for HR administration.
-- Phase P8. CLAUDE.md §12.
-- =============================================================================
--
-- §12 requires an audit row for "every question-bank edit, every role change,
-- every token issue/use" — but 0005's audit_log insert policy admits only
-- apply_evaluation_transition, which was the right call: widening it to "any
-- authenticated user" would let anyone forge history.
--
-- This is the second gated path that note anticipated. It is SECURITY DEFINER
-- so it can write past the policy, and it re-checks HR membership itself, so
-- being able to call it is not the same as being able to use it.
--
-- Deliberately narrow: the caller chooses neither the actor nor the timestamp.
-- An audit row that lets you pick who did it is not an audit row.
-- =============================================================================

create or replace function public.log_admin_action(
  p_entity    text,
  p_entity_id uuid,
  p_action    text,
  p_diff      jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := (select auth.uid());
  v_id     uuid;
begin
  -- No JWT means the service role: a migration, a seed or a cron job. §9 gives
  -- configuration to HR; everybody else is refused.
  if v_caller is not null and not public.is_hr() then
    raise exception 'Only HR can record an administrative action.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_entity is null or p_entity_id is null or p_action is null then
    raise exception 'entity, entity_id and action are required on an audit row.'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  -- actor_id is taken from the session, never from the argument list.
  values (v_caller, p_entity, p_entity_id, p_action, p_diff)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.log_admin_action(text, uuid, text, jsonb) to authenticated;

comment on function public.log_admin_action is
  'Audited write path for HR configuration changes (§12). Actor comes from the session; audit_log stays append-only.';

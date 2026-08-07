-- =============================================================================
-- 0016_notification_settings.sql — the outbound pause switch. Phase P17.
-- CLAUDE.md §10 (distribution), §12 (audit).
-- =============================================================================
--
-- ONE ROW, ONE JOB.
--
-- P17 asks for "a global pause switch … when on, dispatch writes a QUEUED row
-- and sends nothing". That state has to outlive a request and be visible to
-- cron, which has no session — so it cannot be a cookie, a module variable or
-- an environment variable somebody has to redeploy to change.
--
-- §0.4 forbids inventing schema, and this is the narrowest thing that satisfies
-- the requirement: a single-row settings table with a CHECK that keeps it
-- single-row. Not a generic key-value store — that invites the next person to
-- put anything in it, and a table where "anything" lives is a table nobody can
-- reason about.
-- =============================================================================

create table if not exists public.notification_settings (
  -- The CHECK is what makes this a settings row rather than a settings table:
  -- there can only ever be one, so no query has to decide which one is current.
  id            boolean primary key default true check (id),

  outbound_paused boolean not null default false,
  paused_by       uuid references public.profiles(id),
  paused_at       timestamptz,
  paused_reason   text,

  updated_at    timestamptz not null default now()
);

insert into public.notification_settings (id) values (true)
on conflict (id) do nothing;

alter table public.notification_settings enable row level security;

-- Everyone signed in may READ it: the rose banner P17 wants across every admin
-- screen has to know, and a paused system that looks normal is worse than one
-- that is loudly paused.
drop policy if exists notification_settings_read on public.notification_settings;
create policy notification_settings_read on public.notification_settings
  for select to authenticated using (true);

grant select on public.notification_settings to authenticated;

-- No insert, update or delete policy for anyone. The function below is the only
-- write path — same pattern as notifications_log (0010).


/* ---------- set_outbound_paused ---------- */

create or replace function public.set_outbound_paused(
  p_paused boolean,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null or not public.is_admin() then
    raise exception 'Only an administrator can pause outbound messages.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.notification_settings
  set outbound_paused = p_paused,
      paused_by       = case when p_paused then v_caller else null end,
      paused_at       = case when p_paused then now() else null end,
      paused_reason   = case when p_paused then p_reason else null end,
      updated_at      = now()
  where id;

  -- §12: pausing every outbound message in the company is exactly the kind of
  -- change that must be answerable later. The audit row carries who and when.
  insert into public.audit_log (actor_id, entity, entity_id, action, diff, reason)
  select v_caller, 'notification_settings',
         -- A settings row has no uuid of its own; the actor's id keeps the
         -- append-only FK satisfied and the row still says who did it.
         v_caller, case when p_paused then 'notifications.paused' else 'notifications.resumed' end,
         jsonb_build_object('paused', p_paused), p_reason;

  return p_paused;
end;
$$;

revoke all on function public.set_outbound_paused(boolean, text) from public;
grant execute on function public.set_outbound_paused(boolean, text) to authenticated;

comment on table public.notification_settings is
  'Single-row outbound controls (P17). The pause switch is read by dispatch.ts on every send and by cron, which has no session — hence a table rather than a cookie or an env var.';

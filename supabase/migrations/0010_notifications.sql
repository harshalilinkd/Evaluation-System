-- =============================================================================
-- 0010_notifications.sql — The outbound message log. Phase P11.
-- CLAUDE.md §10 (distribution), §12 (audit), §15 (credentials).
-- =============================================================================
--
-- NUMBERING. The P11 brief names this file 0007_notifications.sql. 0007 is
-- already 0007_admin_audit.sql and has been applied, and §0.8 says a migration
-- that has been applied is never edited and numbering is sequential. So this is
-- 0010. Flagged rather than silently renumbered.
--
-- WHAT THIS TABLE IS FOR
--
-- §10: "Every send is logged to notifications_log with the provider response.
-- Failures never block the UI — they surface as a retry-able row in HR's
-- distribution screen." So this is not a debug log. It is the thing the
-- distribution screen reads to answer "did this person get their link, and if
-- not, why not".
--
-- WHAT IT MUST NEVER CONTAIN
--
-- The invite token, or any URL built from one. §10 stores only the SHA-256 hash
-- of a token and returns the plaintext exactly once, to the caller, so it can be
-- handed to WhatsApp or email and then forgotten. A copy in this table would
-- undo that entirely: anyone who could read notifications_log could sign in as
-- anyone in the cycle.
--
-- The `payload` column is the sharp edge — it is jsonb and it is tempting to
-- drop the rendered message body in it. The CHECK constraint below refuses any
-- payload containing something shaped like a token or an /invite/ URL. It is a
-- backstop, not the guard: dispatch.ts never puts one there in the first place.
-- =============================================================================


create table if not exists public.notifications_log (
  id            uuid primary key default gen_random_uuid(),

  -- Text with a CHECK rather than an enum: a new channel (SMS, in-app) should
  -- not need a migration that rewrites a type every policy depends on.
  channel       text not null check (channel in ('WHATSAPP', 'EMAIL')),

  -- The address or number actually dialled, after normalisation. Kept so a
  -- failure can be diagnosed against what was really sent, not what was meant.
  recipient     text not null,

  -- The templates.ts key. Not the rendered body — see the banner.
  template      text not null,

  -- Both nullable: a send may concern an evaluation (an invite), a person with
  -- no evaluation yet, or neither. Not cascading on delete — §12's principle
  -- that a record of what was sent outlives the thing it was about.
  evaluation_id uuid references public.evaluations(id) on delete set null,
  profile_id    uuid references public.profiles(id) on delete set null,

  status        text not null default 'QUEUED' check (status in ('QUEUED', 'SENT', 'FAILED')),

  -- Whatever the provider gave back. Maytapi's own message id, or Resend's.
  -- NEVER treated as proof of delivery — see the comment on status below.
  provider_message_id text,
  error         text,

  -- Non-secret context only: the person's name for display, the due date, the
  -- cycle. Never the link, never the token, never the rendered body.
  payload       jsonb not null default '{}'::jsonb,

  -- Who pressed send. Not in the brief's column list, and added deliberately:
  -- the brief also requires "Rate limit the send action per HR user: 200 sends
  -- per hour", which cannot be counted without knowing whose sends they were.
  sent_by       uuid,

  created_at    timestamptz not null default now(),
  sent_at       timestamptz,

  constraint notifications_log_payload_object check (jsonb_typeof(payload) = 'object'),

  -- The backstop described in the banner. base64url tokens are 43 characters
  -- for 32 bytes; anything that long and token-shaped, or any invite URL, is
  -- refused outright rather than quietly stored.
  constraint notifications_log_no_secrets check (
    payload::text !~ '/invite/'
    and payload::text !~ '[A-Za-z0-9_-]{40,}'
    and coalesce(recipient, '') !~ '/invite/'
  )
);

-- The distribution screen's main read: "the latest row per person per template
-- for this cycle", newest first.
create index if not exists notifications_log_evaluation_idx
  on public.notifications_log (evaluation_id, template, created_at desc);

-- The retry sweep: "show me everything that failed".
create index if not exists notifications_log_status_idx
  on public.notifications_log (status, created_at);

-- The rate limiter counts a caller's last hour. Without this it scans the table
-- on every single send, which is the one moment it must not.
create index if not exists notifications_log_sender_idx
  on public.notifications_log (sent_by, created_at desc);

comment on column public.notifications_log.status is
  'QUEUED -> SENT or FAILED. SENT means the provider accepted the message, never that it arrived: Maytapi reports non-WhatsApp numbers asynchronously and we do not claim a delivery we cannot verify. There is deliberately no DELIVERED value.';

comment on column public.notifications_log.payload is
  'Non-secret display context only. The invite token and any URL built from it are forbidden here and refused by a CHECK constraint (§10).';


/* ---------- RLS ---------- */
--
-- §9 gives configuration to HR and read to the MD. Nobody else has any business
-- knowing who has been chased about their appraisal.
--
-- There is NO insert policy and NO update policy, for anyone. That is the
-- enforcement of the brief's "inserts happen server-side only": the only write
-- path is the two SECURITY DEFINER functions below, which take the actor from
-- the session and cannot be told to lie about it. Same pattern as
-- log_admin_action (0007) and launch_cycle (0009).

alter table public.notifications_log enable row level security;

drop policy if exists notifications_log_read on public.notifications_log;
create policy notifications_log_read on public.notifications_log
  for select to authenticated
  using (public.is_hr() or public.is_md());

grant select on public.notifications_log to authenticated;


/* ---------- queue_notification ---------- */
--
-- Writes the QUEUED row BEFORE the provider is called. That ordering is the
-- point: if the process dies mid-send, the evidence that an attempt was made
-- survives. A row written afterwards would lose exactly the sends most worth
-- knowing about.

create or replace function public.queue_notification(
  p_channel       text,
  p_recipient     text,
  p_template      text,
  p_evaluation_id uuid default null,
  p_profile_id    uuid default null,
  p_payload       jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := (select auth.uid());
  v_recent integer;
  v_id     uuid;
begin
  -- No JWT means a cron job or a migration. §9 gives distribution to HR.
  if v_caller is not null and not public.is_hr() then
    raise exception 'Only HR can send evaluation links.'
      using errcode = 'insufficient_privilege';
  end if;

  -- P11: "Rate limit the send action per HR user: 200 sends per hour."
  --
  -- Enforced here rather than in TypeScript because this is the chokepoint every
  -- send passes through, including a bulk run and a retry sweep. A limit in the
  -- action layer would be bypassed by any future caller that forgot it.
  --
  -- Counted over a rolling hour, not a clock hour: a fixed window lets somebody
  -- send 200 at 10:59 and 200 more at 11:01.
  if v_caller is not null then
    select count(*) into v_recent
    from public.notifications_log
    where sent_by = v_caller and created_at > now() - interval '1 hour';

    if v_recent >= 200 then
      -- SQLSTATE 54000 (program_limit_exceeded). Postgres has no
      -- "too_many_requests" condition name, and RAISE with an unrecognised one
      -- fails on the RAISE itself — so the caller would get a parser error
      -- instead of this sentence, which is the opposite of §0.7.
      raise exception
        'You have sent 200 messages in the last hour, which is the limit. Try again shortly.'
        using errcode = '54000';
    end if;
  end if;

  insert into public.notifications_log
    (channel, recipient, template, evaluation_id, profile_id, payload, status, sent_by)
  values
    (p_channel, p_recipient, p_template, p_evaluation_id, p_profile_id,
     coalesce(p_payload, '{}'::jsonb), 'QUEUED', v_caller)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.queue_notification(text, text, text, uuid, uuid, jsonb) from public;
grant execute on function public.queue_notification(text, text, text, uuid, uuid, jsonb) to authenticated;


/* ---------- settle_notification ---------- */
--
-- Closes a queued row out to SENT or FAILED. Narrow on purpose: it can move a
-- row's outcome and nothing else. It cannot change the recipient, the template
-- or who sent it, so the record of the attempt cannot be rewritten after the
-- fact to look like something it was not.

create or replace function public.settle_notification(
  p_id                  uuid,
  p_status              text,
  p_provider_message_id text default null,
  p_error               text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is not null and not public.is_hr() then
    raise exception 'Only HR can record a send outcome.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_status not in ('SENT', 'FAILED') then
    raise exception 'A notification settles as SENT or FAILED, not %.', p_status
      using errcode = 'invalid_parameter_value';
  end if;

  -- Refuse a provider id or an error string that looks like a leaked token.
  -- Providers echo request content back in error messages more often than is
  -- comfortable, and that is a plausible route for a link to end up in the log.
  if coalesce(p_provider_message_id, '') ~ '/invite/' or coalesce(p_error, '') ~ '/invite/' then
    raise exception 'A provider response containing an invite link cannot be stored.'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.notifications_log
  set status              = p_status,
      provider_message_id = p_provider_message_id,
      error               = left(p_error, 500),
      sent_at             = case when p_status = 'SENT' then now() else sent_at end
  where id = p_id
    -- Only a row still in flight. Settling twice would overwrite the first
    -- outcome, and the first outcome is the true one.
    and status = 'QUEUED';
end;
$$;

revoke all on function public.settle_notification(uuid, text, text, text) from public;
grant execute on function public.settle_notification(uuid, text, text, text) to authenticated;

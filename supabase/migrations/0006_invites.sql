-- =============================================================================
-- 0006_invites.sql — Tokenised invite links. Phase P6. CLAUDE.md §10, §9, §12.
-- =============================================================================
--
-- §10 is a list of exact security requirements. The ones that shape this file:
--
--   • "Only the SHA-256 hash is stored." The plaintext token exists in one
--     process, for one response, and is never written anywhere — not to this
--     table, not to a log, not to notifications_log. A stolen database backup
--     yields no working links.
--
--   • "Single evaluation scope. It never grants access to anything beyond that
--     one evaluation." The token carries an evaluation_id and nothing else; it
--     is not a session, and holding one confers no role.
--
--   • "One active token per (evaluation, channel); resending revokes the old."
--
--   • "Rate limit: 10 attempts per token per hour, then lock."
--
-- The three functions below are SECURITY DEFINER on purpose. Verification has to
-- read a table that no client may read — that is the whole point of storing only
-- hashes — and it has to be atomic, because the attempt counter and the rate
-- limit are the lock. Possession of a valid token is the only credential any of
-- them accept.
-- =============================================================================


/* ---------- invite_tokens ---------- */

create table public.invite_tokens (
  id            uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.evaluations(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id),

  -- SHA-256 of the base64url token, hex encoded. The token itself is never here.
  token_hash    text not null unique,

  -- 'whatsapp' | 'email'. Text rather than an enum because §10 leaves the
  -- channel list open and a new one must not need a migration.
  channel       text not null,

  expires_at    timestamptz not null,
  used_at       timestamptz,
  revoked_at    timestamptz,

  -- Lifetime counter. The hourly window is derived from audit_log, which §12
  -- requires be written for "every token issue/use" anyway — so the timestamps
  -- needed for a rolling window already exist without a second column here.
  attempt_count integer not null default 0,

  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

create index invite_tokens_token_hash_idx on public.invite_tokens (token_hash);
create index invite_tokens_evaluation_channel_idx
  on public.invite_tokens (evaluation_id, channel);

comment on table public.invite_tokens is
  'Only SHA-256 hashes (§10). Clients never read this table; the SECURITY DEFINER functions below are the only path.';


/* ---------- RLS ---------- */

alter table public.invite_tokens enable row level security;

-- §10: nobody but HR may read these rows, and even HR only ever sees hashes.
-- The verification path does not go through RLS at all — it is a definer
-- function — so an employee holding a token still cannot SELECT anything here.
create policy "invite_tokens: hr reads" on public.invite_tokens
  for select to authenticated using (public.is_hr());

create policy "invite_tokens: hr issues" on public.invite_tokens
  for insert to authenticated with check (public.is_hr());

-- No UPDATE or DELETE policy for anyone. Revoking and marking used happen only
-- inside the definer functions, so a client cannot un-revoke a token or reset
-- its attempt counter to defeat the rate limit.

grant select, insert on public.invite_tokens to authenticated;


/* ---------- issue_invite_token ---------- */
--
-- Takes the hash, never the token. The caller generates 32 random bytes, keeps
-- the plaintext in memory long enough to render one link, and passes only the
-- digest here.

create or replace function public.issue_invite_token(
  p_evaluation_id uuid,
  p_channel       text,
  p_token_hash    text
)
returns table (id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller     uuid := (select auth.uid());
  v_is_system  boolean := v_caller is null;
  v_profile    uuid;
  v_self_due   date;
  v_expires    timestamptz;
  v_id         uuid;
begin
  -- Definer functions bypass RLS, so authorisation is re-checked here. §9 gives
  -- distribution to HR.
  if not (v_is_system or public.is_hr()) then
    raise exception 'Only HR can issue invite links.'
      using errcode = 'insufficient_privilege';
  end if;

  select e.evaluatee_id, c.self_due_on
    into v_profile, v_self_due
  from public.evaluations e
  join public.evaluation_cycles c on c.id = e.cycle_id
  where e.id = p_evaluation_id;

  if not found then
    raise exception 'No evaluation with id %.', p_evaluation_id
      using errcode = 'no_data_found';
  end if;

  -- §10 ties expiry to the cycle. Without a self-evaluation deadline there is
  -- nothing to derive it from, and a link with an invented expiry is worse than
  -- no link — it would outlive the cycle it belongs to.
  if v_self_due is null then
    raise exception
      'This cycle has no self-evaluation deadline, so an invite expiry cannot be derived. Set self_due_on first.'
      using errcode = 'invalid_parameter_value';
  end if;

  v_expires := (v_self_due + interval '7 days')::timestamptz;

  -- §10: one active token per (evaluation, channel). Resending revokes the old
  -- one, so an intercepted earlier link stops working the moment HR resends.
  update public.invite_tokens t
  set revoked_at = now()
  where t.evaluation_id = p_evaluation_id
    and t.channel = p_channel
    and t.used_at is null
    and t.revoked_at is null;

  insert into public.invite_tokens (
    evaluation_id, profile_id, token_hash, channel, expires_at, created_by
  )
  values (
    p_evaluation_id, v_profile, p_token_hash, p_channel, v_expires, v_caller
  )
  returning invite_tokens.id into v_id;

  -- §12: every token issue is logged. The hash is recorded, never the token.
  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (v_caller, 'invite_token', v_id, 'invite.issued',
          jsonb_build_object('after', jsonb_build_object(
            'evaluation_id', p_evaluation_id, 'channel', p_channel,
            'expires_at', v_expires)));

  return query select v_id, v_expires;
end;
$$;


/* ---------- verify_invite_token ---------- */
--
-- The only way to resolve a token. Returns a status and, on success only, the
-- evaluation and the email an OTP should go to.
--
-- Granted to `anon` because the whole point is that the holder has no session
-- yet. Possession of a valid, unexpired, unused token is the credential. The
-- email comes back so the server can send the OTP without ever putting it in a
-- URL (§10).

create or replace function public.verify_invite_token(p_token_hash text)
returns table (
  status        text,
  invite_id     uuid,
  evaluation_id uuid,
  profile_id    uuid,
  email         text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t              public.invite_tokens%rowtype;
  v_recent       integer;
  v_email        text;
begin
  select * into t from public.invite_tokens where token_hash = p_token_hash;

  -- An unknown hash gets a flat answer and no audit row: there is no invite to
  -- attribute the attempt to, and writing one per guess would let an attacker
  -- fill the audit log.
  if not found then
    return query select 'INVALID'::text, null::uuid, null::uuid, null::uuid, null::text;
    return;
  end if;

  -- §10: 10 attempts per token per hour, then lock. The window comes from the
  -- audit rows this function writes, so it is genuinely rolling rather than a
  -- counter someone forgot to reset.
  select count(*) into v_recent
  from public.audit_log a
  where a.entity = 'invite_token'
    and a.entity_id = t.id
    and a.action = 'invite.attempt'
    and a.created_at > now() - interval '1 hour';

  if v_recent >= 10 then
    insert into public.audit_log (actor_id, entity, entity_id, action)
    values (null, 'invite_token', t.id, 'invite.rate_limited');

    return query select 'RATE_LIMITED'::text, t.id, null::uuid, null::uuid, null::text;
    return;
  end if;

  update public.invite_tokens
  set attempt_count = attempt_count + 1
  where id = t.id;

  insert into public.audit_log (actor_id, entity, entity_id, action)
  values (null, 'invite_token', t.id, 'invite.attempt');

  -- Order matters: revoked beats used beats expired, so the message the person
  -- sees describes what actually happened to their link.
  if t.revoked_at is not null then
    return query select 'REVOKED'::text, t.id, null::uuid, null::uuid, null::text;
    return;
  end if;

  if t.used_at is not null then
    return query select 'USED'::text, t.id, null::uuid, null::uuid, null::text;
    return;
  end if;

  if t.expires_at <= now() then
    return query select 'EXPIRED'::text, t.id, null::uuid, null::uuid, null::text;
    return;
  end if;

  select p.email into v_email from public.profiles p where p.id = t.profile_id;

  return query select 'OK'::text, t.id, t.evaluation_id, t.profile_id, v_email;
end;
$$;


/* ---------- consume_invite_token ---------- */
--
-- Called once sign-in has completed. Requires the session to belong to the
-- profile the token was issued to, so a signed-in user cannot burn someone
-- else's link, and re-entry is idempotent for the rightful owner.

create or replace function public.consume_invite_token(p_invite_id uuid)
returns table (status text, evaluation_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t        public.invite_tokens%rowtype;
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null then
    raise exception 'A session is required to consume an invite.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into t from public.invite_tokens where id = p_invite_id;

  if not found then
    return query select 'INVALID'::text, null::uuid;
    return;
  end if;

  if t.profile_id <> v_caller then
    -- Someone signed in as one person opening a link issued to another.
    insert into public.audit_log (actor_id, entity, entity_id, action)
    values (v_caller, 'invite_token', t.id, 'invite.wrong_recipient');

    return query select 'WRONG_RECIPIENT'::text, null::uuid;
    return;
  end if;

  if t.revoked_at is not null then
    return query select 'REVOKED'::text, null::uuid;
    return;
  end if;

  if t.expires_at <= now() then
    return query select 'EXPIRED'::text, null::uuid;
    return;
  end if;

  -- Marking used is what makes a link single-use. Already-used is not an error
  -- for the rightful owner mid-flow; the USED page is reached through
  -- verify_invite_token on a fresh visit.
  if t.used_at is null then
    update public.invite_tokens set used_at = now() where id = t.id;

    insert into public.audit_log (actor_id, entity, entity_id, action, diff)
    values (v_caller, 'invite_token', t.id, 'invite.used',
            jsonb_build_object('after', jsonb_build_object('evaluation_id', t.evaluation_id)));
  end if;

  return query select 'OK'::text, t.evaluation_id;
end;
$$;


/* ---------- invite_pending_email ---------- */
--
-- The code-entry screen needs the address an OTP was sent to, but the token has
-- already done its job and been dropped. This resolves an invite id — carried in
-- an httpOnly cookie — back to the address, and only while the invite is still
-- live.
--
-- Returns null rather than raising for a spent invite, so the screen can show
-- the "already used" page instead of an error. Never returns an address for a
-- used, revoked or expired invite, which is what stops the id being used to
-- enumerate staff emails.

create or replace function public.invite_pending_email(p_invite_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.email
  from public.invite_tokens t
  join public.profiles p on p.id = t.profile_id
  where t.id = p_invite_id
    and t.used_at is null
    and t.revoked_at is null
    and t.expires_at > now();
$$;


grant execute on function public.issue_invite_token(uuid, text, text) to authenticated;
grant execute on function public.invite_pending_email(uuid) to anon, authenticated;
-- anon is deliberate: the holder has no session yet, which is the case these
-- functions exist to serve.
grant execute on function public.verify_invite_token(text) to anon, authenticated;
grant execute on function public.consume_invite_token(uuid) to authenticated;

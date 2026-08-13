-- 0073 · HR may edit the wording of a message.
--
-- NEW SCHEMA, AT THE OWNER'S EXPLICIT INSTRUCTION ("make it editable so we can
-- edit templates"). §0.4 forbids inventing a table without one, so it is named
-- here rather than absorbed.
--
-- WHAT THIS DOES AND DOES NOT CHANGE.
--
-- §10's rule was never "the wording must live in source". It is that a message
-- string must not live BESIDE THE CODE THAT SENDS IT — because a body written
-- next to a server action gets edited by whoever is touching that action, and
-- the four places an employee is addressed drift into four different voices.
-- One row per template, edited on one screen, keeps that intact: there is still
-- exactly one place a message is written.
--
-- What it must not become is a way to send something §5 or §9 forbids. Three
-- things enforce that, and only one of them is here:
--
--   · the SET of editable templates is fixed in code, not data — the three
--     digests compose lists at render time and `evaluationClosed` varies with
--     the cycle's disclosure policy, so none of the four is editable at all;
--   · a body may only contain placeholders the template actually supplies, and
--     must contain the ones it cannot work without (a reminder with no link is
--     a message nobody can act on);
--   · a literal URL is refused, so a token can never be typed in by hand.
--
-- The first two are in `lib/notify/overrides.ts`, where the placeholder list
-- lives. The third is a CHECK below, because it is the one that matters if the
-- other two are ever bypassed.

/* ---------- The table ---------- */

create table if not exists public.notification_templates (
  -- The TemplateKey. Not a foreign key to anything — the set of templates is a
  -- TypeScript union, and a row for a key that no longer exists is simply never
  -- read (the loader looks up by key).
  key            text primary key,
  subject        text not null,
  body           text not null,
  updated_by     uuid references public.profiles(id),
  updated_at     timestamptz not null default now()
);

comment on table public.notification_templates is
  'HR''s wording for an outbound message, overriding the default in lib/notify/templates.ts. A key with no row here uses the default.';

comment on column public.notification_templates.body is
  'The plain-text body, carrying {placeholders}. The email is rebuilt from this text inside the designed shell — HR never edits HTML.';

/* -- NOT NULL AND NOT BLANK.
      A row that exists with an empty body would silence a message while the
      screen showed it as customised — the worst of both, and the failure is
      silence, which nobody reports. Deleting the row is how you go back to the
      default, and the screen's Reset does exactly that. -- */
alter table public.notification_templates drop constraint if exists notification_templates_not_blank;
alter table public.notification_templates add constraint notification_templates_not_blank
  check (length(btrim(subject)) > 0 and length(btrim(body)) > 0);

/* -- §10: NO LINK MAY BE TYPED IN.
      The link reaches a message as a placeholder, substituted at send time.
      A literal URL here would either be a dead link on every message or — far
      worse — somebody pasting a real invite, which is a live credential scoped
      to one person (§10) sent to everybody the template addresses.

      P11-2 put the same refusal on `notifications_log` for the same reason.
      This is the other end of the same rule. -- */
alter table public.notification_templates drop constraint if exists notification_templates_no_link;
alter table public.notification_templates add constraint notification_templates_no_link
  check (
    subject !~* '(https?://|/invite/)'
    and body !~* '(https?://|/invite/)'
  );

/* ---------- RLS ---------- */

alter table public.notification_templates enable row level security;

/* -- READABLE BY ANY SIGNED-IN USER, and that is deliberate.
      Every message is rendered inside `sendNotification`, which runs under
      whoever triggered it — an employee submitting their form raises a message
      to HR, so their session has to be able to read the wording. It is not
      confidential: it is the text those same people receive.

      Cron has no session and uses the service client, which bypasses RLS. -- */
drop policy if exists "templates: read" on public.notification_templates;
create policy "templates: read"
  on public.notification_templates for select
  to authenticated
  using (true);

/* -- NO INSERT, UPDATE OR DELETE POLICY FOR ANYONE.
      The write path is `save_notification_template` below — SECURITY DEFINER,
      taking its actor from the session and writing the audit row in the same
      statement. Absence of a policy is the enforcement (P5-9), and it is what
      stops a template being edited without a trace. -- */

grant select on public.notification_templates to authenticated;

/* ---------- The write path ---------- */

create or replace function public.save_notification_template(
  p_key     text,
  p_subject text,
  p_body    text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor  uuid := auth.uid();
  v_before jsonb;
begin
  -- §9: configuration is HR's write. The MD reads it.
  if not public.is_hr() then
    raise exception 'Only HR can change the wording of a message.'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object('subject', subject, 'body', body)
    into v_before
    from public.notification_templates
   where key = p_key;

  insert into public.notification_templates (key, subject, body, updated_by, updated_at)
  values (p_key, p_subject, p_body, v_actor, now())
  on conflict (key) do update
     set subject    = excluded.subject,
         body       = excluded.body,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at;

  /* §12: a change to what the company says to its staff is exactly the kind of
     thing somebody asks about later. The diff carries the wording both ways —
     a template holds no personal data, so there is nothing here §5 confines. */
  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (
    v_actor,
    'notification_template',
    -- The table's key is text; audit_log wants a uuid. Derived from the key so
    -- every edit of one template files against the same id.
    md5('template.' || p_key)::uuid,
    case when v_before is null then 'template.customised' else 'template.edited' end,
    jsonb_build_object(
      'key', p_key,
      'before', v_before,
      'after', jsonb_build_object('subject', p_subject, 'body', p_body)
    )
  );
end;
$$;

create or replace function public.reset_notification_template(p_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor  uuid := auth.uid();
  v_before jsonb;
begin
  if not public.is_hr() then
    raise exception 'Only HR can change the wording of a message.'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object('subject', subject, 'body', body)
    into v_before
    from public.notification_templates
   where key = p_key;

  -- Nothing customised is not an error. HR pressing Reset on a template that is
  -- already the default has got what they asked for.
  if v_before is null then
    return;
  end if;

  delete from public.notification_templates where key = p_key;

  insert into public.audit_log (actor_id, entity, entity_id, action, diff)
  values (
    v_actor,
    'notification_template',
    md5('template.' || p_key)::uuid,
    'template.reset',
    jsonb_build_object('key', p_key, 'before', v_before)
  );
end;
$$;

revoke all on function public.save_notification_template(text, text, text) from public;
revoke all on function public.reset_notification_template(text) from public;
grant execute on function public.save_notification_template(text, text, text) to authenticated;
grant execute on function public.reset_notification_template(text) to authenticated;

do $$
begin
  raise notice '0073: HR can now edit message wording at Settings > Messages. '
               'Templates with no row here use the wording in lib/notify/templates.ts, '
               'which is unchanged.';
end;
$$;

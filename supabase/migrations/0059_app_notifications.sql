-- 0059: in-app notifications — the bell in the topbar, made real.
--
-- The bell has been chrome since UI-REFRESH: a hardcoded pink dot with no
-- dropdown and no data behind it. This is the table it reads.
--
-- THIS IS NEW SCHEMA, AT THE OWNER'S EXPLICIT INSTRUCTION ("users should get
-- notifications with sound"). §0.4 forbids inventing a table without one.
--
-- It is NOT `notifications_log`, and the distinction matters. That table is the
-- OUTBOUND delivery record — one row per WhatsApp or email attempt, keyed by
-- phone number or address, readable by administrators, and the evidence that a
-- send happened (P11-6). This is somebody's inbox: keyed by profile, readable
-- by that person and nobody else, and carrying no delivery meaning at all.
-- Using one for the other would either expose the whole company's message log
-- to every employee, or lose every event that raises no outbound message.
--
-- §5 is what shaped the columns. A notification body is a sentence on a screen
-- with no access control of its own once it is on a phone in a meeting, so:
--   * nothing here may carry a score, a salary figure, or the other side's
--     state. `body` is written from a fixed sentence per template with NO
--     interpolation, so it cannot leak by construction rather than by review.
--   * `href` must be a relative path. An absolute URL in a notification is an
--     open redirect wearing the company's own chrome.

begin;

/* ---------- The table ---------- */

create table if not exists public.app_notifications (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles (id) on delete cascade,

  -- The `TemplateKey` this came from. Text, not an enum: 0022 spent a whole
  -- migration working around the fact that an enum value cannot be dropped once
  -- a row carries it, and this list will move as templates are added and
  -- retired (P22 deleted one; FIX-13 deleted another).
  template      text not null,

  title         text not null,
  body          text not null,

  -- Where the bell takes you. Relative only — see the CHECK below.
  href          text,

  -- A plain uuid, not a foreign key, for the reason P3-2 gives: a reference
  -- that must outlive the row it points at cannot be a constraint. A
  -- notification about an evaluation is still a true record of what somebody
  -- was told, whatever later happens to the evaluation.
  evaluation_id uuid,

  read_at       timestamptz,
  created_at    timestamptz not null default now(),

  -- One bell entry per person per template per evaluation per DAY.
  --
  -- This is what makes the raise idempotent, and it is load-bearing in two
  -- places. `deliver()` calls `sendNotification` once per CHANNEL, so a person
  -- reachable on both WhatsApp and email would otherwise collect two identical
  -- entries for one event. And a re-run of the nightly sweep must not stack up
  -- a second copy of the same chase — the same rule P17-4 and P22-17 already
  -- apply to outbound, keyed the same way, so the two agree.
  --
  -- Dated rather than absolute, so tomorrow's reminder is a new entry.
  --
  -- A DEFAULT, NOT A GENERATED COLUMN, and the difference is not stylistic:
  -- `generated always as (…) stored` requires an IMMUTABLE expression, and
  -- `at time zone` on a timestamptz is STABLE — the timezone database can
  -- change under it. Postgres rejects the table outright with "generation
  -- expression is not immutable". A default has no such requirement, and the
  -- value is written once and never recomputed, which is the same guarantee for
  -- this purpose. §0.10 puts it in Asia/Kolkata, so "today" means today here
  -- rather than in whichever region the function happens to run in (P17-2).
  created_on    date not null default ((now() at time zone 'Asia/Kolkata')::date),

  -- No link, no token. `body` is composed from fixed sentences and cannot
  -- contain one, so this is a backstop rather than the enforcement — the same
  -- shape of guard P11-2 put on `notifications_log.payload`, and for the same
  -- reason: this is exactly where somebody would eventually drop a rendered
  -- message body.
  constraint app_notifications_body_has_no_link
    check (body !~ '://' and body !~ '[A-Za-z0-9_-]{40,}'),

  -- Relative paths only. `/reports/…` yes; `https://elsewhere/…` never, and
  -- `//host` never either — that is protocol-relative and leaves the site.
  constraint app_notifications_href_is_relative
    check (href is null or (href like '/%' and href not like '//%'))
);

comment on table public.app_notifications is
  'In-app notification feed, one row per person per event. Not a delivery log — see notifications_log for that.';

-- Everything the bell asks for: this person, newest first, unread first.
create index if not exists app_notifications_profile_idx
  on public.app_notifications (profile_id, created_at desc);

-- The dedupe. `evaluation_id` is nullable and a unique index treats two NULLs
-- as distinct, so digests (which carry no evaluation) need the coalesce to
-- collapse onto one row a day.
create unique index if not exists app_notifications_once_per_day
  on public.app_notifications (
    profile_id, template, coalesce(evaluation_id, '00000000-0000-0000-0000-000000000000'::uuid), created_on
  );

/* ---------- RLS ---------- */

alter table public.app_notifications enable row level security;

-- You read your own, and that is the whole of it.
--
-- Not HR, not the MD, deliberately. There is no administrative use for reading
-- somebody else's bell — `notifications_log` is where an administrator goes to
-- ask whether a message was delivered — and a feed that an administrator can
-- read is a feed that has to be reviewed for what it discloses about the person
-- reading it.
drop policy if exists app_notifications_read_own on public.app_notifications;
create policy app_notifications_read_own on public.app_notifications
  for select to authenticated
  using (profile_id = auth.uid());

-- Marking your own as read. The trigger below is what keeps this to `read_at`.
drop policy if exists app_notifications_mark_own_read on public.app_notifications;
create policy app_notifications_mark_own_read on public.app_notifications
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- There is NO insert policy for anyone. Writes go through
-- `raise_app_notification` below, which is SECURITY DEFINER and is the only
-- path — the same pattern as `queue_notification` (0010), `log_admin_action`
-- (0007) and `launch_cycle` (0009). Absence of a policy is the enforcement
-- (P5-9): without it, any signed-in user could post a notification to their own
-- bell, which is harmless, or discover by trying that they cannot post to
-- somebody else's, which is not the kind of thing to leave to a policy.
--
-- There is no DELETE policy either. Read is the dismissal.

/* ---------- Only `read_at` may change ---------- */

-- RLS is row-level: the UPDATE policy above admits the row, and with it every
-- column on it. Without this trigger somebody could rewrite the title and body
-- of their own notification. Harmless in itself, but a feed whose contents the
-- reader can edit is not a record of what they were told — and the same
-- column-split reasoning already runs in 0029 and 0030, where it protects a
-- review summary and a salary figure.
create or replace function public.app_notifications_guard_columns()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.profile_id    is distinct from old.profile_id
     or new.template   is distinct from old.template
     or new.title      is distinct from old.title
     or new.body       is distinct from old.body
     or new.href       is distinct from old.href
     or new.evaluation_id is distinct from old.evaluation_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Only read_at may be changed on a notification.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists app_notifications_guard on public.app_notifications;
create trigger app_notifications_guard
  before update on public.app_notifications
  for each row execute function public.app_notifications_guard_columns();

/* ---------- The single write path ---------- */

-- SECURITY DEFINER because it writes a row for ANOTHER person: an employee
-- submitting their form raises a notification for HR, and no policy admits that
-- — nor should one, since "any authenticated user may notify anybody" is a way
-- to put a sentence on a colleague's screen.
--
-- The capability goes to one narrow function instead of to a policy, which is
-- the call P10-4 made for `launch_cycle` and P8-5 for `log_admin_action`.
--
-- It takes no actor and records none. A notification is not an audit row: §12's
-- trail is `audit_log`, which is untouched by this migration.
create or replace function public.raise_app_notification(
  p_profile_id    uuid,
  p_template      text,
  p_title         text,
  p_body          text,
  p_href          text default null,
  p_evaluation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_profile_id is null then
    raise exception 'raise_app_notification: a notification needs somebody to notify.';
  end if;

  insert into public.app_notifications (profile_id, template, title, body, href, evaluation_id)
  values (p_profile_id, p_template, p_title, p_body, p_href, p_evaluation_id)
  -- The dedupe index. A second call in the same day for the same event is a
  -- no-op rather than an error: the caller genuinely does call twice (once per
  -- channel), and that is not a fault to report.
  on conflict do nothing
  returning id into v_id;

  return v_id;  -- null when it was already there today, which callers ignore.
end;
$$;

revoke all on function public.raise_app_notification(uuid, text, text, text, text, uuid) from public;
grant execute on function public.raise_app_notification(uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.raise_app_notification(uuid, text, text, text, text, uuid) to service_role;

grant select, update on public.app_notifications to authenticated;

commit;

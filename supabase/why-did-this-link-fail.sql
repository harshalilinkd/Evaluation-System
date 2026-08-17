-- Why an invite link failed. Read-only; paste into the Supabase SQL editor.
--
-- The screen shows one of five things and each has a different cause, so
-- guessing from the message alone is how the wrong thing gets fixed. This
-- reports, per link, WHICH of them applies and why.
--
-- No token is printed and none can be: §10 stores only the SHA-256 hash, so
-- there is nothing here to leak and nothing to paste back into a browser.

/* ---------- 1. The expiry rule, in one line per open evaluation ----------

   expires_at = the RECIPIENT'S OWN due date + 7 days.

     SELF token → evaluations.due_self_on, else cycles.self_due_on
     LEAD token → evaluations.due_lead_on, else cycles.lead_due_on, else the
                  self dates

   It is NOT a fixed period from when the mail was sent, which is the thing
   that surprises people: resending does not extend it, and a cycle whose due
   date is already more than 7 days past mints a link that is born expired. */

select
  p.full_name,
  t.layer,
  t.channel,
  c.name                                   as cycle,
  coalesce(e.due_self_on, c.self_due_on)   as self_due,
  coalesce(e.due_lead_on, c.lead_due_on)   as lead_due,
  t.expires_at::date                       as expires_on,
  (t.expires_at::date - current_date)      as days_left,
  t.attempt_count,
  case
    when t.revoked_at is not null then 'REVOKED — HR resent the link; only the newest one works'
    when t.used_at is not null   then 'USED — somebody already signed in through it. One use only'
    when t.expires_at <= now()   then 'EXPIRED — past the due date + 7 days'
    else 'VALID'
  end as what_the_screen_says
from public.invite_tokens t
join public.profiles p          on p.id = t.profile_id
join public.evaluations e       on e.id = t.evaluation_id
join public.evaluation_cycles c on c.id = e.cycle_id
order by t.created_at desc
limit 50;

/* ---------- 2. What actually happened to one person's links ----------

   `invite.attempt` is written on every open, `invite.wrong_recipient` when
   somebody signed in as a DIFFERENT person and tried to use it, and
   `invite.rate_limited` after the tenth attempt in an hour.

   WRONG_RECIPIENT is the one worth looking for after a forwarded mail: it
   means the link reached somebody, they signed in as themselves, and the link
   was left unspent. It shows its own page — never "expired". */

select
  a.created_at,
  a.action,
  who.full_name as signed_in_as,
  owner.full_name as link_belongs_to
from public.audit_log a
join public.invite_tokens t on t.id = a.entity_id
join public.profiles owner  on owner.id = t.profile_id
left join public.profiles who on who.id = a.actor_id
where a.entity = 'invite_token'
order by a.created_at desc
limit 50;

/* ---------- 3. The short version ----------

   A link is a way IN for somebody who has never signed in (PW-4). Once a
   person has an account they do not need one at all: /login, then the form is
   on their dashboard. Forwarding a link to a second mailbox is the one thing
   it is not for — the recipient is fixed when the token is minted, and
   `consume_invite_token` re-checks the session against it (P6-5). */

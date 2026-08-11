-- 0067: the manager's hike percentage is mandatory once the field appears.
--
-- At the owner's explicit instruction, stated twice: "a new MANDATORY field
-- called Hike Percent must appear for the HOD to fill out."
--
-- 0062 seeded it optional, on the reasoning that a manager who recommends a
-- promotion without a view on the figure should be able to say so by leaving it
-- blank rather than have a number manufactured from them. That was my call and
-- the owner has overruled it: if they recommend a rise, they name one.
--
-- 0062 is applied, so this is a new file rather than an edit to it (§0.8).
--
-- ============================================================================
-- REQUIRED IS SAFE HERE ONLY BECAUSE IT IS CONDITIONAL.
--
-- P12-1 records the trap this would otherwise be, and it is the single easiest
-- thing to get wrong in this codebase: a hidden question that stays REQUIRED
-- produces a form that cannot be submitted and shows no reason why — the
-- offending field is not on the screen to be filled in.
--
-- `buildZodSchema` requires a question only when it is required AND VISIBLE,
-- and §6 keeps hidden questions out of validation entirely. So a manager who
-- answers "No" to the promotion question never sees this field and is never
-- blocked by it; one who answers Yes or Can be considered sees it and must
-- answer it. That is exactly what was asked for, and it is only safe because
-- the conditional machinery already behaves this way.
--
-- SNAPSHOTS ALREADY LAUNCHED ARE UNTOUCHED (§5). `evaluation_questions` froze
-- `is_required` at launch, so a cycle already running keeps asking it the way
-- it was asked when it opened. Only cycles launched from here carry the change
-- — which is the snapshot rule working, not a gap in this migration.
-- ============================================================================

begin;

update public.questions
   set is_required = true,
       help_text =
         'Required when you recommend a promotion. Your recommendation only — HR '
         || 'and management decide the final figure. A percentage, not an amount: '
         || 'you are not shown anybody''s salary and do not need it to answer this.'
 where id = md5('linkd.q.mgr.hike_percent')::uuid;

do $$
begin
  if not exists (
    select 1 from public.questions
     where id = md5('linkd.q.mgr.hike_percent')::uuid and is_required
  ) then
    raise exception
      '0067: the hike percentage question is missing or was not updated. Apply 0062 first.';
  end if;

  -- The guard that makes the above safe. If the condition were ever cleared,
  -- the question would become required on EVERY manager review — including the
  -- ones recommending no promotion — and every one of them would be unable to
  -- submit, with no field on screen to explain it.
  if not exists (
    select 1 from public.questions
     where id = md5('linkd.q.mgr.hike_percent')::uuid
       and depends_on is not null
       and depends_value is not null
  ) then
    raise exception
      '0067: refusing to make an UNCONDITIONAL question required — that produces a form nobody can submit (P12-1).';
  end if;

  raise notice '0067: the hike percentage is required when the field appears.';
end;
$$;

insert into public.audit_log (actor_id, entity, entity_id, action, diff)
values (
  null,
  'question',
  md5('linkd.q.mgr.hike_percent')::uuid,
  'question.updated',
  jsonb_build_object(
    'is_required', jsonb_build_object('from', false, 'to', true),
    'why', 'Owner instruction: the field is mandatory once it appears.',
    'note', 'Conditional, so it is required only when the promotion answer reveals it. Launched snapshots keep the rule they froze (§5).'
  )
);

commit;

/* ============================================================================
   Confirm
   ==========================================================================
   Both must be true. `required` alone would be the P12-1 trap. */

select
  q.text,
  q.is_required                                as required,
  q.depends_value                              as shown_when,
  (q.depends_on is not null)                   as still_conditional
from public.questions q
where q.id = md5('linkd.q.mgr.hike_percent')::uuid;

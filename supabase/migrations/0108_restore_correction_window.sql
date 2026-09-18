-- 0108: the correction window 0106 deleted, restored beside 0106's own.
--
-- ============================================================================
-- A REGRESSION I SHIPPED IN 0106, AND THE REASON IT WAS INVISIBLE.
--
-- 0106 needed the append-only trigger to permit one thing: clearing
-- `evaluation_id` when a deleted cycle's foreign key sets it null. It got that
-- by `create or replace`-ing `salary_history_is_append_only` — and it built the
-- new body from 0023's ORIGINAL text plus the new clause, never noticing that
-- 0093 had replaced that body in between.
--
-- So 0093's exemption went with it, and with the exemption went the ONLY door
-- through which a pay entry can be corrected. `correct_salary_history_entry`
-- was untouched and still live; it simply could no longer complete, because the
-- UPDATE it issues was refused by the very trigger it opens a window in.
--
-- Reported from Settings > Salary history as:
--   "0 saved, 1 could not be: Increment 1: Salary history is append-only.
--    Record a correction with reason CORRECTION instead of editing UPDATE ."
--
-- Nothing on that screen could have worked, and the message named a remedy the
-- product no longer had a path for — it is 0023's wording, which 0093 had
-- deliberately replaced with one naming the two functions.
--
-- THE LESSON, WHICH THIS LOG ALREADY CARRIED. SR2-5: "A dropped column is a
-- silent behaviour change... recreating a view means reproducing all of it."
-- 0094's own header says the same thing about this very function — that it
-- restates 0068's and 0093's bodies in full BECAUSE a targeted patch against
-- 0093 would silently match nothing. I recreated it from the wrong ancestor,
-- which is the same failure from the other end: not a patch that matched
-- nothing, but a rewrite that matched everything and meant to match less.
--
-- Both exemptions now live in one body, and the verification block at the
-- bottom asserts BOTH — so the next recreate that loses one fails loudly
-- instead of bricking a screen nobody opens every day.
-- ============================================================================

begin;

create or replace function public.salary_history_is_append_only()
returns trigger
language plpgsql
as $$
begin
  /* ---------- 0093's window: a correction, through the one door ----------
        Every clause has to hold, not just the flag: the flag alone would make
        this door as wide as "call set_config first", and the identity and
        provenance columns are what stay true even then.

        `correct_salary_history_entry` sets the GUC transaction-locally, so it
        clears on its own at commit or rollback and nothing outside that one
        statement's transaction can ever see it set. */
  if tg_op = 'UPDATE'
     and current_setting('app.salary_history_correction', true) = 'true'
     and new.id = old.id
     and new.profile_id = old.profile_id
     and new.evaluation_id is not distinct from old.evaluation_id
     and new.recorded_by is not distinct from old.recorded_by
     and new.recorded_at = old.recorded_at
  then
    return new;
  end if;

  /* ---------- 0106's window: detaching from a deleted evaluation ----------
        A cycle destroyed from the recycle bin clears `salary_history.
        evaluation_id` through ON DELETE SET NULL, which is performed as an
        UPDATE and therefore meets this trigger. Written so it CANNOT be used
        to change a figure: the only permitted update is `evaluation_id` going
        from a value to null with every other column identical. No GUC, so
        there is no state anybody can leave in the wrong position — the rule is
        provable from this body alone. */
  if tg_op = 'UPDATE'
     and old.evaluation_id is not null
     and new.evaluation_id is null
     and new.id             is not distinct from old.id
     and new.profile_id     is not distinct from old.profile_id
     and new.effective_from is not distinct from old.effective_from
     and new.previous_ctc   is not distinct from old.previous_ctc
     and new.new_ctc        is not distinct from old.new_ctc
     and new.hike_amount    is not distinct from old.hike_amount
     and new.hike_pct       is not distinct from old.hike_pct
     and new.reason         is not distinct from old.reason
     and new.note           is not distinct from old.note
     and new.recorded_by    is not distinct from old.recorded_by
  then
    return new;
  end if;

  /* -- 0093's wording, restored with it. 0023's original told the reader to
        "record a correction with reason CORRECTION", which is advice the
        product has no path for — corrections are made in place through the
        function named here, and a message pointing somewhere that does not
        exist is worse than a blunt refusal (§0.7). -- */
  raise exception
    'Salary history is append-only outside a correction. Use correct_salary_history_entry, or (for the joining baseline) set_joining_salary — % is not permitted directly.',
    tg_op
    using errcode = 'restrict_violation';
end;
$$;

commit;

do $chk$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'salary_history_is_append_only';

  /* -- BOTH, asserted separately. 0106 passed its own verification while
        having destroyed 0093's window, because it only checked for what it had
        just added. A check that asks solely about its own change cannot see
        what it removed. -- */
  if v_def not like '%app.salary_history_correction%' then
    raise exception '0108: the correction window (0093) is missing. Settings > Salary history cannot save.';
  end if;

  if v_def not like '%new.evaluation_id is null%' then
    raise exception '0108: the detach window (0106) is missing. Deleting a cycle with pay attached will fail.';
  end if;

  -- Neither window may be reachable without its own identity guard.
  if v_def not like '%new.recorded_at = old.recorded_at%' then
    raise exception '0108: the correction window no longer pins recorded_at.';
  end if;

  if v_def not like '%new.new_ctc%is not distinct from%old.new_ctc%' then
    raise exception '0108: the detach window no longer pins the figures.';
  end if;

  -- The door itself must still exist, or the window opens onto nothing.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'correct_salary_history_entry' and p.prosecdef
  ) then
    raise exception '0108: correct_salary_history_entry is missing.';
  end if;

  raise notice '0108 applied. A pay entry can be corrected again, and a deleted cycle can still detach.';
end;
$chk$;

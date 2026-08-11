-- 0069: recording a joining salary works for whoever is entitled to record one.
--
-- Reported: "joining salary not getting saved". Typed, confirmed, dialog closes,
-- nothing stored — and the screen still offers "Add joining salary".
--
-- ============================================================================
-- THE FOURTH APPEARANCE OF ONE CLASS OF BUG.
--
-- `addJoiningSalary` is guarded by `checkRole(["HR_ADMIN", "MD"])`. The table
-- policy `employment: hr updates` (0023) is `using (public.is_hr())`. The MD is
-- not HR. So the MD passes the application guard, the UPDATE matches ZERO ROWS,
-- and PostgREST reports zero rows as SUCCESS — the action returns ok, the
-- dialog closes, and nothing was written.
--
-- Before this it was FIX-14 (a role write), the worker sheet (ratings) and 0066
-- (a pay change). Same shape every time: an application guard that admits
-- somebody the table policy does not, and an UPDATE that cannot fail.
--
-- Worth stating precisely, because it decides which writes are dangerous:
--   · an INSERT refused by RLS raises 42501 — visible, and the caller reports it
--   · an UPDATE that matches no rows is a SUCCESS with zero rows affected
-- Only the second kind fails in silence. That is why this keeps happening in
-- exactly the same place and never in the other.
--
-- 0066 fixed the pay-change path this way and left this one, because I fixed the
-- symptom that was reported rather than the class. This is the same remedy
-- applied to the sibling: HR and the MD both record pay decisions (§9 as
-- amended, and 0023 already lets both append the ledger), so the capability goes
-- to one narrow audited function rather than to a widened policy.
-- ============================================================================

begin;

create or replace function public.record_joining_salary(
  p_profile_id uuid,
  p_amount     numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing  numeric;
  v_current   numeric;
  v_revisions int;
  v_seeded    boolean := false;
begin
  if not (public.is_hr() or public.is_md()) then
    raise exception 'Only HR or management can record a joining salary.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'A joining salary has to be more than zero.'
      using errcode = 'check_violation';
  end if;

  select joining_ctc, current_ctc into v_existing, v_current
    from public.employment_records
   where profile_id = p_profile_id;

  if not found then
    raise exception 'This person has no employment record yet. Add their joining details first.'
      using errcode = 'no_data_found';
  end if;

  /* -- Immutable once set, and refused HERE as well as in the action.
        "Once recorded, joining_salary remains static for audit purposes." A
        baseline that can be edited is a baseline that can move after every
        percentage in the ledger has been computed from it, leaving the stored
        hikes describing a figure that no longer exists. The action checks it
        too; this is the check that holds when the action is bypassed (§9 —
        client code is never the only guard). -- */
  if v_existing is not null then
    raise exception 'A joining salary is already recorded. It is the baseline every later rise is measured against, so it does not change once set.'
      using errcode = 'unique_violation';
  end if;

  /* -- WHETHER THE CURRENT FIGURE IS SEEDED IS DECIDED HERE, NOT BY THE CALLER.
        Somebody who joined on ₹1,80,000 and has had no rise IS on ₹1,80,000, so
        leaving `current_ctc` blank would be false. But where a revision exists,
        `current_ctc` is that revision and this must not touch it.

        The action used to make this call and pass the answer in. That made "the
        joining figure does not overwrite a later salary" a property of the
        CALLER — and this function is granted to `authenticated`, so a payload
        of somebody's choosing could seed it over a real one. Same reasoning as
        P9D-3: a rule that matters belongs in the function that enforces it.

        Legacy JOINING rows do not count as a revision — they are this same
        baseline recorded the old way, not a rise. -- */
  select count(*) into v_revisions
    from public.salary_history
   where profile_id = p_profile_id
     and reason <> 'JOINING';

  update public.employment_records
     set joining_ctc             = p_amount,
         joining_ctc_recorded_by = auth.uid(),
         joining_ctc_recorded_at = now(),
         current_ctc             = case
                                     when v_revisions = 0 and v_current is null then p_amount
                                     else current_ctc
                                   end
   where profile_id = p_profile_id;

  -- The row was found above, so this cannot match zero — but saying so out loud
  -- is what the last four of these were missing.
  if not found then
    raise exception 'The employment record could not be updated.';
  end if;

  v_seeded := (v_revisions = 0 and v_current is null);
  return jsonb_build_object('seeded_current', v_seeded);
end;
$$;

revoke all on function public.record_joining_salary(uuid, numeric) from public;
grant execute on function public.record_joining_salary(uuid, numeric) to authenticated;

commit;

/* ============================================================================
   Confirm
   ========================================================================== */

select
  to_regprocedure('public.record_joining_salary(uuid, numeric)') is not null as function_present,
  (select count(*) from public.employment_records where joining_ctc is not null) as joining_salaries_on_file;

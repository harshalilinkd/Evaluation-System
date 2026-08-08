-- FIX-SALARY-HISTORY.sql
--
-- Recomputes `previous_ctc`, `hike_amount` and `hike_pct` on EVERY salary_history
-- row, in date order, for every person.
--
-- WHY THIS IS NEEDED. Until 1f713b3, `previous_ctc` was taken from
-- `employment_records.current_ctc` — the figure somebody is paid TODAY — whatever
-- effective date the new row carried. Entering history out of order therefore
-- compared a row against a salary that came AFTER it. A joining salary of
-- ₹1,80,000 recorded after a later ₹25,000 row came out as a 620% hike.
--
-- The amounts and dates were never wrong. Only the three derived columns are, and
-- they are derivable from the rows themselves — which is what this does.
--
-- ============================================================================
-- IT SWITCHES OFF THE APPEND-ONLY GUARD, DELIBERATELY, AND SWITCHES IT BACK ON.
--
-- P19-3 made `salary_history` append-only by TRIGGER as well as by policy,
-- precisely so no caller — not the service role, not a later migration, not the
-- owner in the SQL editor — could quietly rewrite what somebody was paid. That
-- guard is doing its job; this is the one case where the stored value is a
-- derived figure that was computed wrongly, and correcting it is repair rather
-- than revision.
--
-- Take a backup first: Supabase dashboard → Database → Backups.
--
-- `new_ctc`, `effective_from`, `reason` and `note` are NOT touched. What people
-- were actually paid, and when, is untouched by this file.
-- ============================================================================
--
-- Run it in two passes. STEP 1 only reports; nothing changes until you uncomment
-- STEP 2 and run again.


/* ============================================================================
   STEP 1 · What is wrong, and what it would become
   ========================================================================== */

with ordered as (
  select
    h.id,
    h.profile_id,
    p.full_name,
    h.effective_from,
    h.reason,
    h.new_ctc,
    h.previous_ctc as stored_previous,
    h.hike_pct     as stored_pct,
    -- A JOINING salary has nothing before it, whatever the dates say.
    -- Otherwise: the most recent row that took effect STRICTLY earlier.
    case when h.reason = 'JOINING' then null else lag(h.new_ctc) over (
      partition by h.profile_id order by h.effective_from, h.recorded_at
    ) end as correct_previous
  from public.salary_history h
  join public.profiles p on p.id = h.profile_id
)
select
  full_name,
  to_char(effective_from, 'DD-MM-YYYY') as effective,
  reason,
  new_ctc,
  stored_previous,
  correct_previous,
  stored_pct,
  case
    when correct_previous is null or correct_previous = 0 then null
    else round(((new_ctc - correct_previous) / correct_previous) * 100, 2)
  end as correct_pct,
  case
    when stored_previous is distinct from correct_previous then 'WILL BE CORRECTED'
    else 'already right'
  end as verdict
from ordered
order by full_name, effective_from;


/* ============================================================================
   STEP 2 · The correction
   ==========================================================================
   Remove the surrounding comment markers to arm it, then run again.

   One transaction: if any part fails, nothing changes and the guard is back on,
   because the ALTER is inside it too.
*/

/*
begin;

  alter table public.salary_history disable trigger salary_history_no_update;

  with ordered as (
    select
      h.id,
      case when h.reason = 'JOINING' then null else lag(h.new_ctc) over (
        partition by h.profile_id order by h.effective_from, h.recorded_at
      ) end as correct_previous,
      h.new_ctc
    from public.salary_history h
  )
  update public.salary_history h
     set previous_ctc = o.correct_previous,
         hike_amount  = case when o.correct_previous is null then null
                             else round(h.new_ctc - o.correct_previous, 2) end,
         hike_pct     = case when o.correct_previous is null or o.correct_previous = 0 then null
                             else round(((h.new_ctc - o.correct_previous) / o.correct_previous) * 100, 2) end
    from ordered o
   where o.id = h.id
     and h.previous_ctc is distinct from o.correct_previous;

  alter table public.salary_history enable trigger salary_history_no_update;

commit;
*/


/* ============================================================================
   STEP 3 · Confirm the guard is back on
   ==========================================================================
   Run this after STEP 2. `tgenabled` must be 'O'. If it is 'D' the trigger is
   still disabled and salary history is editable — re-run the ALTER above.
*/

select tgname, tgenabled,
       case tgenabled when 'O' then 'ON — append-only, correct'
                      else 'DISABLED — RE-ENABLE IT' end as guard
  from pg_trigger
 where tgrelid = 'public.salary_history'::regclass
   and not tgisinternal;

-- =============================================================================
-- 0013_lead_review.sql — the lead review at /team.
-- Phase P13. CLAUDE.md §9 (RLS), §12 (audit).
-- =============================================================================
--
-- NO SCHEMA CHANGE. The whole of P13 runs on tables that already exist:
--
--   * autosave on the LEAD layer   -> merge_evaluation_answers (0011) already
--     accepts p_layer = 'LEAD' and already re-checks that the caller is the
--     assigned lead and the evaluation is at SELF_SUBMITTED.
--   * the lead's comments          -> p_comments_patch on the same function.
--   * submit / return              -> apply_evaluation_transition (0004/0005),
--     which already carries both §8 rows the lead owns.
--
-- So this migration adds one thing, and it is a policy rather than a column.
--
-- WHY THE LEAD NEEDS TO READ audit_log
--
-- 0005 gave audit_log SELECT to HR and the MD alone. Two things P13 must show
-- the lead are recorded nowhere else:
--
--   1. "Returned to {name} on {date} — waiting for them to resubmit."
--      §8's return puts the status back to CYCLE_ACTIVE, which is byte for byte
--      indistinguishable from "never submitted" (P12-13 hit the same wall from
--      the employee's side). The audit row is the only surviving evidence that
--      a return happened at all.
--   2. "{name} started this review" after a mid-cycle lead reassignment.
--
-- Deriving either by inference — "there is a LEAD draft but the status is
-- CYCLE_ACTIVE, so it was probably returned" — would put a guess on screen and
-- state it as fact. §12 keeps the real answer; this policy reads it.
--
-- The grant is as narrow as the need: evaluation rows only, and only for the
-- evaluations this person is the assigned lead of. It is a SELECT policy and
-- nothing else — §12's "no update or delete policy exists for anyone" is
-- untouched, and the 0004 append-only trigger still holds for every caller.
-- =============================================================================

drop policy if exists "audit_log: lead reads own reports" on public.audit_log;

create policy "audit_log: lead reads own reports" on public.audit_log
  for select to authenticated
  using (
    -- entity is checked first so a question-bank or role-change row never
    -- reaches the evaluation lookup. is_lead_of_evaluation returns false for an
    -- id that is not an evaluation anyway, but relying on that would make this
    -- policy's correctness depend on another function's failure mode.
    entity = 'evaluation'
    and public.is_lead_of_evaluation(entity_id)
  );

comment on policy "audit_log: lead reads own reports" on public.audit_log is
  'P13. A lead reads the history of the evaluations they lead — the return reason and the reassignment note live nowhere else (§12). SELECT only; audit stays append-only for everyone.';

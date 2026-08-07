-- =============================================================================
-- 0032_recycle_bin.sql — deleting a cycle, reversibly
-- =============================================================================
--
-- WHY THIS IS A SOFT DELETE AND NOT A DELETE.
--
-- P10-8 blocks a hard DELETE of a launched cycle with a trigger, and it is
-- right to: `evaluation_cycles` cascades to `evaluations`, which cascades to
-- `evaluation_questions` — so one stray DELETE would take every frozen snapshot
-- in the cycle with it, which is the single thing §5 exists to prevent. §17
-- says the same about a submitted layer: return it, never delete it.
--
-- A recycle bin is therefore the only shape this feature can take, and it is a
-- better one anyway. Nothing is destroyed. The row is marked and disappears
-- from every list; restoring is setting the mark back to null. The hard-delete
-- trigger from 0009 is untouched and still refuses the real thing.
--
-- Idempotent, per §0.8.
-- =============================================================================

alter table public.evaluation_cycles
  add column if not exists deleted_at    timestamptz,
  add column if not exists deleted_by    uuid,
  add column if not exists delete_reason text;

comment on column public.evaluation_cycles.deleted_at is
  'In the recycle bin since. NULL means live. Never hard-deleted — 0009''s trigger still refuses that for a launched cycle.';

-- `deleted_by` carries no foreign key, for the same reason audit_log.actor_id
-- does not: the record of who binned something has to outlive their profile.
comment on column public.evaluation_cycles.deleted_by is
  'Who binned it. No FK — the record outlives the actor (P4-5).';

-- Partial: the common read is "everything NOT in the bin", and a full index on a
-- column that is null for almost every row earns nothing.
create index if not exists evaluation_cycles_deleted_idx
  on public.evaluation_cycles (deleted_at)
  where deleted_at is not null;

-- No new policy. `evaluation_cycles` already carries an HR write policy from
-- 0005 (widened by 0012), and binning is an UPDATE like any other — giving the
-- bin its own policy would be a second place the same permission is decided.

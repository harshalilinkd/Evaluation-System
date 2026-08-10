-- 0047 · The worker appraisal: cycles, evaluations, the frozen sheet, both layers.
--
-- §7 has described this module since P0 and only the FORM has ever been built
-- (P24: `worker_questions`, the eight qualities, the three-tick scale). There
-- has been no way to RUN one — no cycle, no evaluation, no supervisor screen —
-- which is why the cycle wizard offers no worker option: there is nothing
-- behind it.
--
-- ============================================================================
-- AMENDMENT TO §8, AT THE OWNER'S EXPLICIT INSTRUCTION.
--
-- §8's worker table is sequential: CYCLE_ACTIVE → SELF_SUBMITTED →
-- SUPERVISOR_REVIEWED → MD_FINALIZED → CLOSED. The owner has chosen BLIND
-- PARALLEL RATING for workers, the same model AMEND-3 gave staff: the worker
-- and their supervisor tick the same sheet at the same time, neither seeing the
-- other.
--
-- A sequential table cannot express that — `SELF_SUBMITTED` as a STATUS means
-- the supervisor is waiting on the worker, and that is exactly the anchoring
-- blind rating removes. So the worker machine mirrors the staff one:
--
--   DRAFT → OPEN → PENDING_REVIEW → REVIEWED → CLOSED
--
-- with each side's submission tracked by its own TIMESTAMP, not by the status.
-- §8's worker rows are superseded; this is recorded in §18 rather than absorbed.
-- ============================================================================
--
-- §7's ISOLATION RULE is why every table here is new rather than a track column
-- on an existing one: "never refactor a staff-module function to accommodate the
-- worker module or the reverse". The two share logins, profiles, departments and
-- the audit log. Nothing else. A staff migration cannot break this, and a
-- `worker_` row can never reach a core evaluation table (§5's module boundary) —
-- the tables simply do not connect.

begin;

/* ============================================================================
   1. The worker's own status vocabulary
   ========================================================================== */
--
-- A separate enum from `evaluation_status`, deliberately. Sharing one would mean
-- a staff status change forcing a decision about workers and the reverse, which
-- is the coupling §7 forbids. The VALUES happen to mirror the staff machine
-- because the flow is the same shape; that is agreement, not sharing.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'worker_evaluation_status') then
    create type public.worker_evaluation_status as enum (
      'DRAFT',           -- created, not yet opened to anybody
      'OPEN',            -- both sheets live, blind to each other
      'PENDING_REVIEW',  -- both sides in (or one skipped); waiting on the MD
      'REVIEWED',        -- the MD has read it and recorded the outcome
      'CLOSED'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'worker_cycle_status') then
    create type public.worker_cycle_status as enum ('DRAFT', 'ACTIVE', 'CLOSED');
  end if;

  -- SELF is the worker; SUPERVISOR is their supervisor. Named for the worker
  -- module rather than reusing `rating_layer`, whose LEAD means something else
  -- on the shop floor.
  if not exists (select 1 from pg_type where typname = 'worker_rating_layer') then
    create type public.worker_rating_layer as enum ('SELF', 'SUPERVISOR', 'MD');
  end if;
end;
$$;

/* ============================================================================
   2. Cycles
   ========================================================================== */

create table if not exists public.worker_cycles (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  period_label   text not null,
  starts_on      date,
  -- Both sides open together, so both dates are set at launch and neither
  -- waits on the other.
  self_due_on    date,
  supervisor_due_on date,
  md_due_on      date,
  status         public.worker_cycle_status not null default 'DRAFT',
  -- What a worker is shown once it closes. Same three options as staff, and
  -- FULL is absent for the same reason (PR-3): it would contradict blindness.
  disclosure     text not null default 'SCORE_AND_DECISION'
                   check (disclosure in ('NONE', 'SCORE_ONLY', 'SCORE_AND_DECISION')),
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint worker_cycles_dates_ordered check (
    self_due_on is null or supervisor_due_on is null or md_due_on is null
    or (self_due_on <= md_due_on and supervisor_due_on <= md_due_on)
  )
);

drop trigger if exists worker_cycles_set_updated_at on public.worker_cycles;
create trigger worker_cycles_set_updated_at
  before update on public.worker_cycles
  for each row execute function public.set_updated_at();

/* ============================================================================
   3. Evaluations
   ========================================================================== */

create table if not exists public.worker_evaluations (
  id             uuid primary key default gen_random_uuid(),
  cycle_id       uuid not null references public.worker_cycles(id) on delete cascade,
  worker_id      uuid not null references public.profiles(id),
  -- Copied at launch, not read live from `profiles.reports_to`: a reassignment
  -- mid-cycle must not silently move an in-flight appraisal (P3-6).
  supervisor_id  uuid references public.profiles(id),
  department_id  uuid references public.departments(id),
  status         public.worker_evaluation_status not null default 'DRAFT',

  /* -- Each side's own timestamp. THE STATUS DOES NOT SAY WHO HAS SUBMITTED.
        That is what makes blind parallel rating expressible: a layer locks on
        its own submission, independently of the other and of the status. -- */
  self_submitted_at       timestamptz,
  supervisor_submitted_at timestamptz,
  -- Set when HR advances past a side that never submitted. A skipped layer is
  -- CLOSED, not merely un-submitted, or it would stay writable for ever.
  self_skipped            boolean not null default false,
  supervisor_skipped      boolean not null default false,

  md_reviewed_at timestamptz,
  closed_at      timestamptz,
  -- A withdrawal is not a status (P10-6). It is whether the organisation is
  -- still asking for this appraisal.
  excluded_at    timestamptz,
  excluded_reason text,

  -- §11: the worker's overall is the SUPERVISOR's "Overall Performance" tick,
  -- never a mean. Stored at submission, never recomputed on read.
  overall_tick   text check (overall_tick in ('EXCELLENT', 'SATISFACTORY', 'NEEDS_IMPROVEMENT')),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- One appraisal per worker per cycle.
  unique (cycle_id, worker_id),
  -- A supervisor cannot appraise themselves: they would fill both sides and see
  -- both, which breaks blindness outright (PR-8 made the same call for staff).
  constraint worker_evaluations_supervisor_not_worker check (supervisor_id is distinct from worker_id)
);

drop trigger if exists worker_evaluations_set_updated_at on public.worker_evaluations;
create trigger worker_evaluations_set_updated_at
  before update on public.worker_evaluations
  for each row execute function public.set_updated_at();

create index if not exists worker_evaluations_cycle_idx on public.worker_evaluations (cycle_id);
create index if not exists worker_evaluations_worker_idx on public.worker_evaluations (worker_id);
create index if not exists worker_evaluations_supervisor_idx on public.worker_evaluations (supervisor_id);

/* ============================================================================
   4. The frozen sheet
   ========================================================================== */
--
-- §5's snapshot rule, applied to the worker form: the questions are frozen at
-- launch so editing the bank afterwards cannot change what somebody was asked.
-- `question_id` is deliberately NOT a foreign key, exactly as in `evaluation_
-- questions` (P3-2) — a snapshot must outlive the row it was taken from.

create table if not exists public.worker_evaluation_questions (
  id            uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.worker_evaluations(id) on delete cascade,
  question_id   uuid not null,
  text          text not null,
  help_text     text,
  sort_order    integer not null,
  is_required   boolean not null default true,
  -- Which frozen row is the overall (§11). Carried into the snapshot so scoring
  -- never has to consult the live bank to find it.
  is_overall    boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (evaluation_id, question_id)
);

create index if not exists worker_evaluation_questions_order_idx
  on public.worker_evaluation_questions (evaluation_id, sort_order);

/* ============================================================================
   5. The answers
   ========================================================================== */

create table if not exists public.worker_evaluation_responses (
  id            uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.worker_evaluations(id) on delete cascade,
  layer         public.worker_rating_layer not null,
  -- { "<question_id>": "EXCELLENT" | "SATISFACTORY" | "NEEDS_IMPROVEMENT" }
  -- Flat, never nested (§5).
  answers       jsonb not null default '{}'::jsonb,
  comments      jsonb not null default '{}'::jsonb,
  submitted_at  timestamptz,
  submitted_by  uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (evaluation_id, layer),
  constraint worker_responses_answers_object check (jsonb_typeof(answers) = 'object'),
  constraint worker_responses_comments_object check (jsonb_typeof(comments) = 'object')
);

drop trigger if exists worker_responses_set_updated_at on public.worker_evaluation_responses;
create trigger worker_responses_set_updated_at
  before update on public.worker_evaluation_responses
  for each row execute function public.set_updated_at();

/* ============================================================================
   6. The worker answers their own sheet now
   ========================================================================== */
--
-- P24 seeded every quality as LEAD_ONLY, because the source form is a
-- supervisor's tick sheet and nothing else existed. Blind parallel rating means
-- the worker fills the same eight qualities about themselves, so they have to
-- be answerable by both sides.
--
-- The OVERALL row is the exception and stays supervisor-only: §11 defines the
-- worker's overall as the supervisor's tick, and a worker rating their own
-- overall would produce a second figure with no defined meaning.

update public.worker_questions
   set answered_by = 'EMPLOYEE_AND_LEAD'
 where is_overall = false
   and answered_by <> 'EMPLOYEE_AND_LEAD';

update public.worker_questions
   set answered_by = 'LEAD_ONLY'
 where is_overall = true
   and answered_by <> 'LEAD_ONLY';

/* ============================================================================
   7. RLS
   ========================================================================== */
--
-- The blindness invariant (§5), enforced here rather than in the interface:
-- the supervisor cannot read the SELF layer and the worker cannot read the
-- SUPERVISOR layer, at ANY status including CLOSED. Only HR and the MD read
-- both.

alter table public.worker_cycles                enable row level security;
alter table public.worker_evaluations           enable row level security;
alter table public.worker_evaluation_questions  enable row level security;
alter table public.worker_evaluation_responses  enable row level security;

/* -- Helpers. SECURITY DEFINER for the reason P5-7 records: a policy on
      `worker_evaluations` that queried the same table would recurse. -- */

create or replace function public.is_worker_of(p_evaluation_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.worker_evaluations e
     where e.id = p_evaluation_id and e.worker_id = (select auth.uid())
  );
$$;

create or replace function public.is_supervisor_of(p_evaluation_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.worker_evaluations e
     where e.id = p_evaluation_id and e.supervisor_id = (select auth.uid())
  );
$$;

grant execute on function public.is_worker_of(uuid)     to authenticated;
grant execute on function public.is_supervisor_of(uuid) to authenticated;

-- Cycles: everyone involved may see that one is running; only HR configures.
drop policy if exists worker_cycles_read on public.worker_cycles;
create policy worker_cycles_read on public.worker_cycles
  for select to authenticated using (true);

drop policy if exists worker_cycles_hr_write on public.worker_cycles;
create policy worker_cycles_hr_write on public.worker_cycles
  for all to authenticated using (public.is_hr()) with check (public.is_hr());

-- Evaluations: your own, or one you supervise, or everything for HR and the MD.
drop policy if exists worker_evaluations_read on public.worker_evaluations;
create policy worker_evaluations_read on public.worker_evaluations
  for select to authenticated using (
    worker_id = (select auth.uid())
    or supervisor_id = (select auth.uid())
    or public.is_hr()
    or public.is_md()
  );

drop policy if exists worker_evaluations_hr_write on public.worker_evaluations;
create policy worker_evaluations_hr_write on public.worker_evaluations
  for all to authenticated using (public.is_hr()) with check (public.is_hr());

-- The frozen sheet follows the evaluation. HR may INSERT (the launch is the one
-- legitimate write); NOBODY may update or delete, and that absence is what
-- enforces §5's snapshot rule (P5-5, P5-9).
drop policy if exists worker_questions_snapshot_read on public.worker_evaluation_questions;
create policy worker_questions_snapshot_read on public.worker_evaluation_questions
  for select to authenticated using (
    public.is_worker_of(evaluation_id)
    or public.is_supervisor_of(evaluation_id)
    or public.is_hr()
    or public.is_md()
  );

drop policy if exists worker_questions_snapshot_insert on public.worker_evaluation_questions;
create policy worker_questions_snapshot_insert on public.worker_evaluation_questions
  for insert to authenticated with check (public.is_hr());

/* -- THE BLINDNESS POLICY.
      Each side reads its OWN layer and no other. Not "unless closed", not
      "unless the disclosure allows" — at any status, for ever. If a supervisor's
      remark ever needs to reach a worker it goes through a curated report
      field, which is a deliberate act of authoring rather than a raw layer
      surfacing on a status change (A3-2). -- */
drop policy if exists worker_responses_read on public.worker_evaluation_responses;
create policy worker_responses_read on public.worker_evaluation_responses
  for select to authenticated using (
    (layer = 'SELF'       and public.is_worker_of(evaluation_id))
    or (layer = 'SUPERVISOR' and public.is_supervisor_of(evaluation_id))
    or public.is_hr()
    or public.is_md()
  );

/* -- Writes. Each side writes its own layer while the record is OPEN and that
      layer is neither submitted nor skipped.

      The supervisor's gate deliberately does NOT consult `self_submitted_at`:
      doing so would gate correctly and still leak, because whether the
      supervisor's form saves would become a readout of the worker's progress
      (F2-2 made this exact call for staff). -- */
drop policy if exists worker_responses_write on public.worker_evaluation_responses;
create policy worker_responses_write on public.worker_evaluation_responses
  for all to authenticated using (
    exists (
      select 1 from public.worker_evaluations e
       where e.id = evaluation_id
         and e.status = 'OPEN'
         and (
           (layer = 'SELF' and e.worker_id = (select auth.uid())
              and e.self_submitted_at is null and not e.self_skipped)
           or (layer = 'SUPERVISOR' and e.supervisor_id = (select auth.uid())
              and e.supervisor_submitted_at is null and not e.supervisor_skipped)
         )
    )
    or public.is_hr()
  ) with check (
    exists (
      select 1 from public.worker_evaluations e
       where e.id = evaluation_id
         and e.status = 'OPEN'
         and (
           (layer = 'SELF' and e.worker_id = (select auth.uid())
              and e.self_submitted_at is null and not e.self_skipped)
           or (layer = 'SUPERVISOR' and e.supervisor_id = (select auth.uid())
              and e.supervisor_submitted_at is null and not e.supervisor_skipped)
         )
    )
    or public.is_hr()
  );

grant select, insert, update on public.worker_cycles                to authenticated;
grant select, insert, update on public.worker_evaluations           to authenticated;
grant select, insert                on public.worker_evaluation_questions to authenticated;
grant select, insert, update on public.worker_evaluation_responses  to authenticated;

comment on table public.worker_evaluations is
  'One shop-floor appraisal. Blind parallel rating: the worker and their supervisor tick the same sheet at the same time and neither reads the other (0047, amending §8''s sequential worker table at the owner''s instruction).';

commit;

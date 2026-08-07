-- =============================================================================
-- 0003_cycles.sql — Cycles, evaluation records, the frozen snapshot, responses
-- and decisions. Phase P3. CLAUDE.md §5 (data model), §8 (state machine).
-- =============================================================================
--
-- THE SNAPSHOT RULE (§5) is what this migration exists to enforce:
--
--   "At cycle launch, each evaluation freezes its question list into
--    evaluation_questions. Editing the question bank later must never change a
--    launched evaluation."
--
-- Two structural consequences, both deliberate:
--
--   1. evaluation_questions.question_id is NOT a foreign key. If HR deletes a
--      question from the bank next year, a launched evaluation must still render
--      and print exactly as it was answered. A FK would either block that delete
--      or cascade the snapshot away — both destroy the historical record.
--
--   2. Every field the renderer needs is COPIED into the snapshot: text,
--      help_text, response_type, is_required, bounds, the conditional pair, and
--      the select options as JSONB. The snapshot never joins back to `questions`
--      for anything. If it did, an edit to the bank would leak into history
--      through that join, which is precisely the failure mode §5 forbids.
--
-- The same reasoning applies to evaluation_questions.depends_on and to the
-- actor columns (submitted_by, decided_by): a reference that must outlive the
-- row it points at cannot be a foreign key.
--
-- !! RLS IS STILL NOT ENABLED. Policies land in P5. !!
-- =============================================================================


/* ---------- Enums ---------- */

-- The cycle's own lifecycle, distinct from an individual evaluation's. A cycle
-- is a container: DRAFT while HR builds it, ACTIVE once launched, CLOSED when
-- every evaluation inside it has been closed.
create type public.cycle_status as enum ('DRAFT', 'ACTIVE', 'CLOSED');

-- §8, in transition order. The state machine itself is P4; this migration only
-- provides the vocabulary.
create type public.evaluation_status as enum (
  'DRAFT',
  'CYCLE_ACTIVE',
  'SELF_SUBMITTED',
  'LEAD_REVIEWED',
  'MD_FINALIZED',
  'CLOSED'
);

-- The three rating layers that collide (§1). One response row per layer (§5).
create type public.rating_layer as enum ('SELF', 'LEAD', 'MD');

-- How much of the finished evaluation the employee is shown (§9). NONE hides it
-- entirely; FULL includes raw lead comments and is the only value that does.
create type public.disclosure_policy as enum (
  'NONE',
  'SCORE_ONLY',
  'SCORE_AND_DECISION',
  'FULL'
);


/* ---------- evaluation_cycles ---------- */

create table public.evaluation_cycles (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  period_label  text not null,

  -- §7: which tracks this cycle covers. Gates who gets an evaluation row, not
  -- which questions they see — question filtering is per person, from their own
  -- profile.track.
  track_scope   public.track_type not null default 'BOTH',

  starts_on     date,
  self_due_on   date,
  lead_due_on   date,
  md_due_on     date,

  status        public.cycle_status not null default 'DRAFT',
  disclosure    public.disclosure_policy not null default 'SCORE_AND_DECISION',

  -- §11: flag a question when |Lead - Self| >= this. Per cycle so the business
  -- can tighten or loosen it without a migration.
  variance_threshold integer not null default 2,

  launched_at   timestamptz,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- The three stage deadlines run self -> lead -> md (§8's transition order).
  -- Out-of-order dates would make "overdue" meaningless on every screen.
  constraint evaluation_cycles_due_order check (
    (self_due_on is null or lead_due_on is null or lead_due_on >= self_due_on)
    and (lead_due_on is null or md_due_on is null or md_due_on >= lead_due_on)
  ),
  -- A negative threshold would flag every question on every evaluation.
  constraint evaluation_cycles_variance_threshold check (variance_threshold >= 0)
);

create trigger evaluation_cycles_set_updated_at
  before update on public.evaluation_cycles
  for each row execute function public.set_updated_at();

comment on column public.evaluation_cycles.launched_at is
  'Set when the cycle moves DRAFT -> ACTIVE and evaluations are snapshotted (P4). NULL means nothing is frozen yet.';


/* ---------- evaluations ---------- */

create table public.evaluations (
  id            uuid primary key default gen_random_uuid(),
  cycle_id      uuid not null references public.evaluation_cycles(id) on delete cascade,

  evaluatee_id  uuid not null references public.profiles(id),
  -- The reviewer for this evaluation, copied from profiles.reports_to at launch
  -- rather than read live: a reorganisation mid-cycle must not silently reassign
  -- an in-flight review.
  lead_id       uuid references public.profiles(id),
  -- Likewise copied, so a department transfer does not retroactively change
  -- which department this appraisal belongs to.
  department_id uuid references public.departments(id),
  track         public.track_type not null,

  status        public.evaluation_status not null default 'DRAFT',

  self_submitted_at timestamptz,
  lead_submitted_at timestamptz,
  md_finalized_at   timestamptz,
  closed_at         timestamptz,

  -- §5: "Scores are never recomputed on read from mutable config." Written once
  -- at submit time from the answers as they then stood.
  self_overall  numeric(4, 2),
  lead_overall  numeric(4, 2),
  final_overall numeric(4, 2),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- §5: one row per employee per cycle.
  constraint evaluations_cycle_evaluatee_unique unique (cycle_id, evaluatee_id),
  -- Nobody reviews their own appraisal; that is what the SELF layer is for.
  constraint evaluations_lead_not_evaluatee check (lead_id is null or lead_id <> evaluatee_id)
);

create index evaluations_cycle_status_idx on public.evaluations (cycle_id, status);
create index evaluations_evaluatee_idx    on public.evaluations (evaluatee_id);
create index evaluations_lead_idx         on public.evaluations (lead_id);

create trigger evaluations_set_updated_at
  before update on public.evaluations
  for each row execute function public.set_updated_at();


/* ---------- evaluation_questions — THE FROZEN SNAPSHOT ---------- */
--
-- Read the banner at the top of this file before changing anything here.

create table public.evaluation_questions (
  id            uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.evaluations(id) on delete cascade,

  -- Deliberately NOT a foreign key to public.questions. This is the key that
  -- answers/comments JSONB is keyed by (§5), and it must remain resolvable after
  -- the source question is deleted from the bank.
  question_id   uuid not null,

  -- Copied, never joined. See consequence 2 in the banner.
  text          text not null,
  help_text     text,
  section       public.question_section not null,
  response_type public.response_type not null,
  answered_by   public.answered_by not null,
  is_required   boolean not null default true,
  min_value     numeric,
  max_value     numeric,

  -- Also not a foreign key: it holds the *source question id* of the parent,
  -- matched against a sibling row's question_id within the same snapshot.
  depends_on    uuid,
  depends_value text,

  -- SINGLE_SELECT / MULTI_SELECT choices frozen as
  --   [{ "label": "...", "value": "...", "sort_order": 10 }, ...]
  -- so relabelling an option in the bank cannot retitle a historic answer.
  options       jsonb,

  -- Assigned sequentially across the whole merged form at snapshot time, so
  -- reading the snapshot back ordered by sort_order alone reproduces the exact
  -- order the evaluatee saw. Do not reuse the bank's per-section values here.
  sort_order    integer not null default 0,

  -- Structural guarantee behind "re-running snapshotEvaluation creates no
  -- duplicates". The application also refuses to re-snapshot a frozen
  -- evaluation; this is the backstop against two concurrent launches.
  constraint evaluation_questions_unique unique (evaluation_id, question_id)
);

create index evaluation_questions_evaluation_sort_idx
  on public.evaluation_questions (evaluation_id, sort_order);

comment on table public.evaluation_questions is
  'Frozen per-evaluation copy of the question list (§5 snapshot rule). Never joins back to public.questions.';


/* ---------- evaluation_responses ---------- */

create table public.evaluation_responses (
  id            uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.evaluations(id) on delete cascade,
  layer         public.rating_layer not null,

  -- §5 JSONB shape, flat, never nested deeper:
  --   answers  { "<question_id>": <value> }
  --   comments { "<question_id>": "<text>" }
  answers       jsonb not null default '{}'::jsonb,
  comments      jsonb not null default '{}'::jsonb,

  -- §5: computed at submit time and stored, never recalculated on read from
  -- config that may since have moved.
  section_scores jsonb,
  overall_score  numeric(4, 2),

  submitted_at  timestamptz,
  -- Plain uuid, not a FK: the record of who submitted must outlive the actor's
  -- profile row (§12 — audit rows are insert-only and never lose their actor).
  submitted_by  uuid,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- §5: one row per layer.
  constraint evaluation_responses_evaluation_layer_unique unique (evaluation_id, layer),

  constraint evaluation_responses_answers_object check (jsonb_typeof(answers) = 'object'),
  constraint evaluation_responses_comments_object check (jsonb_typeof(comments) = 'object')
);

create index evaluation_responses_evaluation_idx on public.evaluation_responses (evaluation_id);

create trigger evaluation_responses_set_updated_at
  before update on public.evaluation_responses
  for each row execute function public.set_updated_at();

comment on column public.evaluation_responses.submitted_at is
  '§8 locking rule: non-null means this layer is read-only until an explicit return transition clears it.';


/* ---------- evaluation_decisions ---------- */

-- One decision record per evaluation, written by the MD at MD_FINALIZED (§9).
-- The overall final score lives on evaluations.final_overall, not here, so that
-- every score for an evaluation sits on one row.
create table public.evaluation_decisions (
  id            uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null unique references public.evaluations(id) on delete cascade,

  promotion_recommendation text,
  increment_type           text,
  old_salary               numeric(12, 2),
  increment_pct            numeric(5, 2),
  new_salary               numeric(12, 2),
  training_required        boolean,
  concerns                 text,
  md_remarks               text,

  -- Plain uuid, as with submitted_by above.
  decided_by  uuid,
  decided_at  timestamptz
);

# CLAUDE.md — Constitution
## LinkD Prints · Performance Evaluation Platform ("Appraise")

> This file is the **single source of truth**. If any phase prompt, screenshot,
> comment, or later instruction conflicts with this file, **this file wins** —
> stop and ask before deviating.

---

## 0. Golden Rules (non-negotiable)

1. **Never rewrite a whole file.** Make targeted, surgical edits. If a file needs
   large changes, edit it section by section. Whole-file rewrites cause streaming
   stalls and lose context.
2. **Never rename anything without an explicit instruction.** Table names, column
   names, enum values, route paths, component names, menu labels and question
   text are fixed once created. If a name looks wrong, ask — do not "improve" it.
3. **Never hardcode a secret.** No API tokens, product IDs, phone IDs, service
   keys or passwords in source. Everything goes to environment variables. If a
   secret appears in a prompt, put it in .env.local and .env.example (key only,
   value blank) and reference it via process.env.
4. **Never invent schema.** Only the tables, columns and enums defined in this
   file exist. Adding a column requires a migration file and an explicit
   instruction.
5. **Never bypass RLS.** The service-role key is used only in server-side
   notification/cron code, **and in the single Supabase Admin API call that
   creates an auth user** (amended P8 — creating an account is not possible any
   other way; everything else about that user goes through the authenticated
   client so RLS still applies). All user-facing reads and writes go through the
   authenticated client with RLS on.
6. **No mock or seeded data in production code paths.** Demo data lives only in
   supabase/seed.sql and is clearly marked.
7. **Fail loudly, not silently.** Every server action returns a typed result with
   an error. Never swallow an error into a blank screen.
8. **One migration per phase.** Sequential, zero-padded: 0001_, 0002_, 0003_…
   Never edit a migration that has been applied — write a new one.
9. **Ask before assuming.** If a requirement is ambiguous, stop and list the
   options with a recommendation. Do not guess and build.
10. **English UI, Indian conventions.** DD-MM-YYYY dates, INR with the ₹ symbol
    and Indian digit grouping (1,00,000), Asia/Kolkata timezone everywhere.

---

## 1. What this system is

A web application that replaces two paper forms — the **Employee Performance
Evaluation** (staff, 0–5 scale) and the **Worker Performance Appraisal**
(shop floor, three-point tick scale) — with one dynamic, department-aware
appraisal platform.

The defining idea: every staff employee fills the SAME form. One section of it
— Job Specific Skills — carries questions mapped to that person's department;
every other section is identical company-wide. Answers land in a JSONB blob
keyed by question_id, and the question list is frozen per evaluation at launch.

Workers are a separate module. Shop-floor appraisal uses its own simple
three-tick form, its own tables prefixed worker_, its own screens and its own
print pack. It shares authentication, profiles, departments, the audit log,
the notification log and the design system, and nothing else.

The second defining idea: the employee and their HOD rate the same form at the
same time, blind to each other. Neither ever sees the other's answers. Only
HR and the MD see both. This is enforced in RLS, not in the interface — a
policy, not a convention. Blind rating is deliberate: a HOD who can see a 5
has a strong pull toward not writing a 2, and the disagreement we want to
measure is the disagreement that exists before either side is anchored.

The third defining idea: a cycle has a type. An EVALUATION cycle ends when the
MD has read the report. An INCREMENT cycle continues into salary — HR records
the numbers, the MD approves, HR and the MD hold an interview call, and the
final hike amount is confirmed. Both types use the same form and the same
blind parallel flow; only the ending differs.

---

## 2. Tech stack (pinned — do not substitute)

| Layer | Choice |
|---|---|
| Framework | Next.js 14+ App Router, TypeScript strict |
| Data layer | Server Actions (mutations) + server components (reads) |
| Styling | Tailwind CSS |
| Components | shadcn/ui |
| Icons | lucide-react |
| Motion | framer-motion (restrained — see DESIGN.md) |
| Charts | recharts |
| Tables | TanStack Table v8 |
| Forms | React Hook Form + Zod (schema generated at runtime) |
| Database | Supabase Postgres + Row Level Security |
| Auth | Supabase Auth — **email + password** (changed P8; was email OTP) + signed invite tokens |
| File storage | Supabase Storage (signed URLs only) |
| WhatsApp | Maytapi REST API (server-side only) |
| Email | Resend (server-side only) |
| Hosting | Vercel |

**Forbidden without instruction:** Prisma, Drizzle, tRPC, Redux, MUI, Chakra,
Bootstrap, styled-components, any CSS-in-JS, any other charting library,
any other auth provider.

---

## 3. Repository structure

> **AMENDED (NAV-1, NAV-2, NAV-3).** The route tree below is the one that
> exists, not the one this section was written with. Four things moved, all at
> the owner’s explicit instruction — §0.2 requires exactly that before a route
> or a menu label changes, and each is recorded in §18:
>
> - `/admin/questions` → `/admin/form-builder/questions`, a **tab** inside the
>   builder rather than its own menu entry.
> - `/admin/departments` → the **list** is a tab in Settings; the per-department
>   mapping screen stays at `/admin/departments/[id]`.
> - `/admin/people` was an empty placeholder; it is now **Team review**, the
>   staff roster and the way into anybody’s scorecard.
> - `/scorecard` is new and is the single canonical scorecard route.
>
> The two retired paths still resolve — they **redirect** rather than 404,
> because a bookmark going nowhere reads as a broken product.

```
/app
  /(public)        → landing, invite link handler, expired/error pages
  /(app)           → authenticated shell (sidebar + topbar)
    /dashboard
    /scorecard            → one person’s history; ?person= for administrators
    /my-evaluation        → employee self-eval
    /team                 → HOD: list of reports + review screens
    /review               → MD: queue + collision view
    /people/[id]/scorecard → redirects to /scorecard?person=[id]
    /admin
      /form-builder       → the form builder
        /questions        → the question bank, as a second tab
      /questions          → redirect → /admin/form-builder/questions
      /departments        → redirect → /admin/settings?tab=departments
        /[id]             → Job Specific Skills mapping for one department
      /cycles             → cycle setup, launch, distribution
      /people             → "Team review": staff roster → scorecards
      /settings           → General · Users · Departments
  /print                  → print-only routes (no chrome)
  /api                    → webhooks + cron only
/components
  /ui                     → shadcn primitives (untouched)
  /appraise               → domain components (RatingScale, TierBadge, …)
/lib
  /supabase               → client, server, service clients
  /forms                  → runtime form assembly + Zod generator
  /notify                 → maytapi.ts, email.ts, templates
  /auth                   → guards, role helpers
  /utils
/supabase
  /migrations             → 0001_…sql, 0002_…sql
  seed.sql
/types
```

---

## 4. Naming conventions

- **Postgres**: snake_case tables (plural) and columns. Primary key `id uuid
  default gen_random_uuid()`. Timestamps `created_at`, `updated_at` (timestamptz).
- **Enums**: SCREAMING_SNAKE_CASE values, e.g. `SELF_SUBMITTED`.
- **TypeScript**: PascalCase types/components, camelCase functions/vars.
- **Server actions**: verbNoun — `submitSelfEvaluation`, `launchCycle`.
- **Routes**: kebab-case.
- **Question keys in JSONB**: the question's `id` (uuid), never its text.

---

## 5. Data model (canonical)

Tables and their purpose. Columns listed are the minimum; a phase prompt may add
listed extras, nothing more.

| Table | Purpose |
|---|---|
| `departments` | id, name, code, is_active |
| `profiles` | mirrors auth.users. id (=auth uid), full_name, employee_code, email, phone_e164, department_id, designation, date_of_joining, track, reports_to (self-FK), is_active |
| `roles` | HR_ADMIN, MD, HOD, EMPLOYEE, SUPERVISOR |
| `user_roles` | profile_id + role — **many-to-many**. One person can be EMPLOYEE and HOD at once. |
| `questions` | id, text, help_text, section, response_type, scale_type, category (CORE / DEPARTMENT), track, is_required, sort_order, answered_by, is_active |
| `question_options` | for SINGLE_SELECT / MULTI_SELECT questions |
| `department_questions` | question_id + department_id + sort_order (mapping table) |
| `evaluation_cycles` | id, name, period_label, track_scope, starts_on, self_due_on, lead_due_on, md_due_on, status, disclosure_policy |
| `evaluations` | one row per employee per cycle. cycle_id, evaluatee_id, lead_id, department_id, track, status, self_submitted_at, lead_submitted_at, md_finalized_at, closed_at |
| `evaluation_questions` | **frozen snapshot** of the question list for that evaluation (question_id, text, type, section, sort_order) |
| `evaluation_responses` | evaluation_id + layer (SELF / LEAD / MD) + answers JSONB + comments JSONB + submitted_at + submitted_by. Unique on (evaluation_id, layer). |
| `evaluation_decisions` | overall_final_score, promotion_recommendation, increment_type, old_salary, increment_pct, new_salary, training_required, concerns, md_remarks |
| `invite_tokens` | evaluation_id, profile_id, token_hash, expires_at, used_at, channel |
| `notifications_log` | channel, recipient, template, payload, status, provider_message_id, error |
| `audit_log` | actor_id, entity, entity_id, action, from_status, to_status, diff JSONB, created_at |

### Invariants

- **Snapshot rule.** At cycle launch, each evaluation freezes its question list
  into `evaluation_questions`. Editing the question bank later must never change
  a launched evaluation. This is the rule that makes historical comparison honest.
- **One row per layer.** A layer is written once and then read-only. Re-opening
  requires an explicit status transition that is audit-logged.
- **JSONB shape.** `answers` is `{ "<question_id>": <value> }`. `comments` is
  `{ "<question_id>": "<text>" }`. Never nest deeper.
- **Scores are never recomputed on read from mutable config.** Store the computed
  section and overall averages on the response row at submit time.
- **Module boundary.** The core evaluation tables are STAFF only. The track column
  on profiles, questions and cycles remains but is always STAFF in this module;
  WORKER data lives exclusively in the worker_ tables. Never write a WORKER row
  into a core evaluation table.
- **Blindness.** No policy, view, action, export or report may expose the SELF
  layer to the lead, or the LEAD layer to the evaluatee, at any status,
  including CLOSED. The only readers of both layers are HR_ADMIN and MD.
- **Salary confinement.** Salary figures are readable by HR_ADMIN and MD only.
  They never appear in a HOD-facing screen, a lead export, an employee-facing
  report, or a notification body.
- **No score overrides.** A question score is written by the layer that owns it
  and is never rewritten by anyone. The report shows both sides; it does not
  reconcile them.

---

## 6. Response types & scales

| response_type | UI | Stored as |
|---|---|---|
| `SCALE_0_5` | 6 segmented buttons, labelled | integer 0–5 |
| `TICK_3` | three radio cells (Excellent / Satisfactory / Needs Improvement) | 'EXCELLENT' / 'SATISFACTORY' / 'NEEDS_IMPROVEMENT' |
| `NUMBER` | numeric input | numeric |
| `BOOLEAN` | Yes / No toggle | boolean |
| `TEXT_SHORT` | single-line | text |
| `TEXT_LONG` | textarea, 1000 char cap with counter | text |
| `SINGLE_SELECT` | radio group | option id |
| `MULTI_SELECT` | checkbox group | array of option ids |
| `DATE` | date picker | date |

The question_section enum value DEPARTMENT_SPECIFIC is labelled "Job Specific
Skills" in every user-facing surface. The enum value itself is never renamed.

**SCALE_0_5 labels (fixed wording — do not paraphrase):**

```
0 · Very dissatisfied (Not implemented)
1 · Poor (Reconsider implementation)
2 · Inefficient (Needs improvement)
3 · Adequate (Meets objective)
4 · Effective (Exceeds objective)
5 · Outstanding (Well exceeds objective)
```

**TICK_3 numeric mapping for analytics only:**
Excellent = 5, Satisfactory = 3, Needs Improvement = 1. Never show the number on a
worker-track form; the worker form stays a tick sheet.

**Conditional questions.** A question may declare `depends_on` (question_id) and
`depends_value`. Example: "If yes, please specify" appears only when the parent
BOOLEAN is true. Hidden questions are not validated and not stored.

**`cycle_scope`** — BOTH (default), EVALUATION_ONLY, or INCREMENT_ONLY. A question
with INCREMENT_ONLY appears only in an increment cycle's form. This is how the
employee's salary expectation question exists without appearing on a plain
evaluation form. Form assembly filters on it alongside track and department.

---

## 7. Tracks and modules

| Module | People | Instrument | Layers | Tables |
|---|---|---|---|---|
| Staff evaluation | office employees | 0-5 scale, one shared form with a department-specific Job Specific Skills section | Self, Lead, MD | core tables |
| Worker appraisal | shop floor / production | three-tick sheet | Self, Supervisor, MD | worker_ tables |

profiles.track decides which module a person belongs to. A person is in exactly
one module. The track column on questions and cycles in the core module is
always STAFF.

Isolation rule: never refactor a staff-module function to accommodate the
worker module or the reverse. Shared needs move into shared infrastructure
deliberately.

---

## 8. State machine (the backbone)

## Staff evaluation — statuses

DRAFT → OPEN → PENDING_HR_REVIEW → HR_APPROVED → MD_REVIEWED → CLOSED

INCREMENT cycles insert one status: MD_REVIEWED → INTERVIEW_DONE → CLOSED.
INTERVIEW_DONE is invalid on an EVALUATION cycle.

While a record is OPEN, both the SELF and LEAD layers are open at the same
time and independently. Layer submission is tracked by self_submitted_at and
lead_submitted_at, NOT by the status. The status moves to PENDING_HR_REVIEW
only when both timestamps are set, or when HR advances it deliberately.

| From | To | Who | Guard |
|---|---|---|---|
| DRAFT | OPEN | HR_ADMIN | cycle launched, evaluatee and lead assigned, questions snapshotted |
| OPEN | OPEN | evaluatee | submits the SELF layer; all required visible self answers valid; SELF layer locks; status does not change unless the LEAD layer is already in |
| OPEN | OPEN | lead | submits the LEAD layer; same rules |
| OPEN | PENDING_HR_REVIEW | system | both self_submitted_at and lead_submitted_at are set |
| OPEN | PENDING_HR_REVIEW | HR_ADMIN | one side has not submitted; reason required and recorded; the missing layer is marked skipped |
| PENDING_HR_REVIEW | OPEN | HR_ADMIN | returns to SELF, LEAD or BOTH; reason required; only the named layers unlock and clear their submitted_at |
| PENDING_HR_REVIEW | HR_APPROVED | HR_ADMIN | report reviewed; on an INCREMENT cycle the salary block must be complete |
| HR_APPROVED | PENDING_HR_REVIEW | MD | MD sends it back to HR; reason required |
| HR_APPROVED | MD_REVIEWED | MD | MD has read the report; remarks recorded |
| MD_REVIEWED | CLOSED | HR_ADMIN or system | EVALUATION cycles only |
| MD_REVIEWED | INTERVIEW_DONE | HR_ADMIN or MD | INCREMENT cycles only; interview date and final approved amount recorded |
| MD_REVIEWED | HR_APPROVED | MD | correction before the interview; reason required |
| INTERVIEW_DONE | CLOSED | HR_ADMIN or system | final amount confirmed; increment dates rolled forward |

Locking rule, restated: a layer locks on its own submission, independently of
the other layer and of the status. It reopens only through a named return.

What employees see, never the enum: In progress · Submitted · Under review ·
Completed.

Worker appraisal:
DRAFT to CYCLE_ACTIVE to SELF_SUBMITTED to SUPERVISOR_REVIEWED to MD_FINALIZED
to CLOSED

| From | To | Who | Guard |
|---|---|---|---|
| DRAFT | CYCLE_ACTIVE | HR_ADMIN | cycle launched, worker and supervisor assigned, questions snapshotted |
| CYCLE_ACTIVE | SELF_SUBMITTED | worker, or supervisor/HR filling on behalf | all required self ticks present |
| CYCLE_ACTIVE | SUPERVISOR_REVIEWED | supervisor with HR authorisation | self stage skipped, reason required and recorded |
| SELF_SUBMITTED | CYCLE_ACTIVE | supervisor (return) | reason required |
| SELF_SUBMITTED | SUPERVISOR_REVIEWED | supervisor | all required supervisor ticks present |
| SUPERVISOR_REVIEWED | SELF_SUBMITTED | MD (return) | reason required |
| SUPERVISOR_REVIEWED | MD_FINALIZED | MD | decisions recorded |
| MD_FINALIZED | CLOSED | HR_ADMIN or system | disclosure applied |

**Every transition writes an audit_log row. No exceptions. No shortcuts. Any
transition not in this table is rejected server-side with a clear error.**

Locking rule: once a layer is submitted it is read-only downstream forever,
unless an explicit return transition above unlocks it.

---

## 9. Roles, access & RLS

> **AMENDED (AMEND-2).** HR_ADMIN and MD are separate again. The v3 flow has
> HR prepare and review, and the MD approve — that is a second pair of eyes on
> a pay decision, and it only exists if the two roles are distinct. AMEND-1's
> is_admin() predicate is retired for evaluation and decision gates; it may
> remain only where both roles genuinely share a power.

| | HR_ADMIN | MD | HOD | EMPLOYEE |
|---|---|---|---|---|
| Config: departments, questions, cycles, people | full | read | — | — |
| Own evaluation | read all | read own | read/write own SELF layer | read/write own SELF layer |
| Reports' evaluations | read all | read all | **write LEAD layer only; cannot read the SELF layer at any status** | — |
| Combined report | read/write review | read | — | — |
| Advance to MD | write | — | — | — |
| MD review and remarks | read | write | — | — |
| Salary figures | read/write | read/write final amount | **never** | **never** |
| Interview record | write | write | — | — |
| Outcome after closing | read | read | — | reads own outcome only, per disclosure |

Helper functions: keep is_hr() and is_md() as the truthful role test. Replace
is_admin() in every evaluation, report, decision and salary gate with the
specific role. Grep for is_admin() and ADMIN_ROLES and report every remaining
use with a justification.

RLS principles:
- Every table has RLS enabled. No table is left open.
- Policies are written against `auth.uid()` and helper SQL functions
  `is_hr()`, `is_md()`, `is_lead_of(evaluation_id)`, `is_evaluatee(evaluation_id)`.
- A HOD is also an employee: their own evaluation is scoped by the evaluatee
  policy, their reports by the lead policy. Both apply simultaneously.
- **Client code must never be the only guard.** Every server action re-checks the
  role and the state machine guard before writing.

---

## 10. Invite links & distribution

- HR sends a link per employee per cycle, over WhatsApp and/or email.
- Token: 32 bytes of cryptographic randomness, base64url. **Only the SHA-256 hash
  is stored.** Single evaluation scope, expires at cycle `self_due_on` + 7 days.
- Opening the link → verify hash → sign the user in via Supabase (email OTP if
  the session is absent) → redirect to their evaluation. It **never** grants
  access to anything beyond that one evaluation.
- Tokens are one active token per (evaluation, channel); resending revokes the old.
- No name, employee code, email or phone in the URL — the token only.
- Rate limit: 10 attempts per token per hour, then lock.

**Maytapi rules:** all calls server-side. Credentials from
`MAYTAPI_PRODUCT_ID`, `MAYTAPI_PHONE_ID`, `MAYTAPI_API_TOKEN`. Phone numbers
normalised to E.164 (default country +91). Every send is logged to
`notifications_log` with the provider response. Failures never block the UI —
they surface as a retry-able row in HR's distribution screen.

---

## 11. Scoring rules

- Section score = mean of answered SCALE_0_5 questions in that section, 2 decimals.
- Overall score = mean of all SCALE_0_5 questions, unweighted, unless the cycle
  defines section weights.
- NUMBER, BOOLEAN, TEXT and MULTI_SELECT answers never enter a score.
- Self average and Lead average are computed and stored independently at each
  layer's submission. Neither is adjusted afterwards.
- Gap = Lead average minus Self average, per question and overall. It is a
  reporting figure only. It is visible to HR and the MD, and to nobody else.
- Flag a question when the absolute gap is at or above the cycle's threshold.
- There is no final score column and no override. The report carries both
  numbers and the gap. If a single headline figure is needed, use the Lead
  average and label it as such.
- Worker track: overall = the Supervisor's "Overall Performance" tick, not a mean.

---

## 12. Audit & compliance

Log to `audit_log`: every status transition, every MD override, every decision,
every question-bank edit, every token issue/use, every role change. Include actor,
timestamp (timestamptz), and a JSONB diff of before/after. Audit rows are
insert-only — no update or delete policy exists for anyone.

---

## 13. UI/UX laws

Full specification lives in **DESIGN.md**. The non-negotiables:

1. **Tier colour identity is sacred.** Self = cyan, Lead = pink, Final = indigo.
   These three colours mean the same thing on every screen, chart, badge and cell.
   They are never used decoratively for anything else — in particular, the
   success green is never a tier. (Re-mapped from amber/blue/emerald onto the
   dashboard palette; the rule is unchanged, only the hues.)
2. **Employee-facing screens are mobile-first.** Most employees open the WhatsApp
   link on a phone. The self-evaluation form must be flawless at 375px wide.
3. **One primary action per screen.** Everything else is secondary or ghost.
4. **No dead ends.** Every list has an empty state, every async action has a
   loading state, every error states what to do next.
5. **Progressive disclosure.** The HR form builder must be usable by a
   non-technical person: plain language, no JSON, no schema jargon in the UI.
6. **Autosave drafts** every 20 seconds and on blur, with a visible "Saved
   HH:MM" indicator. Never lose a half-filled form.
7. **Print is a first-class output.** MD/HR must be able to print a clean,
   signature-ready report pack. Dedicated print routes, not a hacked media query
   over the app shell.
8. Accessibility: keyboard reachable, focus visible, 4.5:1 contrast minimum,
   44px minimum touch targets, labels tied to inputs.

---

## 14. Code standards

- TypeScript strict. **No `any`.** Generate DB types from Supabase into
  `/types/database.ts` and use them.
- Zod validates at every boundary: server action input, invite token payload,
  and the dynamic form.
- Server actions return `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
  Never throw raw to the client.
- No secrets, IDs or PII in `console.log` in production paths.
- Comments explain *why*, not *what*.
- Section banners in long files:
  `/* ---------- Section name ---------- */`
- Every new file starts with a one-line purpose comment.

---

## 15. Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=
MAYTAPI_PRODUCT_ID=
MAYTAPI_PHONE_ID=
MAYTAPI_API_TOKEN=
RESEND_API_KEY=
MAIL_FROM=
CRON_SECRET=
DEFAULT_COUNTRY_CODE=+91
```

`.env.example` carries the keys with empty values and is committed.
`.env.local` carries the values and is git-ignored. Never the reverse.

---

## 16. Definition of Done (every phase)

- [ ] `npm run build` passes with zero TypeScript errors
- [ ] No ESLint errors
- [ ] Migration applied and idempotent-safe; `supabase db reset` works from scratch
- [ ] RLS verified: tested as each of the four roles, including the HOD-who-is-
      also-an-employee case
- [ ] Loading, empty and error states exist for every new screen
- [ ] Works at 375px, 768px and 1440px
- [ ] No secret, ID or PII added to logs or URLs
- [ ] Audit rows written for anything that changes state
- [ ] A one-paragraph summary of what changed, written at the end of the phase

---

## 17. Things you must never do

- Rewrite CLAUDE.md, DESIGN.md or a migration that has been applied.
- Rename a question, department, column, enum value or menu label.
- Delete a submitted evaluation layer — return it instead.
- Show an employee another employee's ratings.
- Show an employee raw Lead comments unless disclosure policy explicitly allows.
- Compute a final score implicitly. Store it.
- Put the Maytapi token, Supabase service key or any credential in client code.
- Add a dependency not listed in section 2.
- "Improve" wording, labels or scale text that came from the source forms.
- Write a WORKER row into a core evaluation table, or a staff row into a
  worker_ table.
- Refactor a staff-module function to serve the worker module, or the reverse.
- Record a fill-on-behalf submission as though the worker submitted it
  themselves.
- Show the lead the employee's self answers, or the employee the lead's
  answers, in any screen, export, report, notification or API response.
- Put a salary figure anywhere a HOD or an employee can read it.
- Override or edit a submitted question score.
- Advance a record to the MD without an HR review.

---

## 18. Phase log

What each phase delivered, and every decision that departed from this document or
resolved an ambiguity in it. **Appended to at the end of each phase — never
rewritten.** Sections 0–17 above remain the constitution; this section is the
record of applying it.

### P0 — Project bootstrap and design foundation

**Delivered.** Next 16.3 / React 19 / TypeScript strict App Router project,
src-less per §3 with every folder created. Tailwind 3.4 and shadcn/ui (18
primitives, unmodified). The full Dossier token set from DESIGN.md §2–§5 in
`app/globals.css`, bridged into `tailwind.config.ts`. Three fonts via
`next/font`. Three Supabase clients in `lib/supabase/`. `.env.example` carrying
the §15 keys. A temporary `/styleguide` route rendering every token.

| # | Decision | Why |
|---|---|---|
| P0-1 | Tailwind pinned to v3 with a real `tailwind.config.ts` | DESIGN.md §2 and P0 both name `tailwind.config.ts`; Tailwind v4 is CSS-first and has no config file. Confirmed with the user. |
| P0-2 | Colour tokens stored as RGB channel triplets, hex kept in a comment beside each | Tailwind v3 silently emits **nothing** for `bg-primary/90` when a token holds a bare `var()` with a hex inside. Every shadcn hover state and the dialog overlay would have been dead, with no error to show for it. Verified in the compiled CSS. |
| P0-3 | DESIGN.md's `--accent` is Tailwind's `primary`; Tailwind's `accent` is `--accent-tint` | The shadcn primitives use `accent` for subtle hover and selected surfaces — the exact role §2 gives `--accent-tint`. Avoids editing a primitive. |
| P0-4 | Tailwind's default spacing scale kept, not replaced | Its `1/2/3/4/6/8/12/16` steps already *are* DESIGN.md §4's `4·8·12·16·24·32·48·64`. Replacing it would break the primitives §3 requires stay untouched. |
| P0-5 | `next-themes` removed; `components/ui/sonner.tsx` pinned to `theme="light"` | DESIGN.md §2 ships light-only for v1, and §17 forbids dependencies outside §2. A one-line edit to a shadcn wrapper, not to a primitive. |
| P0-6 | shadcn's own required deps kept (radix, cva, clsx, tailwind-merge, vaul, sonner, tailwindcss-animate) | Unavoidable consequence of "install and initialise shadcn/ui". |
| P0-7 | `lib/utils/index.ts`, not `lib/utils.ts` | §3 defines `/lib/utils` as a directory; a sibling file of the same name shadows it in module resolution. |
| P0-8 | `.env.example` keeps `DEFAULT_COUNTRY_CODE=+91` rather than blanking it | §15 shows that value, and §0 says this document outranks a phase prompt. It is not a secret. |
| P0-9 | No `/` route yet | The landing page belongs to `(public)` in a later phase. Only `/styleguide` exists. |

### P1 — Core schema and role model

**Delivered.** `supabase/migrations/0001_core.sql` — `pgcrypto`,
`set_updated_at()`, enums `track_type` and `app_role`, tables `departments`,
`profiles` and `user_roles`, the `on_auth_user_created` trigger, five helper
functions and three indexes. `supabase/seed.sql` seeds the five departments.
`types/database.ts` wired into all three Supabase clients. `lib/auth/roles.ts`
exporting `getCurrentProfile()`, `getRoles()`, `hasRole()`, `requireRole()`.

| # | Decision | Why |
|---|---|---|
| P1-1 | **RLS is not enabled on any table.** | §9 policies are P5. Until then Supabase's default grants leave `public` readable and writable by any authenticated user. Flagged in a banner at the top of the migration. Do not point a production project at this schema before P5. |
| P1-2 | `user_roles` carries no `created_at` / `updated_at` | The brief listed only id, profile_id, role and said not to add unlisted columns. §12 records every role change in `audit_log` (P6), so the grant timestamp is not lost. |
| P1-3 | Helpers pin `search_path = public, pg_temp`, not `public` alone | With `pg_temp` absent from the list Postgres still searches it *first* for relation names, so a caller could shadow `public.user_roles` with a temp table and subvert a SECURITY DEFINER check. |
| P1-4 | `has_role(role app_role)` qualifies its parameter as `has_role.role` | In a SQL-language function a column name outranks an identically named parameter. Covered by a test. |
| P1-5 | `handle_new_auth_user()` falls back to the email local part for `full_name`, but does not coalesce a null email | `full_name` is NOT NULL and an invite may not carry one. A null email means something is wrong upstream, and §0.7 says fail loudly. |
| P1-6 | `types/database.ts` is hand-authored to match `supabase gen types` output exactly | Docker is unavailable in this environment, so generation could not be run. `npm run db:types` regenerates it once the project is linked. |
| P1-7 | Department codes chosen as MIS / SALES / OPS / DESIGNS / ACCOUNTS | Not specified anywhere. **Change them now if they are wrong** — §0.2 freezes them once data exists. |
| P1-8 | `user_roles_profile_id_idx` is redundant | The unique constraint on (profile_id, role) already indexes profile_id as its leading column. Created because the brief asked for it explicitly; safe to drop. |

**Verification.** `supabase db reset` could not be run — Docker Desktop is not
installed in this environment. The migration and seed were instead executed
against real Postgres 17 (PGlite/WASM) with the `auth` schema shimmed. 28 checks
passed: clean apply, seed idempotency, both enum value lists, the auth trigger
producing exactly one profile holding EMPLOYEE, one profile holding EMPLOYEE and
HOD simultaneously, the `reports_to <> id` constraint, `set_updated_at`, all five
helper functions under two different callers, and cascade on auth user delete.
`npm run build`, `npm run lint` and `npm run typecheck` all pass.

### P2 — Question bank, options, department mapping

**Delivered.** `supabase/migrations/0002_questions.sql` — enums `response_type`,
`question_category`, `question_section`, `answered_by`; tables `questions`,
`question_options`, `department_questions`; both requested indexes. `seed.sql`
extended with the full bank transcribed from the two source forms: **65
questions** (41 STAFF, 10 WORKER, 14 DEPARTMENT), 13 options, 14 department
mappings, 3 conditional links. `types/database.ts` extended to match.

| # | Decision | Why |
|---|---|---|
| P2-1 | `questions` has **no `scale_type` column**, though §5 lists one | The phase brief gave an explicit column list omitting it and adding `min_value` / `max_value` instead. The 0-5 vs three-point distinction is carried by `response_type`, so `scale_type` had nothing left to express. **This is a divergence from §5** — recorded here rather than silently absorbed. |
| P2-2 | The two source forms' differing 0-5 anchors were normalised | The Google form ran *Poor → Outstanding* on two questions and *Very dissatisfied → Outstanding* on the rest. The brief specifies plain `SCALE_0_5` throughout, so §6's fixed labels now apply uniformly. |
| P2-3 | Seed rows get deterministic uuids from `md5('appraise.question.' || key)` | `questions` has no natural unique key and cannot have one: two questions legitimately share the text *"If yes, please specify the details and reasons"*. The seed keys live only in `seed.sql` — they are **not** a schema column — and make the file idempotent. |
| P2-4 | `min_value` / `max_value` left NULL for `SCALE_0_5` and `TICK_3` | Their ranges are fixed by §6. Restating 0-5 in data would create a second place to drift. Only the NUMBER question carries a bound (min 0). |
| P2-5 | `TICK_3` questions get **no** `question_options` rows | §6 fixes the three cells and §5 scopes `question_options` to SINGLE_SELECT / MULTI_SELECT. Putting them in data would invite editing a scale that must not move. |
| P2-6 | `question_options.value` holds a SCREAMING_SNAKE token, not the label | §6 stores "option id". Splitting token from label means a wording fix never invalidates answers already recorded. |
| P2-7 | Three CHECK constraints added beyond the brief | `depends_on <> id` (a self-dependency hangs the renderer), `depends_on` and `depends_value` are both-or-neither (a half-set condition hides a question permanently and looks identical to HR forgetting it), and `max_value >= min_value`. |
| P2-8 | `department_questions_department_id_idx` is redundant | Same as P1-8: the unique constraint already indexes it. Created because the brief asked. |
| P2-9 | Metadata fields from the forms are **not** seeded as questions | Employee/Worker Name, Department, Designation, Date of Joining, HOD/Supervisor Name and Date of Evaluation all live on `profiles` and `evaluations` already. Seeding them would let someone type a name that disagrees with the record. The `METADATA` section enum exists for anything genuinely form-only. |
| P2-10 | The Worker form's salary block is not in the question bank | Old Salary, Increment %, New Salary and the Salary Same/New toggle are §5 `evaluation_decisions` columns, not questions. `Training Required` **is** seeded, since it appears as a tick on the form itself. |

**Verification.** Executed against real Postgres 17 (PGlite/WASM), same harness
as P1 — Docker is still unavailable so `supabase db reset` could not be run.
48 checks passed: both migrations and the seed apply cleanly, the seed is
idempotent across all three tables, section/track/`answered_by` breakdowns are
exact, all three conditionals resolve to the correct parent (including the two
identically-worded ones pointing at different parents), every CHECK constraint
rejects what it should, option labels match the forms verbatim, no CORE question
is department-mapped and every DEPARTMENT question is, and a form-assembly smoke
test yields 36 questions for a Sales STAFF self form (33 core + 3 Sales, zero
MANAGER_REVIEW) and 10 for the worker form. 47 source texts confirmed present
character for character. `npm run build`, `lint` and `typecheck` pass.

**Note.** The source forms are corporate-compliance work (Companies Act, FEMA,
RBI, SEBI). §1 describes the business as LinkD Prints and §7 defines WORKER as
"shop floor / production". If those are two different organisations, the
department list from P1 and the WORKER track may both need revisiting.

### P3 — Cycles, evaluations and the frozen snapshot

**Delivered.** `supabase/migrations/0003_cycles.sql` — enums `cycle_status`,
`evaluation_status`, `rating_layer`, `disclosure_policy`; tables
`evaluation_cycles`, `evaluations`, `evaluation_questions` (the snapshot),
`evaluation_responses`, `evaluation_decisions`; all seven indexes. Assembly layer
in `lib/forms/`: `assembleQuestions`, `snapshotEvaluation`, `getEvaluationForm`,
plus a pure `conditions.ts`. `types/database.ts` extended.

| # | Decision | Why |
|---|---|---|
| P3-1 | **`snapshotEvaluation` is a no-op when a snapshot exists — not an upsert** | This is the phase's central decision. `on conflict do update` would satisfy "no duplicates" while *violating §5*: a re-run after HR edited the bank would rewrite frozen text. `do nothing` is no better — it would append newly-added questions to an evaluation already being answered. Re-freezing is not an operation the system offers. Reopening a layer (§8) unlocks answers, never the question set. |
| P3-2 | `evaluation_questions.depends_on` and the actor columns (`submitted_by`, `decided_by`) are plain uuids, like `question_id` | Same reasoning the brief gives for `question_id`: a reference that must outlive the row it points at cannot be a foreign key. `submitted_by` in particular must survive the actor's profile being deleted (§12 — audit never loses its actor). |
| P3-3 | Snapshot `sort_order` is assigned sequentially across the whole merged form, in steps of 10 | The bank's `sort_order` is per-section and repeats across sections. Re-numbering globally is what lets `getEvaluationForm` reproduce the exact order from `order by sort_order` alone, matching the `(evaluation_id, sort_order)` index. Steps of 10 leave room to splice. |
| P3-4 | `unique (evaluation_id, question_id)` added to the snapshot | Not in the brief. Structural backstop behind "re-running creates no duplicates", and the only thing that stops two concurrent launches racing past the application-level guard. |
| P3-5 | The MD layer is mapped to `EMPLOYEE_AND_LEAD + LEAD_ONLY + MD_ONLY` | §11's override is defined as replacing a *lead* score, so the MD must see everything the lead recorded. Decisive detail: there are currently **zero** `MD_ONLY` questions seeded, so restricting MD to `MD_ONLY` would render an empty form. Revisit when the collision screen is built. |
| P3-6 | `lead_id` and `department_id` are copied onto `evaluations` rather than read live from `profiles` | A reorganisation or transfer mid-cycle must not silently reassign an in-flight review or move an appraisal to a different department. |
| P3-7 | Assembly runs two queries and merges in TypeScript | A single PostgREST call cannot express "CORE **or** mapped to this department" — the embedded `!inner` join needed for the mapping would silently drop every CORE question. |
| P3-8 | Ordering has four keys: section, sort_order, created_at, id | The last two are not padding. Without a total order, the same person could see their form in a different sequence on two page loads. |
| P3-9 | `department_questions.sort_order` wins over `questions.sort_order` for mapped questions | That column exists so one question can sit at a different position per department. They never interleave, since department questions all live in `DEPARTMENT_SPECIFIC`. |
| P3-10 | Three constraints added beyond the brief | `lead_id <> evaluatee_id`, stage deadlines ordered self → lead → md, and `answers`/`comments` must be JSON objects (§5's flat shape, never an array). |
| P3-11 | Select strings are written out in full, never concatenated | supabase-js infers row types from the select at compile time and degrades everything to `GenericStringError` on any string it cannot statically parse. Cost me a build; noted so it is not reintroduced. |

**Finding worth carrying into P4.** A WORKER-track person has **no self form**:
every worker question is `LEAD_ONLY`, because the Worker Performance Appraisal is
a supervisor-filled tick sheet. §8's `CYCLE_ACTIVE → SELF_SUBMITTED` transition
is therefore vacuous on that track and needs an explicit decision — either the
worker path skips the SELF layer entirely, or the transition auto-completes.

**Verification.** Two suites, both executed. Docker is still unavailable, so
`supabase db reset` could not be run.

*Pure logic (31 checks, run directly on Node 24's native type stripping):*
ordering is total and deterministic, `matchesDependency` across booleans,
numbers, arrays, nulls, case and whitespace, `resolveVisibility` including
transitive hiding through a chain, absent parents, and a dependency cycle
terminating instead of hanging. Includes a guard that fails if `SECTION_ORDER`
ever drifts from the `question_section` enum in 0002.

*Schema (30 checks, real Postgres 17 via PGlite):* three departments produce
three different 44-question snapshots with no cross-department leakage; the
WORKER snapshot is 10 TICK_3 questions and no staff scale question; re-running
the snapshot adds nothing and the unique constraint rejects a duplicate outright.
The snapshot rule itself was attacked directly — rewording a question, relabelling
an option, retiring a question and **deleting** one from the bank all left every
snapshot byte-identical, with the deleted question still rendering in the worker's
frozen list. Note the assembly SQL in that suite mirrors `assemble.ts`; it
verifies the schema and the design, not the TypeScript, which is covered above.

`npm run build`, `lint` and `typecheck` pass.

### P4 — State machine, scoring and audit trail

**Delivered.** `supabase/migrations/0004_audit.sql` — `audit_log` with its index,
an append-only trigger, and `apply_evaluation_transition()`. `lib/evaluations/`:
`transitions.ts` (the §8 table + `canTransition`), `guards.ts` (all five guards),
`scoring.ts` (§11), `completeness.ts`, `state-machine.ts` (`transition()`).

| # | Decision | Why |
|---|---|---|
| P4-1 | **The commit is one PL/pgSQL function, not four supabase-js calls** | §12: "Every transition writes an audit_log row. No exceptions." Four round-trips are not a transaction — a crash between the status update and the audit insert leaves a status change nobody can account for. The split: TypeScript decides *whether* (it needs the assembled form, the answers and visibility, none of which belong in PL/pgSQL), the function *commits* — status, layer lock, scores and audit, all or none. |
| P4-2 | The function matches on the expected from-status and raises `serialization_failure` if it has moved | The application reads, decides, then writes. Between read and write someone else may have transitioned. Without this, two leads clicking Return at once would both "succeed" and the second would silently overwrite. |
| P4-3 | `apply_evaluation_transition` is SECURITY **INVOKER** | A definer function would punch straight through P5's RLS. Authorisation stays in `lib/evaluations`. **P5 must give `authenticated` an insert policy on `audit_log`**, or every transition fails at the last step. |
| P4-4 | `audit_log` is append-only by **trigger**, not only by RLS | §12 says no update or delete policy exists for anyone. RLS alone would not deliver that — the service-role client used by cron and notification code bypasses RLS entirely. A trigger holds for every caller. |
| P4-5 | `audit_log.actor_id` has no ON DELETE clause | Per the brief. Consequence worth stating plainly: **once someone has acted, their profile can no longer be deleted** — P1's auth-user cascade now fails for them. In an audited system that is correct (people are deactivated via `is_active`, never erased), but it is a behavioural change from P1. |
| P4-6 | `canTransition` is synchronous and static; guards run only inside `transition()` | It answers "should this button exist" without touching the database. It deliberately does **not** authorise a write — the doc comment says so, because an `allowed: true` from it looks like permission and is not. |
| P4-7 | Actors are roles **and** relationships | §8's "Who" column mixes both. A pure role check would let any HOD in the company return any employee's form; the check is against `evaluation.lead_id`, copied at launch. HR cannot submit on an employee's behalf — §8 does not list them, and the table is exhaustive. |
| P4-8 | A return clears the layer's `submitted_at`, its stored scores **and** the evaluation's overall — but never the answers | §8 says the layer is "unlocked and cleared of submitted_at". Leaving a score on an unsubmitted layer would show a number on the dashboard for a form still being edited. The answers are the whole point of a return: the person edits and resubmits. |
| P4-9 | `0` and `false` are not blank | A required question answered `0` is "Very dissatisfied (Not implemented)" (§6) and `false` is a real answer to "Any missed deadlines?". Treating either as missing would block a fully answered form — the kind of bug people work around by inventing an answer. |
| P4-10 | An out-of-range scale value scores as null, not clamped | A 9 on a 0-5 question is corrupt data. Clamping it to 5 would silently launder bad input into a real score. |
| P4-11 | WORKER section scores come out empty | §11 defines a section score as the mean of **SCALE_0_5** questions, and a worker form has none. The overall is the "Overall Performance" tick via 5/3/1. Per-section TICK_3 analytics can be added later without changing any stored score. |
| P4-12 | `computeFinalScores` writes a resolved value for **every** scored question, not just the overridden ones | §11: "never left null with an implied fallback". Anything downstream computing `override ?? lead` reintroduces exactly that, and would disagree with the stored value the moment the lead layer is returned and resubmitted. |

**Verification.** Two suites, 117 checks, all executed. Docker still unavailable.

*Pure logic (80 checks, run directly on Node):* the §8 table compared row by row
against an independent transcription of the constitution — 7 rows, correct
actors, correct locks/unlocks, both returns requiring a reason, nothing leaving
CLOSED. Then `canTransition` across every legal path and the illegal ones, and
all of §11: means to two decimals, a genuine `0` scoring as 0 while blank scores
as null, the worker tick overall, variance as Lead − Self with the warning and
critical bands moving with the cycle threshold, and `finalScore` including an
override of 0 beating a lead value of 4.

*Schema (37 checks, real Postgres 17):* every one of the seven §8 transitions
driven through the real RPC in sequence, including both returns and a
re-submission after each. Audit rows proved un-updatable and un-deletable. The
atomicity claim was tested directly — a stale from-status left the status
untouched **and wrote no audit row**.

**Acceptance.** All five criteria hold: a blank required question blocks
SELF_SUBMITTED; a lead cannot rate before SELF_SUBMITTED (`WRONG_STATUS`); the MD
cannot finalise before LEAD_REVIEWED; both returns write an audit row carrying
the reason verbatim; every one of the seven transitions has a passing path, and
CYCLE_ACTIVE → MD_FINALIZED, CLOSED → MD_FINALIZED and DRAFT → DRAFT are all
rejected.

### P5 — Row Level Security

**Delivered.** `supabase/migrations/0005_rls.sql` — RLS enabled on all twelve
tables from P1–P4 with 38 policies, six new SECURITY DEFINER helpers, a
column-level guard trigger on `profiles`, explicit grants, and a replaced
`apply_evaluation_transition`. `supabase/tests/rls.sql` asserts the §9 matrix as
five fixtures. Also `app/page.tsx` — a temporary root redirect, because `/` was
404ing and reading as a broken server.

| # | Decision | Why |
|---|---|---|
| P5-1 | **The transition RPC now re-checks §8's actor rules in SQL** | The function is granted to `authenticated`, so any signed-in user can call it through PostgREST with arguments of their choosing. Without this, an employee could move their own evaluation straight to MD_FINALIZED and the TypeScript state machine would never see it. §9: "Client code must never be the only guard." The CASE duplicates `transitions.ts` deliberately; both must change together, and the test suite asserts the SQL half rejects what the TS half rejects. |
| P5-2 | `evaluations` is UPDATE-able only inside a transaction-local GUC window that only the RPC opens | Makes "§8's table is the single write path" a database guarantee rather than a convention. A direct `update evaluations set status = …` from a client silently affects zero rows. |
| P5-3 | The same GUC admits the RPC's writes to `evaluation_responses` and `audit_log` | Locking a layer happens *after* the status has moved, so by then none of the client policies match. Without this the function would deadlock against its own policies. |
| P5-4 | **Deviation from the brief.** The employee is NOT given the MD response row under SCORE_ONLY / SCORE_AND_DECISION | The brief asks for "scores only when disclosure allows". RLS is row-level: admitting that row also hands over its `comments`, which RLS cannot mask, so the employee would receive more than §9 permits. The score they are entitled to already lives on `evaluations.final_overall` and the decision on `evaluation_decisions`, both of which they can read. Nothing is lost and nothing over-discloses. The MD row is admitted only under FULL. |
| P5-5 | **Deviation from the brief.** `evaluation_questions` gets an HR INSERT policy | The brief says "no client writes". Taken literally that also blocks HR snapshotting at launch — the one legitimate write this table receives. HR may INSERT; **nobody** may UPDATE or DELETE, and that absence is what actually enforces §5. Flagged per the brief's own instruction to fix a policy that blocks a legitimate flow and say so. |
| P5-6 | `profiles_guard_self_update` exempts callers with no JWT | Caught by the test suite: as written it blocked `supabase/seed.sql`, every HR provisioning script and all cron work, because `is_hr()` is false when there is no `auth.uid()`. A guard that misfires on migrations is a bug, not strictness. Same idiom as the system actor in the RPC. |
| P5-7 | Helpers are SECURITY DEFINER and RLS is never FORCEd | A policy on `evaluations` calling a function that reads `evaluations` recurses forever. Running as the owner breaks it — but only while the owner is exempt, so `force row level security` must never be added to these tables. |
| P5-8 | HR cannot write `evaluation_decisions` | §9's matrix gives HR *read* on decisions and the MD *write*. Asserted explicitly, because "HR is the admin so HR can do everything" is the obvious wrong assumption. |
| P5-9 | No DELETE policy on `evaluations`, `evaluation_responses`, `evaluation_questions` or `audit_log`, for anyone | §17 forbids deleting a submitted layer, §5 freezes the snapshot, §12 makes audit append-only. Absence of a policy is the enforcement. |
| P5-10 | `audit_log` INSERT is gated on `in_transition(entity_id)` | Per the brief. **P6 note:** §12 also requires audit rows for question-bank edits, role changes and token issue/use, none of which pass through the transition function. Each needs its own gated path — do not widen this policy to "any authenticated user", which would let anyone forge history. |

**Verification.** 67 checks, all passing, on real Postgres 17 (PGlite) with a
Supabase auth shim. Structural: all 12 tables have RLS on and at least one
policy; `audit_log` has no UPDATE/DELETE policy; `evaluations`,
`evaluation_responses` and `evaluation_questions` have no DELETE policy.
Behavioural: 51 assertions from `supabase/tests/rls.sql`, run as five real users
through `set role authenticated` plus a JWT subject — exactly how PostgREST
calls the database.

**The HOD-who-is-also-an-employee case**, tested explicitly as §9 demands: Deepa
sees precisely two evaluations — her own through the evaluatee policy and her
report's through the lead policy — and not a third. She can edit her own
self-evaluation, cannot rewrite her report's self answers, cannot rate that
report before their self-evaluation is submitted, and cannot touch the LEAD layer
of someone who does not report to her.

**Acceptance.** All five criteria hold, each as a named assertion: an employee
sees exactly one `evaluation_responses` row and it is theirs; a HOD sees their
own evaluation and their report's and nothing else; a HOD cannot write the LEAD
layer of a non-report; neither HR nor anyone else can UPDATE or DELETE an audit
row; every assertion in the harness passes.

**Regression.** P2 (48), P3 schema (30), P3 pure (31), P4 pure (95) and P4 schema
(42, now including four new RPC-authorisation checks) all still pass. `npm run
build`, `lint` and `typecheck` pass.

### P6 — Auth, invite tokens and route guards

**Delivered.** `supabase/migrations/0006_invites.sql` — `invite_tokens` with RLS
and four SECURITY DEFINER functions. Email-OTP sign-in at `/login` (no
passwords). `lib/auth/`: `invite-token.ts` (pure crypto), `invites.ts`,
`guards.ts`, `landing.ts`, `actions.ts`. `middleware.ts`. The `(public)` area —
login, `/invite/[token]`, a code screen and six outcome pages — and the `(app)`
area: shell, ten guarded routes, and `/my-evaluation/[id]` where an invite lands.

| # | Decision | Why |
|---|---|---|
| P6-1 | **The token appears in exactly one URL and is gone by the next hop** | §10 puts the token in the path. Every outcome — the code screen, all six error pages, the evaluation itself — is reached by `redirect`, so the token never reaches a Referer header, browser history beyond that hop, or an analytics query string. The invite id then travels in an httpOnly cookie, never the URL. |
| P6-2 | The invite cookie holds the **invite id**, not the token | Once verified the secret has done its job. Keeping it alive for the code screen would extend its life for no benefit. |
| P6-3 | `verify_invite_token` returns the recipient's email; the browser only ever sees it masked | The server must send an OTP to an address the holder has not typed, and §10 forbids the email in the URL. It comes back server-side and `maskEmail` renders `p•••a@domain`. |
| P6-4 | The hourly rate-limit window is derived from `audit_log`, not a second column | §12 already requires "every token issue/use" be logged, so the timestamps for a genuinely rolling window exist for free. `attempt_count` stays a lifetime counter. Proven by the fact the window could not be aged in a test — the append-only trigger refused. |
| P6-5 | `consume_invite_token` re-checks the session against the invite's `profile_id` | Otherwise anyone signed in could burn someone else's link by opening it. Wrong recipients get their own page and an audit row, and the link stays unused. |
| P6-6 | Verification lives in SECURITY DEFINER functions; no client ever selects `invite_tokens` | Storing only hashes is pointless if the hash table is readable. RLS grants SELECT to HR alone, and even HR cannot UPDATE or DELETE — so a token cannot be un-revoked or its counter reset to defeat the rate limit. |
| P6-7 | Sign-in gives the same reply whether or not the address exists, and `shouldCreateUser: false` | Accounts are created by HR (§9). A distinguishing error would turn the login form into a staff directory. |
| P6-8 | **A lead's landing page is their own evaluation, not /team** | The brief asks for this explicitly and it is right: a HOD is also an employee, and landing them on /team quietly makes their own appraisal — the one task the system exists to get done — something they must go looking for. The team link sits in the sidebar instead. |
| P6-9 | `export const dynamic = "force-dynamic"` on the `(app)` layout | Caught by the build: authenticated pages were being prerendered. Every page there is per-person data behind a guard; a statically generated one is built with no session, and a cached one risks serving one user's page to another. It also keeps `next build` from needing real credentials. |
| P6-10 | `requireRole` moved from `roles.ts` to `guards.ts` | Two implementations of "may they" is how the two drift apart. The guards version redirects, which is what a page needs; `checkRole` is the non-redirecting variant for Server Actions (§14). |
| P6-11 | `requireEvaluationAccess` reads through the authenticated client | RLS answers "may they see this row" before any logic runs, so a row they cannot see is indistinguishable from one that does not exist. Distinguishing them would turn the guard into an oracle for who is being evaluated. |

**Known warning.** Next 16.3 deprecates the `middleware` file convention in
favour of `proxy`, and prints a notice on every build. The file is named
`middleware.ts` because the phase brief names it; migrating is
`npx @next/codemod@canary middleware-to-proxy .` whenever you want the notice
gone.

**Not in this phase.** Delivery over WhatsApp and email — `issueInviteToken`
returns the link, but Maytapi, Resend and `notifications_log` (§10's second half)
are still to come, as is HR's distribution screen.

**Verification.** 66 checks, all passing, on real Postgres 17 plus direct
execution of the pure modules. §10's requirements were tested as requirements:
only the SHA-256 hash is stored and the plaintext appears in no column; the token
is 32 base64url bytes with no character that could be mangled in transit; expiry
is `self_due_on + 7 days`; resending revokes the previous link for that channel
while leaving other channels alone; the tenth attempt is served and the eleventh
is locked; attempts older than an hour fall outside the window; and our SHA-256
agrees with the digest the database compares against — for a fixed token and a
freshly generated one. No audit row contains a plaintext token.

**Acceptance.** All five hold: a valid link signs in and lands on that one
evaluation, with `/my-evaluation/[id]` re-deriving access from who the person is
rather than from the spent token; a second use reports USED; an expired link
reports EXPIRED and shows DESIGN.md §8's "ask HR to send you a fresh one"; no
token, hash or email is ever placed in a query string or an audit row; and
`/admin` redirects an employee from the guard as the page's first statement, so
no markup is produced to be hidden afterwards.

**Regression.** P2 (48), P3 (30 + 31), P4 (42 + 95), P5 (67) all still pass.

### P7 — Application shell and shared components

**Delivered.** `components/appraise/`: `RatingScale`, `TickScale`, `TierBadge` +
`TierLegend`, `StatusChip`, `ProgressRail`, `SectionCard` + `QuestionRow`,
`ScoreStat` + `DeltaChip`, `EmptyState` / `ErrorState` / `TableSkeleton`,
`AutosaveIndicator`, plus `tier.ts` (the reserved palette and the §6 label text)
and `nav-config.ts`. Shell rebuilt to §7: 248px rail, 56px topbar, 1180px content
cap, sheet below 1024px. `lib/utils/date.ts` for §0.10 formatting. `/styleguide`
now renders every component in every state.

| # | Decision | Why |
|---|---|---|
| P7-1 | **Tier class strings are written out in full in `tier.ts`, never interpolated** | Tailwind scans source statically — `bg-${tier}-tint` compiles to nothing. The verbosity is not boilerplate: it is what makes it impossible to apply a reserved tier colour by accident, which is DESIGN.md §2's whole signature. A grep confirms amber, blue and emerald appear nowhere outside `components/appraise`. |
| P7-2 | RatingScale is a radiogroup with a **roving tabindex**, not six buttons | Six tab stops per question makes a 28-question form 168 stops. A rating is one choice among six: arrow keys move within it, Tab carries on to the next question. |
| P7-3 | `preventDefault()` fires only after the key is known to be ours | Calling it up front would swallow Tab and Shift+Tab and turn the form into a keyboard trap — the failure mode that makes a form unusable for exactly the people who most need it to work. |
| P7-4 | The §6 label text lives in `tier.ts` and is asserted against CLAUDE.md itself | The test parses the label block out of the constitution rather than restating it, so the two cannot drift in either direction. §6 says "fixed wording — do not paraphrase". |
| P7-5 | The mobile legend is permanent, not a hover affordance | §6.1 wants the full label on selection *and* on hover. There is no hover on a phone, so below `sm` the entire legend stays visible rather than the wording being unreachable. |
| P7-6 | StatusChip carries **two vocabularies** | §8: "Never show an employee ... a raw status enum. Employees see: In progress · Submitted · Under review · Completed." So `audience="employee"` collapses LEAD_REVIEWED and MD_FINALIZED into "Under review" — whether the MD has finalised is not the employee's business until disclosure. ProgressRail takes the same prop. |
| P7-7 | ProgressRail shows five nodes, and its first and last are **not** tier colours | §6.6 asks for five, so DRAFT — which is before the employee is involved — is off the rail. "Cycle active" and "Closed" belong to no tier, so they take accent and ink-muted; borrowing amber for "in progress" would break §2. |
| P7-8 | The selected cell's 1.5px tier border is rendered as a ring | A 1.5px border would shift the cell half a pixel relative to its unselected neighbours, and six cells in a row make that visible as a jitter when the selection moves. |
| P7-9 | `ScoreStat` renders an absent score as an em dash, never `0.00` | §11 is explicit that missing is not zero. A dashboard showing 0.00 for an unstarted appraisal is the kind of thing people escalate about. |
| P7-10 | `SectionCard` sets `print:break-inside-avoid` itself | §13.7 makes print a first-class output; a section splitting across two sheets is the commonest way a signature-ready document stops being one. Better on the component than remembered per print route. |
| P7-11 | The role indicator excludes EMPLOYEE from its count | §7 says show it "only if the user genuinely holds more than one role". Everyone holds EMPLOYEE, so counting it would put a badge on every screen and teach people to ignore it. |
| P7-12 | Menu labels come from one config consumed by rail, sheet, active-state and topbar title | A link that renders but redirects reads as a permissions bug. The labels are exactly as the brief specifies and a test asserts the list character for character. |

**Also fixed.** `/login` crashed with a stack trace when `.env.local` was absent.
Missing credentials is the one failure every developer hits on first run, and it
has a specific fix — it now renders a setup screen naming the two keys. `§0.7`
says fail loudly, and a Next.js error overlay is not loudly, it is
incomprehensibly. `.env.local` is now created from the template.

**Verification.** 51 checks executed directly, plus the acceptance audits.
The §6 labels are compared against the constitution's own text; menu labels
against the brief's list; TickScale is proven to carry no numeric field, import
no analytics mapping and render no bare numeral (§6.2); §0.10 formatting is
checked for DD-MM-YYYY, 24-hour Asia/Kolkata, ₹ with lakh grouping, and em
dashes for absent values. Greps confirm **no raw hex and no `font-family`
anywhere in `app`, `components` or `lib`**, and that the three tier colours
appear nowhere outside the tier components and the styleguide.

**Regression.** P2 (48), P3 (30 + 31), P4 (42 + 95), P5 (67), P6 (66) all pass.
`npm run build`, `lint` and `typecheck` pass.

### P8 — Password auth, user management, and the question bank

**Two constitution amendments, both at the owner's explicit instruction.** §2's
auth row now reads email + password instead of email OTP, and §0.5 permits the
service-role key for the one Admin API call that creates an auth account.

**Delivered.** Password sign-in at `/login`; the invite flow hands off to it and
returns via `/invite/consume`. Settings gains a **Users** tab where HR creates
people (name, email, department, password, access level) and deactivates them.
`supabase/migrations/0007_admin_audit.sql` adds `log_admin_action`. The question
bank at `/admin/questions`: TanStack table with five filters, a create/edit
**drawer** with inline option editor, conditional-question control and a live
preview built from the real `RatingScale` and `TickScale`, section reordering,
and retire-with-impact.

| # | Decision | Why |
|---|---|---|
| P8-1 | Auth changed to email + password | Instructed. §2 amended rather than quietly diverged from. The consequence worth noting: an invite link can no longer sign someone in by itself, so `/invite/[token]` now redirects to `/login?next=/invite/consume` and the invite id rides an httpOnly cookie across the hand-off. The token still appears in exactly one URL and is never re-shown (§10). |
| P8-2 | Only `auth.admin.createUser` uses the service-role key | There is no other way to create an account. The profile update and role grants go through the **authenticated** client, so RLS decides whether that HR user may write them — a bug in the TypeScript guard cannot quietly hand somebody MD access. |
| P8-3 | EMPLOYEE is granted to everyone and cannot be unticked | There is no user of this system who does not fill in their own appraisal. HOD and SUPERVISOR are granted *in addition*, which is §9's simultaneous-roles case made visible in the UI. |
| P8-4 | HR cannot deactivate their own account | Locking the last admin out is a support call the database cannot undo. |
| P8-5 | `log_admin_action` is the second gated audit path P5-10 predicted | §12 wants audit rows for question-bank edits and role changes; 0005's insert policy admits only the transition function, and widening it would let anyone forge history. This is SECURITY DEFINER, re-checks HR itself, and **takes the actor from the session, never the arguments** — an audit row that lets you choose who did it is not an audit row. |
| P8-6 | Reorder is up/down buttons, not pointer drag | The brief says drag handle. Buttons work by keyboard and on a phone; a pointer-only drag would fail §9's keyboard requirement and §13.2's mobile-first rule on the one screen where HR is most likely to be on a laptop trackpad. The handle is still shown on option rows for affordance. |
| P8-7 | Retiring shows the department **names**, not a count | "Used in 3 departments" makes HR go and look. Naming MIS, Sales and Operations lets them decide on the spot. |
| P8-8 | Zod schemas and `ACCESS_LEVELS` moved to `lib/auth/schemas.ts` | Caught by the build: a `"use server"` module may only export async functions, and exporting a Zod object from one fails at collect-page-data with a message that does not name the offending export. |
| P8-9 | The drawer form is **keyed**, not effect-synced | The React compiler rule flagged syncing props into state in an effect. Remounting on `question.id` gives correct initial state with no cascade and no staleness when two opens race. |

**Verification.** 40 checks. The acceptance criterion that matters most was
tested by attacking it: with a launched evaluation in place, HR reworded a
question, renamed an option, retired a question, reordered a whole section and
added a new one — then the snapshot was compared by **md5 fingerprint over every
field** and came back byte-identical, with the new question absent and the
reworded text nowhere in it. Plain language is checked both ways: every
`response_type` in the database has a label, no label is an enum value, and the
three UI files render no enum and name no table. Every server action is asserted
to call `checkRole(["HR_ADMIN"])` as its first statement.

**Regression.** P2 (48), P3 (30 + 31), P4 (42 + 95), P5 (67), P6 (66), P7 (51)
all pass. `npm run build`, `lint` and `typecheck` pass.

**Known warning.** `useReactTable` trips React Compiler's
`incompatible-library` advisory. It is a warning, not an error — TanStack
returns functions the compiler will not memoize, so it skips memoizing that
component. No action needed unless memoized values are passed down from it.

### P8-PATCH — Single-form model, and the company name

**Company name corrected** throughout: LD Silk Mills → **LinkD Prints**, in both
constitution files, the shell, the auth pages, metadata and the email
placeholders.

**Delivered.** `supabase/migrations/0008_single_form.sql`, `lib/forms/labels.ts`
(the single section-name and section-order map), and the question bank UI
aligned to the single-form model.

| # | Decision | Why |
|---|---|---|
| P8P-1 | `DEPARTMENT_SPECIFIC` is untouched; only its **label** changes | It is the stored value in `questions.section` and in every frozen `evaluation_questions` row. Renaming the enum would rewrite history in every launched evaluation, and §0.2 fixes enum values once created. `lib/forms/labels.ts` is where the distinction lives: what the database calls a thing and what a person calls it are allowed to differ, and only one is safe to change. |
| P8P-2 | Render order lives in TypeScript, not the enum | The required order puts Job Specific Skills fourth; the enum declares it seventh. Reordering a Postgres enum means dropping and recreating the type. Every renderer sorts through `sectionRank`, never `order by section` — the P3 suite's SQL mirror was updated to match, and its assertion now reads the snapshot's real `sort_order` instead of the enum's. |
| P8P-3 | Worker questions are **retired**, and their original track is written to `audit_log` first | Acceptance demands both "deactivated, not deleted" and "no core question has track WORKER" — which together would erase the fact that they *were* worker questions. Writing `question.retired_to_worker_module` with the before/after track keeps that in the one place built for it (§12). |
| P8P-4 | A CHECK constraint enforces the module boundary | §5 says never write a WORKER row into a core evaluation table. A constraint makes that structural rather than a rule someone has to remember. |
| P8P-5 | The category picker was **removed** from the drawer | §1 makes the section and the category the same decision: Job Specific Skills *is* the department-varying section. Two controls that must agree are two controls that will eventually disagree, so choosing the section now sets the category and reveals the department picker inline (P8-PATCH.9). |
| P8P-6 | Department mappings are replaced wholesale on save, not diffed | Unticking a department has to actually remove it. A diff-based update leaves stale mappings that keep asking a department a question HR believes they have taken away. |
| P8P-7 | Seeding only fills departments with **zero** Job Specific Skills questions | Per the brief. It means a department HR has curated is never overwritten, and re-running the migration changes nothing. |

**Open.** Accounts has **2** Job Specific Skills questions; the brief's sets say
three to five each. Because instruction 7 scopes seeding to departments with
*none*, Accounts was skipped. A third question (`dept.accounts.payment_cycle`,
"Payment cycle and vendor reconciliation") sits in the migration's list ready to
land if Accounts is ever emptied — say the word and it can be inserted directly
instead.

**Verification.** 30 checks on real Postgres 17: the enum still has all eight
values with `DEPARTMENT_SPECIFIC` intact, no row was deleted, no core question
carries track WORKER, the constraint rejects a new one, every DEPARTMENT
question is correctly filed and answered by both layers, every department has at
least one, the migration is idempotent, all eight labels match the brief exactly,
and a walk of every file under `app/` and `components/` proves no component
restates a section name.

**Regression.** P2 (48), P3 (30 + 33), P4 (42 + 95), P5 (67), P6 (66), P7 (51),
P8 (40) all pass. `npm run build`, `lint` and `typecheck` pass.

### P9 — Departments and Job Specific Skills mapping

**Delivered.** `/admin/departments` (list with headcount, question count and a
zero-questions flag, create/edit drawer) and `/admin/departments/[id]` (two-pane
mapping, preview, copy). `lib/departments/actions.ts`, `lib/forms/preview.ts`,
and **`components/appraise/form-renderer.tsx` — the single form renderer**.

| # | Decision | Why |
|---|---|---|
| P9-1 | **One renderer, enforced by a test that greps for a second one** | The brief forbids a second renderer, and the test that checks it caught a real violation: P8's `question-preview.tsx` was branching on `responseType` exactly as `FormRenderer` does. It now builds a one-question `FormDefinition` and hands it to the shared component. A preview is just a FormDefinition with one question in it — everything else follows. |
| P9-2 | `assembleQuestions` was split, with `assembleForDepartment` underneath | The preview needs a form for a *department*, the real thing needs one for a *person*. Reimplementing the merge for the preview would let the two drift, and the drift only surfaces once a cycle is live. `assembleQuestions` now resolves a profile to a department and delegates. |
| P9-3 | `previewFormForDepartment` returns the identical `FormDefinition` shape as `getEvaluationForm` | That shape equivalence is what lets one component draw both. The only difference is the source: live bank versus frozen snapshot (§5) — which is exactly what makes one a preview and the other a record. |
| P9-4 | Conditional children are **shown** in the preview, not hidden | HR is reviewing a question set, and a question that would never appear because nobody has answered its parent is the one they most need to see. |
| P9-5 | Reorder is up/down buttons, not pointer drag | Same as P8-6. The brief asks for drag with a keyboard alternative; buttons are the keyboard path and work on a phone, so they are the primary control rather than a fallback. |
| P9-6 | Copy is strictly additive | Nothing the target already asks is removed or reordered. A "copy" that silently reshuffled a curated department would be the kind of thing HR discovers a cycle later. |
| P9-7 | The zero-questions flag appears on the list, the card and the detail header | A department with no Job Specific Skills questions cannot be launched — every employee in it would get an empty section. HR decides readiness from the list, so the flag has to be there, not only on the page they might not open. |
| P9-8 | "Available" shows which other departments already ask each question | Reuse is normal and worth encouraging: a question three teams already trust is a better choice than a fourth variation of it. |

**Verification.** 39 checks. The two that matter were tested by construction:
mapping a question to Sales left every non-Job-Specific question byte-identical
between the Sales and MIS forms while only Sales' Job Specific Skills changed;
and with an evaluation launched, deleting **every** Sales mapping left the frozen
snapshot byte-identical by md5 fingerprint. Plus: all four actions are
HR-guarded and audited, an employee's delete affects nothing, copying twice
cannot duplicate a mapping, and a walk of every `.tsx` under `app/` and
`components/` proves exactly one file renders a form.

**Caught by an older suite.** The P8-PATCH check "no component restates a section
name" failed on new P9 code — the detail page's `metadata.title` was the literal
string. Now sourced from `SECTION_LABELS`, because "every screen, preview, export
and print route" includes the browser tab.

**Regression.** P2 (48), P3 (30 + 33), P4 (42 + 95), P5 (67), P6 (66), P7 (51),
P8 (40), P8-PATCH (30) all pass. `npm run build`, `lint` and `typecheck` pass.

### UI-REFRESH — the Modern SaaS design system, applied

Appearance only. No route, query, server action or piece of business logic
changed, and the full 541-check regression confirms it.

**Delivered.** Token layer completed (`shadow-dashboard`, `rounded-input`, the
`.card-enter` stagger). Every hard card border removed in favour of
`.card-surface` — 16px, borderless, soft shadow. Sidebar rebuilt as a white
edge-to-edge panel with icons and a `primary/10` active tint. Topbar gained
search, a notification bell and the avatar. New `MetricWidget`, `DashboardCard`
and a Recharts layer (`charts.tsx`). `/dashboard` built as a real grid.
`/styleguide` extended to every state.

| # | Decision | Why |
|---|---|---|
| UI-1 | Chart colours are `rgb(var(--token))`, not hex | Recharts needs a resolvable colour string rather than a Tailwind class, and §2 still forbids a hex in a component. The tier colours are deliberately **absent** from `CHART_COLORS`: a series tinted like a tier would claim to mean "who said this" (§13.1). A collision chart passes them explicitly. |
| UI-2 | Green is the trend colour, never a tier | The trend pill is green-up / red-down. That is the one place green carries meaning, which is exactly why it is not a tier — a green that also meant "the MD said this" would make every good delta read as a final score. |
| UI-3 | The active nav item is a `primary/10` fill with primary text, and the 2px left bar is gone | §6 asks for a soft tint with coloured text. The fill *is* the signal; a bar as well is two signals for one state. |
| UI-4 | Tinted alert blocks and the dashed empty state keep their borders | They are notices, not cards. A critical-tint block with a `critical/40` border is §5.3's pill pattern scaled up; the dashed border on an empty state is a deliberate "nothing here yet" affordance. Every actual **card** is borderless. |
| UI-5 | The `prefers-reduced-motion` override lives **outside** `@layer components` | It was nested inside the layer first time and silently vanished from the compiled CSS — the layer cascade reorders nested media queries. Caught by grepping the built stylesheet rather than trusting the source. |
| UI-6 | `animation-fill-mode: backwards` on the stagger | Without it, a delayed card renders at full opacity for its delay and then jumps back to the start of the animation — the stagger looks like a flicker. |
| UI-7 | The dashboard adds read-only queries | Task 14 asks for metric widgets and charts, and a metric widget with no metric is not a design. All counts go through the authenticated client, so RLS decides what each person sees — an employee's dashboard is naturally their own slice. No mutation and no new server action. |
| UI-8 | Topbar search is presentational | Wiring it to a real query is a feature, and this phase changes appearance only. |

**Verification.** All acceptance criteria checked mechanically: no hex, no
`font-family`, no hardcoded radius anywhere in `app/`, `components/` or `lib/`;
no bordered cards remain; one font family (`--font-sans`, Inter). The compiled
stylesheet was inspected directly and carries all 18 §2 tokens, the seven-step
type scale with line-height and tracking baked in, `--radius-control: 8px`,
`--radius-card: 16px`, the focus ring on `accent-primary`, `.tabular`, and both
halves of the entrance animation.

---

### P10 — Evaluation cycles at `/admin/cycles`

Migration `0009_cycle_launch.sql`. `lib/cycles/{schema,validate,launch,queries,actions}.ts`.
Screens: the list, the four-step wizard (`/new`, reused at `/[id]/edit`), and the
status board (`/[id]`). New components `StatTile`/`HeroCard`, `SegmentedProgress`,
and `StepRail`.

| # | Decision | Why |
|---|---|---|
| P10-1 | **Participants are DRAFT evaluations.** No `cycle_participants` table | §8's first transition is `DRAFT → CYCLE_ACTIVE`, so the evaluation row must exist before it can be transitioned. The roster HR builds in step 3 *is* the set of rows launch moves. There is no moment where a participant list and the evaluations can disagree, and §0.4 stays intact — no invented schema. |
| P10-2 | The launch write is one PL/pgSQL function; the questions are assembled in TypeScript and passed in as JSONB | Atomicity and one-assembly-path pull in opposite directions. A TS loop of 47 × 3 PostgREST calls cannot roll back; reimplementing `assembleForDepartment` in SQL would give two merge algorithms that must agree forever, and a snapshot is frozen for years. So the split mirrors P4's: **TypeScript decides, SQL commits.** |
| P10-3 | Assembly is cached per `(department, track)`, not per person | Every staff employee answers the same form and only Job Specific Skills varies, so two people in Accounts assemble identically by construction. 47 people across 6 departments become 6 assemblies — and everyone in a department provably freezes the *identical* set even if the bank is edited mid-loop. |
| P10-4 | `launch_cycle` is SECURITY DEFINER with an internal `is_hr()` gate | It writes empty SELF rows for other people. No RLS policy admits that and none should: "HR may insert a SELF row for anybody" would also let HR pre-fill somebody's self-assessment. The capability goes to one narrow audited function instead of to a policy — the same pattern as `log_admin_action` (0007). |
| P10-5 | The payload must cover **every** live participant, re-counted server-side | A caller that omitted somebody would launch a cycle that permanently excludes them with no record. Trusting the client's list is the same mistake as trusting its readiness. |
| P10-6 | Withdrawal is `excluded_at`/`excluded_reason`, **not** a status | An eighth `evaluation_status` would mean re-deriving every guard, policy and board column from §8. Routing an abandoned evaluation to CLOSED is worse — §8 reaches CLOSED only from MD_FINALIZED, so it would sit in the "finalised" cohort of every report for ever. An exclusion is not a state of the evaluation; it is whether the organisation is still asking for it. |
| P10-7 | `evaluations_lead_not_evaluatee` dropped | P10 warning 7 requires a self-led participant to be *reachable* and flagged. Leaving the constraint would make the warning dead code — `setCycleParticipants` would fail with a raw constraint violation instead. A department head has nobody above them in this module; the MD layer is still the second opinion. **Reversal of a 0003 decision — flagged deliberately.** |
| P10-8 | Deleting a launched cycle is blocked by a trigger, not by the action | `evaluation_cycles` cascades to `evaluations` cascades to `evaluation_questions`. One stray DELETE would take every frozen snapshot in the cycle with it, which is the single thing §5 exists to prevent. That guard belongs in the database. |
| P10-9 | The launch dialog's progress is stage-based, not per-person | The write is one transaction, so there is no per-person progress to report without breaking the atomicity that makes it safe. The three stages are the three real phases of the action; the last is indeterminate rather than inventing a percentage. |
| P10-10 | Cohort question counts read `evaluation_questions`, not the live bank | The card answers "did this department launch thin?" Reading the bank would show what is mapped *today* — precisely the number that cannot be trusted after an edit (§5). |
| P10-11 | Dialog state resets by keyed remount, not by an effect | Third time this pattern has come up (`ColorSwatch`, `QuestionForm`, now four dialogs). A reset effect is the cascading-render pattern the React compiler rejects, and a remount states the intent better: this is a new form, not the old one wiped. |
| P10-12 | ⚠ **"Reopen" is not implemented — §8 conflict, unresolved** | P10's row menu lists "Reopen (HR only)". §8 gives the two return transitions to the **lead** (`SELF_SUBMITTED → CYCLE_ACTIVE`) and the **MD** (`LEAD_REVIEWED → SELF_SUBMITTED`); HR is on neither row, and `apply_evaluation_transition` enforces that table in the database. §0 says this file wins and to stop and ask. The action returns the explanation and the menu item renders disabled with the same sentence. **To enable: amend §8 to add HR_ADMIN to the two return rows, then add HR to the CASE in `apply_evaluation_transition`.** That is a Constitution change and belongs in a prompt. |
| P10-13 | Lead-reassignment notifications are **not sent** | §5 puts every send in `notifications_log`, which does not exist until the P11 dispatcher. Writing to a missing table would fail and inventing it would breach §0.4. The reassignment commits and audits now; the two names come back so the screen tells HR who to inform by hand. |

**Verification — 53 checks, all against real Postgres.** 47 people → 47
evaluations, 47 distinct snapshots, 47 evaluation audit rows + 1 cycle row, 47
empty SELF rows, all reached through `apply_evaluation_transition` (proved via
the recorded `from_status`/`to_status`). The snapshot rule was attacked:
rewording, retiring and deleting from the bank after launch left the md5
fingerprint of a frozen snapshot **identical**. A forced failure at participant
25 of 47 left **zero** snapshot rows, zero response rows, zero audit rows, zero
advanced evaluations and the cycle still DRAFT. An unmapped department blocks
the launch with a message naming it. A WORKER participant blocks it. A second
launch names who launched first. A launched cycle cannot be deleted.

Full regression: **594 checks across 12 suites, 0 failed.** Typecheck 0, lint 0
errors, build clean.

---

### P11 — Distribution: WhatsApp and email links

Migration `0010_notifications.sql`. `lib/notify/{phone,maytapi,email,templates,dispatch,queries,actions}.ts`.
Screen `/admin/cycles/[id]/distribute` with a history drawer. The status board's
"Send links" button and row "Resend link" are now wired to it.

| # | Decision | Why |
|---|---|---|
| P11-1 | **Migration is `0010_`, not the brief's `0007_`** | 0007 is `0007_admin_audit.sql` and has been applied. §0.8: numbering is sequential and an applied migration is never edited. Renumbered, not renamed. |
| P11-2 | **The token never reaches `notifications_log`, and a CHECK enforces it** | §10 stores only the SHA-256 hash and returns the plaintext once. `payload` is jsonb and is exactly where somebody would eventually drop a rendered message body containing the link. The constraint refuses any payload or recipient matching `/invite/` or a 40+ char token shape, and `settle_notification` refuses a provider response carrying one — providers echo request content back in error strings more often than is comfortable. dispatch.ts never offers one in the first place; the constraint is the backstop. |
| P11-3 | `notifications_log` has a SELECT policy and **no insert or update policy for anyone** | The brief says "inserts happen server-side only". Absence of a policy is what enforces that: `queue_notification` and `settle_notification` are the only write path, they are SECURITY DEFINER, and they take the actor from the session. Same pattern as `log_admin_action` (0007) and `launch_cycle` (0009). |
| P11-4 | `sent_by` added beyond the brief's column list | The brief also requires "200 sends per hour per HR user", which cannot be counted without knowing whose sends they were. Flagged rather than absorbed. |
| P11-5 | The rate limit lives in the database function, not the action layer | It is the chokepoint every send passes through — single, bulk and retry-all. A limit in TypeScript would be bypassed by the next caller that forgot it. Rolling hour, not clock hour: a fixed window allows 200 at 10:59 and 200 more at 11:01. |
| P11-6 | The QUEUED row is written **before** the provider is called | If the process dies mid-send, the evidence that an attempt was made survives. A row written afterwards loses exactly the sends most worth knowing about. |
| P11-7 | Resend over `fetch`, not the `resend` SDK | §2 names the provider, not the client, so the SDK would be permitted. It is not used because §10's timeout-and-one-retry semantics apply equally to both channels, and the SDK hides the response behind its own error shape. One retry policy, written once, for both. No new dependency. |
| P11-8 | Credentials are read at call time, not at module load | The brief asks for a throw at module load. Next evaluates modules during `next build`, where missing keys are normal, so that would fail the build on any machine without credentials. The check happens on first use and returns `NOT_CONFIGURED` — §0.7's "fail loudly" is satisfied by the message reaching HR's screen, and the screen states it once up front rather than as 47 identical failures. |
| P11-9 | **There is no DELIVERED anywhere in the system** | Maytapi accepting a message is not WhatsApp delivering it; a number not on WhatsApp is reported later on a webhook we do not consume. The chip says Sent. A test asserts the string appears in no source file. |
| P11-10 | `OPENED` comes from `invite_tokens.used_at`, not a tracking pixel | Token consumption means a person followed the link and signed in. That is evidence; an image load is not, and a pixel in an HR email is the kind of thing that erodes trust in the whole system. |
| P11-11 | A bad phone number is **not** logged as a failed send | A `notifications_log` row means an attempt was made. Nothing was attempted, and the screen already shows the specific reason on the contact column before anybody presses send. Logging it would inflate the failure count with rows no retry can fix. |
| P11-12 | `normaliseToE164` returns a structured reason, never null | "Invalid" is not actionable when HR is looking at 47 rows. A landline and a 9-digit typo need different fixes, so `TOO_SHORT`/`AMBIGUOUS_COUNTRY`/… each carry their own sentence into the row's tooltip. |
| P11-13 | Bulk progress is driven one person at a time from the client | The action is sequential and paced 300ms internally. Calling it per person is what makes the progress bar real rather than an animation — and one failure never stops the run, because each person is a separate call whose outcome is collected either way. |
| P11-14 | The email palette is the one place a hex literal lives outside `globals.css` | Email clients cannot read a CSS custom property and roughly half strip `<style>` entirely, so every colour must be an inline literal. The values mirror DESIGN.md §2 and say so; they cannot be derived across that boundary. |
| P11-15 | The email card uses the brief's 26px radius | DESIGN.md §4 has 16px and 20px and no 26px step. The brief is specific about its own surface, so 26px is used there and only there, noted so it does not read as a stray value. |
| P11-16 | Templates sign off **LinkD Prints** | The brief's example text says "LD Silk Mills", which is the name P8-PATCH corrected throughout. Not reintroduced. |

**Verification — 66 checks.** The pure normaliser is exercised directly: nine
accepted spellings of one number all yield `+919876543210`, and thirteen refusals
each return the *right* reason, including two landlines and two foreign numbers.
On real Postgres: RLS on with a SELECT policy and no insert/update/delete policy;
the queue → settle round trip; a settled row cannot be re-settled, so the first
outcome stands; `DELIVERED` is rejected outright. §10 was attacked directly — a
payload carrying an invite link, a payload carrying a bare 43-character token, a
recipient carrying a link and a provider error echoing one are all refused, and
the table is asserted to contain no link. The 201st send in an hour is refused
with a readable message, and sends aged past the hour stop counting. Source-level:
no credential-shaped literal anywhere, only `dispatch.ts` imports a provider,
all three modules are `server-only`, no message string exists outside
`templates.ts`, and `.env.example` carries all five keys blank.

Full regression: **660 checks across 13 suites, 0 failed.** Typecheck 0, lint 0
errors, build clean.

**Not done, and needs saying.** `RESEND_API_KEY` is empty in `.env.local`, so
email will return `NOT_CONFIGURED` until a key is added — the screen says so
rather than failing per row. The reminder, overdue, lead-review, returned,
finalised and closed templates are written and tested but nothing calls them
yet: they belong to the cron/scheduler phase and to the P12–P14 screens that
raise those events.

---

### UI-2 — Dark theme, collapsible rail, full-bleed dashboard

Appearance and shell only. No route, query, server action or business rule
changed, and the 660-check regression confirms it.

**Two DESIGN.md rules were changed at the owner's explicit instruction**, and
DESIGN.md was amended rather than quietly diverged from:

- §2 shipped **light-only for v1**. Both themes now ship.
- §6 specified a **white sidebar**. The rail is now Slate Navy (#1E293B).

**Delivered.** Dark theme as a full token re-map plus `--sidebar-*` as its own
family; `components/appraise/theme.tsx` (pre-paint script, theme toggle, rail
toggle); the collapsible navy rail; a glass topbar; `data-full-bleed`; three new
chart types (`RadialGauge`, `StackedBarChart`, `RankedBarChart`); a rebuilt
dashboard grid.

| # | Decision | Why |
|---|---|---|
| UI2-1 | **No `next-themes`.** ~40 lines instead | §17 forbids a dependency outside §2 and that rule did not change with the theme decision. State is two attributes on `<html>`: `data-theme` and `data-rail`. |
| UI2-2 | A render-blocking inline script applies both **before first paint** | React cannot do this. Markup is streamed and hydrated after the browser has painted, so a theme applied in an effect arrives a frame late — a dark-theme user gets a full-brightness flash on every navigation, and a collapsed rail makes the whole layout jump. |
| UI2-3 | Dark is a **re-map, not a second palette** | Every token keeps its role, so no component knows which theme it is in. Adding a parallel set of names would mean every component choosing between them, which is how the two drift. |
| UI2-4 | `.card-surface` swaps its shadow for a hairline in dark | A soft shadow against a dark ground is invisible, so the card would merge into the canvas. Same job — separating card from ground — done by the tool that works there. |
| UI2-5 | The rail gets its own `--sidebar-*` token family | It is the one region whose foreground does not follow the page. Without separate tokens somebody writes `text-ink` inside it and gets charcoal on navy — and it looks fine in dark, so it ships. |
| UI2-6 | Rail width is a CSS variable flipped by `data-rail`, not React state | Same reason as UI2-2, plus: no component holds the state, so the mobile sheet, the rail and the toggle cannot disagree. |
| UI2-7 | Collapsed nav items keep their label in `title` | A 76px rail is otherwise nine unlabelled glyphs. The visible label is what names the link when expanded; `title` carries it when it is not. |
| UI2-8 | Full bleed is `data-full-bleed` + a `:has()` rule, not a prop | `(app)/layout.tsx` is shared by every authenticated route and cannot read the pathname. Threading a flag through would make every page pass something it does not care about. |
| UI2-9 | Only the dashboard is full-bleed | A grid centred in 1180px wastes half a wide monitor. A 2000px-wide text input does not. Forms and tables keep the cap. |
| UI2-10 | Chart hues are assigned **by meaning**, and the set stops at four | indigo = primary quantity, cyan = secondary, emerald = good, amber = needs attention. What makes a dashboard gaudy is not the number of colours but a colour meaning two things — so a series takes its hue from what it represents, never from wanting variety, and a reader learns the palette once. |
| UI2-11 | Toggles read state with `useSyncExternalStore`, not a mount effect | Caught by the React compiler. It is also correct on the merits: the value lives in localStorage and on `<html>`, and two toggles copying it into state would each hold their own stale version of something one source owns. |
| UI2-12 | Tier colours stay reserved, and out of the chart palette | §13.1 is unchanged. The owner's palette has no pink, but pink is the Lead tier — so it keeps its token and its meaning, and simply never appears as a chart series. |

**Verification.** The compiled stylesheet was inspected directly rather than
trusted from source — the layer cascade has silently dropped rules in this
codebase before (UI-5). All present: `data-theme="dark"`, `--sidebar`,
`--rail-w`, `data-rail="collapsed"`, `.rail`, the `:has()` full-bleed rule,
`.glass`, `.card-surface`. Typecheck 0, lint 0 errors, build clean.

**Regression: 660 checks across 13 suites, 0 failed** — including P7's assertion
that the three tier colours appear nowhere outside the tier components.

---

### P11-WIRE — The remaining six templates, connected

P11 wrote seven templates and wired one. This connects the other six to the
events that raise them. No new template text, no schema change.

**Delivered.** `lib/notify/events.ts` (`notifyTransition`), hooked into
`transition()`; `app/api/cron/reminders/route.ts` for the two time-based
messages; `sendNotification` gained an optional client so cron can log without a
session.

| # | Decision | Why |
|---|---|---|
| PW-1 | **Notifications hang off `transition()`, not off screens** | §8's function is the only place a status changes, so every future screen — P12's self-evaluation form, P13's lead review, P14's MD view — raises the right message without knowing `events.ts` exists. Each screen remembering to send is how a product ends up notifying on three transitions out of five, and nobody notices until an employee asks why they were never told their form came back. |
| PW-2 | The hook runs **after** the commit, and cannot throw | The status change is durable and audited by then. A provider outage, a missing key or an employee with no phone must never turn a submitted form into a reported failure. `notifyTransition` catches its own errors and returns an advisory summary, which `transition()` passes back as `notified` — so a caller can say "submitted, but we could not reach your lead", which is neither success nor failure. |
| PW-3 | **DRAFT → CYCLE_ACTIVE raises nothing** | 47 messages firing the instant a cycle launches, before HR has looked at the roster, is not a feature. The invite stays a deliberate act on the distribution screen. |
| PW-4 | Employees get a token; leads, the MD and HR get a plain URL | §10 is explicit that a token "never grants access to anything beyond that one evaluation". For an employee who has never signed in that is exactly right. For a lead who needs their queue it would scope them *down* — a token is a way in for someone who has none, not a convenience for someone who has an account. |
| PW-5 | An MD return notifies the **lead**, not the employee | `LEAD_REVIEWED → SELF_SUBMITTED` sends the *lead's* review back. Telling the employee would be telling them about work that is not theirs and has not changed. |
| PW-6 | Finalising notifies HR, not the employee | §9 releases the result to the employee at CLOSED, under the cycle's disclosure policy. A message at MD_FINALIZED would leak the outcome before it has been released. |
| PW-7 | The closing message is handed the policy, not a pre-filtered payload | `evaluationClosed` already encodes §9's rules. Filtering before the call would put the same decision in two places, and they would disagree the first time a policy changed. |
| PW-8 | Cron uses the **service client**, and only cron does | §0.5 permits the service-role key in "server-side notification/cron code". It is unavoidable: a scheduled job has no session, so `auth.uid()` is null and RLS hides every row it needs. A test asserts no user-facing notify module imports it. |
| PW-9 | Cron is **not** rate-limited | `queue_notification`'s 200/hour cap counts by `sent_by`, which is null for the system actor. The cap exists to stop a person fat-fingering a bulk send, not to throttle a nightly sweep sized by how many people are genuinely late. |
| PW-10 | Reminders only inside a 5-day window, overdue only after the date, and a 20-hour quiet period | A message every night from the day a cycle opens trains people to ignore all of them. The quiet period also makes the job safe to retry. |
| PW-11 | The secret travels in the `Authorization` header, never a query string | A URL ends up in access logs, and a cron endpoint anyone can trigger is a way to message every employee in the company. A missing `CRON_SECRET` returns 503 rather than running unauthenticated. |

**Verification — 38 new checks (p11b), 698 in total, 0 failed.** All seven
templates are proved to have a live call site; the five §8 moves that raise a
message are mapped and `DRAFT → CYCLE_ACTIVE` is proved not to be; the hook is
proved to sit *after* the RPC by source position; the cron route is proved to
require a bearer secret, to chase only CYCLE_ACTIVE, to skip withdrawn people
and not to chase twice in a night. §10 was re-checked on both new paths: no
`context:` payload anywhere contains a link, a token or a URL, and both modules
send only through `dispatch`.

**Still not configured.** `RESEND_API_KEY` and `CRON_SECRET` are both empty in
`.env.local`. Email returns `NOT_CONFIGURED` and the cron route returns 503
until they are set — both state the reason rather than failing silently.

---

### P12 — The dynamic self-evaluation at `/my-evaluation`

Migration `0011_self_answers.sql`. `lib/forms/zod-generator.ts`,
`lib/evaluations/self-actions.ts`. `FormRenderer` extended with controlled
values, errors, hidden-question filtering and a reference column. Screens:
`/my-evaluation` and `/my-evaluation/[id]`.

**Three deviations from the brief, all resolved in the Constitution's favour.**

| Brief | Constitution | Taken |
|---|---|---|
| RatingScale "solid **amber** fill"; amber progress bar | §13.1: Self = **cyan**, "tier identity is sacred" | Cyan |
| `num-xl` **mono** | DESIGN.md §3: one family, "no separate mono for numerals" | Inter, tabular |
| 26px radius header card | §4: 16px card / 20px hero | 20px |

| # | Decision | Why |
|---|---|---|
| P12-1 | **A question is required only when required AND visible** | The single easiest thing to get wrong here. A hidden conditional that stays required produces a form that cannot be submitted and shows no reason — the offending field is not on screen. §6: "Hidden questions are not validated and not stored." |
| P12-2 | The schema is rebuilt from the answers, memoised on them | Visibility depends on the answers and visibility decides what is required, so the validator is a function of the form's current state, not a constant. |
| P12-3 | `0` and `false` are answers, not blanks | §6 / P4-9. A scale answered 0 is "Very dissatisfied (Not implemented)"; `false` is a real answer to "Any missed deadlines?". Treating either as missing blocks a fully answered form — the kind of bug people work around by inventing an answer. |
| P12-4 | Autosave sends a **patch**, merged in SQL | Two saves in flight carrying the whole object can land out of order, and the older one wins — an answer silently disappears from a form somebody spent twenty minutes on. `jsonb ||` is order-independent for distinct keys. |
| P12-5 | Hidden keys are removed in the **same statement** as the merge | Otherwise flipping "Any missed deadlines?" back to No leaves orphaned detail text that resurfaces on the lead's screen and the print pack, attached to a question nobody was asked. |
| P12-6 | `merge_evaluation_answers` re-checks §8's lock and §9's layer ownership | It is granted to `authenticated`, so it is callable straight through PostgREST with arguments of the caller's choosing. Without the check, autosave would be a hole straight through the state machine. |
| P12-7 | Submit re-reads the snapshot and rebuilds the schema **server-side** | The client's validity is not trusted and neither is its question list. Same builder both sides, so they cannot disagree. |
| P12-8 | Submit delegates scoring and the status change to P4's `transition()` | A second scoring path would eventually disagree with the first, and §11's means are already written and tested there. |
| P12-9 | Errors are ordered by **form position**, not by Zod | "Scroll to the first error" has to mean the topmost one on the page. |
| P12-10 | The error state marks the **field**, never the card | A card washed rose makes every question inside it look wrong. A left bar plus the message beneath names exactly one. |
| P12-11 | Autosave flushes on `visibilitychange`, not only `beforeunload` | iOS Safari does not reliably fire unload when an app is backgrounded — which is precisely when a phone user leaves a form. |
| P12-12 | MULTI_SELECT renders as wrapped chips | A column of checkboxes at 375px is a long scroll of small targets; chips wrap, read as a set, and each is a 44px tap. |
| P12-13 | "Returned" is detected from `audit_log`, not from status | §8's return puts the status back to CYCLE_ACTIVE, which is indistinguishable from never having submitted. The audit row is the only place the fact survives — §12's purpose exactly. |
| P12-14 | Metadata renders as a definition list, never inputs | These come from the profile and the evaluation record. An editable field here lets somebody type a name that disagrees with the record it is drawn from. |
| P12-15 | The index redirects when there is exactly one open evaluation | Most people arrive from a WhatsApp link with one thing to do, and a list of one exists only to be clicked through. |

**Verification — 50 checks (p12).** The generator is exercised directly: a blank
required question blocks and a hidden conditional never appears among the errors;
answering Yes reveals the child and answering it clears the block; flipping back
to No strips the stored value; a LEAD_ONLY question never blocks the employee;
`0` submits; 1000 characters pass and 1001 fail; a multi-select value outside the
frozen options is refused; the first error is the topmost question. Two
departments were rendered and proved identical outside Job Specific Skills. On
real Postgres: two separate patches both survive, a later patch updates one key
and leaves the rest, hidden keys are removed, another employee and the lead are
both refused the SELF layer, and a submitted layer refuses further writes.
Source-level: exactly one component renders a form, submit re-validates
server-side and never writes `status` directly, and the progress bar uses the
SELF tier rather than amber.

**Regression: 748 checks across 15 suites, 0 failed.** Typecheck 0, lint 0
errors, build clean.

**Not in this phase.** P13's lead review. `FormRenderer` already takes
`referenceValues` / `referenceLayer` for it, and `merge_evaluation_answers`
already gates the LEAD layer on SELF_SUBMITTED — but no lead screen exists yet.

---

### AMEND-1 — HR_ADMIN and MD merged

Migration `0012_merge_hr_md.sql`. **§9's access matrix and §8's transition table
are both amended above**, at the owner's explicit instruction.

**What changed.** The two roles were deliberately different: HR configured the
system and could not decide pay; the MD decided pay and could not configure. Both
now hold both sets of powers.

**The consequence, stated plainly: there is no longer a second pair of eyes on a
pay decision.** Whoever authors the questions can also launch the cycle, write
the final scores and set the increment. That was a separation of duties, and it
has been removed on purpose. Reversing it means reverting 0012 and restoring the
split rows in §9.

| # | Decision | Why |
|---|---|---|
| A1-1 | One predicate, `is_admin()`, replacing every `is_hr()`-only and `is_md()`-only gate | The merge is one idea, so it lives in one function. Nineteen policies each carrying `is_hr() or is_md()` is nineteen places to miss one. |
| A1-2 | `is_hr()` and `is_md()` are **kept** | They are still the truthful answer to "does this person hold that role", the audit trail still distinguishes them, and a future re-split needs them. Only the *gates* merged, not the roles. |
| A1-3 | `ADMIN_ROLES` is the single TypeScript expression of it | Seventeen routes and actions now gate on the constant. A route that gates on one role alone is a bug, and grepping the constant finds every place the decision reaches. |
| A1-4 | The employee's submit and the lead's two transitions are **untouched** | Merging the administrative roles says nothing about who fills in a form. §8 rows 2, 3 and 4 are unchanged in both the SQL CASE and the TS table. |
| A1-5 | The five remaining `is_hr()` function gates are patched via `pg_get_functiondef` | `launch_cycle`, `reassign_evaluation_lead`, `exclude_evaluation`, `queue_notification` and `settle_notification` differ from their originals by one word. Restating five long, already-tested bodies to change it invites a transcription error; a targeted replace is exact by construction. |
| A1-6 | p5 now loads the **whole** migration chain, not just 0005 | It was passing while asserting the pre-merge policies — a suite that green-lights behaviour the running system no longer has is worse than no suite. |
| A1-7 | The two inverted RLS assertions were **rewritten, not deleted** | "HR cannot write decisions" became "HR may write decisions", and the same for the MD on config. Both halves are asserted, so reverting one direction without the other fails. The tests now record that the control was removed deliberately. |
| A1-8 | p7 asserts the MD and HR menus are **equal**, not that each contains a list | An equality check cannot drift back apart silently. |

**Caught in passing.** Several files had been rewritten to CRLF by an earlier
editing pass on this Windows machine — invisible to the compiler, but it broke
p7's parser, which reads the §6 scale labels out of CLAUDE.md itself. 38 files
normalised back to LF.

**Regression: 751 checks across 15 suites, 0 failed.** Typecheck 0, lint 0
errors, build clean.

---

### P13 — The lead review at `/team`

Migration `0013_lead_review.sql` (one RLS policy, **no schema change**).
`lib/forms/review-form.ts`, `lib/evaluations/{lead-actions,team-queue}.ts`.
`FormRenderer` gained a paired mode. Screens: `/team` and
`/team/[evaluationId]`. `mdReviewPending` added to the notification templates
and wired to §8's fourth transition.

**Four deviations from the brief, all resolved in the Constitution's favour.**
The same class of conflict P12 recorded, resolved the same way.

| Brief | Constitution | Taken |
|---|---|---|
| "Self in **amber** tint"; "amber score chips"; "amber left bar" | §13.1: Self = **cyan** | Cyan |
| Lead RatingScale with "the **indigo** solid fill" | §13.1: Lead = **pink**; indigo is Final | Lead tier, pink |
| Header card **26px** | DESIGN.md §4: 16px card / 20px hero | 20px |
| Read "**DESIGN_V2.md** §7" | No such file; §13 names DESIGN.md | DESIGN.md §7 |

| # | Decision | Why |
|---|---|---|
| P13-1 | **The two-column layout is a mode of `FormRenderer`, not a second component** | The brief asks for two things that pull against each other: "rendered by the shared FormRenderer" and "row-aligned per question — use a grid, not two independent scrolling panes". Two renderer instances side by side *cannot* be row-aligned; each column takes its own height and the two lists drift apart within a screenful. A bespoke review component would be the second renderer P9-1 forbids. So the pairing is one renderer, one question, one grid row, two cells — the only shape that satisfies both sentences. |
| P13-2 | The row's shape is decided by `answered_by` alone, and there is **no branch on section anywhere** | EMPLOYEE_ONLY renders full-width as context, LEAD_ONLY full-width with no empty self column, EMPLOYEE_AND_LEAD paired. Manager Review is full width because its questions are LEAD_ONLY, not because of what the section is called — which is also why Job Specific Skills needs no branch, and a test asserts the one remaining `DEPARTMENT_SECTION` comparison is P9's preview highlight. |
| P13-3 | `mergeReviewForm` builds a **display-only** form; the LEAD definition stays authoritative | The lead's screen shows more questions than the lead answers. `LAYER_ANSWERED_BY.LEAD` has to stay `EMPLOYEE_AND_LEAD + LEAD_ONLY` — it is what `buildZodSchema` validates and `computeScores` averages, so widening it would block a submission on the narrative section and drag employee prose into a numeric mean. Both inputs have already been through `getEvaluationForm`, so nothing is assembled twice and the frozen snapshot is still the only source. `submitLeadReview` deliberately never touches the merged form. |
| P13-4 | **No migration was needed for the mechanics.** 0013 adds one SELECT policy and nothing else | 0011's `merge_evaluation_answers` already accepts `p_layer = 'LEAD'`, already re-checks that the caller is the assigned lead at SELF_SUBMITTED, and already carries `p_comments_patch`. `apply_evaluation_transition` already holds both §8 rows the lead owns. The phase is a screen over machinery that was built to receive it. |
| P13-5 | ⚠ **The lead can now read `audit_log` for their own reports** | 0005 gave audit SELECT to HR and the MD alone. Two things the brief requires are recorded nowhere else: "Returned to {name} on {date}" (§8's return puts the status back to CYCLE_ACTIVE, byte-identical to never-submitted — P12-13 hit this from the other side) and "a note naming who started it" after a reassignment. Inferring either from "there is a draft but the status is CYCLE_ACTIVE" would put a guess on screen and state it as fact. The policy is scoped to `entity = 'evaluation'` and to `is_lead_of_evaluation`, is SELECT only, and leaves §12's append-only guarantee untouched. **This widens who can read the audit trail — revert 0013 to undo it.** |
| P13-6 | `MIN_REASON_LENGTH` moved from `guards.ts` to `transitions.ts` | It was already 10, already enforced by `requireReason` — the brief's "at least 10 characters" was asking for a number that existed. But `guards.ts` is `server-only`, so the return dialog could not import it and would have hardcoded a second copy. Two copies of a threshold is how a form starts accepting what the server then rejects. Re-exported, so nothing else changed. |
| P13-7 | The live "your average" tile is **not** a stored score | §11 stores scores at submit time inside `transition()`, from the server's copy. The tile is a preview of what that will be, computed by the same rule — an unweighted mean of the answered SCALE_0_5 questions. Nothing reads it back. |
| P13-8 | Variance goes through P4's `computeVariance`, threshold from the cycle | A second implementation on this screen would eventually disagree with the MD's collision view about who differed — on the one number the whole product exists to surface. The rose chip and its "consider adding a comment" line are guidance with **no** validation attached, exactly as the brief says. |
| P13-9 | A comment expands **inline** and rides the same autosave call as the score | The brief forbids a modal, and is right: a comment explains the score beside it, and a dialog covers the thing being written about. Comments travel in `p_comments_patch` on the same request as the answer — split across two calls, one can land and the other not. |
| P13-10 | The queue is a card list, not a table | The brief names nine columns per row. At 375px that is either a horizontal scroll or eight-point type, and §13.2 makes the phone the first case rather than the fallback. Every field the brief lists is present; the geometry is not a table. |
| P13-11 | A row that cannot be reviewed shows its reason **beside** the disabled button, not in a tooltip | §13.4: a disabled control with no explanation is a dead end, and a tooltip is not an explanation on a touch screen. |
| P13-12 | The lead's own evaluation is a banner linking to `/my-evaluation`, and is reachable **no other way** from these screens | P6-8 already established where a lead's own appraisal lives. A test asserts the queue contains exactly one `/team/[id]` link and that the banner points at `/my-evaluation`. The banner is a reminder and never a block — a lead may review their team first. |
| P13-13 | Three §8 moves already notified; this phase wires the fourth | `SELF_SUBMITTED → LEAD_REVIEWED` raised nothing before. It now notifies the **MD** — not HR, who already receive the finalised message one step later, and being told twice about one evaluation is how people learn to skim. The message carries no score: a rating in a WhatsApp message is a rating disclosed on a channel with no access control around it. |
| P13-14 | The lead reassignment edge case needed **no code** | `is_lead_of_evaluation` reads `evaluations.lead_id`, so the moment HR reassigns, the old lead's guard fails and their RLS policies stop matching — access ends immediately. Their draft is untouched because §8 unlocks layers and nothing else. Only the "who started it" note needed building, and 0013 is what lets it be read. |

**Verification — 81 checks, 0 failed.** The pure half runs the real
`mergeReviewForm` source: EMPLOYEE_ONLY narrative is included as context,
Manager Review sorts last, a shared question appears exactly once, the merged
answers are the **lead's** and never the employee's, and hidden ids are the
union of both layers. The rest asserts the rules that are architectural rather
than computational — a walk of every `.tsx` under `app/` and `components/`
proves exactly one file still renders a form; the pairing is proved to branch on
`answered_by` and never on section; the readout is proved not to truncate; the
submit path is proved to re-read the snapshot, validate the **LEAD** layer and
never mention the merged form; and the three `/my-evaluation` files are proved
to read no LEAD layer, pass no `referenceValues` and use no `pair` — the
employee sees no lead comment anywhere in this phase.

`npm run build`, `lint` and `typecheck` pass.

**Not verified.** The suites from P2–P12 were run in earlier sessions and are
not committed to this repository, so the full regression could not be re-run
here. Four shared files changed: `form-renderer.tsx` (the new `pair` prop is
optional and its absence takes the original single-column path unchanged),
`guards.ts` and `transitions.ts` (the constant moved and is re-exported), and
`templates.ts` (`TEMPLATE_KEYS` is now 8 rather than 7 — a P11 assertion on that
count would need updating). Nothing was executed against a live database: the
0013 policy is written and reviewed but unapplied.

---

### P13 — Lead review at `/team` (verification pass)

**Built in a separate session.** This entry records the audit, the one gap
found, and the suite that was missing.

Delivered there: `0013_lead_review.sql`, `lib/evaluations/{lead-actions,team-queue}.ts`,
`lib/forms/review-form.ts`, `/team` and `/team/[evaluationId]`, and a `pair`
mode on `FormRenderer`.

**Audited against the brief; the notable calls were right.**

| Claim | Finding |
|---|---|
| "Do not build a second renderer" | Held. Pairing is a **mode of `FormRenderer`**, not a new component — one grid, one row per question, split 45fr/55fr. |
| "Do not branch the renderer for Job Specific Skills" | Held, and better than asked: the row shape comes from `answered_by`, so Manager Review renders full-width with no empty self column *because its questions are LEAD_ONLY* — not because of what the section is called. |
| No schema invented | Held. 0013 adds **one SELECT policy and no columns**: autosave, comments, submit and return all ran on 0011 and 0004/0005 already. |
| Comments inline, never a modal | Held. The only two dialogs are the terminal actions. |

| # | Decision | Why |
|---|---|---|
| P13-1 | The lead's `audit_log` read is a policy, not an inference | §8's return puts the status back to CYCLE_ACTIVE — byte for byte identical to "never submitted" (P12-13 hit this from the employee's side). Guessing "there is a LEAD draft, so it was probably returned" would put an inference on screen and state it as fact. The narrow SELECT is scoped to `entity = 'evaluation'` and `is_lead_of_evaluation(entity_id)`; §12's append-only guarantee is untouched. |
| P13-2 | **Gap found and fixed:** the policy existed for a message that was never shown | `PendingSelf` reported "has not submitted" for both cases, so the audit read 0013 was written for went unused. It now distinguishes them and names the date — a lead who returned three forms needs to know which is still outstanding. |
| P13-3 | Two suites needed correcting, not the code | p12's "one renderer" detector matched any mention of `SCALE_0_5`, and P13's screen mentions it to compute the live average. A renderer *renders*: the detector now requires importing the scale primitive **and** switching on `responseType`. |
| P13-4 | p11's message-text rule dropped "Namaste" | The queue's header greeting legitimately says "Namaste {name}" on screen. A rule meant to keep outbound **message bodies** in `templates.ts` had become a rule about vocabulary; it now keys on phrases that can only come from a sent message. |

**Verification — 37 new checks (p13).** On real Postgres: a lead cannot write
their layer before the employee submits and can once they have; comments land on
the LEAD layer without disturbing answers; a *different* HOD is refused and the
message names the assigned lead; the employee cannot write the LEAD layer; a
submitted LEAD layer refuses further writes; the return unlocks the SELF layer
and stores the reason verbatim. 0013's policy was exercised **under `set role
authenticated`** — PGlite connects as superuser and bypasses RLS, so a bare
SELECT would have proved nothing. §8 was probed from the lead's side: they can
submit their review, and cannot finalise or close.

**Regression: 788 checks across 16 suites, 0 failed.** Typecheck 0, lint 0
errors, build clean.

**Still outstanding.** P14 (the MD collision view at `/review`) — `/review` is
still a placeholder, so `LEAD_REVIEWED` is currently the end of the road.

---

### P14 — The collision and approval workspace at `/review`

Migration `0014_md_finalise.sql`. `lib/review/{queries,actions}.ts`. Screens:
the queue (`/review`) and the collision view (`/review/[evaluationId]`), with
`decision-card.tsx` and `section-radar.tsx`.

**Four deviations from the brief, all resolved in the Constitution's favour.**

| Brief | Constitution | Taken |
|---|---|---|
| Self on **amber** tint, Final on solid **green** | §13.1 Self = cyan, Final = indigo; green is the trend colour and never a tier (UI2-10) | Cyan / indigo |
| Axis labels in **Onest** 9px; `num-xl` mono | DESIGN.md §3: one family, no separate mono for numerals | Inter, tabular |
| Avatar in a lead-to-**violet** gradient | No violet token exists; §2 is the only place a colour is defined | Cyan→indigo, self to final |
| 26px radius identity card | §4: 16px card / 20px hero | 20px |

| # | Decision | Why |
|---|---|---|
| P14-1 | Finalise is **one PL/pgSQL function**, and the scores are computed in TypeScript and passed in | Four writes — MD layer, decisions, transition, override audit — with no atomicity would leave states nobody can explain, and §8 has no path back from MD_FINALIZED except CLOSED, so none of them could be unwound. Reimplementing §11's means in SQL would give two scoring algorithms that must agree forever, about the number a salary decision was made against. Same split as P10: **TypeScript decides, SQL commits.** |
| P14-2 | The database **refuses** a payload where any scored question would land null | The acceptance criterion is "a database check confirms no nulls in the MD layer", and the last point it can still be enforced is before the write. `p_scored_ids` tells the function what "every scored question" means without re-deriving it. |
| P14-3 | `computeFinalScores` already did the hard half | P4-12 wrote "a resolved value for **every** scored question, not just the overridden ones" two phases before there was a screen for it. This action is a caller, not a reimplementation. |
| P14-4 | An override is counted against the **lead's value**, not against "the client sent a key" | An MD who clicks the score the lead already gave has not overridden anything. An audit row saying they changed 3 to 3 is noise in the one place noise is most expensive. |
| P14-5 | One audit row per override, not one row carrying an array | An override is a decision about one question. Somebody asking "why is this 4 when the lead said 2" should find a row about that question rather than unpack a blob. |
| P14-6 | Decisions are written **before** the transition | §8's guard on LEAD_REVIEWED → MD_FINALIZED is "decisions recorded". The guard should find them already there rather than trust a later statement to add them. |
| P14-7 | `select … for update` on the evaluation | Two MDs pressing Finalise at the same instant would both read LEAD_REVIEWED and both proceed, and the second would write decisions over the first's. |
| P14-8 | The flag is a **glyph plus a label**, never colour alone | §13.8. The flagged row is the single thing this screen exists to surface, so it is the last place to encode a state in hue. A `sr-only` "flagged difference" carries it to assistive tech. |
| P14-9 | The radar caps at three series **structurally** | Self, lead and final are the only layers there are (§1). Final appears only once an override exists; before that it sits exactly on the lead polygon and would just thicken the line. |
| P14-10 | KPI is excluded from the radar | Nothing in it is scored, so plotting it would draw a zero-length spoke and imply the person scored nothing there. |
| P14-11 | Below 12 scored questions the radar plots **questions**, and says so | A section average computed from one or two answers is a shape that implies more than it knows. |
| P14-12 | `Segmented` is defined at module scope | Caught by the React compiler. A component created during render is a new type every render, so the subtree remounts and every control loses focus mid-interaction. |
| P14-13 | Salary maths runs **both ways** | The percent drives the new salary and editing the new salary back-computes the percent. Whichever field the MD is looking at is the one they trust, so neither is the master. A new salary at or below the current one is refused — an "increment" that lowers pay is either a typo or a decision that should not be recorded under that label. |

**Verification — 35 checks (p14), all on real Postgres.** The rule that matters
was attacked directly: a payload missing one of three scored questions is
refused, an explicit `null` is refused just as firmly, and in both cases the
evaluation does not move and no decision is written. A clean finalise then
proves the whole chain — MD_FINALIZED, `final_overall` copied onto the
evaluation, a value for **every** scored question (the override where given, the
lead's score where not), the layer locked with the actor recorded, the decision
persisted with its salary figures, one transition audit row and exactly one
override audit row carrying the question id, the lead value and the MD value.
A second finalise is refused and writes no duplicate audit rows. Neither the
employee nor the lead can finalise. Source-level: still exactly one renderer,
the radar has at most three `<Radar>` series, the queue cannot finalise, and
neither amber nor success green stands in for a tier.

**Regression: 823 checks across 17 suites, 0 failed.** Typecheck 0, lint 0
errors, build clean.

**Not in this phase.** P15's print pack — "Print all finalised" renders disabled
with the reason, since the batch route does not exist yet.

---

### P15 — Reports and the print pack

`app/print/` — its own layout, `print.css`, `evaluation-sheet.tsx`,
`summary-sheet.tsx`, `print-toolbar.tsx` and three routes.
`lib/print/{document,batch}.ts`. Print actions added to the collision view, the
cycle board, the MD queue and the employee's own completed evaluation.

| # | Decision | Why |
|---|---|---|
| P15-1 | Print routes live **outside** the `(app)` group, with a layout of their own | "Do not reuse the app shell" is not only a styling rule. The shell is a client tree carrying a sidebar, a topbar, the theme script and a cycle selector; hiding it with `display: none` still ships all of it and still lets one escape through a stray print style. Placement is what makes the guarantee structural. |
| P15-2 | `print.css` writes **raw hex**, and it is the only stylesheet outside `globals.css` that may | §2 forbids a hex in a component because a token can move. Here a token cannot help: a printer has no custom properties, no dark theme, and no tints that survive a monochrome laser. §7a inverts the system on purpose, and this file is that inversion. |
| P15-3 | Page numbers use `@page` margin boxes, and the limitation is **stated** | `counter(page)`/`counter(pages)` only resolve inside an `@page` margin box. Firefox and Safari honour it; **Chrome does not** and prints nothing there, so Chrome users get numbering from the print dialog, which is on by default. The alternative — counting page breaks in JavaScript — guesses at the printer's line breaking and is wrong the first time a font size changes. |
| P15-4 | The sheet is a **server component**; only the toolbar is a client one | This is what makes 47 evaluations possible: the browser receives finished HTML, so there is no hydration work proportional to the size of the pack. |
| P15-5 | Documents are built with **bounded concurrency**, not 47 at once | Each document issues five queries. 47 in parallel is 235 simultaneous connections, which does not fail cleanly — it queues inside the pooler and the page hangs on the slowest. Six at a time. |
| P15-6 | The batch pack is not built until `?go=1` | A 47-person pack is a minute of somebody's printer. The filter screen makes producing it a deliberate act rather than a side effect of following a link. |
| P15-7 | The **audience is a parameter**, never inferred from the session | HR legitimately prints an employee copy to hand over. Inferring it from who is signed in would make that impossible, and would make the redaction invisible. |
| P15-8 | Redaction removes the comments and keeps the scores | §9: the employee "sees final score + decision, **never** raw lead comments". So an employee copy below FULL loses the per-question remarks, the lead's written blocks and the MD's internal remarks — and keeps everything §9 says they see. The page says so rather than leaving an unexplained gap. |
| P15-9 | The grading scale is printed **on the document** | The acceptance criterion is that somebody who never used the app can read the sheet. §6's wording comes from `SCALE_0_5_LABELS`, not retyped — §6 says "fixed wording, do not paraphrase" and the printed pack is the last place to paraphrase it. |
| P15-10 | Nothing on the sheet carries a tier colour | Who said what is conveyed by three labelled columns — position and text, which survive a monochrome printer. A tier tint would say the same thing in a way that vanishes. |
| P15-11 | One unreadable evaluation does not take the pack down | It is skipped, and the summary sheet still lists the person, so whoever is printing can chase it rather than discovering a silently short pack. |

**Caught by an older suite, for the third time.** P8-PATCH's "no component
restates a section name" failed on `"Quantitative Performance (KPI)"` in the
print sheet. Both section headings now come from `SECTION_LABELS`. That rule has
now caught P9, P12 and P15 — it is the most productive test in the suite.

**Verification — 55 checks (p15).** The routes are proved to import no shell and
to sit outside `(app)`. The stylesheet is proved to carry A4/18mm, the page-number
counters, `break-inside: avoid` on section and signature blocks, a repeating
table header, a hidden toolbar, and the screen preview's paper sheet. §9 was
checked in both directions: the three redacted fields are proved withheld and
the score and decision fields proved **not** withheld. The sheet is proved to
carry all eight metadata fields, all seven ratings columns, three signature
cells, and no tier or app token class at all. The pack is proved to build
server-side with bounded concurrency, and the sheet proved to carry no
`"use client"` directive. No PDF library was added.

**Regression: 878 checks across 18 suites, 0 failed.** Typecheck 0, lint 0
errors, build clean.

---

### P16 — Analytics (partial)

Migration `0015_views.sql` (six views), `lib/analytics/{queries,csv}.ts`,
`/people/[profileId]/scorecard`, and a CSV export route.

**⚠ NOT COMPLETE. See "Still to do" below — the role-aware `/dashboard` rebuild
was not delivered in this session.**

| # | Decision | Why |
|---|---|---|
| P16-1 | **Migration is `0015_`, not the brief's `0008_`** | 0008 is `0008_single_form.sql` and has been applied. §0.8: numbering is sequential, an applied migration is never edited. Same call as P11-1. |
| P16-2 | Every view is `security_invoker`, and it is **proved, not assumed** | A Postgres view runs as its OWNER by default. Every view here reads `evaluations`, which has RLS — so a default view would bypass every policy and hand any signed-in employee the company's salary decisions through an aggregate. That is the default behaviour, and it is silent. p16 asserts `reloptions` on all six, then proves the behaviour by querying as three different people. |
| P16-3 | The proof runs under `set role authenticated` | PGlite connects as superuser and bypasses RLS outright. Without the role switch every assertion would pass while proving nothing — the same trap P13's suite hit. |
| P16-4 | `v_section_scores` carries an `is_comparable` column | Job Specific Skills is a **different set of questions per department**, so Sales' 4.2 beside Accounts' 3.8 compares two unrelated things. The flag travels with the row so a chart cannot forget; `getAnalytics` filters on it rather than leaving it to each caller. |
| P16-5 | `v_variance_by_lead` returns the **signed** mean and the absolute mean | A lead who is +2 on half their team and −2 on the other half averages zero and is *inconsistent*, not biased. A lead at +1.4 across twenty people is saying something else. Both matter, so the count travels too — +2.0 over three people is noise. |
| P16-6 | Every view filters `track = 'STAFF'` and `excluded_at is null` | §5's module boundary. Averaging a shop-floor tick sheet into a staff mean produces a number that means nothing and cannot be traced back to why. |
| P16-7 | "Needs attention" is empty for an employee by construction | RLS would already reduce it to themselves — a list of one person nagging them. §9 gives an employee nothing about anyone else, so the query is skipped rather than filtered. |
| P16-8 | CSV is generated server-side from the same query | An export built from client state is an export whose contents the client chose. Going back through the view means the file is exactly what that person may read, decided by the same policies as the screen. BOM + CRLF because Excel on Windows renders bare-LF UTF-8 as mojibake, and these are Indian names. |
| P16-9 | The scorecard's guard redirects, but RLS is what protects it | `v_employee_history` is security_invoker, so a viewer who may not see this person's evaluations gets an empty history whatever the URL says. The redirect is the clean-exit layer — without it somebody who edited the URL would sit on empty charts wondering if it was broken. |

**Verification — 38 checks (p16).** The acceptance criterion was tested by
construction: two employees in one department scoring 5 and 1. HR sees
`people: 2, avg_self: 3`. Employee A sees `people: 1, avg_self: 5` — their own
number, revealing nothing — and is explicitly asserted **not** to see the
average of 3 or a count of 2. A's history contains only A's rows; A's rating
distribution totals one, not two. The lead sees both reports; HR sees everyone.
The arithmetic was hand-checked against the fixture: gap, signed mean delta (0),
mean absolute delta (1), and the 4-5/2-3 buckets.

**Regression: 916 checks across 19 suites, 0 failed.** Typecheck 0, lint 0
errors, build clean.

**Still to do — P16 is not finished.**
> **Superseded by §18 STATUS.** Accurate when written; several of these have since been delivered. STATUS at the end of §18 is the current list.


- The **role-aware `/dashboard`** rebuild (HR / MD / lead / employee views, the
  bento layout, the variance-by-lead diverging bar chart, the stacked-area
  submissions trend). `/dashboard` currently still shows the UI-2 version, which
  reads raw counts rather than the views.
- **"View as table" on every chart** — done on the scorecard trend, not yet on
  the dashboard charts.
- CSV export on **every** table; only department scores has a route so far.
- The **under-one-second-with-500-evaluations** target is indexed for but not
  measured.

---

### P17 — Notifications, reminders and cron (partial)

Migration `0016_notification_settings.sql`. `lib/notify/schedule.ts`. Rewritten
`/api/cron/reminders`. Pause switch honoured by `dispatch.ts`. `vercel.json`
moved to 10:00 Asia/Kolkata.

**⚠ NOT COMPLETE. The `/admin/settings/notifications` screen and the HR daily
digest were not delivered — see "Still to do".**

**Reverses a documented decision, at the owner's instruction.** PW-3 raised
nothing on `DRAFT → CYCLE_ACTIVE`, on the reasoning that 47 messages the instant
a cycle opens — before HR has looked at the roster — is not a feature, and that
the invite should stay a deliberate act on the distribution screen. P17 requires
the opposite. **Launching is now the moment the whole company hears about it**,
and the distribution screen becomes a resend tool rather than the first send.
The pause switch is the brake if a launch goes out by mistake.

| # | Decision | Why |
|---|---|---|
| P17-1 | The secret is compared **timing-safely** | `a !== b` short-circuits on the first differing byte, so the time it takes to fail leaks how much of the prefix was right — recoverable one character at a time. Length is folded into the accumulator rather than checked first, because an early return on length would leak the length. |
| P17-2 | Quiet hours are computed in **Asia/Kolkata**, not the server zone | A Vercel function runs in UTC. A naive `getHours()` would put the window five and a half hours out and send at 02:30 local — the exact failure the rule exists to prevent. |
| P17-3 | Quiet-hour work is **not** queued for 08:00 | The job runs again at 10:00 and the same people are still late. A backlog firing at 08:00 would deliver yesterday's reasoning against today's data, and "who is holding this" may have changed overnight. |
| P17-4 | Dedupe is keyed by **person**, and read from `notifications_log` | P17: "one message per person per day … enforce it by querying notifications_log, not by an in-memory flag." An in-memory flag is per-invocation, so two runs in a day would each think they were the first — which is precisely the idempotency being asked about. The person is also marked inside the run, so four records cannot each send. |
| P17-5 | Reminders fire at **three moments**, not across a window | 3 days ahead, the day itself, then daily until 7 days past, then silence. A system that finds a reason to message every day gets muted — and a muted channel fails silently on the one message that mattered. |
| P17-6 | The pause switch is a **single-row table**, not a key-value store | It must outlive a request and be readable by cron, which has no session — so not a cookie, not a module variable, not an env var needing a redeploy. The `check (id)` on a boolean primary key is what keeps it single-row, so no query has to decide which row is current. A generic settings store invites the next person to put anything in it. |
| P17-7 | Dispatch checks the pause **after** writing the QUEUED row | A paused send is still an attempt somebody made, and the row is the evidence. QUEUED with no provider behind it is exactly what "paused" should look like, and it is what "Retry all failed" picks up when the pause lifts. Read per send, so pausing mid-bulk-run stops the next message rather than the next deploy. |
| P17-8 | Pausing and resuming are **audited** | §12. Silencing every outbound message in the company is exactly the kind of change that must be answerable later. |

**Verification — 49 checks (p17).** The scheduling rules run directly: 22:00,
02:00 and 07:59 IST are quiet, 08:00 and 10:00 are not, and 23:00 IST — 17:30
UTC — is proved quiet, which a server-zone implementation would get wrong. The
reminder ladder is walked end to end: 3 days ahead fires, 2 and 4 do not, the
day itself fires, 1 through 7 days late nudge, **8 days late stops**. The
timing-safe comparison accepts the right secret and rejects a wrong one, a
prefix, an empty header and a same-length impostor. On real Postgres: a second
settings row is refused, an employee cannot pause, an administrator can, the
actor and reason are taken from the session, both directions are audited, and
the table has no insert/update/delete policy for anyone.

**Four p11b assertions were rewritten, not deleted** — they asserted the
pre-P17 rules. Each now asserts the new one and says in a comment that it
changed, so the reversal is recorded rather than hidden.

**Regression: 965 checks across 20 suites, 0 failed.** Typecheck 0, lint 0
errors, build clean.

**Still to do — P17 is not finished.**
> **Superseded by §18 STATUS.** Accurate when written; several of these have since been delivered. STATUS at the end of §18 is the current list.


- **`/admin/settings/notifications`** — the whole screen: the pause switch UI,
  the message log with filters and per-row retry, and the template preview
  panel. The engine behind it exists and is tested; nothing renders it.
- The **rose "messages are paused" banner** across admin screens.
- The **HR daily digest** email (submitted since yesterday, reviewed, newly
  overdue, needing HR action). `notifyTransition` still messages HR per
  finalisation rather than batching into a digest.
- **`LEAD_REVIEWED → MD_FINALIZED` notifies HR per event**, which P17 says
  should become the digest instead.

---

### P2-RESEED — the textile question bank

Migration `0017_reseed_questions.sql`. Replaces the P2 bank, which was
transcribed from a company-secretarial Google form and describes no job at
LD Group.

| # | Decision | Why |
|---|---|---|
| PR-1 | **Migration is `0017_`, not the blueprint's `0012_`** | 0012 is `0012_merge_hr_md.sql` and is applied. §0.8, as with 0010 and 0015. |
| PR-2 | The old bank is **retired, never deleted** | §17 forbids deleting a question row and §5 froze copies of it into launched evaluations. `is_active = false` retires it from every future form while leaving the audit trail and every snapshot untouched. One audit row records how much moved at once. |
| PR-3 | Deterministic ids from `md5('linkd.q.' || key)` | `questions` has no natural unique key, and a stable id is what lets the four conditionals reference their parent without a second round trip. Keys live only in the migration — they are not a schema column. Same device P2 used. |
| PR-4 | The ten new departments are added; existing ones are **kept and not renamed** | §0.2. Renaming a department would silently re-label every evaluation already filed against it. |
| PR-5 | **`worker_questions` is not reseeded** | Blueprint step 6 asks for it; that table does not exist, because the worker module has never been built. Writing it would breach §0.4. Flagged rather than faked. |
| PR-6 | Three Work Output conditionals, not four | The blueprint's counts table says "9 (4 conditional)" while the section itself lists three (Q5, Q7, Q9). Three is what the questions describe, and three is what is wired. Manager Review Q8 is the fourth conditional overall. |

**Verification — 36 checks.** The acceptance criterion was tested by
construction: a cycle was launched and snapshotted with the OLD bank, then the
reseed ran, and the snapshot's md5 fingerprint is proved **identical** — before,
after, and again after a second run. Retired questions still render in it. No
active question mentions Companies Act, FEMA, RBI or SEBI. Every section's count
matches the blueprint, all ten departments carry 5–7 Job Specific Skills
questions, seven sampled strings are proved verbatim including the ±1 mm
tolerance and the 36"/58"/64"/72" widths, and a KATA employee's assembled form
comes to 38 questions with six of their own and none of Design's.

---

### P9B — The form builder at `/admin/form-builder`

`lib/questions/estimate.ts`, `/admin/form-builder`. Three panes: structure,
editor, live preview. Linked from the sidebar as the default way in; P8's
question bank and P9's mapping screen stay reachable as advanced views.

**Four deviations from the mockup, all resolved toward the Constitution.**

| Mockup | Constitution | Taken |
|---|---|---|
| Onest + IBM Plex Mono | DESIGN.md §3: one family, no separate mono | Inter, tabular figures |
| Self = amber, Final = green | §13.1: Self = cyan, Lead = pink, Final = indigo | Current tier tokens |
| Canvas `#EFEFEB`, warm paper | §2's palette replaced that direction at UI-REFRESH | Current tokens |
| 24px pane radius, 22px cards | §4: 16px card, 20px hero | 20px |

| # | Decision | Why |
|---|---|---|
| P9B-1 | The preview is the **real `FormRenderer`**, given a real `FormDefinition` | "If it renders here, it renders identically for the employee" is the entire value of the screen. A lookalike would be a second renderer that drifts — the thing P9 forbade and this phase repeats. A test asserts the builder imports no rating primitive of its own. |
| P9B-2 | Sections come from `SECTION_ORDER`; there is no way to add or remove one | The enum is fixed (§0.2) and the renderer depends on it. Only order and contents are editable, and the absence of any `setSections` is what enforces it. |
| P9B-3 | The department selector filters **only** the department section | Every other section is drawn from the same `category = 'CORE'` list regardless of department, which is what makes "identical company-wide" true by construction rather than by discipline. |
| P9B-4 | The lead view filters by `answered_by`, never by section name | Manager Review appears on the lead's view *because its questions are LEAD_ONLY*, not because of what the section is called — the same rule P13's pairing uses. |
| P9B-5 | **The fill estimate excludes conditional questions** | Found by the test, not assumed: counting all three conditional KPI questions puts the real KATA form at 17 minutes, against the blueprint's stated 13. A conditional is only asked of somebody who answered Yes, and most answer No — charging every reader for a branch they never take makes every form look too long and the warning meaningless. |
| P9B-6 | The snapshot banner returns every visit | §5 is the thing HR most often misunderstands. Dismissible per session, never for good. |

**Verification — 28 checks (p9b).** The estimator runs directly: the per-type
weights, the two sides counted separately, the long-form warning tripping on
twenty long-text questions and not on forty ratings, and the real KATA form
landing at 13 minutes — with an explicit check that counting the conditionals
would overstate it. Source-level: the preview uses the real renderer and imports
no input primitive; no enum value is rendered as text anywhere; sections come
from `SECTION_ORDER` with no setter; the department filter touches only the
department section; the route is admin-guarded.

**p7's menu list was extended, not loosened** — "Form Builder" is a tenth label,
and the other nine are still guarded against a rename character for character.

**Regression: 1029 checks across 22 suites, 0 failed.** Typecheck 0, lint 0
errors, build clean.

**Still to do — P9B is not finished.**
> **Superseded by §18 STATUS.** Accurate when written; several of these have since been delivered. STATUS at the end of §18 is the current list.


- **Autosave.** The editor edits a local draft and the preview follows it, but
  nothing is persisted yet — `saveQuestion` is not wired, so a reload discards
  changes. This is the largest gap.
- **Add question, Remove question, and drag-to-reorder** (with the keyboard
  move-up/move-down alternative).
- The **conditional editor** — "Only show sometimes", the parent picker, and the
  rule rendered back as a sentence.
- The **inline option editor** for Pick one.
- **"Start from the standard form"** and **"Copy Job Specific Skills from another
  department"**.
- The **responsive collapse** below 1150px and 900px — the panes are currently
  hidden rather than becoming a drawer and tabs.

---

### FIX-1 — The seed ran in the wrong place, and it was hiding three bugs

Not a phase. A repair, prompted by three errors reported after every migration
had been applied for real: `supabase/tests/rls.sql`, `supabase/bootstrap-admin.sql`
and `supabase/seed.sql` all failed.

**The root cause was in the test harness, not the product.** Sixteen suites
loaded `seed.sql` *between* migrations 0007 and 0008. `supabase db reset` runs
every migration first and the seed last. Everything downstream of 0008 was
therefore being tested against a database no CLI would ever produce, and three
real bugs sat inside that gap — green the whole time.

| # | Decision | Why |
|---|---|---|
| F1-1 | **The question bank left `seed.sql` for `0017_reseed_questions.sql`** | Two failures, one loud and one quiet. Loud: the seeded WORKER rows violate `questions_core_track_staff`, the CHECK 0008 added, so a real reset aborted outright. Quiet, and worse: a seed running after 0017 re-inserted the entire retired company-secretarial bank **as active**, silently undoing the reseed and putting FEMA and SEBI questions back in front of a fabric printer. The bank is product content, not demo data, and §0.6 does not require it to live in the seed — only that demo data lives nowhere else. |
| F1-2 | `0018_retire_old_departments.sql` — the five original departments are deactivated, not deleted | 0017 added ten textile departments and correctly left MIS, SALES, OPS, DESIGNS and ACCOUNTS alone (§0.2 freezes a name). The consequence nobody had looked at: fifteen departments, five with **zero Job Specific Skills questions**, and per P9-7 such a department cannot be launched at all. HR was being shown five choices that quietly did not work, two of them near-homographs of the real ones — "Sales" beside "Sales & Customer Service". `is_active = false` is the same treatment P4-5 gives a person who has left. |
| F1-3 | `bootstrap-admin.sql` now raises and redirects to `grant-admin.sql` | It opened with `\set`, a **psql meta-command**. The Supabase SQL editor is not psql, so the first line was a syntax error every time. A file that cannot work in the one place it is meant to be pasted should say so, not fail obscurely. |
| F1-4 | `rls.sql`'s fixture moved to SALESCS / MISSYS | It resolved `code = 'SALES'`, which no longer exists, to NULL — and that **silently disarmed a security test**. `update … set department_id = null` is not a change when the value is already null, so the guard trigger had nothing to refuse and the assertion failed for a reason unrelated to what it was testing. The lookup is now asserted before use, so a future rename fails loudly instead of quietly weakening a check. |
| F1-5 | p2's subject changed from the bank's **content** to 0002's **schema** | Its assertions counted 65 questions and named the ten special-assignment options — all retired by 0017. p2reseed asserts the textile bank against its real texts. What p2 uniquely owns, and what nothing else covered, is the four enums, the three CHECK constraints and the structural invariants that hold for *any* bank. A suite that must be rewritten whenever content changes is a suite that stops being run. |
| F1-6 | p3-sql's snapshot-rule block now **picks its targets from the bank** instead of naming them | Same reasoning, applied where it matters most: §5's rule is that editing the bank cannot touch history, and that has nothing to do with which question is edited. It rewords, relabels, retires and deletes whatever it finds, then compares an md5 fingerprint over every field of the frozen snapshot. |
| F1-7 | p8patch and p2reseed **build their own pre-state** | Both test a migration that transforms an existing bank, and both used to inherit that bank from the seed. They cannot any more, and should not have: a suite that depends on another file continuing to supply its fixture breaks the moment that file legitimately changes. Being explicit also documents what each migration actually needs to be true. |
| F1-8 | Four stale assertions were **corrected, not deleted** | p8 pinned the wording "Only HR", which AMEND-1 changed to "Only an administrator" (A1-5) — it was reporting a security failure that did not exist. p3-sql still asserted `evaluations_lead_not_evaluatee`, which P10-7 dropped **on purpose**; it now asserts the constraint is gone, so a silent re-add fails. p10 checked that snapshot rows were a whole multiple of 47, which was only ever a proxy for "nothing was appended" and is wrong now that departments carry five to seven Job Specific Skills questions each; it asserts the claim directly. |

**The harness ordering itself is the fix that matters.** All twenty-two suites
now load the full chain and then the seed, in that order, with a comment saying
why. Had they done so from the start, none of these three files would have
reached a real database broken.

**Regression: 1011 checks across 22 suites, 0 failed** — up from 856 passing
against the wrong ordering. Typecheck 0 errors, lint 0 errors (3 pre-existing
warnings), build clean.

**Action required.** `0018_retire_old_departments.sql` has **not** been applied.
Apply it before the next cycle launch. It is idempotent, safe on a database
where those departments were never created, and raises a `notice` naming anybody
still assigned to a retired department so they can be reassigned.

---

### P9B-CRUD — The form builder finished, and the department list corrected

Closes the four gaps P9B left open — add, remove, reorder and autosave — plus a
redesign, resizable panes, and the department reconciliation the owner asked for.

**RENAMES ARE EXPLICITLY INSTRUCTED.** §0.2 freezes a name once created and
`0019_departments_reconcile.sql` changes eight of them. The owner gave the list
directly and chose "match my list exactly", which is the explicit instruction
§0.2 requires. Recorded here rather than absorbed silently.

| # | Decision | Why |
|---|---|---|
| PC-1 | **The builder writes only through P8's existing actions** | `saveQuestion`, `setQuestionActive` and `reorderQuestions` are already HR-guarded, already audited and already the question bank's write path. A builder reaching for the table directly would be a second path that eventually disagrees about who may write and what gets logged. Two additive changes were needed: the action returns the new row's `id` (the drawer never needed it; the builder must select what it just created) and revalidates `/admin/form-builder`. A test asserts no client file in the builder imports a Supabase client. |
| PC-2 | **A new question is written immediately, not held until it is complete** | The alternative is a modal that discards a half-made question on a refresh with no explanation. Writing at once means `questionFormSchema`'s five-character minimum has to be satisfied on creation, so the placeholder is a real sentence — and one that reads as obviously unfinished, so nobody launches a cycle with it still in place. |
| PC-3 | Remove **retires**, and offers an undo | §17 forbids deleting a question: historic responses key off its id and launched evaluations hold their own frozen copy. The button says "Remove" because that is what it does to the *form*, and the undo is real rather than cosmetic precisely because the row never went anywhere. The test asserts no delete against `questions`, `question_options` or `department_questions`. |
| PC-4 | A refetch **merges** into the draft; it does not replace it | Every save calls `revalidatePath`, so fresh props arrive mid-typing. Assigning them would take a character back out of the field somebody is still filling. Anything queued for save keeps its local value, and the merge happens **during render** against the previous props — React's documented way to react to a prop change. An effect calling setState is the cascading-render pattern the compiler rejects, and it also renders once with the stale value first, which is visible as a character flickering. |
| PC-5 | The dirty set is **state, not a ref** | Caught by the compiler. It is also right on the merits: the merge in PC-4 reads it during render, and a ref read at render time is exactly the thing that fails to re-render when it changes. |
| PC-6 | Ordering has **one** persist path | Up/down buttons and pointer drag both end in `persistOrder`. Buttons are the primary control, not a fallback (P8-6, P9-5) — they work by keyboard and on a phone. Two write paths would let the optimistic numbers and the stored ones disagree, and the disagreement only shows after a refresh. |
| PC-7 | Pane widths are **fractions**, remembered via `useSyncExternalStore` | A pixel layout looks right on the monitor it was dragged on and wrong on every other one. The store is the UI2-11 pattern: the value lives in localStorage, and copying it into state means two components each holding their own stale version of something one source owns. Server snapshot is the default, so SSR and first paint agree and there is no hydration mismatch. |
| PC-8 | The splitter is a real `separator` with arrow keys | §13.8. A pointer-only splitter puts the entire layout out of reach of anybody not using a mouse — on the one screen whose whole job is arranging things. Double-click evens the pair, which is the cheapest way back from a drag that went too far. |
| PC-9 | **The preview toggle now says what it switches** | It read "Employee / Lead" with no statement of what changed, and was reported as confusing — reasonably, since it looks like a filter on the question list and is actually a change of *viewer*. It now names the viewer, the team, the question count and the fact that nothing typed there is an answer. That last sentence is a single constant, so it cannot drift between the two audiences. |
| PC-10 | Below 1150px the panes **stack**; nothing is hidden | The old builder hid two of three panes at that width, which is not a responsive layout — it is a screen that silently stops working. |
| PC-11 | `0019` **creates** Operations, Rolling and Calendar rather than only renaming | The renames only fire where the row already exists, and FIX-1 stopped `seed.sql` creating the five original departments — so a fresh `supabase db reset` had no OPS row for the rename to find, and Operations vanished. Both paths were tested and converge on the same ten. |
| PC-12 | Two retired shells are renamed "(retired)" — the one rename nobody asked for | `departments.name` is UNIQUE, and "MIS" and "Sales" were held by the empty P1 shells, so the working departments could not take those names while they existed. Deleting the shells is refused by §17, since `profiles` and `evaluations` may point at them. A retired row that says what it is beats a deleted row that used to. |
| PC-13 | A rename carries every Job Specific Skills question with it, and 0019 touches `department_questions` **not at all** | The mapping joins on `department_id`, so it follows the row automatically. Retiring likewise keeps its mappings dormant rather than dropping them — reactivating a department restores its full question set intact. |
| PC-14 | Department management was **already built**; it was only undiscoverable | `/admin/departments` has had create, rename, retire and reactivate since P9, all audited. Nothing was added — a link was, from the builder's department picker, because that is where somebody first notices a team is missing or wrongly named, and hunting the admin menu at that moment is how a stale department survives another cycle. |

**Departments are now the ten the owner named.** Design, Printing, KATA,
Rolling, Calendar, Fusing, HR, MIS, Operations, Sales. Rolling, Calendar and
Operations carry no Job Specific Skills questions yet and **cannot be launched
until they do** (P9-7); the builder, the departments list and 0019's own notice
all say so.

**p9b was repointed at the directory, not one file.** Five of its checks failed
on a refactor that changed no behaviour, because they read `builder-client.tsx`
by path and the builder is four files now. The same class of problem FIX-1 hit
from the other side: a rule pinned to a layout rather than to its claim. The
lead-toggle check no longer pins a variable name either — it asserts the toggle
states what it changes.

**Verification — p9b 50 checks, up from 28.** New coverage: the builder writes
only through the audited actions and imports no Supabase client; removing
deactivates and never deletes; the undo goes through the same action in reverse;
autosave debounces and flushes on `visibilitychange`; ordering has exactly one
call to `reorderQuestions`; the splitter is keyboard-operable and reports its
position; widths are fractions; the layout is remembered without a
setState-in-effect. 0019 was tested on both a fresh chain and a live-shaped
database and converges on the same ten departments either way.

**Regression: 1033 checks across 22 suites, 0 failed.** Typecheck 0 errors,
lint 0 errors (3 pre-existing warnings), build clean.

**Action required.** `0019_departments_reconcile.sql` has **not** been applied.
It supersedes `0018_retire_old_departments.sql`, which is idempotent and
harmless whether or not it ran first. Apply 0019 before the next cycle launch —
until then the picker still shows all fifteen departments.

---

### NAV-1 — The sidebar restructured, and the screens behind it

Ten admin menu items became four. Two became tabs, one empty placeholder became
a real screen, and the scorecard gained the information it was missing.

**THREE MENU LABELS CHANGED, ALL EXPLICITLY INSTRUCTED.** §0.2 fixes a menu
label once created, and the owner supplied the target structure directly. Named
here rather than absorbed into a new list:

| Was | Now | Why |
|---|---|---|
| `Question Bank` | a **tab** inside Form Builder | Two sidebar entries for one job read as two jobs. |
| `Departments & Form Builder` | a **tab** inside Settings | The name promised a builder it did not contain, and the builder exists separately. |
| `People` | `Team review` | It was an empty placeholder. It is now the staff roster and the way into anybody's scorecard. |

| # | Decision | Why |
|---|---|---|
| N1-1 | **The question bank lives at `/admin/form-builder/questions`, not `/admin/questions`** | `activeHref` picks the longest matching prefix, so nesting the route is what keeps Form Builder highlighted on both tabs — with no special case in the nav config. Putting the tab at a sibling path would have meant teaching the highlighter about a relationship the URL already expresses. |
| N1-2 | Both retired routes **redirect**; neither is deleted | HR has had `/admin/questions` and `/admin/departments` in the sidebar since P8 and P9 and will have bookmarked them. A 404 on a page that worked yesterday reads as a broken product, not as a menu that moved. |
| N1-3 | The **per-department mapping screen is not retired** | Only the list moved. `/admin/departments/[id]` is where Job Specific Skills questions are attached to a team, and the list in Settings still links to it. A test asserts the route still exists. |
| N1-4 | The Settings tab is **addressable** via `?tab=` | Without it the departments redirect would land on Users and make somebody hunt for the tab they asked for. Unknown values fall back rather than rendering a `Tabs` with no panel showing. |
| N1-5 | **Team review is a real screen, not a renamed placeholder** | Renaming a placeholder delivers nothing. It is the roster: search by name, code or designation, filter by department and stage, and every row carries the three tier scores and opens that person's scorecard. A test asserts the page no longer imports `Placeholder`. |
| N1-6 | It reads through the **authenticated** client | Every number on it is somebody's appraisal score. RLS decides what each viewer sees; the role guard is the clean exit, not the protection — the same call P16-9 made for the scorecard. |
| N1-7 | A withdrawn participant is **not** a stage | P10-6 made exclusion an `excluded_at` rather than a status. Reporting it as "in progress" would put somebody in the chase list for a form nobody is waiting on. The row says Withdrawn. |
| N1-8 | An unrated person shows an **em dash**, never `0.00` | §11 / P7-9, on the one screen showing three scores at once. A roster reading 0.00 down a column of unstarted appraisals is the kind of thing people escalate about. |
| N1-9 | **Scorecard is reached from a person, never from the menu** | A standalone "Scorecard" item has nobody to show until you pick somebody, so it would open on a picker — a menu item whose first screen is a question. Three routes now lead to the same scorecard: the roster, the MD queue's collision view, and the lead's team list. |
| N1-10 | The scorecard gained the **three-layer verdict, a section profile and a latest-verdict panel** | It had a trend chart and two tables — the history, but not the answer. The three tier scores are the answer, in the reserved colours they carry on every other screen, and the section bars are three stacked tracks rather than one because the gap between layers is the entire point and a single bar hides exactly that. |
| N1-11 | The trend delta is **green up / red down**, and that is not a tier | UI2-2. Green appears there because it describes movement, not a layer. It is the one place in the product green carries meaning, which is precisely why it is never a tier. |
| N1-12 | Job Specific Skills is **excluded from the section profile** | Already true upstream via `is_comparable` (P16-4): the questions differ per department, so plotting one department's beside another's compares two unrelated things. The scorecard is a consumer of that flag, not a second place to remember it. |
| N1-13 | **The collision view needed no work** | P14 already built everything the artifact shows: the radar, the Self / Lead / Δ / Final table with flagged rows, overrides falling back to the lead score, and the executive decision with salary, promotion, training and remarks. It is reached by opening a person from the Review & Approve queue. One thing was added — a link to that person's past cycles, because a pay decision is being made on that screen and the history is the single most useful context for one. Linked rather than embedded: the history belongs to the person, and duplicating it here would be a second place for it to drift. |

**Two suites were corrected, not loosened.** p7's menu list still guards every
remaining label character for character — it lost three entries and gained one,
and the amendment is named in the file. p9b's "the question bank stays
reachable" was asserting the NAV still referenced it; the claim is unchanged but
the bank is reachable as a tab now, so testing the nav tested the wrong thing.
Both now assert what the change actually promises: the tab strip renders on
**both** halves, and the old URL redirects rather than 404s.

**Two of my own assertions were wrong and were fixed, not deleted.** One
searched the roster source for `"0.00"` and matched the comment explaining the
rule — reporting a bug in its own documentation. It now tests the null branch.
The other three fought template-literal escaping through Python, bash and
JavaScript and were testing my quoting rather than the source; they are plain
substring checks now.

**Verification — p7 76 checks (up from 52), p9b 52 (up from 50).** New coverage:
Team review is not a placeholder and every row opens a scorecard; it reads
through the authenticated client with the guard first; withdrawn is not a stage;
missing is an em dash; both new screens take tier colours from the tier module
and use no amber or success green as a tier; the scorecard shows all three
layers, a section profile and a table fallback per chart; a redacted decision
says withheld; departments are managed from Settings with an addressable tab;
the mapping screen survives; the MD queue opens the collision view and it links
to past cycles.

**Regression: 1059 checks across 22 suites, 0 failed.** Typecheck 0 errors,
lint 0 errors (3 pre-existing warnings), build clean.

**Noted, not built by me.** `deleteDepartment` appeared in
`lib/departments/actions.ts` during this phase. It refuses while any profile or
evaluation references the department and points at deactivating instead, which
is the §17-respecting behaviour — recorded here so the phase log accounts for
every change in the tree, not only mine.

---

### NAV-2 — Scorecard in the sidebar, and the builder's preview made live

**Reverses NAV-1's scorecard decision, at the owner's instruction.** NAV-1 chose
"reached from the roster only", on the reasoning that a standalone Scorecard item
has nobody to show until you pick somebody. The owner asked for the menu entry.
It now opens on **your own** scorecard — which every employee is entitled to see
(§9) — and an administrator gets a picker to switch to anybody.

| # | Decision | Why |
|---|---|---|
| N2-1 | `/scorecard` is the **single canonical route**; `/people/[id]/scorecard` redirects into it | Two routes rendering the same screen is a drift risk, and only one of them can keep the sidebar item highlighted. The old path was canonical since P16 and is linked from the roster and the collision view, so it redirects rather than 404s. |
| N2-2 | The nav item is open to **every role** | An employee seeing their own result is §9, not a privilege. Restricting it to administrators would have meant either hiding it from the people it is about, or building a second employee-facing route for the same screen. |
| N2-3 | A `?person=` the viewer may not see is **ignored, not refused** | Answering "you may not see that person" turns the query string into a way to find out who exists. It silently falls back to their own card; RLS is what actually decides what the page can read (P16-9). |
| N2-4 | Own card **drops the parameter** rather than writing `?person=<self>` | `/scorecard` stays the canonical URL for "mine", so the sidebar link matches it exactly and the item highlights. |
| N2-5 | **The renderer now anchors sections** | Questions were already addressable — P12 added `id="q-…"` for "jump to the first error". Sections were not, which is precisely why the preview could not be pointed at one. Two lines in the shared renderer, and both panes get the behaviour. |
| N2-6 | The preview scrolls **within its own pane**, never the page | `scrollIntoView` on a nested scroller happily moves the window too. On a three-pane screen that drags the structure list and the editor out of view in order to show something in the third pane — the fix looking exactly like a new bug. Offsetting against the scroller is what keeps the movement local. |
| N2-7 | Question first, section second | Selecting a question is the more specific intent, so it wins. Opening a section with nothing selected scrolls to the section head. Falling back the other way would ignore the click somebody actually made. |
| N2-8 | The edited question is **tinted, not bordered**, and an error still wins | A border would shift the row by a pixel as the highlight moves between questions — the same reason P7-8 made the rating cell's selection a ring. And a highlighted row that is also invalid has to read as invalid first, so `highlighted && !error`. |
| N2-9 | The open section moved **up to the builder** | The preview and the structure pane both need it. Two components each holding their own copy is how they end up disagreeing about what is on screen — the same reasoning as UI2-11. |
| N2-10 | A structure row shows **two lines of the question**, not one truncated line | A question truncated at four words is not identifiable, and identifying questions is the entire job of that list. Below it: type, who answers, whether it is conditional, whether it is optional — the four things that change how a question behaves. |
| N2-11 | "Who answers" is tagged **only when it is not both** | Most questions are answered by both sides. Tagging every one of them puts a badge on thirty rows and teaches people to stop reading badges. |
| N2-12 | Counts are **worded**, not bare numerals | An "8" beside a section name reads as an index as easily as a total. "8 questions" cannot be misread. |
| N2-13 | Details carries a **padlock** | It is drawn from the profile and the evaluation record and is not authorable (P12-14). A section that silently does nothing when clicked reads as broken; one that says it is locked reads as deliberate. |

**A testing habit corrected, for the fourth time.** Three new assertions failed
against correct code because they searched a whole file for a string that also
appears in the comment explaining that string. `scrollIntoView` was the worst
case: the assertion asserting its absence matched the sentence saying why it is
absent. **An absence assertion must target the call syntax — `.scrollIntoView(`
— never the bare identifier**, and that rule is now written where the next
person will read it rather than rediscovered a fifth time.

**Verification — p7 76 checks, p9b 67 (up from 52).** New coverage: the renderer
anchors both sections and questions; the preview prefers the selected question
over the open section; it scrolls the pane and not the page and honours
`prefers-reduced-motion`; the highlight is applied and an error outranks it; the
open section has exactly one owner; the structure pane shows two lines per
question, plain-language types, conditional and optional markers, worded counts,
a locked Details section and a real empty state. Plus the scorecard's single
canonical route, both entry points linking to it, and the picker being
administrator-only.

**Regression: 1079 checks across 22 suites, 0 failed.** Typecheck 0 errors,
lint 0 errors (3 pre-existing warnings), build clean.

---

### NAV-3 — The scorecard made complete

Scorecard moves to second in the sidebar, and the screen stops being a page of
em dashes for anybody who is not already finished.

**Two things were wrong, and only one of them was "it looks empty".**

| # | Decision | Why |
|---|---|---|
| N3-1 | **"By section" was showing the DEPARTMENT average, not the person's** | It read `v_section_scores`, which is per (cycle, department, section, layer) — an average across everybody in the team. Under a heading carrying one person's name that reads as their profile, and it is not. Their sections are now derived from their own answers. A screen that quietly attributes the team's numbers to an individual is worse than one showing nothing. |
| N3-2 | **Scores are the LAST thing to exist, so the card had nothing to say until the end** | Every panel keyed off a finalised score, so an in-flight evaluation rendered dashes in every slot — which reads as broken, not as early. The card now leads with where the cycle actually stands: who it is with, what happens next, the three stage deadlines, and §8's rail. |
| N3-3 | Per-question detail goes through **§11's `scoreValue`** | It is the one implementation of "what is this answer worth" — only SCALE_0_5 counts and TICK_3 converts through the 5/3/1 mapping. A second numeric reading on this screen would eventually disagree with the stored overall, about somebody's appraisal. |
| N3-4 | The detail is read through the **authenticated** client, and §9 is not reimplemented | RLS already decides which layers a viewer may read. An employee whose cycle withholds detail simply gets no LEAD column — rather than the page carrying its own copy of the disclosure rules and drifting from the policy the first time one changes. |
| N3-5 | The settled value per question is **final ?? lead ?? self** | The same precedence §11 uses to resolve a score, so "strongest" and "where to focus" cannot rank by a number the stored overall disagrees with. |
| N3-6 | The gap panel is signed **Lead − Self**, matching the collision view | Somebody who sees both screens must see the same sign. It flags at §11's threshold of 2 and says plainly that a gap is not a mistake — it is the conversation worth having. |
| N3-7 | The rail uses the **employee vocabulary** when somebody views their own card | P7-6: an employee never sees a raw status enum. Whether the MD has finalised is not their business until disclosure. An administrator viewing the same card gets the internal wording, because for them it is a queue. |
| N3-8 | The trend chart only renders with **more than one cycle** | A trend line through a single point is not a trend; it is a dot on an axis, which is exactly what the screenshot showed. |
| N3-9 | Every headline tier now carries a **second line** — the delta, or why there is none | An em dash with nothing beside it is ambiguous between "not rated" and "rated zero". §11 is explicit that missing is not zero, so the card says which. |
| N3-10 | Scorecard sits **second**, after Dashboard | At the owner's instruction. The pairing is right: the dashboard says how the company is doing and this says how you are. |

**What the card now shows, in order:** identity and the three layers with
movement since last cycle · where this cycle stands, with stage deadlines and
the rail · the trend, once there is more than one cycle · strongest and
where-to-focus, from the rated answers · the person's own section profile ·
the verdict · where self and lead differed by 2 or more · every rated answer ·
every cycle.

**One stale assertion was corrected, not deleted.** p7 asserted the section
profile came from `latestSections` — the department average, which is precisely
what N3-1 removed. Two checks now hold the new rule from both sides: the
sections come from `card.questions`, and `latestSections` does not appear in the
component at all, so quietly reverting to the department numbers fails.

**Verification — p7 87 checks (up from 76).** New coverage: an in-flight cycle
shows its state rather than empty scores; the rail uses the employee vocabulary
for a self-view; the card names what is outstanding; section scores come from
the person's own answers and the department view is not passed off as theirs;
strengths, focus areas and the self-versus-lead gap are present with the gap
signed as §11 defines it; every rated answer is listed; and the per-question
numbers go through `scoreValue` with no second mapping, read through the
authenticated client.

**Regression: 1090 checks across 22 suites, 0 failed.** Typecheck 0 errors,
lint 0 errors (3 pre-existing warnings), build clean.

---

### STATUS — where the build stands (as of P30)

**This section supersedes every earlier "Still to do" list in §18**, including
the version written at P23, which predated everything from P24 onward. The phase
entries above are the record of what each phase did and are never edited; this
is the single current answer to "what is left". **Rewrite this section when it
drifts, rather than adding a second list somewhere else.**

#### Deployed

The app is on Vercel from `github.com/harshalilinkd/Evaluation-System` (private),
functions pinned to `bom1` because Supabase is `ap-south-1` — they were on
opposite sides of the world, which was the whole of the "deployed app is slow"
report.

#### Must happen before anybody is appraised for real

1. **`NEXT_PUBLIC_APP_URL` is still `http://localhost:3000` on the deployment.**
   Every invite link on both channels is therefore a bare path that opens
   nothing. `absoluteUrl()` now refuses to build one (P30) rather than sending
   it, so this fails loudly instead of silently — but it is still the single
   thing standing between the system and working end to end. Set it and
   **redeploy**: `NEXT_PUBLIC_*` is baked in at build time.
2. **Email needs its credentials.** AMEND-4 added SMTP so it can send from a
   Gmail account; `SMTP_USER`, `SMTP_PASSWORD` (a 16-character App Password)
   and a matching `MAIL_FROM` are not set yet. WhatsApp works without this.
3. **Migrations 0038 and 0039 may be unapplied.** 0020–0037 were confirmed by
   the owner. Without 0038 an evaluation with both sides submitted sits at OPEN
   and never reaches HR. `supabase/whats-applied.sql` answers this in one paste.

#### Built and working

Everything in §18 above, and since P23: the worker appraisal form in the Form
Builder (P24) · editable section names and order (P25) · the thank-you dialog
(P26) · the redesigned print pack and the company mark (P27) · the invite-link
and email preflight (P28) · corrected dashboard encodings with table views
(P29) · one link builder that cannot emit a broken URL (P30) · SMTP email
(AMEND-4) · the cycle type on screen · the cycle activity trail · bulk question
import with the 116 job-specific questions prepared.

Repairs since P23 worth knowing about, because each was invisible until it bit:
autosave gated on retired statuses (FIX-2), a save/submit contract that lost
work (FIX-3), a draft mirror that destroyed the draft (FIX-4/6), `INSERT …
RETURNING` needing a SELECT policy so only the HOD could submit (FIX-10), and
§8's both-sides-in transition that nobody had the standing to make (FIX-11).

#### Genuinely outstanding

| Area | What is missing |
|---|---|
| **A real end-to-end run** | Still the highest-value thing left. Nothing has been driven from launch to close against live data. Every fix since P23 was found by the owner using the product, not by the suites. |
| **The test suites** | Live in a scratch directory outside the repository and are largely gone. Every claim in §18 up to P23 rests on them. New work since is covered by one-off scripts, also outside the repo. |
| **Worker module (§7)** | The FORM exists (P24). The appraisal does not: no `worker_evaluations`, no worker cycle, no supervisor screen, no worker print pack. §8's worker transition table still describes something that does not run. |
| **Section names are half-dynamic** | Every rendered FORM uses HR's names (P25). Screens that call `sectionLabel()` for their own chrome — the question-bank filter, the departments mapping screen, the scorecard section profile, the cycle wizard — still show the shipped defaults. |
| **Palette** | The validator reports two real failures nobody has acted on: light-mode green↔cyan below the normal-vision floor, and dark-mode green and amber outside the lightness band (P29). Both are §2 token changes. |
| **Exports** | CSV exists for department scores, the employee and employment imports, and the question bank. P16 asked for it on every table. |
| **Performance** | P16's "under one second with 500 evaluations" is indexed for and has never been measured. |
| **CSV import: update** | The employee import creates people but cannot amend them; re-uploading a corrected file fails on the duplicate email. The employment and question imports do update. |
| **`?increment_for=`** | `/admin/increments` links to `/admin/cycles/new?increment_for={id}` and the wizard ignores the parameter. |
| **On-demand due sweep** | `compute_due_items` runs only from the nightly cron, so somebody entered today does not appear on `/admin/due` until tomorrow. |

#### Standing risks

- **The Maytapi token has never been rotated** after being handled in a session;
  the owner declined at the time.
- **`finalise_evaluation` still exists in the database** with no caller. 0014 is
  applied and §0.8 forbids editing it, so it stays.
- **Gmail as the mail sender** (AMEND-4) caps at ~500/day, locks the account
  rather than failing the message, and ties company mail to a personal account.
  `send.linkdprints.com` via Resend remains the better answer and is a settings
  change, not a code change.

### AMEND-2 — Two cycle types, blind parallel rating, and HR/MD split again

**Constitution only. No code, schema or test was changed in this phase.** Seven
targeted amendments were applied to §1, §5, §6, §8, §9, §11 and §17 at the
owner's explicit instruction. Everything below is now a **divergence between the
constitution and the running system**, and the code is what is wrong.

**What changed.**

| § | Amendment |
|---|---|
| 1 | The second defining idea is now **blind parallel rating** — employee and HOD rate the same form at the same time, neither ever seeing the other. A third idea added: a cycle has a **type**, EVALUATION or INCREMENT, differing only in how it ends. |
| 5 | Three invariants added: **Blindness**, **Salary confinement**, **No score overrides**. |
| 6 | `cycle_scope` added to the question fields — BOTH / EVALUATION_ONLY / INCREMENT_ONLY, filtered at assembly alongside track and department. |
| 8 | The staff state machine **replaced entirely**: `DRAFT → OPEN → PENDING_HR_REVIEW → HR_APPROVED → MD_REVIEWED → CLOSED`, with `INTERVIEW_DONE` inserted for INCREMENT cycles. Layer submission is tracked by timestamps, not by status. |
| 9 | **AMEND-1 reversed.** HR_ADMIN and MD are distinct again, and the access matrix is replaced. |
| 11 | Variance and MD override replaced by **Gap**, a reporting figure only. There is no final score column and no override. |
| 17 | Four prohibitions added: no cross-layer exposure, no salary where a HOD or employee can read it, no editing a submitted score, no advancing to the MD without HR review. |

**The reversal, stated plainly.** AMEND-1 merged the two administrative roles
and recorded the consequence: no second pair of eyes on a pay decision. The v3
flow restores it by construction — HR prepares and reviews, the MD approves —
and that only works if the roles are distinct. `0012_merge_hr_md.sql` is
therefore no longer the constitution's position.

---

#### The `is_admin()` / `ADMIN_ROLES` audit §9 requires

**38 `is_admin()` call sites in SQL, across 3 migrations. 28 `ADMIN_ROLES` uses
in TypeScript, across 23 files.** Every one is classified below. Nothing has
been changed yet — this is the report, and the work list.

**SQL — must be split (config write is HR-only now; MD reads).** Sixteen
policies in `0012_merge_hr_md.sql` gate configuration on `is_admin()`, which
under the new §9 grants the MD write access they should not have:
`departments_hr_all`, `questions_hr_all`, `question_options_hr_all`,
`department_questions_hr_all`, `evaluation_cycles_hr_all`, `user_roles_hr_all`,
`profiles_hr_update`, `profiles_hr_insert`, `evaluation_questions_hr_insert`,
`evaluations_hr_draft_insert`, `evaluations_hr_draft_update`,
`evaluations_hr_draft_delete`, `invite_tokens_hr_select`. Each needs
`is_hr()` for write and `is_hr() or is_md()` for read.

**SQL — must be split differently (salary).**
`evaluation_decisions_md_insert` and `evaluation_decisions_md_update` currently
give both roles full write. The new matrix gives HR read/write on the salary
block and the MD read/write on **the final amount only** — one predicate cannot
express that, so these need column-level separation or two paths.

**SQL — superseded outright.** `apply_evaluation_transition` (0012) encodes the
old seven-row §8 table and `finalise_evaluation` (0014) encodes the MD-override
model §11 has just removed. Both are replaced by the new state machine, not
patched.

**SQL — `is_admin()` may remain, with justification.**
- `log_admin_action` (0012) — recording an administrative action is a power both
  roles genuinely hold: HR for configuration, the MD for review and remarks.
  §12 needs both in the audit trail and the actor is taken from the session, so
  the predicate is truthful.
- `set_outbound_paused` (0016) — silencing outbound messages is an operational
  brake either administrator should be able to pull. Both directions are
  audited.
- `merge_evaluation_answers` (0012) — **not actually an admin gate.** It
  branches on layer ownership (`Only the employee can write their own
  self-evaluation`), and the `is_admin()` reference there is incidental to the
  system-actor path. It needs re-reading under the blindness invariant rather
  than a role swap.

**TypeScript — 15 `checkRole(ADMIN_ROLES)` and 13 `requireRole(ADMIN_ROLES)`.**
The split falls out of the new matrix:
- **Config screens and actions → HR write, MD read.** `admin/cycles/*` (5
  routes plus `lib/cycles/actions.ts`), `admin/form-builder` and its questions
  tab plus `lib/questions/actions.ts`, `admin/departments/[id]` plus
  `lib/departments/actions.ts`, `admin/settings` plus `lib/auth/provisioning.ts`.
- **MD-owned → MD write, HR read.** `review/page.tsx` and
  `lib/review/actions.ts` — the MD review and remarks row of the matrix.
- **Genuinely both, no change needed.** `admin/people` (Team review is a read),
  `scorecard/page.tsx` (the `privileged` flag only decides whether the person
  picker renders; both roles see everyone), `print/cycle/[id]`,
  `print/summary/[cycleId]`, `lib/notify/actions.ts` (distribution is an HR job
  but the MD resending a link is harmless and audited).
- **The constant itself.** `lib/auth/roles.ts` defines `ADMIN_ROLES`. It should
  survive only as "both administrators", never as a permission — A1-3 made it
  the single expression of the merge, and grepping it is how every affected site
  was found here.

---

#### What this phase did NOT do

No migration was written. No policy, action, screen or test was touched. The
running system still implements AMEND-1's merged roles, the old six-status
state machine, MD overrides and a final score column. **The regression suites
still pass against the code, which now contradicts §§1, 5, 6, 8, 9, 11 and 17
of this document.**

Nothing in the amended sections is safe to rely on until that is closed. The
first migration of the next phase should be numbered `0020_`.

---

### AMEND-3 — Blind parallel rating. Capability removed on purpose.

Migrations `0020_blind_rating_enum.sql` and `0021_blind_rating.sql`. The lead's
paired review screen, the collision view's place in the product, and the lead's
ability to return a form are all **deleted**. That is the phase, not a side
effect of it.

**Three corrections to the brief, flagged rather than absorbed.**

| Brief | Reality | Taken |
|---|---|---|
| `0014_blind_rating.sql` | 0014 is `0014_md_finalise.sql` and is applied | `0021_`, and `0020_` for the enum |
| "drop the RLS policy added in **0013** that lets a lead read the SELF layer" | **0013 does not touch `evaluation_responses` at all** — it adds one `audit_log` policy. The lead's SELF read comes from **0005**'s `responses: read SELF layer`, via `can_see_evaluation()` | Revoked at 0005's policy; intent unchanged, target corrected |
| one migration | `alter type … add value` cannot be USED in the transaction that adds it | Split: 0020 adds the labels, 0021 uses them |

| # | Decision | Why |
|---|---|---|
| A3-1 | `can_see_evaluation()` is **left alone**; the SELF policy stops calling it | It is still the truthful answer to "may this person see that this evaluation exists", which the lead still may. What changes is that seeing the record no longer implies reading both sides. Narrowing the helper would have silently changed every other policy that calls it. |
| A3-2 | The evaluatee's read of the LEAD layer is **gone at every status** | 0005 admitted it at CLOSED under FULL disclosure. Item 3 is explicit that no policy may grant it at any status. If lead narrative ever needs to reach an employee it goes through a curated report field — a deliberate act of authoring, not a raw layer surfacing on a status change. Proved at all five statuses plus CLOSED-with-FULL. |
| A3-3 | A layer's write gate is its **own timestamp**, not the record's status | §8: "a layer locks on its own submission, independently of the other layer and of the status." `self_open()` / `lead_open()` are what make that true in SQL. `self_skipped` closes the layer too — HR advancing past a missing side must not leave it writable. |
| A3-4 | The four pre-blind statuses **stay in the enum**; a CHECK retires them | Item "do not drop an enum value that historical rows use". An `audit_log` diff quoting `SELF_SUBMITTED` is exactly such a row. Readable forever, writable never. |
| A3-5 | The status migration **counts before and after and refuses to differ** | A status migration that loses a row is not noticed until a cycle will not close. It also raises if any row still carries a retired value. |
| A3-6 | `OPEN → OPEN` twice, told apart by `locks` | A layer submission no longer moves the record, so `from`/`to` stop identifying a transition. The same discriminator is used in the SQL CASE and in `findTransition`, so the two halves cannot drift — which is the whole reason P5-1 duplicated the table in the first place. |
| A3-7 | The lead's **return is deleted**, not disabled | A lead cannot return a form they cannot see. §8 gives returns to HR — the only role that can read both sides and therefore judge whether one needs sending back. |
| A3-8 | The queue **does not fetch** `self_submitted_at` | Fetching it and choosing not to render it leaves the leak one careless line away. Not fetching it keeps the signal out of the process. The row type cannot carry it either, so a future field cannot quietly reintroduce it. |
| A3-9 | The queue sorts by **due date**, not by how long each report has been waiting | The old sort ranked by time since the employee submitted — the ordering was itself a readout of the other side. |
| A3-10 | "In progress" reads the **LEAD layer only** | It needs to know a draft exists. Reading the only layer 0021 leaves the lead able to see means this query cannot become a leak even by accident. |
| A3-11 | The paired mode is **removed from the renderer**, not left for the worker module | Item 10 keeps it only if the worker module uses it. No `worker_` table exists and no caller passes `pair`. `AnswerReadout`, `ScoreChip`, `readableAnswer` and `TIER_BAR` went with it — every one existed solely to draw the other layer's answer. |
| A3-12 | The lead is told **at launch**, not when the employee submits | Item 11. The old `leadReviewPending` fired on the employee's submission, which is a readout of their progress. Both layers open together now, so launch is when the lead's form actually opens. A layer submission raises **nothing at all** — neither side is told anything about the other. |
| A3-13 | An HR return messages **only the side that was unlocked** | `returned_to` decides. A return of one layer says nothing about the other, and telling both would report each side's state to the other. |
| A3-14 | `requireEvaluationAccess(_, "md")` now admits **the MD alone** | AMEND-2 reversed the 0012 merge, and this guard still had `isMd \|\| isHr`. The retired screens are guarded by `requireRole(["HR_ADMIN"])` directly instead, because a retired screen wants the opposite of the live rule. |

**Not enforced, and said plainly.** §8 scopes `MD_REVIEWED → CLOSED` to
EVALUATION cycles and `MD_REVIEWED → INTERVIEW_DONE` to INCREMENT cycles.
**`evaluation_cycles` has no `cycle_type` column.** AMEND-2 introduced the idea;
no migration has added it; §0.4 forbids inventing one. Both endings are
reachable until it exists. Same for `requireInterviewRecord`, which passes
because there is no interview record in the schema to check, and for
`requireSalaryComplete`, which can only verify a salary block that has been
started rather than require one.

---

#### Acceptance

Run under `set role authenticated` with a JWT subject — PGlite connects as
superuser and bypasses RLS, so without the role switch every assertion would
pass while proving nothing.

```
BEFORE: CLOSED=1, CYCLE_ACTIVE=1, DRAFT=1, LEAD_REVIEWED=1, MD_FINALIZED=1, SELF_SUBMITTED=1
AFTER:  CLOSED=1, DRAFT=1, MD_REVIEWED=1, OPEN=2, PENDING_HR_REVIEW=1        (6 rows → 6 rows)

lead reading SELF layer of their own report: []                    → 0 rows
lead reading ALL layers:                     ["LEAD"]
employee reading LEAD layer at OPEN                                → 0 rows
employee reading LEAD layer at PENDING_HR_REVIEW                   → 0 rows
employee reading LEAD layer at HR_APPROVED                         → 0 rows
employee reading LEAD layer at MD_REVIEWED                         → 0 rows
employee reading LEAD layer at CLOSED                              → 0 rows
employee reading LEAD at CLOSED + FULL disclosure                  → 0 rows
HR reading both layers:                      ["LEAD","SELF"]
MD reading both layers:                      ["LEAD","SELF"]
```

`/team` shows no indication of the employee's side: the query does not select
it, the row type cannot hold it, the three tiles and the filter count the lead's
own state, and the sort is by due date. The collision view is unreachable from
any navigation — `nav-config.ts` has no entry, and both retired screens are
`HR_ADMIN`-guarded and banner-marked.

**Tests were rewritten to assert blindness, never deleted.** p13's seven
paired-rendering checks now assert the paired layout is gone, the renderer takes
no second layer, the lead is never blocked on the employee, and the screen
states why. p4-pure's independent §8 transcription is thirteen rows instead of
seven and asserts that HR may not record the MD's review — the second pair of
eyes, checked from both sides. New suite **p18** carries the acceptance run.

**Regression: 1129 checks across 23 suites, 0 failed.** Typecheck 0 errors,
lint 0 errors (4 pre-existing warnings), build clean.

---

#### Two things worth recording against myself

**I destroyed `form-renderer.tsx` with a careless regex** — a `[\s\S]*?` delete
that matched far more than intended, leaving 8 lines of a 625-line file. There
is no VCS in this project. It was recovered in full from `sourcesContent` in a
`.next` build sourcemap, and the AMEND-3 edits were then reapplied as exact
string replacements with the line count checked at each step. **A destructive
regex over a whole file is not an acceptable editing tool here**, and the
recovery only worked because a build happened to be on disk.

**The comment-matching trap, for the fifth time.** Three assertions failed
against correct code because the identifier they asserted was absent also
appeared in the comment explaining its absence. p18 now carries a `code()`
helper that strips comments before any whole-file absence check. That is the
general fix the previous four one-off corrections should have been.

---

#### Still outstanding after this phase

`/reports` does not exist. Both banners point at it, `mdReviewPending` and
`evaluationFinalised` link to it, and §8's `PENDING_HR_REVIEW` and
`HR_APPROVED` statuses have no screen. **HR currently has no way to review a
record or advance it to the MD**, and the MD has no way to record a review —
the transitions exist and are guarded, but nothing calls them. That is P20, and
until it lands a launched cycle can reach `PENDING_HR_REVIEW` and stop there.

---

### P10-REV — Cycle type, dual dispatch, and copy that matches v3 (INCOMPLETE)

**⚠ THIS PHASE IS NOT FINISHED. The regression is at 980 passed, 15 failed.**
Typecheck 0 errors and the build is clean, but twelve assertions genuinely fail
and three suites crash in the batch runner while passing standalone. Details at
the end — do not treat this entry as a completed phase.

Migrations `0022_cycle_type.sql`. **The brief names the file `_cycle_type.sql`
with no number; 0021 is taken, so §0.8 makes it 0022.**

#### What is done and verified

| # | Decision | Why |
|---|---|---|
| PR-1 | `cycle_type`, `cycle_kind`, `default_self_days`, `default_lead_days` are **text with CHECKs, not enums** | AMEND-3 spent a whole migration working around the fact that an enum value cannot be dropped once a row carries it. These two lists are young enough that getting them wrong is likely, and a CHECK can be replaced. |
| PR-2 | **`cycle_scope` finally exists** | AMEND-2 §6 defined it and no migration ever added it, so the salary-expectation question had nowhere to live. Assembly now filters on it beside track and department, and the question is seeded INCREMENT_ONLY + EMPLOYEE_ONLY — the HOD never sees it, and §5's salary confinement keeps the figure to HR and the MD. |
| PR-3 | `disclosure = FULL` is **retired by CHECK, not dropped** | It contradicted §5's blindness and 0021 had already deleted the RLS branch honouring it, so it was an option promising something the database refused. Existing FULL rows are migrated to SCORE_AND_DECISION. The enum value stays for history. Zod refuses it at the boundary too, so HR reads a field error rather than a constraint violation. |
| PR-4 | Evaluations carry **their own due dates** | A rolling cycle gives two people in the same cycle different deadlines, so the cycle's dates stopped being the answer. Backfilled from the cycle, which is exactly what BATCH would have set. |
| PR-5 | **An invite token names its layer** | Item 14e. Without the column a token is scoped to an evaluation and both links open the same screen. The unique index moved from (evaluation, channel) to (evaluation, **layer**, channel) so the two links coexist — and resending one no longer silently revokes the other. |
| PR-6 | **Token hashes come in on the launch payload; plaintext never touches SQL** | `gen_random_bytes` exists in Postgres, but the plaintext would then have to be RETURNED from `launch_cycle` to be sent — putting a live secret in a result set and from there in any log that records one. TypeScript generates the pair, sends the SHA-256, keeps the plaintext in memory for the dispatch after the commit. Same split as P10-2. |
| PR-7 | `launch_cycle` creates **both** response rows and **both** tokens, all-or-nothing | The lead is a recipient from launch now, not from the employee's submission, so their form must exist to open and their link must exist to send. |
| PR-8 | **Their own HOD is now a hard block**, in the wizard AND in `launch_cycle` | P10-7 dropped the database constraint precisely so this case could be reached and named. Under blind rating it is no longer merely odd: that person fills both sides and sees both, which breaks §5 outright. "Themselves" is no longer offered in the picker at all — an option that always blocks the launch is not a choice — and the MD is offered first as the alternative. |
| PR-9 | A HOD with no contact details **blocks** the launch | It was a warning while only the employee received a link and HR could hand it over. Both people are recipients now, and a HOD who cannot receive their form cannot rate at all. |
| PR-10 | `leadReviewInvite` is a **new template**, not a reworded `leadReviewPending` | The old one said "{employee} has submitted their self-evaluation" — true under the sequential flow, a leak under blind rating. The new one states only that the form is open and when it is due. |
| PR-11 | Dispatch runs **after** the commit, capped at 10 per HOD | A provider outage must not roll back a launch that is already durable and audited (PW-2). The cap stops a HOD with thirty reports receiving thirty messages in a minute; the remainder is left for the cron sweep, which chases against each evaluation's own due date. |
| PR-12 | Board columns are the **v3 statuses**, and the two sides are **two chips** | The old columns were "Self submitted" then "Lead reviewed" — a sequence that no longer exists. Which side has come in is a property of the row, not the column. Two chips rather than "1 of 2 submitted", because HR needs a name to chase, not a number. Interview is dropped from an evaluation cycle rather than standing empty. |

#### Two regressions I introduced and then fixed

- **I dropped the launcher's name** from `launch_cycle`'s already-launched error,
  replacing it with "somebody else". The name lives only in the audit row and is
  the one actionable thing in that message. Restored.
- **I renamed the audit action** `invite.attempt` → `invite.attempted` in
  `verify_invite_token`. The rate limiter counts that action, so the rename
  silently disabled §10's ten-attempts-per-hour lock. Restored.

Both were caught by suites that only started exercising the new code once their
migration chains were extended — which is the FIX-1 lesson landing again: **the
suites had been running against a database that stopped at 0017**, so nothing
after AMEND-3 was being tested at all. All thirteen were extended to the full
chain, and that is what surfaced these.

#### What is NOT done

- **`/admin/due` does not exist.** Item 5 and the acceptance both reference it as
  where rolling-cycle people appear. A rolling cycle can now be created and
  launched with zero participants, but there is no screen to add people as their
  dates arrive, so a rolling cycle currently goes nowhere.
- **Item 19's UI.** The `advanceWithoutOneSide` action is written, guarded and
  wired to §8, but no row menu item calls it and there is no confirmation dialog
  naming what is missing.
- **The acceptance list is unverified.** None of the nine acceptance criteria has
  been proved end to end — in particular "3 evaluations, 6 response rows, 6
  tokens, 6 messages" and "a lead's token opens the lead form and returns
  not-authorised for the employee's", which is the security-critical one.

#### The 15 failures

| Suite | Failing | Nature |
|---|---|---|
| p6 | 7 | `verify_invite_token` gained a `layer` column and the suite reads its result positionally. The observed values are correct (ten VALID then LOCKED); the assertions compare the wrong shape. Test-side, but unconfirmed. |
| p5 | 2 | `rls.sql` — one HOD write assertion still assumes the pre-blindness policy. |
| p16 | 2 | Analytics views read statuses that no longer occur. |
| p14 | 1 | `finalise_evaluation` is legacy and cannot run from `PENDING_HR_REVIEW`; the message assertion is stale. |
| p4-sql, p10, p18 | crash in the batch runner only | All three pass standalone (15/0, 44/0, 19/0). Likely resource pressure from 23 sequential PGlite instances, not a code fault — but it is unproven, and a suite that passes alone and fails in the run is not a passing suite. |

---

### P19 — Employment and compensation master data

Migration `0023_employment.sql`. **The brief names it `0015_employment.sql`;
0015 is `0015_views.sql` and is applied, so §0.8 makes it 0023** — the same call
as 0010, 0017, 0021 and 0022.

This phase holds the most sensitive data the system has ever carried, so every
decision below was taken as a privacy decision first.

| # | Decision | Why |
|---|---|---|
| P19-1 | **No salary column on `profiles`** | The brief forbids it and the reason is worth stating: every screen in the product selects from profiles, several through long literal select strings, and one column there would surface in a dozen places nobody would think to check. A test asserts profiles carries nothing matching `ctc`, `salary` or `compensation`. |
| P19-2 | An employee's own dates come from a **view with no salary column**, not a filtered read | RLS is row-level. A policy admitting somebody's own `employment_records` row hands them every column in it, `current_ctc` included — RLS cannot mask a column. `v_my_employment` selects four columns and none of them is money, so the absence is structural rather than a policy anybody could widen. P5-4 made this exact call for the MD response row. |
| P19-3 | `salary_history` is append-only by **trigger as well as by policy** | P4-4's reasoning applied to pay. No UPDATE or DELETE policy exists for anyone — absence is the enforcement (P5-9) — but RLS alone would not deliver it: the service-role client used by cron bypasses RLS entirely, and so does any future migration. The trigger holds for every caller, and the suite proves it by failing an UPDATE **as superuser**. |
| P19-4 | `is_admin()` is not used anywhere in this migration | AMEND-2 retired it for every evaluation, report, decision and salary gate. These are the most salary-shaped gates in the system, so each names the specific role §9 gives it: HR writes the record, HR and the MD both read, both may append pay history. |
| P19-5 | **`next_increment_date` is derived by trigger and has no input field** | A form field would be a second implementation of a rule the database already owns, and the two would disagree the first time somebody changed the frequency. The screen renders it read-only with the reminder date beneath in plain words. |
| P19-6 | The recalculation touches **only a PENDING reminder** | One already SENT is a record that HR was told; one ACTIONED is a record that they did something. Rewriting either because a date moved afterwards would erase what actually happened. |
| P19-7 | `previous_ctc`, the hike and the percentage are **computed server-side**, never accepted | A caller that could send its own previous figure could write a history that disagrees with the record it came from — and this table's only job is to be evidence. |
| P19-8 | A pay change **requires a reason and a note** | Optional would mean "usually blank". A pay change with no explanation is the thing somebody has to reconstruct from memory two years later. |
| P19-9 | A CORRECTION dated before the current effective-from **does not move today's figure** | It is fixing the past. An unconditional update would let a backdated correction silently overwrite a later, correct salary. |
| P19-10 | **No salary figure appears in any audit diff** | §12 wants the change recorded and §5 forbids the figure leaving HR and the MD. 0013 lets a lead read `audit_log` for their own reports, so a CTC in a diff would walk straight past the confinement invariant. The diffs carry dates, the employment type, the reason and the row id — enough to find the record, nothing to read off it. A test parses every `p_diff` in the module and asserts none matches `ctc`, `salary` or `hike`. |
| P19-11 | Overdue on the calendar is **not** a `StatTone` | `StatTone` has no critical member, and adding one would put a reserved-looking colour on a tile component every screen uses. Overdue is not a tier — it is a failure. The count carries the warning in its caption, and each late row in the table takes a rose left bar and a day count, so colour is never the only signal (§13.8). |

#### Acceptance — the negative cases, pasted

Every read runs under `set role authenticated` with a JWT subject. PGlite
connects as superuser and bypasses RLS, so without the role switch all of this
would pass while proving nothing.

```
a HOD selecting employment_records    → []      ZERO rows
a HOD selecting salary_history        → []      ZERO rows
a HOD selecting increment_reminders   → []      ZERO rows
an employee selecting employment_records   → []  ZERO rows
an employee selecting salary_history       → []  ZERO rows
an employee selecting increment_reminders  → []  ZERO rows

HR reads employment_records and salary_history        ✓
the MD reads employment_records and salary_history    ✓
a HOD attempting to change somebody's CTC             → refused, value unchanged

UPDATE salary_history as superuser  → refused by trigger
DELETE salary_history as superuser  → refused by trigger
policies on salary_history          → SELECT and INSERT only

last_increment_date 2025-04-01, frequency 12  → next 2026-04-01, remind 2026-03-01
frequency changed to 6                        → next 2025-10-01
the stale reminder is deleted, not duplicated → 1 row

an employee reading v_my_employment → their own dates, and the view has no
                                      ctc/salary column at all
a HOD reading v_my_employment       → 0 rows
profiles                            → no ctc/salary/compensation column
```

Plus source-level: both salary screens guarded to `["HR_ADMIN", "MD"]`, the
Increments menu restricted to the same two, and **no salary identifier in any
lead-facing or employee-facing screen** — `/team`, the lead review, the
self-evaluation, the scorecard and the team queue are each checked with comments
stripped, along with every file under `app/print`.

**p19: 39 checks, 0 failed.**

#### What is NOT done

- **The CSV bulk import.** Not started. The initial load still has to go in one
  person at a time through the Employment tab.
- **"Start increment" links to `/admin/cycles/new?increment_for={id}`** and the
  wizard ignores that parameter — the link opens a blank cycle rather than one
  pre-seeded with that person.
- The **WhatsApp reminder** to HR one month before an increment is due: the
  `increment_reminders` rows are created and kept correct, and `remind_on` is
  right, but nothing sends them. The cron route does not know about this table.

#### Regression

**1017 passed, 17 failed** — p19 is green, and the 17 are the P10-REV debt this
phase did not touch: p6 (7), p5 (2), p16 (2), p14 (1), and three suites that
pass standalone but crash in the batch runner. p7's menu list gained
"Increments" and is green again. Typecheck 0 errors, lint 0 errors (5
pre-existing warnings), build clean.

---

### P19-B — One joining date, a person you can actually enter, and three bugs the regression was hiding

Migrations `0024_one_joining_date.sql`, `0025_reassign_lead_blind.sql`,
`0026_invite_status_ok.sql`, `0027_cycle_progress_blind.sql`.

Two pieces of work. The first is what was asked for. The second is what running
the regression properly turned up — and it turned out the regression had been
lying for three phases.

#### Part 1 — the duplicate joining date, and the five-field form

0001 gave `profiles` a `date_of_joining`. 0023 gave `employment_records` a
second one and made it NOT NULL. They were written and read by different code:

| | written by | read by |
|---|---|---|
| `profiles.date_of_joining` | **nothing** — no form collected it | the scorecard, the print pack |
| `employment_records.date_of_joining` | the Employment tab | the increment calendar |

So the scorecard and every printed evaluation showed a joining date no screen
ever set — permanently blank — while the Employment tab filled a different copy
those screens never looked at.

| # | Decision | Why |
|---|---|---|
| P19B-1 | **`profiles` wins; the column is dropped from `employment_records`** | A joining date is ordinary personnel data, not salary. The scorecard shows it to the person themselves and the print pack puts it on a signature-ready sheet — both legitimate. `employment_records` is HR/MD-only by design (§5), so keeping the date there locked it away from screens that have always displayed it. The split now reads cleanly: **profiles = who they are, employment_records = what they are paid and when it changes.** |
| P19B-2 | A trigger on `profiles` reaches across to recalculate | The joining date used to sit on the same row as the increment rule. Now it is on another table, and moving somebody's start date has to reach across — otherwise correcting a new joiner's date leaves their first increment permanently on the old schedule. The trigger fires a no-op UPDATE rather than restating the rule, so `compute_next_increment` stays the only implementation. |
| P19B-3 | `v_my_employment` is rebuilt **from `profiles`**, still with no salary column | It selected `employment_records.date_of_joining`, which is what made the column undroppable. One behaviour changed: a person with no employment record now gets their own row with nulls rather than no row. That is right — it is their own data. What matters is asserted directly: they see **only themselves**. |
| P19B-4 | The backfill is **guarded on the column existing** | Section 5 drops what section 1 reads, so a second run referenced a column that was gone. Dynamic SQL, so the name is not resolved until the branch is taken. |
| P19B-5 | **The create form now captures the whole person** | Five fields became twelve: employee code, work mobile, designation, reports-to, joining date, employment type, last increment, frequency. Three had **no form at all** and could only be set by hand in SQL. Two are load-bearing — §10 sends every invite to `phone_e164`, and since AMEND-3 a HOD with no contact details BLOCKS a cycle launch. |
| P19B-6 | The phone is normalised **server-side** | `normaliseToE164` is `server-only` and returns a structured reason (P11-12), so the field says *what* is wrong. A landline and a nine-digit typo need different fixes. |
| P19B-7 | **Salary is deliberately absent from the create form** | A joining CTC has to append to `salary_history`, which belongs on the Employment tab where the append-only history is visible. Writing pay history from an account-creation dialog would do it from a screen that shows none of it. |
| P19B-8 | A failed employment insert is **reported, not rolled back** | The account and profile are real and usable by then. Naming the gap beats destroying a working account over a date. |

#### Part 2 — the regression was reporting the wrong thing

Three suites had been logged as "pass standalone, crash in the batch runner" for
three phases. Both halves of that sentence were false.

| # | Decision | Why |
|---|---|---|
| P19B-9 | **The runner was printing PGlite's minified bundle as the error** | `grep -E 'Error'` matched a line inside `chunk-2B24BK54.js`, which the stack trace prints in full. Every crash was reported as `import{b as ne,e as r,...}` and read as a bundler problem. It never was one. Anchored to the message line instead — an error report that names the wrong thing is worse than no error report, because it ends the investigation. |
| P19B-10 | **`asUser` leaked its JWT subject into every later query** | `set_config('request.jwt.claim.sub', …, false)` persists on the connection, and the helper reset only the *role*. So every "as superuser" query after the first impersonation silently ran as that person. `reset role` returns superuser, which bypasses RLS — but **not triggers**, so a setup UPDATE was refused by `profiles_guard_self_update` and looked like a product failure. The subject is now saved and restored. The worse half is what it means for the assertions that passed: any "superuser cannot do this" check could have been passing because RLS refused it, not because the trigger did. |

Three real product bugs were behind those crashes. All three are in shipped
migrations, and all three would have reached the owner.

| # | Bug | Consequence |
|---|---|---|
| P19B-11 | **`verify_invite_token` returned `'VALID'`; every caller expects `'OK'`** (0026) | 0022 rewrote the function to carry the new `layer` column and the success literal changed in the rewrite. `lib/auth/invites.ts` branches on `"OK"` and its `VerifyStatus` union has no `'VALID'` member, so the success row fell through to the failure branch. **Every invite link in the system failed to verify** — an employee opening the WhatsApp link §10 sent them was told it was not valid. The same rewrite also renamed `'RATE_LIMITED'` to `'LOCKED'`, missing the `case "RATE_LIMITED"` that renders the "too many attempts" screen, and **dropped the `invite.rate_limited` audit row 0006 wrote** — so a token being hammered until it locked left no trace. `consume_invite_token`, rewritten a few lines below in the same file, still returned `'OK'`; the one odd literal was the tell. |
| P19B-12 | **`reassign_evaluation_lead` gated on the four retired statuses** (0025) | 0021 migrated the data and replaced the transition RPC but did not touch 0009's helpers. Every live evaluation is at `OPEN`, which was in neither list, so the guard refused all of them with a self-contradictory message: *"The lead can only be changed before the review is written. This evaluation is at OPEN."* **HR could not reassign a lead at all** — anyone who left, changed team or was entered against the wrong HOD stranded their reports with no fix available in the product. |
| P19B-13 | **`v_cycle_progress` counted four statuses that no longer exist** (0027) | Every `filter` matched nothing, so a cycle with every evaluation fully reviewed reported **0.0% complete** on HR's cycle board and the dashboard. |

| # | Decision | Why |
|---|---|---|
| P19B-14 | 0025's guard reads `lead_submitted_at`, not a status | 0009's cut-off was never really about the status; it was about whether the review had been written. Under the old sequential machine those were the same fact. Under blind parallel rating they are not — both layers are filled during OPEN — so an evaluation can sit at OPEN with the review already submitted and locked. The reason is unchanged: a submitted LEAD layer carries its author in `submitted_by`, and moving `lead_id` afterwards attributes one person's review to another. |
| P19B-15 | 0027 keeps **every column name** and changes only what each counts | §0.2, and `lib/analytics/queries.ts` selects `*` into a generated type. `self_submitted` and `lead_reviewed` now read the submission **timestamps**, because blind rating means neither layer has a status of its own — no single status can say "self is in, lead is not" when the two no longer take turns. |
| P19B-16 | A step counts as done from the timestamp **or** the status | The timestamp alone under-reports twice: a skipped layer (`self_skipped` / `lead_skipped`) advances the status deliberately without ever setting one, and a row an administrator moved would read as unstarted for ever. A progress bar that shows 33% on a finished evaluation is worse than none. |
| P19B-17 | All three are patched by **targeted replacement**, not restatement | Same call as A1-5. Each differs from a long, already-tested body by one literal; retyping the rest invites a transcription error into a function nobody would re-read. Each patch verifies it matched something and raises if it did not. |
| P19B-18 | `rls.sql`'s stale assertions were **rewritten, not deleted** | Three encoded rules AMEND-3 deliberately reversed. "A lead cannot rate before the self-evaluation is submitted" is now "a lead MAY rate in parallel"; "under FULL disclosure a closed evaluation exposes the lead layer" is now "FULL is unreachable **and** a CLOSED evaluation still exposes no lead layer" — the single row that would catch blindness being undone by a disclosure setting. |
| P19B-19 | One of those failed for a **NULL** reason, not a real one | `(select answers ->> 'x' …) <> '99'` read NULL once blindness hid the row, and `NULL <> '99'` is NULL, not true. So the assertion failed while the property it tested had been *tightened*. Written `is distinct from`. F1-4 in reverse: there a NULL silently disarmed a security test; here it made a passing one look broken. |
| P19B-20 | The parallel-rating assertion **rolls its own write back** | A PL/pgSQL exception block is a subtransaction, so raising after the successful insert proves the write was permitted without leaving the row behind. Persisting it collided with a later fixture insert for the same (evaluation, layer) — a test that quietly changes the fixture breaks the tests after it. |

#### Verification

**1101 passed, 3 failed**, up from 1023 passed / 16 failed. p5 alone went from
16 to 73 — it had been aborting at the first stale assertion, so 57 checks never
ran at all. p6 66/0 (the §10 rate limiter is whole again, including the audit
row), p10 55/0, p16 38/0, p19 44/0.

Typecheck 0 errors, lint 0 errors, build clean.

**The 3 remaining failures are honest and named.** All three drive the
pre-AMEND-3 state machine and need their fixtures rewritten, which is a
deliberate piece of work rather than a patch:

- **p4-sql** — its transition table is the old §8; it drives `OPEN → OPEN`.
- **p18** — inserts an evaluation carrying a retired status, refused by
  `evaluations_status_current`.
- **p14** — covers `finalise_evaluation`, which still requires `LEAD_REVIEWED`.
  This one is **not** a bug to fix: AMEND-3 superseded that path and the route
  now lives at `/review-legacy`, reachable from no menu. `lib/review/actions.ts`
  is its only caller. Worth a decision — either the legacy route and its action
  go, or the function is brought onto the new machine. It should not sit
  half-alive.

**Apply order.** `0024`, `0025`, `0026`, `0027` are all unapplied. **0026 is the
urgent one** — until it is applied, no invite link in the system verifies.

#### Still outstanding on P19

- **The CSV bulk import.** Not started.
- **"Start increment"** links to `/admin/cycles/new?increment_for={id}` and the
  wizard ignores the parameter.
- **The increment reminder is never sent.** `increment_reminders` rows are
  created and kept correct and `remind_on` is right, but the cron route does not
  know the table exists.

---

### P19-C — The employee database: a form you can read, a CSV import, and salary

No migration. `lib/auth/csv.ts` is new; `schemas.ts`, `provisioning.ts` and the
Users tab are extended. Settings › Users is now the single place a whole person
is entered.

**Reverses P19B-7 at the owner's explicit instruction.** That decision kept
salary off this form on the grounds that a CTC has to append to
`salary_history`, and that belongs where the history is visible. The objection
is answered rather than overruled — see P19C-2. §5 salary confinement is
untouched.

#### The empty right-hand side

`max-w-form` is 760px. The form carried it, so twelve fields sat in a 760px
column pinned to the left of a 1180px card — which is what was reported, and it
was not only a gap. Twelve fields in one undifferentiated list read as one
long list; there was nothing to tell somebody they had moved from identity to
team to money.

| # | Decision | Why |
|---|---|---|
| P19C-1 | **The form is five named bands, label left and fields right** | Naming the groups is what turns a list into a structure somebody can scan — Identity · Where they sit · Employment · Compensation · Access. The label column is what fills the width the old layout wasted, and it earns the space by carrying each group's purpose rather than stretching the inputs to 1180px, which would make a name field wider than any name. Below `md` it collapses to one column (§13.2). |
| P19C-2 | **Salary is written as `salary_history` rows, not as a number on the record** | This is what answers P19B-7. The three figures compose the same rows the Employment tab would have written — `JOINING` at their joining date, `ANNUAL_INCREMENT` at their last increment — so the append-only history is correct from the first save instead of starting empty and being reconstructed from memory later. The record's `current_ctc` is set alongside, because that is what they are paid today. |
| P19C-3 | **"Last increment amount" needed no new column** | It is `salary_history.hike_amount`, which has existed since 0023. §0.4 forbids inventing schema, and the honest place for the figure was already modelled — it is the thing that makes `previous_ctc` knowable. |
| P19C-4 | `previous_ctc` and the percentage are **derived, never accepted** | P19-7. A caller that could send its own previous figure could write a history that disagrees with the record it came from, and this table's only job is to be evidence. Given the current salary and the increment amount, the previous figure is arithmetic. |
| P19C-5 | An empty salary field is **unrecorded, not zero** | `z.coerce.number()` turns `""` into 0, and a joining salary of zero is a different fact from "we do not know it". The preprocess is what keeps the difference — and it also accepts `₹4,80,000`, because refusing what HR pastes out of a spreadsheet sends them to a calculator for no reason. |
| P19C-6 | **No salary figure reaches an audit diff** | P19-10, and it matters more here than anywhere: 0013 lets a lead read `audit_log` for their own reports, so a CTC in a diff would walk straight past §5. The diff records `salary_recorded: true` — that a figure exists, never what it is. |
| P19C-7 | **The import and the form share one creation path** | `provisionPerson` was extracted so both call it. Two write paths for "create a person" would eventually disagree about which fields are saved and what gets audited — and the disagreement would surface on whichever path is used less, which is the one nobody is watching (PC-1). |
| P19C-8 | **Every row is validated before any row is created** | A file that is half wrong should be fixed and re-uploaded. Creating fourteen of twenty leaves HR to work out by hand which fourteen, and the second attempt then fails on those as duplicates. So a single bad row imports nothing and returns a list to fix. |
| P19C-9 | It is **not one transaction, and does not pretend to be** | Creating an auth account is an Admin API call, not a database write, so it cannot be rolled back from here. The honest design is a per-row report: every row says whether it landed and why not, so a partial run is recoverable by reading the screen rather than by inspecting the database. |
| P19C-10 | The CSV reader is **hand-written, and is not `split(",")`** | §2 pins the dependency list. The two things that break a naive split are exactly the two things this file contains — a comma inside a quoted name ("Sharma, Priya") and a rupee figure with Indian grouping ("4,80,000"). Both arrive quoted from Excel, and both would silently shift every later column of that row into the wrong field. A mis-parsed row does not throw. |
| P19C-11 | The BOM is stripped | Excel on Windows writes one. Left in place it becomes part of the first header, so `full_name` silently stops matching and every row reports a missing name. The template is written *with* a BOM and CRLF for the same reason the CSV export is (P16-8). |
| P19C-12 | An unparseable date is **refused, never guessed** | §0.10 makes DD-MM-YYYY the convention, so that is what HR will type; ISO is accepted and passed through. Anything else returns null rather than a guess — reading `03-04-2025` as the wrong month would set somebody's increment eleven months out with nothing on screen to show for it. |
| P19C-13 | A duplicate email **inside the file** is caught before the database sees it | Postgres would catch it on the second row, but only after creating the first — and "somebody already has that email" is a misleading thing to read when the somebody is four rows above in the same upload. |
| P19C-14 | Departments match on **name or code**; leads match on **email** | HR exports from one system and types into another, and being strict about which of the two a column holds would reject a file that is entirely unambiguous. Email is the only lead identifier a spreadsheet reliably carries and the only one that is unique — and when it does not resolve, the message says to import heads of department first, which is the actual fix. |
| P19C-15 | The submit bar is **sticky** | One primary action (§13.3), on a form that is now long enough that a button at the bottom is a scroll away from most of the fields. |

#### Verification — p19c, 59 checks, 0 failed

The reader is exercised against the shapes HR's spreadsheets actually contain
rather than a tidy example: a quoted comma inside a name, a grouped rupee
figure, an escaped quote, an embedded newline, CRLF, a BOM, and a trailing blank
row. The template is proved to round-trip — downloaded, parsed and validated
back through `createUserSchema`, so the file HR is handed cannot be one the
importer rejects. Dates: eight cases including two that must be refused rather
than guessed. Money: `""` is proved to stay undefined rather than becoming 0,
`₹4,80,000` is proved to parse, and zero, negative, text and absurd figures are
each refused.

§5 was checked in both directions. Source-level: every `diff:` block in
`provisioning.ts` is parsed out and proved to carry no money-bearing field —
with a self-test that the guard would catch `current_ctc: 480000` and would not
trip on the `salary_recorded` boolean, because an absence check that cannot
detect the thing it forbids is worth nothing. Behaviourally, on real Postgres
under `set role authenticated`: both composed rows are accepted, the derived
previous figure and percentage are exactly right, an invented `reason` is
refused by the constraint, and **the employee cannot read the pay history just
written for them**.

**Regression: 1160 passed, 3 failed across 25 suites.** The 3 are unchanged from
P19-B — p4-sql, p18 and p14, all driving the pre-AMEND-3 state machine.
Typecheck 0 errors, lint 0 errors, build clean.

#### Still outstanding

- **"Start increment"** links to `/admin/cycles/new?increment_for={id}` and the
  wizard ignores the parameter.
- **The increment reminder is never sent.** The rows are created and correct;
  the cron route does not know the table exists.
- The import creates people but does not **update** them. Re-uploading a
  corrected file fails on the duplicate email rather than amending the record.

---

### P19-D — The bulk employment import, and P19's last two acceptance criteria

Migration `0028_employment_import.sql`. `lib/employment/import.ts`,
`previewEmploymentImport` / `commitEmploymentImport`, and the import panel on
`/admin/increments`.

**This closes P19 rather than repeating it.** The brief was re-issued in full;
everything in it except the bulk import had already been delivered as P19,
P19-B and P19-C, and `0023_employment.sql` is applied — §0.8 forbids editing an
applied migration, so the phase was audited line by line and only the genuine
gaps were built. Two divergences from the re-issued brief are recorded rather
than silently absorbed:

| Brief | What exists | Why |
|---|---|---|
| `0015_employment.sql` | `0023_employment.sql` | 0015 is `0015_views.sql` and is applied (§0.8). Same call as 0010, 0017, 0021, 0022. |
| `employment_records.date_of_joining not null` | the column lives on **`profiles`** | 0024 removed the duplicate at the owner's "please avoid duplicate entries". The two copies were written and read by different code and disagreed — see P19B-1. |

#### What was actually missing

The import. P19's own log recorded it as "not started", and P19-C's import is a
different thing: it **creates** people from a file of names, emails and
passwords. This one **fills in** people who already exist, matched by employee
code, which is what an initial load of payroll data actually is.

| # | Decision | Why |
|---|---|---|
| P19D-1 | **This import IS all-or-nothing, and P19-C's could not be** | Not an inconsistency — the difference is real and worth stating. P19C-9 explained that creating an auth account is an Admin API call, not a database write, so a half-finished run cannot be unwound and the honest design there was a per-row report. Every write here is a database write, so one transaction covers the run and the brief's demand is actually satisfiable. |
| P19D-2 | Which makes it **one PL/pgSQL function**, not a loop of PostgREST calls | The only way to get one transaction. The split is P10-2's and P14-1's: **TypeScript decides, SQL commits** — the CSV is parsed, every row validated and every employee code resolved in TypeScript, none of which belongs in PL/pgSQL, and the function receives a payload it writes entirely or not at all. |
| P19D-3 | The preview and the commit run **the same builder** | `commitEmploymentImport` re-runs `buildEmploymentPreview` server-side and refuses if any row is bad. A preview produced by a second, more forgiving parser is a preview that lies — and without the re-run the screen could talk the server into accepting a row it had just shown as broken. |
| P19D-4 | **A blank salary column means "not in this file", never "set it to nothing"** | The single most expensive thing this import could do is wipe a salary because a column was left empty. `coalesce(excluded.current_ctc, e.current_ctc)` on the upsert. A file of corrected dates does not have to carry every figure again. |
| P19D-5 | An imported CTC **writes its own pay history** | A `current_ctc` with no history behind it is a number nobody can account for. The row composed is the one the Employment tab would have written (P19C-2): ANNUAL_INCREMENT at the last increment date, JOINING where there has not been one. |
| P19D-6 | `previous_ctc` and the hike are **left null, not guessed** | An initial load knows today's figure, not the one before it. P19-7 forbids accepting a previous figure from the caller, and inventing one here would put a fabricated hike into the table whose only job is to be evidence. |
| P19D-7 | A re-import appends **no duplicate** pay row | Checked against an identical (person, date, figure) before inserting. `salary_history` has no UPDATE path for anyone (P19-3), so a duplicate could never be tidied up afterwards — it has to not happen. |
| P19D-8 | **One audit row for the batch**, naming the file and the count | Per the brief. `entity_id` is `not null`, so the batch takes a generated id — the batch is a real event and deserves one. The diff carries `file`, `rows` and `salary_rows`; `salary_rows` is a **count of rows written, never an amount** (§5, P19-10), because 0013 lets a lead read `audit_log` for their own reports. |
| P19D-9 | The panel is **HR's alone**, and the SQL re-checks it | §9 as amended gives HR the write and the MD the read, so `/admin/increments` renders for both but the import panel only for HR. `import_employment` re-checks `is_hr()` internally — a hidden panel is not a permission. |
| P19D-10 | A row whose code resolves to nobody is **refused, not skipped** | Creating the person from here would mean inventing an email and a password, which is Settings › Users. The message says so. Skipping silently is the exact failure all-or-nothing exists to prevent. |
| P19D-11 | An increment dated **before** the joining date is refused | That file has two columns swapped, and importing it would set the whole increment schedule wrong for everybody in it. |

#### Acceptance — the criteria as stated, including the two P19 proved differently

```
a row with no person attached          → refused
  …and the FIRST row was not written   → 0 employment records
  …no pay history                      → 0 rows
  …no audit row claiming an import     → 0 rows

a clean file                           → 2 records, 2 opening pay rows, 1 audit row
  the audit row names the file         → "staff-load.csv"
  …and the count                       → 2
  …and carries NO salary figure        ✓

a blank CTC column on re-import        → existing figure untouched (480000.00)
re-importing the same file             → no duplicate pay row

a HOD running the import               → refused
an employee running the import         → refused
the MD running the import              → refused (§9: the write is HR's)

HR attempting UPDATE on salary_history → refused
HR attempting DELETE on salary_history → refused
  …and the figure is untouched         ✓

a HOD selecting employment_records     → []
a HOD selecting salary_history         → []
a HOD selecting increment_reminders    → []
an employee selecting employment_records  → []
an employee selecting salary_history      → []
an employee selecting increment_reminders → []

the 90-day window                      → 1 person inside it, 1 overdue, derived
```

Two of those had been proved a different way and are now proved as the brief
words them. **The failing UPDATE is now run as HR**, not only as superuser —
superuser is the stronger statement but it is not the same statement, and the
brief asks for HR. And the **90-day calendar** is asserted from dates placed
relative to `current_date`, so the check cannot rot into a pass.

**p19d: 58 checks, 0 failed.**

#### Regression

**1218 passed, 3 failed across 26 suites.** The 3 are unchanged from P19-B —
p4-sql, p18 and p14, all driving the pre-AMEND-3 state machine. Typecheck 0
errors, lint 0 errors, build clean.

#### What is still open from P19

- **"Start increment"** links to `/admin/cycles/new?increment_for={id}` and the
  wizard still ignores the parameter.
- **The increment reminder is never sent.** `increment_reminders` rows are
  created and kept correct and `remind_on` is right; the cron route does not
  know the table exists.

---

### P20 — The combined report at /reports

Migration `0029_reports.sql`. **The brief names it `0016_reports.sql`; 0016 is
`0016_notification_settings.sql` and is applied, so §0.8 makes it 0029** — the
same call as 0010, 0017, 0021, 0022, 0023 and 0028.

`lib/reports/{types,answer,topics,build,queries,actions}.ts`. Screens `/reports`
and `/reports/[evaluationId]`, the print route `/print/report/[id]`, and the
`Reports` nav entry AMEND-3 left a slot for. Three notification events wired.

**This closes the gap AMEND-3 named.** Until now a launched cycle reached
`PENDING_HR_REVIEW` and stopped: HR had no way to review a record or advance it,
and the MD had no way to record a review. The transitions existed and were
guarded; nothing called them.

| # | Decision | Why |
|---|---|---|
| P20-1 | **`evaluation_reviews` is a new table, not a column on `evaluation_decisions`** | 0003's table is the OUTCOME — promotion, increment type, salary. This is the REVIEW — did HR read it, what did they conclude, did the MD agree. AMEND-2 separated those two ideas when it split the roles again, and one row would mean a single policy governing both a summary the MD may write and a salary figure only HR may set. |
| P20-2 | **The column split is a TRIGGER, because RLS cannot express it** | §9 gives HR the review and the MD the remarks. RLS is row-level: an UPDATE policy admitting the MD admits every column, so the MD could rewrite `hr_summary`. A second pair of eyes that can edit the first pair's words is not a second pair of eyes. The trigger refuses it, and the suite proves it by trying. |
| P20-3 | **The salary block is attached LAST, and only then** | The brief: omit, never blank — "check the serialised JSON, not the rendered screen". A blanked key survives `JSON.stringify` and tells the browser a salary block exists. So the report object is *built without one*, and `report.salary = …` runs inside a single `if (isIncrement && audience is HR or MD)`. There is no code path that puts an empty salary key on the object, which is what makes the omission literal rather than a convention. |
| P20-4 | The audience is a **parameter**, and it decides only the salary block | P15-7's call, sharpened. It never decides whether the blind layers are visible — every read goes through the authenticated client, so RLS refuses a caller the SELF layer regardless of what they pass. Passing `"OTHER"` cannot widen anything; it can only narrow. |
| P20-5 | Band 3's topics are **curated, and the pairing is by question id** | The brief forbids automatic matching, so there is none: three topics chosen by a person. Matching by question TEXT would break the first time HR rewords a question, because §5 freezes the text into every snapshot — the id is stable for ever, and 0017 derives it as `md5('linkd.q.' || key)`, so it is knowable without a lookup. |
| P20-6 | "Where to improve" has **no employee question, and says so** | This form does not ask anybody to name a weakness in themselves. Showing the topic with the left column empty states that plainly, which is more useful to HR than quietly pairing the lead's answer with something the employee wrote about a different thing. |
| P20-7 | Bands 4 and 5 take **everything Band 3 did not claim** | So nothing anybody wrote can fall out of the report. A snapshot from an older bank, or a question HR authored themselves, still reaches the page — it simply appears in the employee's or the lead's own band rather than in a pair. |
| P20-8 | The queue's default sort is the **absolute** gap | §11 defines the gap as Lead − Self, and a lead who rated two points *below* the employee matters exactly as much as one who rated two above. A signed sort would bury half of them. |
| P20-9 | The queue does **not** re-assemble every form to count flags | Two snapshots per row, over hundreds of rows, would make the screen unusable. It counts from the stored answers; the report itself recomputes from the frozen snapshot, which is the authoritative number. |
| P20-10 | HR's summary is saved **before** the transition | Reversed, a failed save would leave the record with the MD carrying no review — which is the one thing the MD is meant to be reading. |
| P20-11 | The increment salary guard is **§8's own**, not re-implemented | `requireSalaryComplete` already runs inside `transition()`. A copy here would be a second definition of "complete", and the two would disagree the first time P21 changes what the block contains. |
| P20-12 | The return dialog names **exactly** what will happen | "The employee's answers will unlock and their submission will be cleared. The lead's review stays locked and untouched." §13.4 — an irreversible action described vaguely is how somebody clears a submission they meant to keep. The sentence changes with the choice, because the consequence does. |
| P20-13 | **`/print/report/[id]` answers 403, and needed a config flag to do it** | Every other print route hands out a redacted copy where §9 requires one. This one cannot: the report's whole content is both sides of a blind evaluation together, so there is no version safe for anybody else — a redacted edition would be a nearly-empty page that still confirms what it is and who it is about. `forbidden()` is what returns a real 403, and Next refuses to run it unless `experimental.authInterrupts` is on. Enabled, and recorded here: without the flag the call throws an internal error, turning a deliberate refusal into a crash. Not a dependency, so §2 is untouched. |
| P20-14 | The 403 page **names nobody** | Saying whose report was asked for would make the URL a way to find out who is being evaluated (P6-11). |
| P20-15 | No action on this screen uses `ADMIN_ROLES` | AMEND-2 un-merged the roles and this is where it matters most: HR prepares and reviews, the MD approves. One predicate over both would be the second pair of eyes removed in the one place it was restored for. Asserted directly. |
| P20-16 | The three new messages go to **HR only**, and carry no score | "Your report is ready", said to an employee, means their HOD has submitted — precisely what blind rating withholds (A3-12). And a gap in a WhatsApp message is the one figure §11 confines to HR and the MD, on a channel with no access control around it (P13-13). |

#### A bug the suite caught in my own code

`audit_log.reason` is a **column**, not a key in `diff`. The report builder read
`diff.reason`, which is `undefined` — so the meta panel would have rendered every
past return with no explanation, which is the one thing §8 requires a return to
carry. Found by asserting the reason came back verbatim, fixed to read the
column, and the suite now checks that the builder reads exactly what the RPC
writes: `reason` from the column, `returned_to` from `diff.after`.

#### Acceptance

```
a HOD selecting evaluation_reviews      → []      ZERO rows
an employee selecting evaluation_reviews → []     ZERO rows
the MD rewriting HR's summary           → refused by trigger, summary intact
nobody may DELETE a review              → no DELETE policy exists

a HOD reading the SELF layer of their own report  → 0 rows  (§5 still holds)
the employee reading the LEAD layer               → 0 rows
HR reads both · the MD reads both                 ✓

PENDING_HR_REVIEW → MD_REVIEWED   → no such row in §8, and the SQL refuses it
HR may send to the MD             ✓
HR may NOT record the MD's review ✓

return to SELF:  status → OPEN
                 self_submitted_at  → cleared
                 lead_submitted_at  → UNCHANGED
                 the lead's answers → intact
                 the reason         → audited verbatim

salary: exactly one assignment, guarded on cycle type AND audience;
        the report object is built with no salary key at all

/reports and /reports/[id]  → requireRole(["HR_ADMIN","MD"]), guard first
/print/report/[id]          → forbidden() — 403, not a redaction
the nav entry               → HR and MD only
no action uses ADMIN_ROLES  ✓
every status move goes through transition()  → 5 of 5
```

**p20: 65 checks, 0 failed.**

#### Verification

The report is proved to render no rating control, import no form renderer, write
to no `evaluation_responses`, and contain no override or `final_overall` write —
§11 and the brief's "HR reviews; HR does not re-rate". The printed sheet is
proved to be a server component, to carry all three signature lines, to take
§6's scale from the constant rather than retyping it, to mark every band
break-inside-avoid, and to use no tier or app token class. All six notification
moves are proved to have a live case, and the "report ready" branch is proved to
address `HR_ADMIN` and to carry no score.

**Two guards moved deliberately.** p5's table count is 18 → 19 (`evaluation_reviews`)
and p7's menu list gained "Reports" as a tenth label — both kept as exact
assertions rather than loosened, so a future addition still has to be a decision.

**Regression: 1283 passed, 3 failed across 27 suites.** The 3 are unchanged from
P19-B — p4-sql, p18 and p14, all driving the pre-AMEND-3 state machine.
Typecheck 0 errors, lint 0 errors, build clean.

#### Not in this phase

- **Band 6 is a placeholder**, as the brief specifies: "Salary review is added in
  the increment step." P21 fills it, and `requireSalaryComplete` already gates
  the send on it.
- **The MD's follow-on close** exists for an EVALUATION cycle; the INCREMENT
  path says the interview step arrives in P21 rather than offering a button that
  goes nowhere.
- `finalise_evaluation` and `/review-legacy` are **still half-alive** — reachable
  from no menu, called only by `lib/review/actions.ts`, and still requiring the
  retired `LEAD_REVIEWED`. P20 replaces what they did. They should now either be
  removed or brought onto the new machine; p14's one failure is that decision
  waiting to be made.

---

### P21 — Salary review, MD approval and the interview record

Migration `0030_increment.sql`. **The brief names it `0017_increment.sql`; 0017
is `0017_reseed_questions.sql` and is applied, so §0.8 makes it 0030** — the
same call as 0010, 0021, 0022, 0023, 0028, 0029.

`lib/increment/{calc,queries,actions}.ts`, the salary band and interview card on
`/reports/[evaluationId]`, and the employee's outcome card. P20's placeholder
band is deleted rather than left beside its replacement.

| # | Decision | Why |
|---|---|---|
| P21-1 | **0022's expectation question is RETIRED, and two new ones seeded** | This is the decision that mattered most. 0022 already asked "What **monthly** salary would you consider fair?" — and P21's column is `employee_expectation_ctc`, an annual figure compared directly against `current_ctc`. Copying a monthly answer into it is wrong by a factor of twelve, in a number that feeds a pay decision. Retiring rather than renaming leaves every launched snapshot intact (§17, §0.2), and the copy is keyed to the NEW id, so an old monthly answer can never reach the annual column. Audited. |
| P21-2 | **Every figure is computed once, in `calc.ts`, and stored** | The brief forbids computing a hike in a component, and the reason is sharper than tidiness: a percent worked out in an `onChange` is a percent nobody can reproduce, and it will not match what the database holds. The screen calls the same functions the server calls, and the server recomputes from the two salaries rather than accepting a percent from the browser. |
| P21-3 | `hikePct` returns **null, never Infinity**, on a zero current salary | `numeric` cannot store Infinity and no screen can render it as anything a person should read. Null renders as an em dash. Enforced three deep: the function returns null, a CHECK refuses `current_ctc <= 0`, and the action returns a sentence naming the fix rather than an arithmetic error. |
| P21-4 | The two inputs are **linked, and neither is the master** | Editing the percent recomputes the amount and editing the amount recomputes the percent, both through `calc.ts`. Whichever field HR is looking at is the one they trust — the same call P14-13 made for the old collision view. |
| P21-5 | The annualised percent is **labelled as context, in the interface** | A 15% rise after 18 months is a different decision from 15% after 12. But the money actually paid is the real percent, so the card says so in words: "Context only — the money paid is 15%." A figure that could be mistaken for the decision has to say that it is not. |
| P21-6 | **The column split is a trigger, again** | Same as 0029's, applied to money: HR proposes, the MD approves, and RLS is row-level so an UPDATE policy admitting the MD admits every column. Without the trigger the MD could rewrite HR's justification and HR could award themselves the approved figure. The interview columns are deliberately writable by both — §8 gives that transition to either, and the interview is a conversation they hold together. |
| P21-7 | **The employee may write their own expectation and nothing else** | Found by the suite, not by inspection: `record_salary_expectation` is SECURITY DEFINER, but a definer function does not change `auth.uid()` — so the function was blocked by its own guard trigger and the answer never left the blob. The exemption is written as narrowly as it can be: every one of the other fifteen columns must be unchanged. They still have no SELECT policy, so they can write it and never read it back. |
| P21-8 | The copy runs at submission **and again at HR's first proposal** | `current_ctc` is NOT NULL, so a review row cannot exist before there is a salary on record — and at submission there may not be one. Rather than making the column nullable to suit the ordering, the copy is idempotent and runs again when the row can exist. It coalesces, so a second call cannot blank a figure. |
| P21-9 | **The confirmation is one PL/pgSQL function** | Six writes: the review row, `MD_REVIEWED → INTERVIEW_DONE`, the `salary_history` append, the employment record, the reminder, `INTERVIEW_DONE → CLOSED`. A partially applied increment is a payroll incident, not a bug report. Both transitions go through `apply_evaluation_transition` rather than a direct UPDATE, because the status column is only writable inside the window that function opens (P5-2). |
| P21-10 | It **refuses to run without an MD approval**, and so does the action | Two guards, because the brief forbids it and §9 is the reason it exists: HR proposes, the MD approves, and that separation is only real if the confirmation checks it. |
| P21-11 | `last_increment_date` is set, and the P19 trigger does the rest | `next_increment_date` is not written here. Moving the date is what makes `compute_next_increment` recalculate, so the rule stays in one function — and the suite proves it rolled forward twelve months rather than trusting it. |
| P21-12 | The reminder is **ACTIONED, not deleted** | P19-6: one already sent is a record that HR was told; marking it actioned records that they did something. Deleting it erases both. |
| P21-13 | **No salary figure in the confirmation's audit row** | P19-10 and §5, and it matters most here: 0013 lets a lead read `audit_log` for their own reports. The row carries the `salary_history` id and the effective date — enough to find the record for anybody entitled to read it, nothing to read off it. |
| P21-14 | The employee's outcome is a **shape that cannot carry anything else** | `EmployeeOutcome` has three fields: completed, newCtc, effectiveFrom. There is no prop for a rating, a gap, a remark or a median, so the card could not render one if it tried — the safest way to keep a figure off a screen is for the screen to have no way to reach it (P19-2's reasoning). The CTC keys are omitted rather than blanked under NONE disclosure. |
| P21-15 | It reads `salary_history`, not `increment_reviews` | The employee may not read the review table at all, and the pay record is the thing that is actually true. |
| P21-16 | The quick-set bands are a **single-row settings table** | The brief asks for configurable rather than hardcoded. An array rather than three columns, so a fourth band is data and not a migration. The P17-6 idiom: a CHECK on a boolean primary key is what keeps it single-row. |

#### A second stale-status bug, in the employee's own screen

`/my-evaluation/[id]` looked for the return audit row with
`from_status = 'SELF_SUBMITTED'` and `to_status = 'CYCLE_ACTIVE'`, and compared
the live status against `CYCLE_ACTIVE`. AMEND-3 renamed all three. The filter
matched nothing, so **an employee whose form was returned was never told why** —
which is the entire content of a return, and §8 requires the reason for exactly
that purpose. Same family as the three P19-B found. Fixed to
`PENDING_HR_REVIEW → OPEN`.

#### Acceptance

```
the increment form asks both expectation questions      ✓
the evaluation form asks NEITHER                        ✓
0022's monthly question retired, not deleted, audited   ✓

a HOD selecting increment_reviews      → []   ZERO rows
an employee selecting increment_reviews → []  ZERO rows
HR may NOT set the approved figure     → refused by trigger
the MD may NOT rewrite HR's justification → refused
…nor the employee's expectation           → refused

current_ctc of 0                    → refused by CHECK
hikePct(0, x) · hikePct(null, x)    → null, never Infinity
the action names the fix            → NO_CURRENT_SALARY

ten round trips percent→amount→percent  → 0 drifted

confirm without an MD approval      → refused
a forced failure mid-confirmation   → salary_history untouched
                                    → employment_records untouched
                                    → the evaluation did not move
                                    → the review row is not FINAL

a clean confirmation → exactly ONE salary_history row
                       480000 → 552000, +72000, 15.00%, ANNUAL_INCREMENT
                       employment_records.current_ctc  = 552000
                       last_increment_date             = 2026-09-01
                       next_increment_date             = 2027-09-01
                       status                          = CLOSED
                       two audit rows, and NO figure in either

the employee reading their own salary_history → 0 rows
the outcome shape and the card read ONLY completed / newCtc / effectiveFrom
```

**p21: 60 checks, 0 failed**, plus 24 unit checks on `calc.ts` run directly.

#### Verification

The band is proved to contain no arithmetic at all — no `/ 100`, no `* 100`, no
`Math.round` — and to import every figure from `calc.ts`. The server is proved
to recompute the percent from the two salaries rather than accept one, and to
store it. A salary change is proved to be written only through `salary_history`.
HR's and the MD's actions are proved separately gated, with `ADMIN_ROLES` absent.

**Two guards moved deliberately.** p5's table count is 19 → 21
(`increment_reviews`, `increment_settings`). p19c's "exactly one submit" was
counting the file's total, which pinned the wrong claim — §13.3 is one primary
action **per form**, and Settings › Users now holds three. Rewritten to assert
each form individually rather than loosened.

**Regression: 1344 passed, 3 failed across 28 suites.** The 3 are unchanged from
P19-B — p4-sql, p18 and p14, all driving the pre-AMEND-3 state machine.
Typecheck 0 errors, lint 0 errors, build clean.

#### Not in this phase

- **The hike bands have no settings screen yet.** `saveHikeBands` is written and
  guarded, and the band reads whatever is stored; nothing renders an editor, so
  changing them means a SQL update. The same gap P17 left on the pause switch.
- **`/reports` still shows one report at a time.** A cycle-wide increment sheet —
  every proposal on one screen for a budget conversation — is the obvious next
  thing and is not built.
- `finalise_evaluation` and `/review-legacy` remain half-alive, unchanged from
  P20's note.

---

### P22 — Automatic scheduling of what is due

Migration `0031_due_items.sql`. **`cycle_kind` is NOT added here — 0022 already
added it, with the same BATCH / ROLLING check the brief asks for.** New:
`milestone_type`, `due_items`, three functions, `lib/due/{queries,actions}.ts`,
`lib/notify/due-digest.ts`, `/admin/due`, and six templates. The P17 cron route
is extended; no second route exists.

#### The leak this phase found

`leadReviewPending` — *"{employee} has submitted their self-evaluation"* — was
**live at `DRAFT->OPEN`**. So every HOD, at every launch, was told their report
had already submitted: false at launch, and precisely the readout AMEND-3
removed. P10-REV wrote `leadReviewInvite` for that moment and recorded the
reasoning (PR-10); the call site was never switched.

Switched, and the template **deleted from the file** rather than left unused. A
template that leaks, sitting where the next person will reach for it, is a
landmine — and the brief's acceptance is "read every template and confirm".

| # | Decision | Why |
|---|---|---|
| P22-1 | **The sweep creates a PENDING ITEM, never an evaluation** | The brief forbids auto-creating, and the reason is worth stating: an appraisal that appeared in somebody's WhatsApp because a clock ticked is an appraisal nobody chose to run. `compute_due_items` writes to one table and sends nothing. |
| P22-2 | `due_items` has **no client INSERT and no DELETE policy** | The sweep is the only creator, and an item that can be deleted is a milestone that can be made to have never been due. HR resolves one by creating or skipping; both leave the row. |
| P22-3 | It is **HR/MD-only** | A due item names a person, and an INCREMENT one says their pay is under review. Same §5 restriction as the increment calendar. |
| P22-4 | ANNUAL is **not computed** | It comes from the yearly batch cycle. Inventing an annual item per person would duplicate every batch participant as a second thing HR has to dismiss. |
| P22-5 | The sweep looks **45 days ahead and 180 days back** | An item that appears on the morning it is due leaves no time to act. The backward window catches a recent joiner entered late; anything older is history, not a task. |
| P22-6 | A rolling cycle is chosen from the **item's** due date, not today | An evaluation due in October 2025 belongs to FY 25-26 even if HR confirms it in December. `ensure_rolling_cycle` is idempotent on the name, so the year's cycle is created once and reused. |
| P22-7 | A milestone evaluation carries its **own** due dates | Two people added three months apart do not share a deadline. 0022's `due_self_on` / `due_lead_on` already existed for exactly this; the cycle's dates are a backstop. |
| P22-8 | `create_milestone_evaluation` is **one transaction**, and TypeScript assembles | The single-person `launch_cycle`, same split (P10-2): the merge algorithm lives in `assembleForDepartment` and reimplementing it in SQL would give two that must agree forever. Row, snapshot, both response rows, the transition and both tokens commit together. |
| P22-9 | It refuses a self-rating outright | PR-8: under blind rating that person fills both sides and sees both, which breaks §5. |
| P22-10 | **Each side is chased on its own timestamp** | P17 chased whoever was "holding" the record — the employee at `CYCLE_ACTIVE`, the lead at `SELF_SUBMITTED`. AMEND-3 retired both, so **the nightly chase has been silent ever since**; and the model was wrong as well as the names, because under blind rating there is no holder. Two independent tasks per evaluation now, each against its own deadline. |
| P22-11 | The template follows the **layer**, and they are separate templates | Not one body with a role parameter: a shared body is a body somebody eventually adds a helpful sentence to. An employee never receives the lead wording, and a lead's message never mentions their own form. |
| P22-12 | A person still gets **one message a day**, covering one form | Somebody can be an employee with their own form and a lead with several. The most urgent record is messaged; the rest are picked up tomorrow. Chasing all of them at once is how a channel stops being read. |
| P22-13 | The digests are a module the **same route** calls | Everything goes out through `sendNotification`, so the pause switch, the rate limit, the `notifications_log` row and §10's no-token constraint all apply without being restated. No second sending path, no second cron. |
| P22-14 | The HR digest is **one message listing everyone** | Never one per employee. Twelve increments falling due is twelve WhatsApps otherwise. Capped at eight names inline with "and {n} more". |
| P22-15 | Overdue increments go **weekly**; the MD every two days | An overdue increment often waits on something HR cannot control. A daily nag on it becomes noise, and a channel people have learned to ignore fails on the message that matters. Cadence is one constant per template, enforced against `notifications_log`. |
| P22-16 | **No message carries a salary figure** | The digests take counts, names, departments and dates — there is no parameter that could hold an amount. §5: the message says an increment is due; the amount lives behind the login. |
| P22-17 | Dedupe is asked of `notifications_log`, never of memory | P17-4. An in-memory flag is per-invocation, so two runs in a day would each think they were the first — which is exactly the idempotency the acceptance asks about. |
| P22-18 | A blocked row says **why**, beside the disabled button | Four different causes — no department, no mapped questions, no lead, self-rating — and four different fixes. §13.4: a disabled control with no explanation is a dead end. |
| P22-19 | Dispatch happens **after** the commit | PW-2: a provider outage must not roll back an evaluation that is already durable and audited. |

#### Acceptance

```
a 1 Sep joiner → MONTH_1 on 2025-10-01 · MONTH_6 on 2026-03-01
ANNUAL is never invented here
running the sweep again → creates nothing (unique index)
an increment becomes an item from next_increment_date

a HOD selecting due_items      → 0 rows
an employee selecting due_items → 0 rows
no DELETE policy · no client INSERT policy

financial_year_label(2026-06-01) → FY 26-27
financial_year_label(2026-03-31) → FY 25-26
the rolling cycle → "New joiner evaluations FY 26-27", ROLLING, ACTIVE, created once

the sweep created NO evaluation
HR confirming → evaluation in the item's OWN financial year's cycle,
                tagged MONTH_1, OPEN via §8, 1 question frozen,
                both response rows, one token per layer, its own due dates,
                and the item marked CREATED
the same item twice → refused
somebody rating themselves → refused

EVERY employee- and lead-facing template read → no leak
  …and the guard proved able to catch the one that did
leadReviewPending → gone from the code; launch now sends leadReviewInvite
no template takes a salary parameter

ONE cron route · retired statuses gone from the code
each side chased on its own timestamp · template follows the layer
digests through the same dispatcher · dedupe from notifications_log
overdue weekly (24 × 6.5h) · MD every two days (44h)
a missing phone → email, and the row is marked in contactGaps
quiet hours and the timing-safe secret unchanged
```

**p22: 60 checks, 0 failed.**

#### Suites corrected, not loosened

**p11b lost three assertions to this phase and gained better ones.** All three
encoded behaviour P22 deliberately reversed: `leadReviewPending` having a call
site (it was the leak), the wiring count pinned at 7, and "chases whoever is
holding the record". Each was rewritten with the reversal named in a comment.

Two of its checks were also **wrong in a way that mattered**. The declared-key
regex scanned the whole templates file and matched the email palette, then
filtered the result down to keys already wired — so it was structurally
incapable of spotting a declared-but-unwired template, which is the only thing
it existed to do. Now scoped to the `TEMPLATE_LABELS` block and comparing both
lists. And the retired-status check matched the comment explaining why the
statuses are gone — **the sixth time** the comment trap has bitten; it strips
comments now.

p5's table count is 21 → 22 and p7's menu gained "What is due" — both kept as
exact assertions.

**Regression: 1412 passed, 3 failed across 29 suites.** The 3 are unchanged from
P19-B — p4-sql, p18 and p14, all driving the pre-AMEND-3 state machine.
Typecheck 0 errors, lint 0 errors, build clean.

#### Not in this phase

- **`/admin/due` is not on the dashboard.** The brief says it should be the first
  thing HR sees there; the dashboard rebuild is still P16's outstanding work, so
  the screen is reachable from the sidebar only.
- **The MD can open `/admin/due` but not act on it.** That is deliberate — HR
  confirms — but there is no MD-specific view of it either.
- The sweep runs from the cron. Nothing runs it on demand, so a person entered
  today does not appear until tomorrow morning.

---

### P23 — The gaps closed

No migration. Six things that were built but unreachable, one screen that was
never rebuilt, and one path that P20 superseded and nobody removed.

| # | Decision | Why |
|---|---|---|
| P23-1 | **The pause switch has a screen** | P17 built the engine and 0016 the switch; nothing rendered it, so silencing every outbound message in the company meant opening a SQL console. That is not something anybody reaches for while a launch is going out by mistake. Settings › Messages. |
| P23-2 | It writes through `set_outbound_paused`, never a raw UPDATE | That function takes the actor from the session and audits both directions (§12, P17-8). An UPDATE would work and would lose both. |
| P23-3 | A reason is required in **both** directions | "Why is everything silent?" is a question somebody asks days later, and the answer belongs on the screen. Resuming needs one too — it is the same question in reverse. |
| P23-4 | **The banner is on every authenticated screen**, not the settings page | A pause is easy to set and easy to forget, and the failure it creates is silence: nobody complains about a message they never knew was coming. It reads through the authenticated client, so RLS decides — an employee sees nothing about machinery they cannot reach. |
| P23-5 | The message log **can only report** | `notifications_log` has a SELECT policy and no insert or update policy for anyone (P11-3). The screen has no write path, and the suite asserts it. |
| P23-6 | The provider's own error text is shown, unedited | Paraphrasing a delivery failure is how somebody chases the wrong problem. "Number not on WhatsApp" and "invalid token" need different fixes. |
| P23-7 | The wording preview renders **placeholders, never a live message** | A preview built from a real evaluation would put an actual invite token on a settings screen (§10). It also derives its list from `TEMPLATE_LABELS`, so a template added without a preview shows up as a gap rather than silently missing. |
| P23-8 | **The dashboard reads P16's six views** | It counted rows itself and showed everybody the same four tiles. `getAnalytics` picks the audience from the roles, and every view is `security_invoker` — so an employee's figures are their own slice by construction rather than by a filter somebody has to remember. |
| P23-9 | Each audience gets a **different layout**, and cannot reach the others' data | A lead's view destructures `needsAttention` and nothing else; an employee's destructures `ownHistory` and nothing else. What a component cannot destructure it cannot render, which is a stronger guarantee than remembering not to. §5: the gap and the company averages are HR and MD only. |
| P23-10 | **Your own work comes first, whatever your role** | The dashboard opens on the reader's own outstanding form or their team's ratings, then the company. A screen that leads with statistics while the reader's own appraisal is overdue has its priorities the wrong way round — and HR and the MD are employees too (§9). |
| P23-11 | A lead's queue counts the **LEAD layer only** | Reading the employee's side to build a dashboard number would be the blindness leak by another route (A3-10). |
| P23-12 | **`/admin/due` is the first thing an administrator sees**, and is not fetched at all for anybody else | P22 asked for the first; the second is §5 — an employee has no business knowing who is due an increment, so the query does not run rather than running and being hidden. |
| P23-13 | The hike-bands editor lives on the **General** tab | P21 made them configurable and stored them; nothing rendered an editor, so changing the three buttons HR presses on every salary review meant an UPDATE. The tab was a placeholder saying the settings "arrive with the notification work" — they have. |
| P23-14 | **`/review-legacy` and `lib/review` are deleted** | P20 replaced what they did. They were reachable from no menu and still required `LEAD_REVIEWED`, which AMEND-3 made unreachable — so they were a screen that could not run, sitting in the tree for somebody to find. `finalise_evaluation` stays in 0014 because an applied migration is never edited (§0.8); it simply has no caller now. |

#### A file that was broken when I found it

`people-client.tsx` was mid-refactor to a data grid and did not compile —
`useReducedMotion` was never imported and its value never read. I removed the
line rather than importing a hook the component does not use, and left the
refactor otherwise alone. (`dash` looked undefined too, but only because the
file was being written as I read it; it is defined further down and I removed my
duplicate.)

#### Verification

**p23: 40 checks, 0 failed.** The rules a screen can quietly break are what is
asserted: no salary figure reaches the message log or the dashboard; no preview
contains a real link; the pause action revalidates every screen because every
screen shows the banner; the lead and employee dashboards cannot reach the
admin-only data.

**Three suites were corrected, not loosened.**

- **p14 is retired**, and the file records why rather than being deleted. Its
  subject — `finalise_evaluation` — is superseded by AMEND-2 (no override),
  AMEND-3 (no `LEAD_REVIEWED`), P20 (the replacement) and P23 (the last
  callers). Rewriting its fixtures to manufacture a status no row can hold would
  be a suite asserting behaviour the product no longer has, which A1-6 already
  established is worse than no suite. It now asserts the retirement: the
  function is unreferenced, the screens are gone, and `/reports` does the job.
- **p7 and p15** referenced the deleted route. p7's "every row opens that
  person's scorecard" also pinned a variable name that a concurrent refactor
  changed from `person` to `row.original` — the behaviour was identical. Both
  now assert the claim rather than the spelling.

**The Tailwind `gap` trap, for the third time.** Two dashboard assertions matched
the `gap-3` utility class while checking that a view carries no *gap figure*.
They target the destructured data now, which is what the rule is actually about.

**Regression: 1451 passed, 2 failed across 30 suites** — down from 3.
`p4-sql` and `p18` remain, both driving the pre-AMEND-3 state machine and both
needing their fixtures rewritten. Typecheck 0 errors, lint 0 errors, build clean.

**§18's STATUS section was rewritten**, as the section itself instructs. The
NAV-3 version predated AMEND-2, AMEND-3 and everything from P19 onward.

---

### P23-FIX — The stale-status sweep

A follow-on to P23, prompted by "what needs fixing now". The answer was found by
sweeping rather than by recalling: **eight more places filtered on a status
AMEND-3 retired**, and a filter on a value no row can hold matches nothing and
fails silently.

| Where | What it broke |
|---|---|
| `sendEvaluationLink`, `issueCopyableLink` | Refused unless the status was `CYCLE_ACTIVE`. **HR could not send or resend a single invite link.** The distribution screen was dead. |
| The distribution board | `wrongStatus` was true for every row, so every person showed as unsendable with a reason nobody could act on. |
| `/my-evaluation` | `OPEN_STATUSES` listed all four retired values, so an employee's own page showed no open evaluation — and no past one either, since a live record is neither in that list nor CLOSED. |
| The scorecard's "where this cycle stands" | Keyed on the four retired statuses, so N3-2's panel was blank for every live cycle. |
| `needsAttention` | Filtered on two retired statuses; the dashboard's "needs chasing" was permanently empty. |
| The batch print pack | "Print all finalised" filtered `MD_FINALIZED`; the pack came back empty on every cycle. |
| The cycle board's progress | `ORDER` ranked `OPEN` equal to the retired `SELF_SUBMITTED`, so `reachedSelf` was true for every open record — the list reported everybody as submitted from the moment the cycle launched. |
| The lead's own-evaluation banner | Never shown, so a HOD was never reminded their own appraisal was open (P13-12). |

| # | Decision | Why |
|---|---|---|
| PF-1 | The progress helpers read **timestamps**, not a status | The same correction 0027 made to `v_cycle_progress`: under blind rating both layers fill during OPEN, so no status can say "self is in, lead is not". The status is still consulted, because it is the only thing that says a SKIPPED layer is done. |
| PF-2 | The distribution board reads the **employee's** timestamp only | It is the employee's distribution list. Reading the lead's would leak their progress onto a screen about somebody else (§5). |
| PF-3 | "Needs chasing" is late when **either** side is past its own date | There is no "whose turn" any more. It names a record, never which side is late — the list is HR's and the MD's, and §9 gives an employee nothing about anyone else. |
| PF-4 | The scorecard's wording was **rewritten, not just re-keyed** | Two old lines would have become a blindness leak the moment they matched again: "With your lead — they are reviewing your answers" tells the employee their HOD has started, and "Your lead has finished" tells them it is done. The new wording says where the RECORD is and never what anybody else has done with it. |
| PF-5 | The team queue's chip stops borrowing a retired value | It used `SELF_SUBMITTED` to mean "this lead has submitted their review" — it rendered correctly and read as somebody else's progress. |
| PF-6 | **A standing sweep, not another fix** | This class has now bitten seven times across five phases. p23 walks every file under `lib`, `app` and `components`, strips comments, and fails on any retired status outside an explicit display-only allowlist. It also proves it can detect what it forbids. |

**Regression: 1453 passed, 2 failed across 30 suites.** `p4-sql` and `p18`
remain — both drive the pre-AMEND-3 machine and need their fixtures rewritten.
Typecheck 0 errors, lint 0 errors, build clean.

**Noted, not built by me.** A recycle bin for cycles (`deleted_at`, `0032`,
`recycle-bin-tab.tsx`) and a data-grid refactor of the roster appeared in the
tree during this phase. Recorded so §18 accounts for every change, not only mine.

---

### P23-GREEN — The last two suites, and a chain that had been extended too far

`p4-sql` and `p18` had been red since AMEND-3. Both were carried as named debt
through five phases on the grounds that they needed "a deliberate fixture
rewrite rather than a patch". This is that rewrite. **The regression is 1500
passed, 0 failed — green for the first time since AMEND-3.**

| # | Decision | Why |
|---|---|---|
| PG-1 | **p18's chain had been extended too far, by me** | Its whole subject is the MIGRATION: build a database in the pre-blind statuses, apply 0020 onward, prove every row converted. A later chain-extension pass applied 0020–0032 *before* the fixture, so `evaluations_status_current` existed before a single pre-blind row could be inserted and the suite crashed on its own setup. FIX-1's "run the whole chain before the seed" is right everywhere else; p18 is the one suite whose chain must be split, and that is now written down in it. |
| PG-2 | p18's FULL-disclosure assertion was **inverted, not deleted** | It set `disclosure='FULL'` and proved blindness survived it. 0022 (PR-3) retired FULL outright, so the claim is now stronger and is asserted in both halves: the setting cannot be reached, AND a CLOSED evaluation exposes no lead layer anyway. One without the other leaves a gap. Same treatment `rls.sql` got in P19-B. |
| PG-3 | **p4-sql was half-migrated, which is worse than not migrated** | Its statuses had been updated but its ACTORS had not: the lead returned a form and the MD returned it again, both of which AMEND-3 deleted (A3-7 — a lead cannot return a form they are not allowed to read). The labels still named retired statuses too, so a passing run would have described a machine the product no longer has. |
| PG-4 | The walk now follows §8 exactly, including what is **refused** | Two negative assertions carry the phase's substance: a LEAD cannot return a form, and HR may NOT record the MD's review. The second is the second pair of eyes AMEND-2 restored, checked from the side that would break it. |
| PG-5 | A `callSystem` helper, because the system actor is not "actor: null" | `apply_evaluation_transition` refuses a transition recorded "on behalf of another user" unless the caller IS the actor, and the system path is the one where both are null. Leaving a JWT subject set from the previous call made a legitimate system transition look like an impersonation. |
| PG-6 | The audit-row count is **derived, not pinned** | It was `=== 9`, a number somebody has to re-derive by hand every time the walk changes — and getting it wrong looks like a product failure. It now compares the total against the distinct transitions actually made. |
| PG-7 | The retired actions are asserted **absent**, not merely unlisted | `md_finalize`, `return_to_employee` and `return_to_lead` are gone. Checking only that the new ones are present would let an old one quietly reappear. |

**0032 is in the tree but not in the applied set.** The concurrent recycle-bin
work added it; every suite now loads it and it applies cleanly on the full chain,
breaking nothing. The recycle bin will not work until it is applied.

**Regression: 1500 passed, 0 failed across 30 suites.** Typecheck 0 errors,
lint 0 errors, build clean.

---

### FIX-2 — Autosave still enforced the flow AMEND-3 deleted

Not a phase. A repair, prompted by a HOD opening their review and being told
**"This evaluation is not ready for a lead review."** with the indicator stuck on
*Not saved — retrying* — on a screen whose entire premise is that the HOD rates
without waiting for anybody.

Migration `0033_parallel_layer_writes.sql`.

**The message was not merely a refusal. It stated the opposite of §1.** Blind
parallel rating means both forms open at launch and neither side can see the
other; "not ready" told the HOD to go and wait for something they are forbidden
to know about, and would have sent them to HR to ask about a working screen.

**The root cause, and how it survived.** AMEND-3 moved the staff machine to
`DRAFT → OPEN → …` and migrated every row. 0021 rewrote the RLS policies to
match and introduced `self_open()` / `lead_open()` for A3-3's rule — *a layer's
write gate is its own timestamp, not the record's status*. **It never touched
`merge_evaluation_answers`**, which is the only write path autosave has. That
function is SECURITY DEFINER, so RLS never sees the write and its three internal
status checks are the whole gate — and all three name statuses that 0021's own
`evaluations_status_current` CHECK forbids. Every branch was unreachable:

| layer | wanted | reachable |
|---|---|---|
| SELF | `CYCLE_ACTIVE` | no |
| LEAD | `SELF_SUBMITTED` | no |
| MD | `LEAD_REVIEWED` | no |

So **the employee's autosave was equally dead and nobody had reported it** — the
lead's failure was louder only because its message was a lie rather than a
plausible sentence. AMEND-3's acceptance run proved blindness through the RLS
policies and the transition RPC; it never wrote an answer through the function a
form actually calls, which is exactly the gap.

| # | Decision | Why |
|---|---|---|
| F2-1 | The gate is `status = 'OPEN'` **and 0021's helper**, not the helper alone | The row-level lock at `v_row.submitted_at` was already correct, but it cannot see `self_skipped` / `lead_skipped` — HR advancing past a missing layer must not leave it writable. Reusing 0021's helpers rather than restating the condition keeps one implementation shared with the policies; a second copy is how the RPC and RLS end up disagreeing about who may write. |
| F2-2 | The LEAD gate is **deliberately not a function of `self_submitted_at`** | Consulting it would gate correctly and still be wrong: it would make the employee's progress observable through whether the HOD's form saved. A3-8 keeps that signal out of every lead-facing path, and a write gate is a path. |
| F2-3 | Patched via `pg_get_functiondef`, **and each replacement verifies it matched** | A1-5 and P19B-17's idiom: the body differs by one condition and retyping the rest invites a transcription error into tested code. Its known failure mode is silently matching nothing, so every pair raises if it finds neither the old form nor the new, and a third block reads the rewritten definition back and asserts no retired status survives. |
| F2-4 | The MD branch's **status** is corrected to `HR_APPROVED`; its **role** is left alone | §8 gives the MD their write at `HR_APPROVED → MD_REVIEWED`, so leaving `LEAD_REVIEWED` would leave a third dead branch. But 0012 merged the role to `is_admin()` and AMEND-2 has since re-split HR and MD — that is a §9 matrix change touching sixteen policies, and it does not belong in a fix for a stuck form. Recorded as debt, not smuggled in. |
| F2-5 | The false message is replaced; the SELF one is kept | "No longer open for editing" is still true. §0.2 freezes names, not exception strings, and no TypeScript matches on either — checked. |

**Verification — 14 checks on real Postgres 17 (PGlite), 0 failed.** The suites
were not available on this machine, so the harness extracts 0012's function and
0021's two helpers **verbatim from the migration files** rather than retyping
them, and tests the patch against exactly the text it will meet.

The bug is reproduced first: before 0033 the HOD is refused with the message the
owner saw, and the employee is refused too. After it — the HOD rates while the
employee has not submitted, the employee rates independently, both layers store
their own answers, the HOD may still edit after the employee submits, a
submitted layer refuses further writes, a **skipped** layer is closed although it
was never submitted, nothing is writable once the record leaves `OPEN`, and the
migration is idempotent.

**Not touched, and did not need to be.** `transitions.ts` row 3 already gives the
lead's submit `actors: ["LEAD"]` with no dependency on the employee, and
`readOnly` on the review screen is the lead's own submission. The TypeScript half
has been AMEND-3-correct throughout; every retired status left in `lib/evaluations`
is in a comment.

**Apply order.** `0033` requires `0021` and raises a sentence naming it if the two
helpers are absent, rather than failing later inside autosave. **Until it is
applied no form in the system can save — neither the employee's nor the HOD's.**

---

### FIX-3 — The save/submit contract on both rating forms

Not a phase. Found while confirming FIX-2, from a report that a HOD with every
question answered was told **"29 questions still need an answer."**

**The count was the tell.** The header read *30 of 31 answered* — the client's
own tally — while the server said 29 were blank. Both were right: 31 questions,
29 of them required, and the server's copy held **nothing**, because every
autosave had failed. The screen was describing the rater's work; the server was
describing an empty draft. Neither number was wrong and the sentence they
produced together was, and it blamed the one person who had done the work.

That is FIX-2's root cause surfacing at the other end. But getting there
exposed three defects in the client that are real on their own, and would
outlive the migration.

| # | Decision | Why |
|---|---|---|
| F3-1 | **A failed save puts the patch back on the queue** | `flush()` cleared `pending` *before* awaiting, and on failure never restored it. So the next flush found an empty queue and returned immediately: nothing was ever resent, and the answers were gone. The indicator said *Not saved — retrying* the whole time, which was false in both halves — it was not retrying, and there was no longer anything to retry with. P12's self form has restored the patch since it was written (merged UNDER any newer edit, so a retry cannot resurrect a value since changed); P13's review screen dropped the line, and a single transient failure was enough to lose twenty minutes of somebody's work (§13.6). |
| F3-2 | **Submit stops when the draft never reached the server** | Both forms flushed and then submitted regardless of the outcome, handing the server a copy that did not contain the answers — which is exactly how "N questions still need an answer" reaches somebody looking at a full form. The save is the honest failure, so it is the one reported (§0.7), and the message says plainly that nothing typed is lost. |
| F3-3 | `inSync` is a **ref, not state** | `flush` is what the unload listeners and the 20-second guaranteed save are keyed on. Reading `saveState` to answer "does the server have everything" would put it in `flush`'s dependency list, so every idle→saving→saved cycle would tear those listeners down and restart the interval — starving the very retry F3-1 exists to make real. Caught by writing it the obvious way first. |
| F3-4 | An empty queue is **not** proof the server has everything | The last attempt may have failed and left nothing new to send. That is the case the naive early-return gets wrong, and it is the exact case a submit needs to know about. |
| F3-5 | A failed submit **closes the confirmation dialog first** | The error renders on the page and the dialog covered it completely, so a failed submit looked like a button that did nothing at all — which is what was reported as "no confirmation". The self form is the opposite shape: it renders its error *inside* the dialog, so that one must stay open. Same goal, two layouts, and a test now pins each. |
| F3-6 | A successful submit **scrolls the confirmation into view** | The confirmation banner is at the top of the page and the submit button at the bottom, so the one thing the rater is waiting for was a scroll away and the screen appeared unchanged. |

**Verification — 20 checks, 0 failed.** Both forms are asserted to report
whether the server has the draft, to restore a failed patch with newer
keystrokes winning, to stop the submit when it has not saved, and to say so
rather than repeating the server's misleading count. Plus the two symptoms that
produced silence: the dialog closes before the error on the lead screen and
stays open on the self screen, and success brings the banner into view. Absence
checks strip comments first — the trap §18 has now recorded six times.

Typecheck 0 errors, lint 0 errors.

**This does not replace 0033.** These changes make the failure honest and
non-destructive; the forms still cannot save until `0033_parallel_layer_writes.sql`
is applied.

---

### FIX-4 — A reload could destroy a finished form

Not a phase. A repair, prompted by somebody filling a whole rating form,
refreshing by accident, and getting it back empty.

`lib/forms/draft-cache.ts`, wired into both rating screens.

**Why the whole form vanished.** Until autosave lands, the ONLY copy of an
answer is React state, and a reload destroys that. With FIX-2 unapplied every
save was being refused, so the server had nothing to hand back and the form
returned blank — but the exposure is not specific to that bug. A dropped
connection, a sleeping laptop, a phone killing a backgrounded tab: any of them
loses everything typed since the last successful save. §13.6 says never lose a
half-filled form, and the product had no answer for the gap between a keystroke
and its acknowledgement.

| # | Decision | Why |
|---|---|---|
| F4-1 | **sessionStorage, not localStorage** | These are appraisal ratings — a HOD's verdict on twelve reports, or somebody's own self-assessment — and §5 keeps each layer away from the other side. A shared office machine is exactly where that gets tested, and localStorage would leave every draft ever typed sitting in the browser for the next person to open devtools on. sessionStorage still survives a reload, including a hard one, which is the accident this exists for; it dies with the tab. The trade is deliberate and stated: it protects against the accident, not against closing the tab, and closing a tab is not an accident in the way refreshing is. |
| F4-2 | The mirror is a **safety net, never a source of truth** | The server's copy is what is scored and what §5 freezes. `unsavedFrom` returns only what the server is missing, so the mirror can never overwrite something the database already accepted. |
| F4-3 | **Only the difference is announced** | The mirror is rewritten on every keystroke, so it is nearly always a duplicate of what the server already holds. A banner on every reload of a saved form would teach people to ignore the one that means something. |
| F4-4 | Local wins where the two disagree | Safe by construction rather than by policy: sessionStorage belongs to this tab, so its contents were typed here and are at least as new as anything this tab has managed to send. |
| F4-5 | Read through **`useSyncExternalStore`, applied during render** | Three constraints meet here. sessionStorage does not exist during SSR, so it cannot seed `useState` without a hydration mismatch on the very fields being restored. An effect calling setState is the cascading-render shape the React compiler rejects — it failed lint on the first attempt, which is the sixth time this codebase has met that rule. And an effect also paints once with the un-restored values, visible as the answers flickering in. So: the store gives a value with a server snapshot (theme.tsx and resizable-panes.tsx already read browser state this way), and the merge is PC-4's during-render adjustment, guarded by `appliedKey` to happen once. |
| F4-6 | The snapshot is **frozen per key**, and dropped on unmount | `getSnapshot` must return a stable reference or `useSyncExternalStore` re-renders forever — the trap resizable-panes.tsx records. Freezing also matches the intent: the only version that matters is the one that was in the tab when the page loaded. Unmount forgets it, so returning to a form re-reads rather than replaying the load before last. |
| F4-7 | The recovery goes **on the wire, not just on screen** | Restoring answers visually without queueing them would leave somebody looking at a full form the server still knows nothing about — the same bug wearing a friendlier face. Only a ref is written synchronously; the send is deferred by a timeout, which is what keeps setState out of the effect body. |
| F4-8 | **Every storage access is wrapped** | Storage throws rather than returning null in more cases than is comfortable — Safari private browsing, a full quota, an embedded webview with storage disabled. A form that will not render because its safety net could not be read is worse than no safety net. |
| F4-9 | Cleared on submit | The layer is locked (§8) and the server has it, so the mirror has nothing left to protect, and ratings left in the tab past that point are exposure with no purpose. |

**Verification — 24 logic checks + 18 wiring checks, 0 failed.** The logic runs
directly against the real module with a storage stub: the round trip including
arrays and comments, the diff returning only what the server lacks, local
winning, a reordered multi-select counting as a change while a re-serialised
identical one does not, the frozen snapshot returning an **identical reference**
across writes, `forgetMountDraft` re-reading, and four ways of breaking storage —
corrupt JSON, a wrong-shaped draft, a missing comments half and a throwing
`setItem` — none of which reach the caller. The wiring is asserted on both
screens: read through the store with a server snapshot, applied once during
render, mirrored on change, queued for sending, forgotten on unmount, cleared on
submit, and sessionStorage with no `localStorage` anywhere in the module.

Typecheck 0 errors, lint 0 errors.

**This is still not a substitute for 0033.** It stops a reload destroying work
and it makes any save failure survivable, but the forms cannot reach the
database until `0033_parallel_layer_writes.sql` is applied.

---

### FIX-5 — Deleting questions, single and in bulk

`deleteQuestionsForever` and `setQuestionsActive` in `lib/questions/actions.ts`;
a delete mode, a row selection and a confirmation on the question bank.

**The requested flow, built as asked.** A Delete control offering two choices —
one question, or several. "One" puts a bin on every row. "Several" turns the
rows into a selection with a header toggle, a running count and a bulk action.
Neither is on until it is chosen, so reading the bank is never cluttered with
checkboxes nobody asked for.

**One deviation, and it is the substance of the phase.** §17 and PC-3 forbid
destroying a question that has been asked: answers are filed against its id and
every launched evaluation holds a frozen copy (§5). So the action deletes only
what has never reached anybody, and **retires the rest rather than refusing** —
HR asked for it to go, and the honest outcome is that it stops being asked, not
that the click did nothing. The same line `deleteCycleForever` and
`deleteDepartment` already draw.

| # | Decision | Why |
|---|---|---|
| F5-1 | **The application guard is the only protection, and that is now proved** | `evaluation_questions.question_id` is deliberately NOT a foreign key (P3-2, and 0003's own banner says so), because a snapshot must outlive the row it was taken from. The consequence nobody had tested: Postgres will happily delete a question sitting in forty frozen forms, silently, leaving every one of them pointing at nothing. There is no constraint to fall back on. The suite asserts the delete succeeds unguarded and leaves an orphan — so the check can never be removed on the assumption the database has it covered. |
| F5-2 | A conditional's parent is **found and named** before the delete is attempted | `depends_on` has no cascade, so this would otherwise surface as a raw foreign-key violation. The fix — edit or detach the follow-up first — is not something a constraint message tells anybody, and the child's text is what makes it findable. |
| F5-3 | The text is read **before** anything is destroyed | Once the row is gone the audit diff is the only record the question ever existed, so it has to carry what it said (§12). Audited before the delete for the same reason. |
| F5-4 | One audit row per question, never one carrying an array | P14-5's call: a deletion is a decision about a question, and somebody asking why one vanished should find a row about it rather than unpack a blob. |
| F5-5 | **Select-all covers what is on screen, never the whole bank** | The filters are how HR narrows to "the ones I mean". A toggle reaching past them would select questions the person cannot see, which is the classic way a bulk action takes something nobody intended. The label says "select all N shown". |
| F5-6 | The dialog states the rule **before** the click, and the strip names what was kept afterwards | Whether a question sits in somebody's frozen form is a server question, so the dialog cannot evaluate it — it explains what happens to each kind, and the result names every question that was kept and why (§13.4). |
| F5-7 | Both toggles are `useCallback` | The column definitions are memoised and close over them; an arrow recreated each render would rebuild the whole column set on every keystroke in the search box. Caught by lint rather than by inspection. |

**Verification — 9 checks on real Postgres, 0 failed.** The FK clauses are
copied from 0002 and 0003 exactly as written there, because they are the
subject. Proved: a question inside a frozen form deletes without complaint and
orphans the snapshot; options and department mappings cascade; a conditional's
parent is refused by a constraint whose message explains nothing; and detaching
the follow-up makes it deletable, which is the fix the action tells HR to make.

Typecheck 0 errors, lint 0 errors (1 pre-existing `useReactTable` warning).

---

### P9D — Bulk question import, and the role→department mapping

Migration `0034_question_import.sql`. `lib/questions/import.ts` (pure),
`lib/questions/import-actions.ts`, the import dialog on the question bank, and
`supabase/imports/job-specific-questions.csv` — all 116 questions from
ROLE_QUESTIONS.md, ready to load.

**The blueprint proposed role profiles; the owner chose departments.** Asked
directly, they gave a role→department mapping instead of picking an option, so
the roles that need their own question set become departments of their own.
`role_profiles` and `role_profile_questions` are NOT built. Recorded here
because the document argues the opposite and a later reader will want to know
it was a decision, not an oversight.

**Two renames, both explicitly instructed (§0.2).** `MIS` → **Data Analyst**,
and six new departments: Sales Coordinator, Design Coordinator, Process
Coordinator, Executive Assistant, Supervisor, SAB Operator. The department list
is now a mix of functions and job titles; said once, at the time, and not
relitigated.

**Sales Executive was missing from the mapping** — 12 of the document's 13
roles were named. Rather than guess a home for its 8 field-sales questions,
they carry `Sales Executive` in the file, which the importer flags as an
unknown department needing confirmation. The decision reaches the owner at the
moment it matters instead of being made for them.

| # | Decision | Why |
|---|---|---|
| P9D-1 | **Migration is `0034_`, not the blueprint's `0019_`** | 0019 is `0019_departments_reconcile.sql` and is applied. §0.8, as with 0010, 0017, 0021, 0022, 0023, 0028, 0029 and 0030. |
| P9D-2 | The preview and the commit run **one builder** | `buildImportPreview` is pure and takes the bank and the department list as arguments, so the server re-runs the identical function rather than trusting what the screen sends. P19D-3: a preview produced by a second, more forgiving parser is a preview that lies, and without the re-run the browser could talk the commit into accepting a row it had just shown as broken. |
| P9D-3 | **Dedupe by text is a property of the FUNCTION, not of the payload** | Found by the suite, not by inspection. The action resolves each row against the bank and passes `existing_id` — but `import_questions` is granted to `authenticated` and callable through PostgREST with any payload, so relying on that field made "re-importing the same file creates nothing" a property of the caller. The same file twice, with the field left null, duplicated every question. The function now looks the text up itself, with the same normalisation `questionKey()` uses so both halves agree on what "the same question" means. |
| P9D-4 | A **retired** question does not count as "already exists" | Both halves exclude it. Otherwise re-importing an old sheet would silently pull a question somebody deliberately retired back onto a live form. |
| P9D-5 | The department carries down a sparse column | The source sheet writes the role once and leaves the rows beneath it blank. Detecting that costs four lines and removes the single most likely reason for a first import to fail; the alternative is telling HR to reformat their own file. `role`, `role_profile` and `job_role` are accepted as column names for the same reason. |
| P9D-6 | An unrecognised answer type is an **error, not a default** | A question quietly becoming a 0-5 rating when somebody meant Yes/No is only noticed once it is on a live form. Blank still defaults, because blank is an absence rather than a mistake. |
| P9D-7 | One bad row imports **nothing** | P19C-8. A half-imported file leaves HR working out by hand which rows landed, and the second attempt then reports those as already existing. Unlike the employee import (P19C-9), every write here is a database write, so one transaction genuinely covers it — hence one PL/pgSQL function rather than a loop of PostgREST calls (P19D-2). |
| P9D-8 | Creating a department needs an explicit tick | The blueprint asks for it and it is right: a department created by a typo has to be retired by hand afterwards, and it would sit in HR's picker in the meantime. |
| P9D-9 | Import sits **beside** Add a question, not inside it | Adding one question and loading a hundred are different jobs; hiding either inside the other costs whoever is doing the common one an extra click. |
| P9D-10 | The export is the same shape the importer reads | So export → edit in Sheets → re-import is a genuine round trip, and a no-op if nothing changed — every exported question matches by text and is mapped, never duplicated. |
| P9D-11 | `import_questions` is added to the hand-authored `types/database.ts` | P1-6: the file is hand-maintained because Docker is unavailable. A cast at the call site would have compiled and left the next `db:types` run to silently drop it. |

**The counts, as the blueprint asks for them.** 13 roles, 116 rows, matching
ROLE_QUESTIONS.md exactly per role. **103 distinct question texts** — 13 rows
are shared across roles and become one question row mapped several times:
Timely Completion of Assigned Work (3 departments), Report Preparation (3),
and Fabric Handling, Machine Maintenance, Defect Identification, Wastage
Control, Production Process Knowledge, ERP / Google Sheet Knowledge,
Documentation Accuracy, Google Sheets / MS Excel Knowledge and Work Process
Compliance (SOP Following) at 2 each.

**Verification — 42 pure checks + 25 on real Postgres, 0 failed.** The reader is
exercised against the shapes a spreadsheet actually contains: the sparse
two-column sheet, a `role` header, blank trailing rows, a BOM, and six ways for
a row to be wrong — each of which must name what was typed. The generated file
is proved to survive its own reader with zero errors. On Postgres, the function
is loaded verbatim from 0034: shared text becomes one row mapped twice, a
re-import creates nothing, an unknown department is refused and writes
**nothing**, a bad row rolls the whole batch back, the audit row names the file
and the departments and takes its actor from the session, and both a non-HR
caller and an anonymous one are refused by the function itself.

Typecheck 0 errors, lint 0 errors (1 pre-existing `useReactTable` warning).

**Not done.** The live-preview binding bug (the document's Prompt 3) is
untouched — it is a separate fix in the question drawer.

---

### P24 — The worker appraisal form, in the Form Builder

Migration `0035_worker_questions.sql`. `lib/worker/{questions,actions}.ts`,
`/admin/form-builder/worker`, and a third tab on the builder strip.

**§7's worker module has existed on paper since P0 and none of it has ever been
built** — §18's STATUS calls it "the largest single gap against the
constitution". This builds ONE piece: the form. The appraisal itself
(`worker_evaluations`, the supervisor flow, §8's worker transition table, the
print pack) is still absent, and both the migration's notice and this entry say
so rather than letting a tab imply a working module.

**`worker_questions` is new schema, and was explicitly instructed.** §0.4
forbids inventing a table; PR-5 flagged this exact one as missing and refused to
seed it for that reason. The owner asked for it directly ("for workers we have
separate simple form that also we need to build in our app"). §5's "WORKER data
lives exclusively in the worker_ tables" is what shaped it.

| # | Decision | Why |
|---|---|---|
| P24-1 | A separate table, because there is nowhere else it could go | 0008 added `questions_core_track_staff`, a CHECK refusing a WORKER row in `questions` (P8P-4). That constraint is the module boundary made structural, and it is doing its job: the staff bank will not physically accept these. Which is the point — §7 shares authentication, profiles, departments, the audit log and the design system, and nothing else. The suite asserts the table has **no foreign key into the staff schema**, so the two cannot be joined by accident. |
| P24-2 | **`is_overall` is a column, not a text match** | §11: "Worker track: overall = the Supervisor's Overall Performance tick, not a mean." The source form prints that fact twice — row 8 of the table, and again as a line beneath it. Scoring has to find that row, and matching on its text would break the first time somebody edited the wording — which §17 freezes anyway. A partial unique index allows exactly one, because §11 names it in the singular. |
| P24-3 | The overall row **cannot be removed**, and says so | A worker form without it would have no score at all. Rendered as a locked "Kept" rather than hidden: a control that silently is not there reads as a bug; one that says why reads as deliberate (§13.4). The action refuses it server-side too, because a hidden button is not a permission. |
| P24-4 | The eight qualities are transcribed **exactly as printed** | §17 forbids improving wording that came from a source form, so "Behavior & Discipline" keeps its US spelling and "On-time Reporting" its hyphen. The suite asserts both, and asserts the British spelling is absent — the correction somebody will eventually make in passing. Helper text is NEW and is marked as such in the migration, so nobody mistakes it for something frozen. |
| P24-5 | **The shared `FormRenderer` draws it. No second renderer.** | A tick sheet is a form with one section of TICK_3 questions in it, and P9-1 forbids a second renderer — a test greps for one. §7's isolation rule targets *functions*: nothing here calls `assembleQuestions`, `getEvaluationForm`, `computeScores` or `buildZodSchema`, and the suite lists them by name and asserts none appears. The renderer is UI infrastructure, the same distinction P9-3 drew when the department preview was made to return the identical `FormDefinition` shape so one component could draw both. |
| P24-6 | The preview renders under `CORE_PERFORMANCE` | `FormQuestion.section` is not optional and its enum is the staff form's. Adding a WORKER value would put a worker concept inside the enum every staff form sorts by; using the truthful existing one keeps the shared TYPE shared and the DATA separate, which is the distinction §7 actually cares about. |
| P24-7 | The salary block, the comment and the signatures are **shown but not editable** | P2-10 settled where they live: Old Salary, Increment % and New Salary are decision columns, not questions, and putting them in a question bank would let somebody edit a pay field as though it were a rating. They are listed beneath the preview so HR can see the whole form, labelled as not being questions. |
| P24-8 | Writes are `HR_ADMIN`, never `ADMIN_ROLES` | §9 as amended by AMEND-2: HR writes configuration, the MD reads it. The page guard admits both because reading the form is something the MD may do; all three write actions name HR alone, and the suite asserts `ADMIN_ROLES` appears nowhere in them. |
| P24-9 | A third **tab**, not a mode of the builder | The worker sheet shares no question, no scale and no department with the staff form. Folding it in as a filter would suggest the two are views of one bank; they are two forms, and the tab strip says so. |

**Verification — 37 checks, 0 failed.** The eight qualities are checked against
the source form character for character. The isolation rule is checked by naming
every staff assembly and scoring function and asserting none is reachable from
any of the four new files, and that the module reads `worker_questions` and
never `questions` or `department_questions`. On real Postgres: eight rows, all
TICK_3, exactly one overall and it is Overall Performance, in the printed order;
a second overall row is refused; the migration is idempotent; RLS is on with a
read policy and an HR write policy; and no foreign key crosses into the staff
schema.

**A test of mine was wrong and was fixed, not deleted.** The "exactly one
renderer" detector required a `switch`, and `FormRenderer` dispatches with a
chain of ternaries — so it matched **nothing at all**, and reported that as a
failure. A detector that finds zero renderers in a codebase with one is not
strict, it is broken. It now keys on the scale-primitive import plus three or
more `responseType ===` branches.

Typecheck 0 errors, lint 0 errors.

**Not built, and worth stating plainly.** There is no worker appraisal: no
`worker_evaluations`, no worker cycle, no supervisor screen, no worker print
pack, and §8's worker transition table still describes something that does not
run. This is the form, and a place to edit it.

---

### FIX-6 — The draft mirror destroyed the draft it was protecting

FIX-4 shipped a tab-local mirror so a reload could not lose a filled form. It
was reported still broken, and it was: **the mirror wiped itself on every page
load**, and the fault was mine.

**The ordering.** The mirror was written from an effect on `values`. Effects run
on the **hydration commit** — which is BEFORE `useSyncExternalStore` re-reads
the store and hands back what the tab had saved. So on every reload the sequence
was: server renders empty → hydrate → effect fires with those empty values →
`writeDraft` overwrites the saved draft with `{}` → the store is finally read
and finds nothing. The form came back blank exactly as if there had been no
mirror at all, which is precisely what was reported.

| # | Decision | Why |
|---|---|---|
| F6-1 | The mirror is written from the **change handler**, never from an effect | A handler only ever runs because a person typed, so it can only ever store something they meant. It has no relationship to the hydration commit and cannot race the restore. The effect that remains does one thing — clear on submit — and clearing cannot destroy anything that is not already safely on the server. |
| F6-2 | The lost-work class is now **pinned by a test**, not by a comment | The suite parses every `useEffect` in both forms and fails if one calls `writeDraft` with `values` in its dependency list. A comment saying "do not do this" would not have caught it, because I wrote the comment and the bug in the same file. |
| F6-3 | No refs during render | The first fix read `cacheKey` and `readOnly` through refs assigned during render, which `react-hooks/refs` rejects outright. The handler closes over them and lists them as dependencies instead — its identity changes when the answers do, which costs nothing on a form that re-renders on every keystroke anyway. |

**Verification — 44 checks, 0 failed** (up from 38). Typecheck 0 errors, lint 0
errors.

**Also added: `supabase/whats-applied.sql`.** A read-only query that reports,
per migration from 0026 to 0035, whether the object it creates exists. Three
separate bugs this session had "that migration was never applied" as their real
cause, and there was no quick way to tell. Now there is a table instead of a
guess.

**Still true, and still the blocker on saving:** `0033_parallel_layer_writes.sql`
is not applied. Until it is, `merge_evaluation_answers` gates the LEAD layer on
`SELF_SUBMITTED` — a status AMEND-3 retired and no row can hold — so every save
is refused and every submit reports the honest "your answers have not reached
the server". The mirror now keeps the work safe across a reload; it cannot make
the database accept it.

---

### P25 — Section names and order become editable

Migration `0036_form_sections.sql`. `lib/forms/{section-config,section-actions}.ts`,
an **Edit sections** dialog on the builder's structure pane, and `FormSection.label`
threaded through the renderer.

**The prompt was a rename.** "Manager Review (Team Lead only)" is the wrong name
for a section once some of its questions are answered by the employee too — and
the owner asked for the structure to be editable generally rather than for that
one string to be changed.

**Worth recording, because it nearly became a bigger change than it needed to
be:** that section renders lead-only *because its questions are `LEAD_ONLY`*,
not because of its name. P13-2 fixed the row shape to `answered_by` and P9B-4
did the same for the builder's lead view. So making some of those nine questions
answerable by the employee needs no structural change at all — it is
`answered_by` per question, editable in the drawer since P8. Only the NAME was
actually wrong.

| # | Decision | Why |
|---|---|---|
| P25-1 | **The set of sections is not editable, and the dialog says so first** | `question_section` is an enum. §0.2 fixes an enum value once created, and the reason is not conservatism: the value sits on every `questions` row AND is frozen into every `evaluation_questions` row at launch (§5). Adding or dropping one would rewrite what people were asked in appraisals that have been signed. The suite asserts no action can insert or delete a row and that the migration contains no `alter type`. |
| P25-2 | **"Park" is what removing a section usually means** | Refusing outright would leave HR with no way to take a section off the form short of retiring its questions one at a time. Parking hides it from new forms, keeps every question exactly where it is, and is reversible — the same shape as retiring a question (PC-3) rather than deleting it. |
| P25-3 | The label is applied to the **snapshot's** sections, never used to re-select them | §5 freezes which questions were asked and in what order. `getEvaluationForm` groups the frozen rows first and decorates the headings afterwards, so a rename cannot disturb either. Asserted by source position, and by proving the snapshot query never mentions `form_sections`. |
| P25-4 | `FormSection.label` is **optional**, and absent means the shipped default | One field on the type made every rendered form pick up the change — the employee's, the lead's, the builder preview, the printed sheet — because they all go through `FormDefinition`. Optional is what keeps every existing caller correct without being edited, and what keeps a form rendering if `form_sections` cannot be read. A section with no name is a blank heading on somebody's appraisal, which is worse than an old name. |
| P25-5 | `SECTION_LABELS` and `SECTION_ORDER` **stay**, as the defaults | 0036 seeds the table from them, so applying it changes nothing anybody can see — the point is to move the values somewhere editable, not to edit them. They are also the fallback before the migration is applied, which is the gap every deploy has. |
| P25-6 | Read once per request, through React's `cache()` | A page rendering six components that each need a section name issues one query, and all six see the same answer — which matters while HR is editing in another tab. |
| P25-7 | A missing section degrades to **last**, never to absent | 0036 refuses to apply while any enum value has no row, so this only fires if one is deleted by hand. But dropping a section from the order would silently stop its questions being asked, and a heading in the wrong place is a far cheaper failure than a section that vanished. |
| P25-8 | The editor opens from the **structure pane heading** | That is where somebody is standing when they decide a section is called the wrong thing — not in a settings menu two screens away. |
| P25-9 | A rename records the name it replaced | §12. "Why is this section called something else?" is a question asked weeks later, and the audit diff is the only place the previous name survives. |

**Verification — 28 checks, 0 failed.** On real Postgres: all eight sections
seeded with today's names and today's order (Job Specific Skills still fourth,
P8P-2); a blank name refused by a CHECK; a second row for one section refused;
idempotent; RLS on with read-for-everyone and write-for-HR. Source-level: no
action can add or delete a section, the enum is never altered, the section value
itself is never written, the defaults survive as the fallback, and the rename
reaches the real form, the preview and the renderer by the same path.

Typecheck 0 errors, lint 0 errors.

**Partial, and worth being exact about.** Every screen that renders a FORM now
shows HR's names. Screens that call `sectionLabel()` directly for their own
chrome — the question-bank filter, the departments mapping screen, the scorecard's
section profile, the cycle wizard's review step — still show the shipped
defaults, because they do not go through `FormDefinition`. They are consistent
with each other and with history; they are not yet consistent with a rename.
Threading the config into them is mechanical and is the obvious next pass.

---

### FIX-7 — A forbidden redirect that explained nothing

Two things, from one report that saving still fails.

**The save failure is unchanged and is not a code fault.** `merge_evaluation_answers`
still carries 0012's three retired status gates, because 0033 has not been
applied. The string "This evaluation is not ready for a lead review." exists in
exactly three files — 0011, 0012 and 0033's own comment — so its appearance on
screen is proof of which version is live. Nothing in the application can route
around it: it is the only write path a form has, and it is SECURITY DEFINER, so
RLS (which 0021 got right) never gets a say.

`supabase/FIX-SAVING-NOW.sql` was added: the same change as 0033, cut to
seventeen lines so it can be pasted in one go, and proved end to end — before
it, the RPC returns the exact error the owner reported; after it, the write
succeeds and the answer is stored.

**FIX-6 worked.** The report carried "13 answers were recovered from this tab",
which is the recovery banner doing its job on a form whose saves were all
failing. That is the case it was built for.

**The second bug was real.** `requireRole` and `requireEvaluationAccess` both
redirect to `landingPathFor(roles) + "?error=forbidden"`, and **nothing anywhere
read that parameter**. Opening a link you are not entitled to open bounced you to
a page that said nothing at all — which reads as the app losing the click rather
than as a decision it made (§13.4).

| # | Decision | Why |
|---|---|---|
| F7-1 | The notice is mounted in the `(app)` layout, not on the landing pages | `landingPathFor` can send somebody to any of four routes depending on their roles. A notice on three of them would be worse than none, because the missing one is the case nobody tests. |
| F7-2 | It says nothing about what was being opened | P6-11: a guard that explains itself precisely becomes an oracle for who is being evaluated. It says the page is not theirs and points at My Team, which is the actionable half, and reveals nothing about whether the thing exists. |
| F7-3 | Dismissing removes the parameter from the URL | Left in place it returns on every refresh and travels to anybody the URL is shared with, who would then see a warning about something that never happened to them. |
| F7-4 | Wrapped in `Suspense` | `useSearchParams` opts its subtree out of static rendering, and this layout wraps every authenticated page. |

Typecheck 0 errors, lint 0 errors.

---

### FIX-8 — /my-evaluation was a queue of round trips

Reported as lag on the employee's own page. It was not rendering, and it was not
the database being slow: the page issued its queries **one after another**, and
every one of them waited for a full round trip before the next was sent.

**The chain, as it stood.** `requireEvaluationAccess` → `getEvaluationForm`
(evaluation → snapshot → answers → section config, four in series) → cycle →
lead's name → own profile → department → the return audit row → the outcome.
Eleven blocking trips before a single question could render, on the screen most
of the company sees first and the one they open on a phone.

Not one of them needed the previous answer. The snapshot, the answers and the
section names are keyed by `evaluationId` alone; the cycle, the lead and the
profile by ids the guard has already established.

| # | Decision | Why |
|---|---|---|
| F8-1 | The reads are **issued together**, not made cheaper | No query was removed, no column dropped, no filter added. `Promise.all` changes only what waits for what, so there is nothing here that can quietly return different data than before. |
| F8-2 | **RLS still judges every query on its own** | Batching is not a join. Each request carries the same session and meets the same policies it always did; an evaluation the caller may not read still comes back empty and is still refused by the same branch. The suite asserts every error branch survived the move and that no `.eq("evaluatee_id")` crept into the index — writing one would imply the policy might not hold. |
| F8-3 | The guard still runs **before** any read | `requireEvaluationAccess` stays the first statement (§9). Parallelising the reads behind a guard is safe; parallelising the guard WITH them would be a page that fetches an appraisal before deciding whether the caller may see it. Asserted by source position. |
| F8-4 | The department stays behind, alone | It is the one genuine dependency — it needs the profile's `department_id`. One trip after the batch instead of seven inside a chain. |
| F8-5 | The count is now a **test**, not a habit | The suite strips `Promise.all` blocks and counts the `await`s on queries that remain. A future edit that appends one more sequential read fails, which is how this grew in the first place — every phase added one and none of them looked like a problem on its own. |

**Verification — 13 checks, 0 failed.** Three blocking trips remain where there
were eleven: the guard, the batch, and the department. Typecheck 0 errors, lint
0 errors.

**Unrelated, and not mine:** `lib/auth/provisioning.ts` currently fails typecheck
with three unused imports (`emailSchema`, `newPasswordSchema`, `addSalaryChange`).
Untouched, and flagged rather than silently fixed.

---

### FIX-9 — The database is a different version of the product than the code

Diagnosed from three screenshots, and it explains every save failure of the past
several sessions at once. **No code was at fault.**

**The evidence, and why it is conclusive.** The employee's autosave and the
HOD's go through the SAME function, `merge_evaluation_answers`. The owner
reported, in one sitting:

| Observation | What it requires |
|---|---|
| the employee's form saving — "saved 15:58" | the SELF branch passing, which needs `status = 'CYCLE_ACTIVE'` |
| the HOD's refused with "not ready for a lead review" | the LEAD branch failing, which it does at any status but `SELF_SUBMITTED` |
| `new row violates row-level security policy for table "audit_log"` on submit | the transition function not opening the `app.transition_evaluation` window — i.e. not 0021's version |

One fact accounts for all three: **the evaluations are at `CYCLE_ACTIVE`, so
migrations 0020 and 0021 were never applied.** The database is still running the
pre-AMEND-3 sequential state machine while the application is written for blind
parallel rating. Everything downstream — 0022 through 0036 — sits on top of that
gap.

That also explains why every previous fix "did not work": 0033 rewrites gates on
a machine the database has never had.

| # | Decision | Why |
|---|---|---|
| F9-1 | **`whats-applied.sql` leads with the row statuses, not the object list** | A migration checklist tells you what is missing; the status histogram tells you *which product this database is running*, which is the question that was actually going unanswered. `CYCLE_ACTIVE` in that result is the whole diagnosis in one line. |
| F9-2 | It now covers **0020 and 0021**, which the first version did not | The original started at 0026 because that was the oldest thing I had recorded as outstanding. The two that mattered most were older than my own list — which is exactly how this went unnoticed for so long. |
| F9-3 | `FIX-SAVING-NOW.sql` **refuses on a pre-0021 database**, and says which files to apply first | Found by testing it: a plpgsql body is not resolved at CREATE time, so the patch would have applied cleanly and then failed at runtime with "function public.self_open does not exist" — a new and more confusing error than the one it replaces. It now stops with a sentence naming 0020 and 0021. |
| F9-4 | The order is stated as an order, not a list | 0021 migrates every evaluation's status and counts the rows before and after, refusing to differ (A3-5). Applying anything that depends on the new statuses first would fail against data that does not have them yet. |

**Verification.** The diagnostic was run against a PGlite database built to the
OLD shape — the state I believe the owner's is in — and correctly reports
`CYCLE_ACTIVE → OLD — apply 0020 and 0021`, with 0020 and 0021 both `false`. The
guarded patch was run against a pre-0021 database and refused with the message
above rather than applying.

**Nothing in the application was changed by this entry.** The code has been
correct for the machine it targets since AMEND-3; the database has not been
moved onto it.

---

### P26 — The thank-you, and three sentences that described the wrong flow

`components/appraise/submitted-dialog.tsx`, shown on both rating forms once a
layer is submitted.

**FIX-9 was wrong, and the correction belongs here.** The owner's
`whats-applied.sql` output came back `true` for every migration including 0020,
0021 and 0033. The database was never on the old state machine. The inference
was drawn from screenshots taken before the migrations were applied, and it was
stated with more confidence than the evidence carried.

| # | Decision | Why |
|---|---|---|
| P26-1 | **One dialog, two audiences** | What differs between the employee's and the lead's is a tier tint and three sentences, which are props. A second copy is how the employee's version ends up saying something the lead's does not — in a product where the difference between those two audiences IS the design (§5). |
| P26-2 | It thanks the submission, not the page visit | Driven by its own flag raised inside `doSubmit`, never by `form.isSubmitted`. Keyed on the latter it would thank somebody every time they reopened a finished form to read it, which turns a courtesy into noise. |
| P26-3 | Green is on the **tick only**, never as a tier | UI2-2 keeps green as the trend colour and out of the tier palette. The tick means "done"; the tint around it is the reserved tier colour and means "whose form has landed". Two signals, neither borrowing the other's meaning. |
| P26-4 | A settle, not a bounce | DESIGN.md §5: motion confirms, it never performs. 280ms, a single ease, and `useReducedMotion` turns it off entirely — a celebratory animation on an appraisal would misread the moment badly. |
| P26-5 | Dismissible by clicking away | The one dialog in the product with nothing to lose: the work is already saved and locked (§8). Trapping somebody in an acknowledgement would be the opposite of a courtesy. |
| P26-6 | **Three sentences describing the sequential flow were corrected** | The confirm dialog, the submitted banner and the hero all said the lead "will review it next" — true before AMEND-3 and wrong since. Both sides rate the same form at the same time, and HR reads them together. Copy, not a label, so §0.2 does not freeze it — and leaving it would have taught every employee a flow the product does not have. |
| P26-7 | Neither message reports the other side | The employee is told HR reads their answers alongside their manager's ratings; they are not told whether those ratings exist yet. The lead is told the same in reverse. §5, and a test greps both strings for the phrases that would break it. |

**Verification — 18 checks, 0 failed.** Both forms use the one component; the
tier tints are the reserved ones and green is on the tick alone; the dialog is
raised inside `doSubmit` rather than from `isSubmitted`; neither message
contains a phrase that would report the other side's progress or carry a score;
"will review it next" appears nowhere; reduced motion is honoured; one primary
action, 44px, with an accessible name.

Typecheck 0 errors, lint 0 errors.

---

### FIX-10 — INSERT ... RETURNING needs a SELECT policy, and the employee had none

Migration `0037_audit_no_returning.sql`. Reported as "HOD submitted employees
form but employee not able to submit his self evaluation form", with
`new row violates row-level security policy for table "audit_log"`.

**The asymmetry was the whole clue.** Both submits call the same function and
both write the same audit row, so a difference between them had to be a
difference in the CALLER.

`apply_evaluation_transition` ends with:

```
insert into public.audit_log (...) values (...) returning id into v_audit_id;
```

Under RLS, `INSERT ... RETURNING` reads the row back, so it needs a **SELECT**
policy as well as the INSERT one. Postgres reports the failure as "new row
violates row-level security policy", which points squarely at the WITH CHECK and
is thoroughly misleading — the insert itself was permitted every time.

Who holds a SELECT policy on `audit_log`:

| | policy | source |
|---|---|---|
| HR, the MD | yes | 0005 |
| a LEAD, for their own reports | yes | 0013 (P13-5, added so the queue could say "returned on {date}") |
| the EVALUATEE | **none** | — |

So the HOD's submit passed and the employee's did not. P13-5 widened the audit
read for a display string, and in doing so accidentally gave leads the SELECT
that `RETURNING` needs — which is why this went unnoticed for four phases: the
only path anybody exercised was the one that happened to work.

| # | Decision | Why |
|---|---|---|
| F10-1 | **The id is generated before the insert; RETURNING is dropped** | The function returns the same value it always did, and needs no read-back at all. `gen_random_uuid()` was already the column default, so nothing about the row changes. |
| F10-2 | The obvious fix — a SELECT policy for the evaluatee — was **refused** | The transition rows for an evaluation include the LEAD's submission. An employee reading them would learn their manager had rated them and when, which is the exact thing AMEND-3 exists to prevent (§5). A test asserts the employee still cannot read the audit trail after the fix. |
| F10-3 | §12 is untouched | No policy was added, removed or widened. `audit_log` stays append-only and readable by the same three parties as before. |
| F10-4 | Patched via `pg_get_functiondef`, verified per replacement, and idempotent | A1-5 / P19B-17 / F2-3. It also detects a body that has already been patched and says so rather than failing. |

**Verification — 9 checks, 0 failed, on real Postgres with 0005's and 0013's
policies reproduced exactly.** Before 0037: the HOD submits and the employee is
refused with the reported message. After: both submit, both audit rows are
written, the SELF row records the employee as its actor, the ids are real — and
the employee still reads **zero** audit rows.

`supabase/whats-applied.sql` gained a row for 0037.

**A gap this exposed and did not close.** §8 says the system raises
`OPEN → PENDING_HR_REVIEW` once both `self_submitted_at` and `lead_submitted_at`
are set. `transitions.ts` carries the row and `state-machine.ts` accepts a
`bySystem` discriminator for it — but **nothing calls it**. A grep for
`bySystem: true` returns no call sites, so an evaluation with both layers in
stays at OPEN and never reaches HR. That is the next thing to fix, and it is not
this migration.

**FIX-10 addendum — the first version of 0037 would not apply.** It raised:

```
0037: apply_evaluation_transition does not contain "  )
  returning id into v_audit_id;"
```

Three of its four replacements matched and the fourth did not, which is the tell:
it was **the only one that spanned a newline**, and the function is stored with
CRLF line endings. AMEND-1 already recorded that files in this repository had
been rewritten to CRLF by an editing pass on this machine; the function was
created from one of them. The test fixture was built from LF text, so every
check passed against a body the real database does not have.

Fixed by making the target single-line — `returning id into v_audit_id;` → `;`,
which is valid because `values (…)` followed by a bare `;` is a complete
statement. **The migration is safe to re-run:** the loop raises before
`execute`, so the failed attempt changed nothing.

The suite now stores the function with **CRLF by default** and LF only under an
env flag, and passes 9/9 both ways. A patch-in-place migration that is only ever
tested against LF is a patch that works everywhere except production.

---

### FIX-11 — Both sides in, and nobody able to say so

Migration `0038_raise_pending_hr_review.sql`. The gap FIX-10 exposed, closed.

**§8's row existed and nothing could run it.** `transitions.ts` has carried
`OPEN → PENDING_HR_REVIEW` by the system since AMEND-3, and `state-machine.ts`
takes a `bySystem` discriminator for it — but a grep for `bySystem: true`
returns no call sites. An evaluation with both layers submitted stayed at OPEN
for ever and never reached HR, which is the entire purpose of collecting both.

**It was not a forgotten call.** 0021 defines the system actor as
`v_caller is null` — no JWT at all — and gates the move on `is_hr() or
v_is_system`. Whoever completes the pair is an employee or a HOD: neither is HR,
and neither is sessionless. **Nobody present had the standing to make the move.**
Adding a call site would have produced a permission error, not a fix.

| # | Decision | Why |
|---|---|---|
| F11-1 | **A trigger, not another patch to `apply_evaluation_transition`** | 0037 had to match text inside that function and failed on the real database because the stored body is CRLF (FIX-10 addendum). A trigger matches nothing, so it cannot miss. It also fires for every path that completes a pair — both submits, HR skipping a layer, and anything added later — which is what "the system raises it" ought to mean. |
| F11-2 | SECURITY DEFINER, and deliberately tiny | It IS the system actor §8 names. `status` is writable only inside the transition window (P5-2) and `audit_log` only while `in_transition` holds, so a trigger running as the employee would be refused by both. What it can do is one status move, in one direction, only when both sides are genuinely in. |
| F11-3 | A **skipped** layer counts as in | §8 lets HR advance past a missing side, and that sets `self_skipped`/`lead_skipped` rather than a timestamp. Keying on timestamps alone would strand exactly the records HR had already intervened on. |
| F11-4 | The audit row has **no actor** | §12 requires the row; naming the employee who happened to submit second would attribute a system move to a person who did not make it. |
| F11-5 | The recursion guard is the **column list**, not a flag | The trigger is `after update of self_submitted_at, lead_submitted_at, self_skipped, lead_skipped`, and its own UPDATE touches only `status` — so it cannot re-enter. Nothing to remember to clear. |
| F11-6 | Records already stranded are swept once, in the migration | Anything that reached "both in" before the trigger existed is sitting at OPEN with nobody able to move it. Leaving them would mean applying the fix and still needing a manual repair for the cohort that motivated it. Each backfilled row is audited with `backfilled: true`. |

**Verification — 13 checks, 0 failed.** One side alone does not advance and
writes no audit row; the second side does, and is audited exactly once; both
orders work; a skipped layer completes the pair; DRAFT and CLOSED records are
left alone; re-touching a timestamp does not re-advance or re-audit; the
backfill moves a pre-existing stranded record and audits it with no actor; the
migration is idempotent.

`supabase/whats-applied.sql` gained a row for 0038.

---

### P27 — The printed pack redesigned, and the company mark

`app/print/print.css` and `evaluation-sheet.tsx` restyled section by section
(§0.1 — no whole-file rewrite). `public/logo.png` is now the company mark, used
on the letterhead and in the sidebar.

**What made the old sheet look plain, and what was NOT the fix.** The obvious
answer is colour, and it is the wrong one: P15-10 keeps the tier hues off this
sheet because who-said-what has to survive a monochrome laser, and a tint that
vanishes in greyscale says nothing. Elegance on paper is hierarchy — a real
masthead, air around the title, hairlines instead of boxes, and one typographic
voice. The suite now asserts that **every colour that reaches paper is black,
white or a neutral grey**, and proves that check can detect a hue.

| # | Decision | Why |
|---|---|---|
| P27-1 | **Georgia for the title, section headings and the section band; Helvetica for data** | §3 gives the APP one family and no exceptions; this file is §7a's deliberate inversion for paper (P15-2), and a restrained serif is what makes a signed record read as official rather than as a screen that was printed. Confined to headings — the data stays sans, where tabular figures line up. |
| P27-2 | Hairlines, not a grid | Every cell carried a 0.5pt black box, which is what makes a printed table read as an exported spreadsheet. Horizontal rules now do the work; vertical rules survive only between cells and in pale grey, because the Remarks column still has to be a visible box to write in. |
| P27-3 | The identity block lost its outer box | Eight boxed cells directly under the title were the heaviest thing on the page. Labels are now small letterspaced caps — captions rather than data — with a hairline between rows. |
| P27-4 | The section band is a `td` with a row class, not a `th` with an inline colour | A `th` inside `tbody` inherited the header's uppercase caps treatment, so a section name rendered as another column heading. |
| P27-5 | The signature block gets a rule above it and a full-width line | It is what the sheet exists for, and it was three cramped 40mm stubs tacked onto the last section — which reads as a form to fill in rather than a record to sign. |
| P27-6 | The grading scale is a keyed block | §6's wording verbatim (P15-9), but it was a run-on paragraph of 8pt text. Boxed with a heavy left rule, it reads as the key it is for somebody who has never used the app. |
| P27-7 | **The logo is an `<img>` whose `alt` is the company name** | A missing file then degrades to the wordmark rather than to a broken-image icon — unbranded rather than broken. It is height-capped in **millimetres**, because a logo sized in pixels lands at whatever the printer's DPI decides. |
| P27-8 | In the sidebar it sits on a white tile, with an EMPTY alt | The artwork is multi-coloured on a dark ground, so the navy rail would swallow the strokes that give the wordmark its shape; the tile is the plate. The alt is empty because the company name is written beside it, and announcing it twice is noise rather than access. |
| P27-9 | `next/image` is not used, and the disable says why | It needs the optimiser at runtime, and this sheet is rendered to paper; in the rail it would defer the one element that should paint first. |

**Verification — 24 checks, 0 failed.** §7a intact: A4/18mm, page counters,
break-inside on sections and signatures, a repeating table header, the toolbar
hidden. P15 intact: no tier token or class, the grading scale still from the
constant, section names still from `SECTION_LABELS`, the sheet still a server
component. Plus the redesign itself and both logo placements.

**Two of my own assertions were wrong and were fixed, not deleted.** One matched
`"use client"` inside the comment explaining the file is a server component —
the comment trap, **seventh** occurrence in this log. The other flagged
`#eef1f7`, which is the on-screen preview canvas inside `@media screen` and
never reaches paper; the greyscale rule now strips all three screen blocks by
brace-matching over comment-free text before it judges anything.

**Action required.** Save the artwork as **`public/logo.png`** (~600px wide,
transparent). `public/README.md` says so, and nothing breaks until it is there.

**P27 addendum — the mark alone, on all four sheets.** At the owner's
instruction the "LinkD Prints" wordmark beside the logo is removed; the masthead
is now the artwork with **Performance Evaluation** captioned beneath it.
`.print-wordmark` is deleted rather than left unused, and the same block was
applied to all four print routes — the evaluation sheet, the cycle summary, the
report and the pack cover — which had drifted into four spellings of the same
header.

`alt` changed from the company name to **empty**. An empty alt means decorative,
and a browser renders *nothing* for a broken decorative image — no icon, no
stray text. That is what stops a missing file putting a broken-image glyph on a
document somebody is about to sign, which is exactly what was reported. The
trade is deliberate and worth naming: with the wordmark gone, a sheet printed
without `public/logo.png` carries no company name at all. The file is not
optional any more.

**26 checks, 0 failed.**

---

### P28 — Why the link did not work, and a guard so it cannot happen quietly

Reported as "links are sent on WhatsApp only, and they should be clickable and
open the evaluation form". **No channel was missing.** `lib/notify/events.ts`
has sent on every channel a person can be reached on since P11-WIRE, and the
distribution screen has had WhatsApp / Email / **both** buttons since P11. The
two real faults were configuration, and the reason neither had been noticed is
that both fail *silently*.

| What was wrong | What it does |
|---|---|
| `NEXT_PUBLIC_APP_URL=http://localhost:3000` | WhatsApp only turns text into a tappable link when it sees a real domain, so the invite arrived as plain text — and a phone cannot reach a laptop even if it is typed out. The send succeeds, the log says Sent, and the link opens nothing. |
| `MAIL_FROM=Appraise <onboarding@resend.dev>` | Resend's shared testing sender delivers **only** to the address that owns the Resend account. Every other employee is rejected by the provider. That is why WhatsApp arrived and email did not. |

`RESEND_API_KEY` is fine — quoted in `.env.local`, which dotenv strips.

**The code gap behind both:** `NEXT_PUBLIC_APP_URL` is read in four places and
was validated in none, so a localhost address flowed into every message. §0.7
says fail loudly; this failed as silently as it is possible to fail.

`lib/notify/preflight.ts` is new and pure.

| # | Decision | Why |
|---|---|---|
| P28-1 | The URL check **refuses the send**, in the action | A message that cannot be opened is worse than a refusal: nothing tells HR until an employee phones. Placed in `sendEvaluationLink` rather than only on the screen, because the screen is not the only caller — launch and the nightly chase send too. |
| P28-2 | The From check **warns, and does not refuse** | The send genuinely works for the one person who owns the Resend account, which is exactly the situation somebody is in while testing. Refusing would block the only path that currently succeeds. |
| P28-3 | Private ranges are refused, not just `localhost` | `192.168.x`, `10.x`, `172.16–31.x` and `.local` all work on the office wifi and fail on mobile data — which is the worst kind of bug, because it works when you test it at your desk. A public `172.32.x` is explicitly still allowed. |
| P28-4 | A host with no dot is refused | WhatsApp needs something that looks like a domain. `http://desktop-pc:3000` is reachable on the LAN and will still arrive as plain text. |
| P28-5 | Verdicts cross to the client, never values | The page computes the checks server-side and passes the result. A test asserts no verdict carries anything shaped like an API key (§17). |
| P28-6 | Each verdict carries **title, detail and fix** | "Invalid configuration" sends somebody to me. Naming the variable, what it does to the message, and the specific change to make is the difference between a blocker and a task. |

**Verification — 23 checks, 0 failed.** Localhost, both loopback forms, all three
private ranges, `.local` and a bare machine name are each refused with a reason
naming WhatsApp's linkifying; a public 172.32 address is not; four real
deployment shapes are accepted including a cloudflared tunnel; empty,
scheme-less and non-web URLs are refused; the resend.dev sender is flagged with
the account-owner explanation and the verify-your-domain fix; and no verdict
leaks a key shape.

**Nothing in the sending code needed to change.** The two settings do — see the
banners now shown on `/admin/cycles/[id]/distribute`.

---

### P29 — The dashboard's encodings, corrected

Asked for a more advanced and informative dashboard. The layout was already
sound; what was wrong was underneath it — **two of the three charts encoded
their data incorrectly**, and one of them broke §13.1.

The palette was validated with a script rather than judged by eye. Findings,
both pre-existing:

| Check | Result |
|---|---|
| light, 4 series on white | **FAIL** — green ↔ cyan ΔE 12.5, below the 15 floor: hard to tell apart even with full colour vision. **`CHART_COLORS.green` turns out to be used by nothing**, so the pair never actually co-occurs. |
| light, contrast vs surface | **WARN** — three series below 3:1. Not dismissable: it obligates visible labels or a table view. |
| dark, 4 series on #1B2C38 | **FAIL** — dark-mode green (L 0.773) and amber (L 0.837) sit above the 0.77 band. Separation and contrast both pass. |
| indigo ↔ amber as a diverging pair | **PASS** in light, ΔE 46 normal / 40 protan. |

| # | Decision | Why |
|---|---|---|
| P29-1 | **The rating-band donut was cycling tier and status colours** | It ran `i % 4` over FIVE bands — so two shared a hue — using `--critical`, `--warning`, `--primary` and `--final`. Two of those are reserved status colours, and `--final` is a TIER: §13.1 keeps indigo meaning "the MD said this" and UI2-12 keeps tiers out of chart series entirely. It also coloured by position in a `group by` result, which has no guaranteed order, so a band emptying would have repainted every other one. |
| P29-2 | Bands take the **single-hue ordinal ramp** | 0-1 → 4-5 is one scale, not five kinds of thing. `ORDINAL_STEPS` already existed for exactly this and had never been used here. Five bands, five steps. |
| P29-3 | The mapping is **by band, never by index** | `ratingBandColor()` resolves the colour from the band's own value, so a colour always means the same score whatever the query returns, and an unrecognised band sorts last rather than colliding with 0-1. |
| P29-4 | Lead variance is **diverging**, with a zero rule | It is signed data — above the line the lead rated higher than the employee, below it lower — drawn in one flat hue, which threw away the only thing the reader wants. Two poles, a neutral midpoint, and sorted so the extremes sit at the ends and the leads who agree collapse toward the middle. |
| P29-5 | The poles are indigo and amber, deliberately **not green and red** | §11 makes the gap a reporting figure, not a verdict, and P16-5 says a lead at +2 is not "good". Green/red is the natural reach and the wrong one — it would tell HR somebody had done well by rating their team highly. |
| P29-6 | Every chart gained a **table view** | The contrast WARN is an obligation, not advice: marks below 3:1 must carry relief. Direct labels cover the bars; a donut cannot label every slice, so it needs the numbers as text. It is also P16's outstanding "view as table on every chart", which only the scorecard trend ever got. A real toggle with `aria-pressed`, not a hover affordance — §13.8, and there is no hover on a phone. |
| P29-7 | The variance table keeps the **sign** | "0.40" and "-0.40" are opposite findings and must not read alike. |

**Verification — 22 checks, 0 failed.** No tier or status token is used as a
series fill; nothing is modulo-cycled; the band's colour comes from the band;
the ramp is one hue in five steps; the diverging chart has its zero line and
picks its pole from the value's sign; all three charts have a table view with an
announced caption and tabular right-aligned numbers; tooltips and reduced-motion
survive.

**One of my own checks hit the comment trap again** — it matched `i % 4` inside
the comment explaining that `i % 4` had been removed. Eighth occurrence in this
log. The suite strips comments before every absence check.

**Not changed, and worth stating.** The light-mode green↔cyan failure is real
but currently theoretical, because no chart uses green. The dark-mode lightness
failures are in the tokens themselves (§2), and re-stepping those is a design
system change rather than a dashboard one — recorded here so the next person
does not have to re-derive it.

---

### AMEND-4 — Email may go over SMTP as well as Resend

**§2's email row is amended at the owner's explicit instruction**, and recorded
here rather than quietly diverged from. It read *Resend (server-side only)*; it
now reads **Resend, or SMTP where the company sends from its own mailbox**.
`nodemailer` is added to the pinned dependency list for that purpose, which §17
otherwise forbids.

**Why it was asked for.** Resend will only send from a domain verified with it.
The owner wanted to send from `harshali.linkd@gmail.com`, which Resend cannot
do at any price — Gmail speaks SMTP and nothing else. The alternative offered
(verify `send.linkdprints.com`, no code change) was declined in favour of the
personal account.

**The costs, stated because they land on somebody later.** Gmail allows roughly
500 messages a day and locks the ACCOUNT rather than failing the message when
that is passed. Every employee sees a personal address as the sender of their
appraisal. If that account goes, the system's email goes with it.

| # | Decision | Why |
|---|---|---|
| A4-1 | **Resend is not removed** | The transport is chosen by which credentials are present, not by a flag — so there is no third setting that can disagree with the other two, and moving to a verified domain later is a settings change rather than another code change. The tested path is untouched. |
| A4-2 | SMTP wins when both are set | An explicit `SMTP_USER` is a deliberate act; a leftover `RESEND_API_KEY` is usually just a key nobody cleared. Choosing the deliberate one is the safer read of the ambiguity. |
| A4-3 | **`MAIL_FROM` must contain `SMTP_USER`, and the send is refused otherwise** | Gmail silently rewrites a From address it does not own. The message then arrives from somebody other than the person `notifications_log` records as the sender — a quiet disagreement between what was sent and what was logged, which is exactly the kind of thing nobody notices until it matters. Refusing is louder and cheaper. |
| A4-4 | The preflight has **two rule sets**, not one with exceptions | The `resend.dev` sandbox warning is about Resend and is nonsense under SMTP; the "From must be the account" rule is about Gmail and is nonsense under Resend. A single function with both would fire the wrong advice at whoever read it. |
| A4-5 | A rejected App Password gets its **own message** | Gmail answers `535 Username and Password not accepted`, which sends people to reset the account password — the wrong fix. The message names the App Password and the 2-Step Verification prerequisite instead. |
| A4-6 | The provider's error is `redact`ed before it is returned | An SMTP failure echoes the envelope, and a bad login echoes the username. §0.3 keeps credentials out of logs, and P11-2's CHECK would refuse the row anyway. |
| A4-7 | Both transports keep the **same contract** | `sendEmailViaSmtp` never throws and returns the same `SendResult` as `sendEmail` and `sendWhatsApp`. A caller that has to wrap one of the three in a try/catch is a caller that will forget. |

**Verification — 10 checks, 0 failed.** Under SMTP: a matching From passes, a
non-matching one is refused with the rewrite explained and the exact line to
paste, an empty one is refused with the account filled in, the sandbox warning
does not fire, and case is ignored. Under Resend, all three original rules still
hold. Typecheck 0, lint 0.

**Still true:** email is not what is blocking anybody. `NEXT_PUBLIC_APP_URL` is
still `http://localhost:3000`, so every invite link on the deployment is a bare
path (P30) — on both channels.

---

### P30 — The dashboard's density, and the gap made visible

Two things: the dashboard stopped rendering chart-shaped holes when it has no
data, and the product's central comparison — self against lead — became a chart
instead of four numbers in a row.

#### Why the dashboard looked wrong when nothing was wrong

`EmptyState` is the FULL-PAGE affordance: a dashed block sized to fill a screen.
Dropped inside a dashboard panel it holds ~300px open to say one sentence. Early
in a cycle every panel is empty, so the page became whitespace with captions
floating in it — which reads as broken rather than as early, and early is where
every cycle starts.

| # | Decision | Why |
|---|---|---|
| P30-1 | A panel with nothing to show **collapses to a line** | `PanelEmpty` instead of the full-page block. The card sizes to its content, so a young cycle looks young rather than faulty. |
| P30-2 | **The hero earns its size, or it does not get it** | A full-bleed dark slab announcing "Nothing needs you" was the loudest element on a page whose entire message was that there is nothing to do. It takes the night treatment only when the reader has something outstanding; otherwise it steps back to a quiet card and lets the numbers lead. Weight follows importance. |
| P30-3 | Rows are **equal height** | Two panels side by side with different content left a gap under the shorter one, which reads as a rendering fault rather than a layout. |
| P30-4 | The four counts gained a **denominator and a progress bar** | Four bare numbers with nothing to divide by are four facts nobody can act on. The bar uses `--primary`, not a tier: it is the cycle's progress, not any one layer's (§13.1, UI2-12). |
| P30-5 | When a cycle has produced **no ratings at all**, the four analysis panels collapse into one | Four empty charts is the wrong shape for "this has just launched". |

#### The gap, as a chart

| # | Decision | Why |
|---|---|---|
| P30-6 | **A dumbbell, not paired bars** | The question is "where do the two sides disagree", and a table of four numbers per row made the reader subtract in their head. Paired bars would ask them to compare two lengths from a shared baseline; a dumbbell puts both points on one track and makes the DISTANCE the visible thing. The gap becomes the shape. |
| P30-7 | The palette was **computed, not judged** | The dataviz skill's validator was run rather than the pair being eyeballed. The full five-colour set FAILS — green↔pink at ΔE 4.9 under deuteranopia — so those two must never sit adjacent, which is already the rule (green is the trend colour, pink a tier). The §13.1 tier pair **passes**: ΔE 8.9 deutan, 31.2 normal. It was mandated anyway; it is good to know it is also correct. |
| P30-8 | Cyan's contrast WARN is **discharged, not dismissed** | The validator flags cyan below 3:1 on white and the skill says that "obligates visible labels or a table view — it is not dismissable". Both ship: the gap is direct-labelled on every row, and `ChartFigure` keeps the table one click away. |
| P30-9 | The **gap** is the only number on every row | "Label selectively — never a number on every point." The two values ride the dots on hover and live in the table; flooding the rows would make the labels stop working. |
| P30-10 | Two series, so a **legend is always present** | Identity is never left to colour alone. The swatch carries the hue; the text stays in ink tokens, never the series colour. |
| P30-11 | Markers are 12px with a **2px surface ring**, and the connector is 4px | The skill's mark spec. The ring is what keeps the two dots legible where they overlap, which is exactly the case that matters — a small gap is the interesting one. |

#### Found in the parallel work, and fixed because it blocked the build

`cycles-client.tsx` had a `//` comment sitting **between JSX attributes**, which
is a syntax error — `{/* */}` is only valid between children, so neither form
works there. Moved above the element. Recorded because it is not mine.

`transitions.ts` has also gained a row §8 does not contain —
`PENDING_HR_REVIEW → CLOSED` — and `apply_evaluation_transition` refuses it. P5-1
duplicated that table into SQL deliberately, noting both halves must change
together; as it stands a screen would offer the action and the database would
reject it. **Not fixed here — it belongs to whoever is adding it.**

Typecheck 0 errors, lint 0 errors, build clean. p23 42/42.

---

### P31 — The form builder made legible, and the mark on the forms themselves

`components/appraise/form-letterhead.tsx` is new. `structure-pane.tsx`,
`preview-pane.tsx` and `builder-client.tsx` edited section by section (§0.1 —
no whole-file rewrite), plus the letterhead threaded into both rating screens.
No route, query, server action or business rule changed.

**Four things were asked for and all four are done.** Recorded together because
three of them are the same problem seen from different angles: the builder was
designed on a wide monitor by somebody who already knew what every control did.

| # | Decision | Why |
|---|---|---|
| P31-1 | **Below 1150px the builder shows ONE pane, not three stacked** | The previous fallback rendered all three in a column, which PC-10 chose over hiding two of them — right at the time, and still not usable. Each pane owns its own scroller, so three of them inside a page that also scrolls gave three short windows: the structure list about 200px tall, and the editor two full screens below the question you had just tapped. One at a time gives each pane the height it was built for. Nothing is hidden — that was PC-10's actual objection, and it still holds: every pane is one tap away and the tab says what is behind it. |
| P31-2 | Tapping a question **moves you to the editor**; removing the open one moves you back | On a phone the panes are not side by side, so selecting a question and leaving the reader on the list makes the tap look ignored. The same is true in reverse: staying in an editor whose subject has just been removed is a screen about nothing. |
| P31-3 | Each tab carries a **second line** saying what is behind it | "Structure · Edit · Preview" is three nouns that all sound like the same screen to somebody opening the builder for the first time. The Edit tab reads "Pick one first" when nothing is selected rather than opening an empty pane (§13.4). |
| P31-4 | **A search, and it is a VIEW — never the order** | The bank runs to hundreds of rows across eight sections, so finding the one about wastage meant opening every section in turn. Typing opens the sections that match and drops the rest. The critical detail: `visibleIn` is a separate list from `rowsIn`, because reordering computes positions from the list it is given — hand it a filtered one and a drag moves the row to its index among the *matches* rather than among its neighbours. Dragging is off while searching, and Add is hidden, since a new question would land straight out of view. |
| P31-5 | **White at 40% reads as grey, not as a lighter weight** | This is what "make the font readable" was pointing at. The structure pane is white on ink, where opacity does not behave like a type weight — it desaturates to the background. Body text was at 45%, counts at 40%, the row index at 30%, the drag handle at 20%. Everything is now at 70% or above, and a suite check fails on anything under 55%. |
| P31-6 | **Nothing under 11px**, and the 9px tags are gone | Six distinct sizes below the type scale had accumulated — `text-[9px]`, `[10px]`, `[10.5px]`, `[11px]` — each one added because the previous one was too big for the space. The space was the problem. Asserted, so the next squeeze fails rather than shipping. |
| P31-7 | An open section is a **darker well, not a lighter one** | It was `bg-white/[0.07]`, which lifted the open section away from the panel and washed the whole pane toward grey — the thing that made the type look faint in the first place. Recessing it to `bg-black/25` keeps the ground dark and the text on top of it. Same for the footer. This is the "a little darker" half of the request; the other half was P31-5. |
| P31-8 | The remove button is **reachable without a hover** | It was `opacity-0` until hover. There is no hover on a touch screen, so on a phone that control did not exist — the row could be read and selected but never removed. Visible below `lg`, hover-revealed above it. The drag handle goes the other way: it is a pointer affordance, so it is hidden where it cannot be used rather than sitting there doing nothing. |
| P31-9 | **The mark is one component, four callers** | P27 put the logo on the printed pack. A form filled in on a phone is the same document before it is signed and should say whose it is. Written once — the print routes had already drifted into four spellings of one header (P27 addendum) and had to be reconciled; starting from one is cheaper than converging on one. It goes on the employee's form, the lead's review, the builder preview and the submitted confirmation. |
| P31-10 | `alt` is **empty**, and the tile is white | Both inherited from P27 and both load-bearing. Empty alt means decorative, and a browser renders *nothing* for a broken decorative image — so a deployment missing `public/logo.png` shows a clean gap rather than a broken-image glyph on somebody's appraisal. The white plate is P27-8: the artwork is multi-coloured on a transparent ground, and a dark header swallows the strokes that give the wordmark its shape. |
| P31-11 | The preview shows the letterhead too | The point of that pane is "if it renders here it renders identically for the employee" (P9B-1). A preview of the questions alone is a preview of part of the document. |

**Verification — p9b 88 checks, 0 failed**, up from 66. New coverage: the small
screen shows one pane and every pane has a tab; the switcher is at module scope
(P14-12); tapping moves you to the editor and removing brings you back; search
filters a list that reorder does not read, and reorder still reads the
unfiltered one; dragging is off while filtered; **no type under 11px and no
white text under 55% anywhere in the structure pane**, both asserted with the
offending values reported; the remove button is reachable without a hover; and
the mark is one component used by all four screens with an empty alt and a
white plate on ink.

**A suite assertion was wrong and was fixed, not deleted.** p9b's "sections come
from SECTION_ORDER, not from state" tested `!/setSections/` — which also matches
`setSectionsOpen`, the dialog boolean P25 added. It had been reporting a section
*list* setter that has never existed. Now `/setSections\s*\(/`, with a
self-test proving it catches a real setter and not the dialog's. **This is the
substring trap, and it is the comment trap's cousin** — §18 has recorded that
one eight times. The general rule now covers both: an absence check targets the
call syntax, never the bare identifier.

**Regression: 1506 passed, 9 failed across 29 suites.** Every one of the nine
was verified against a baseline with this phase's edits removed and is
**identical** — they belong to the concurrent work, not to this: p4-pure (§8's
table has gained a 14th row), p8patch (`data-grid.tsx` restates "Details"),
p11 (`smtp.ts` imports a provider, which AMEND-4 intended), p12, p13, p20 and
p22. Typecheck 0 errors, lint 0 errors, build clean.

**p6 needs `NEXT_PUBLIC_APP_URL` set to run at all**, and that is P30 working
rather than a failure: `absoluteUrl` now refuses to build a link with no site
in front of it, and the suite calls `inviteUrl` directly. With any public
address set it is 66/0. Worth knowing before somebody reads the crash as a bug.

---

### P32 — Email was already built. What was missing was a way to know it works.

No migration. `verifySmtp` added to `lib/notify/smtp.ts`, `checkEmailTransport`
to `lib/notify/settings.ts`, and an **Email delivery** card on Settings ›
Messages. The SMTP keys added to `.env.local` with the two routes written out.

**Asked: "can we implement link sent via email using SMTP or any other free
method". The answer is that AMEND-4 already did.** `sendEmail` picks SMTP when
its credentials are present and Resend otherwise, `dispatch.ts` has always
routed the EMAIL channel through it, and `nodemailer` is installed. Nothing was
missing from the send path. What was missing was configuration — and any way to
check the configuration short of launching a cycle and watching every invite
fail, after the messages had already been logged as attempts.

| # | Decision | Why |
|---|---|---|
| P32-1 | **A connection check, deliberately NOT a test send** | §10 makes `dispatch.ts` the single path a message may leave by, and the docstring is explicit that nothing calls a provider directly. A "send a test to yourself" button bolted on beside it would be a second path — unlogged, and needing a 15th `TemplateKey` for something that is not a product message. `transport.verify()` authenticates and sends nothing, so the invariant is untouched. |
| P32-2 | It says what it does **not** prove | It establishes the host, the port and the credentials. It does not establish that a given recipient will accept the mail, and the card says so rather than letting a green tick imply more than it knows. |
| P32-3 | Resend gets **no invented check** | It has no handshake — the credentials are only exercised by a real request. The card reports what is configured and says the first invite is the proof, which is true, instead of a check that always passes. |
| P32-4 | The two real failures are **told apart, and share one explanation** | A rejected App Password answers `535 Username and Password not accepted`, which sends people to reset their account password — the wrong fix, and it locks nothing in. A blocked port answers `ETIMEDOUT`. `explain()` is shared by the send and the check, because two copies of "what does this error mean" is how a check starts giving different advice from the send it is testing. |
| P32-5 | The card sits **above** the message log | The log answers "did it work" afterwards. This answers it before, which is the only moment the answer is cheap. |
| P32-6 | `.env.local` now carries the SMTP keys blank, with both routes written out | Blank means unused — `smtpConfigured()` is false on an empty string, so Resend stays the transport and nothing changes until somebody fills them in. The comment names the App Password prerequisite (2-Step Verification) and the `MAIL_FROM`-must-contain-`SMTP_USER` rule, because both are refusals somebody will otherwise hit blind. |

**p11's one-send-path check was asserting a proxy, and it was red over a rule
nothing had broken.** It asked "who imports `maytapi.ts` or `email.ts`", carving
out `email.ts` because that file imports a TYPE — then AMEND-4 added `smtp.ts`,
which imports `redact` for exactly the same reason, and the suite went red. It
now asserts the claim directly: **no module outside the transport tier CALLS a
send function**, comments stripped first. That is narrower (a shared helper is
fine) and stronger (it would catch a send smuggled through a re-export, which
an import check cannot see), and it has a self-test proving it detects one.

**One of my own assertions was wrong and was fixed, not deleted.** "verifySmtp
sends nothing" was written as `!/verifySmtp[\s\S]*?sendMail\(/` — an unbounded
lazy span that runs straight past the closing brace into `sendEmailViaSmtp`
below, which of course calls `sendMail`. It now cuts the function body at the
next top-level `export` before testing it, and a companion check asserts the
send path still exists beside it. Same family as the comment and substring
traps: **an assertion has to be scoped to the thing it is about.**

**Verification — p11 69 checks, 0 failed**, up from 65/1. Typecheck 0 errors,
lint 0 errors, build clean.

**Regression: 1509 passed, 9 failed across 29 suites.** p11 went green. The nine
belong to the concurrent work: p4-pure, p8patch, p12, p13, p20, p22, and **p19,
which is newly red and is worth reading rather than clearing** — `0040_own_current_salary.sql`
puts the employee's own CTC on their increment form, and p19's "no salary figure
in self-form.tsx" is §5's salary-confinement guard catching it. That may well be
the right call (it is their own salary, and P21-7 already lets them write their
own expectation against it) but it is a §5 decision and belongs in this log,
made by whoever is adding 0040 rather than absorbed silently here.

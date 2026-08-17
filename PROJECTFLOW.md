# PROJECTFLOW.md
## How Appraise actually works, end to end

> **What this file is.** `CLAUDE.md` is the constitution — the rules the code
> must obey, plus a phase-by-phase record of how it was built. This file is the
> other half: **what happens, in what order, and who does it.** Read this to
> understand the product; read CLAUDE.md to understand why a rule exists.
>
> Where the two disagree, **CLAUDE.md wins** and this file is out of date.
>
> Everything below describes the code as it stands today, checked against the
> source rather than against the history in CLAUDE.md §18 — that section records
> what each phase did, and several of its notes have since been superseded.

---

## 1 · What the product is, in one page

LinkD Prints appraises two populations, and they barely share anything.

|  | **Backend Team** (staff) | **Production Team** (workers) |
|---|---|---|
| Instrument | one shared form, 0–5 ratings | a three-tick sheet |
| Who fills it | the employee **and** their manager, in parallel | the supervisor alone |
| Sections | eight, one of which varies by department | one list of qualities |
| Reviewed by | HR, then management | HR, then management |
| Tables | `evaluations`, `evaluation_*` | `worker_evaluations`, `worker_*` |
| Screens | `/my-evaluation`, `/team`, `/reports` | `/worker-appraisal`, `/admin/worker-appraisals` |

`profiles.track` decides which module a person belongs to. A person is in
exactly one. **Nothing crosses between them** — not a table, not a function, not
a score. That is a deliberate rule (CLAUDE.md §7), and it is why the two halves
of this document read so differently.

### The three ideas the whole design rests on

1. **One form, one department-specific section.** Every Backend Team employee
   answers the *same* form. Only *Job Specific Skills* changes by department.
   That is what makes two people comparable.

2. **Blind parallel rating.** The employee and their manager rate the same form
   **at the same time**, and **neither ever sees the other's answers** — not
   during, not after, not on any screen or export. Only HR and management see
   both. This is enforced by database policy, not by hiding things in the
   interface.

   *Why:* a manager who can see a 5 has a strong pull toward not writing a 2.
   The disagreement worth measuring is the one that exists before either side is
   anchored.

3. **A cycle has a type.** An **Evaluation** cycle ends when management has read
   the report. An **Increment** cycle continues into salary — a proposal, an
   approval, and a confirmed figure. Same form, same blind flow; only the ending
   differs.

---

## 2 · The people, and what each can do

Roles are **many-to-many**: one person can hold several. Everybody holds
`EMPLOYEE`, because everybody fills in their own appraisal — including HR and
the MD.

| Role | What it means |
|---|---|
| `EMPLOYEE` | Fills in their own form. Everyone has this. |
| `HOD` | Also rates the people who report to them. |
| `SUPERVISOR` | Also fills in production tick sheets. |
| `HR_ADMIN` | Configures the system, reviews reports, prepares salary. |
| `MD` | Approves. Reads reports, records the review, approves pay. |

**HR and the MD are separate on purpose.** HR prepares and reviews; the MD
approves. That is a second pair of eyes on a pay decision, and it only exists
while the two roles are distinct.

Three things are confined by policy and cannot be widened from the interface:

- **Blindness** — no screen, export, report or message may show one rating layer
  to the other side.
- **Salary** — figures are readable by HR and the MD only. Never a manager, never
  the employee (except their own current salary on their own increment form).
- **Audit** — every state change is written to `audit_log`, which can be inserted
  into and never updated or deleted, by anyone.

---

## 3 · Setting up: what HR does before anybody is appraised

### 3.1 People

**Settings › Users.** Create a person: name, email, department, designation, who
they report to, joining date, employment type, and access level. Password is set
here; there is no self-signup.

There is also a **CSV import** for bulk loading, and the roster is editable
**cell by cell like a spreadsheet** — change a designation on twelve rows and
save once.

Two things about the import worth knowing:

- **The manager can be another row in the same file.** It resolves against both
  the database and the file, and creates managers before their reports.
- **`salary_unit` says whether a figure is monthly or annual.** Blank means
  monthly. Every salary in the database is stored *annual*; the conversion
  happens once, at the edge.

Production workers can be imported **without an email** — they never sign in.

### 3.2 Departments

**Settings › Departments.** Ten of them. A department with **no Job Specific
Skills questions cannot be launched** — every employee in it would get an empty
section — and the screen says so.

### 3.3 The form

**Form Builder** has three tabs:

| Tab | What it is |
|---|---|
| **Form Builder** | Structure, editor and live preview, side by side. |
| **Question Bank** | The full table of questions, with filters and bulk actions. |
| **Worker Form** | The production team's three-tick sheet — a different form entirely. |

The Backend Team form has eight sections, in this order:

1. **Details** — from the person's record. Not editable, not a question.
2. **Quantitative Performance (KPI)**
3. **Core Performance**
4. **Job Specific Skills** ← the only section that varies by department
5. **Behavioural, Team Skills & Learning**
6. **Learning & Development**
7. **Add-ons & Key Achievements**
8. **Manager Review** — questions only the manager answers

Sections can be **renamed and reordered**, and one can be parked. The *set* of
sections cannot change — the value is frozen into every launched evaluation, so
adding or removing one would rewrite what people were asked in appraisals that
have been signed.

Each question carries: its text, optional helper text, an answer type, who
answers it (employee / manager / both), whether it is required, and optionally a
condition ("only show this when an earlier Yes/No was answered Yes").

**The preview on the right is the real form renderer.** If it renders there, it
renders identically for the employee — there is exactly one form renderer in the
whole codebase, and a test fails the build if a second one appears.

### 3.4 The schedule

**Settings › Evaluation periods.** When appraisals fall due, per person.

```
NEW JOINER — measured from their joining date
  +1 month   evaluation      +6 months  evaluation      +12 months  increment

THEREAFTER — measured from their LAST INCREMENT, and re-anchored at every one
  +3 months  evaluation      +9 months  evaluation      +12 months  increment
                                                          …then again
```

All four intervals are configurable, and the count is data — "how many
evaluations a year" is a setting, not a code change. HR is given 30 days'
notice; new joiners 7, because their first review is only about six weeks after
they start.

---

## 4 · A cycle, start to finish

### 4.1 Create it

**Evaluation Cycles › New.** Three steps:

1. **Name and type** — Evaluation or Increment.
2. **People** — who is in it. An increment round starts pre-ticked with the
   people who are actually due; an evaluation cycle starts with everybody, and
   there is a select-all / clear-all.
3. **Review and launch.**

Dates are **not asked for**. A cycle opens the day it launches and runs a week.
That week is a *reminder schedule*, not a deadline — **the form does not close
when it passes.** Only a submission closes a form.

The launch is blocked if anything would make it dishonest:

- somebody's department has no Job Specific Skills questions
- somebody has no manager assigned
- somebody would be rating themselves
- a manager has no phone and no email, so cannot receive their form

Each of these names the person and links to where it is fixed.

### 4.2 Launch

One database transaction. For every participant it writes:

- the evaluation row
- a **frozen copy of the question list** — this is the snapshot rule, and it is
  the thing that makes historical comparison honest. Edit the question bank
  afterwards and **every launched evaluation is untouched**, for ever.
- two empty response rows — the employee's and the manager's
- two invite links, one scoped to each

All of it commits together or none of it does. A launch that fails halfway
leaves nothing behind.

**Then the messages go out** — after the commit, so a provider outage cannot
roll back a launch that is already durable. Every person is sent their link on
every channel they can be reached on.

### 4.3 Both sides fill it in

Employee and manager work **at the same time and independently**. Neither can
see the other, and neither waits for the other.

Each form:

- **autosaves** every 20 seconds and on blur, showing "Saved 15:58"
- **mirrors the draft in the browser tab**, so a refresh cannot lose work
- **restores** anything the server has not got, and says how much it recovered
- **reveals conditional questions** as soon as the answer that unlocks them is
  given
- **refuses to submit** if the draft has not reached the server, saying so
  plainly rather than reporting a misleading "N questions still need an answer"

On a phone the fixed footer carries the count, the progress and the save state,
because all three are otherwise at the top of a form that is twenty swipes long.

A layer **locks the moment it is submitted**, independently of the other side.

### 4.4 It reaches HR

When both sides are in — or HR deliberately advances past a missing one — the
record moves to **Pending HR review** by itself.

HR can read a report **before** that, as soon as *either* side is in. The
`/reports` queue shows it as readable-but-not-ready, and names which side is
still outstanding.

### 4.5 The report

`/reports/[id]` is the first screen where both sides appear together. It has six
bands:

1. **Employee & cycle** — who, which cycle, which period
2. **Scores** — Self · Manager · **Average** · difference, per section and
   overall, with wide differences flagged
3. **Curated topics** — chosen pairs of questions, employee answer beside
   manager answer
4. **What the employee said** — everything of theirs not already paired
5. **What the manager said** — the same, from their side
6. **Salary** — increment cycles only, and HR/MD only

HR writes a summary and either **returns it** (naming which side unlocks, with a
reason) or **sends it to the MD**.

The MD records their review, or sends it back to HR.

### 4.6 The ending

- **Evaluation cycle** → closed once management has read it.
- **Increment cycle** → the salary band opens. The manager's recommended
  percentage is on the form; HR proposes a figure; the MD approves one; the
  interview is recorded; the increment is confirmed.

**Confirming an increment is one transaction** that writes the pay history row,
updates the employment record, rolls the increment date forward, marks the
reminder actioned, and closes the evaluation. A half-applied increment is a
payroll incident, not a bug report.

**HR proposes, the MD approves, and neither can write the other's figure** — the
database refuses it, not the interface.

---

## 5 · The production team

Different flow, different tables, different screens.

```
HR starts a round  →  the supervisor ticks the sheet  →  HR prices it
                   →  management approves  →  closed
```

- **Production Appraisals** lists every appraisal in every live round, one row
  each, with the round as a column. Somebody can be appraised in several rounds
  and nothing is overwritten.
- The supervisor rates **eight qualities** on Excellent / Satisfactory / Needs
  Improvement, plus an **Overall Performance** tick which *is* the score for the
  period — there is no mean on this track.
- The supervisor also recommends an **increment percentage**, but is not shown
  the amounts.
- HR prices it. **An unpriced recommendation cannot be sent up** — there would
  be nothing for the second pair of eyes to be a second pair of eyes on.
- Management approves and closes.

Workers **do not rate themselves**. That was decided deliberately, and the
hand-over path for a supervisor to fill one in on their behalf still exists in
the database if it is ever wanted.

A worker's own scorecard shows their overall result across rounds and says
plainly that the quality-by-quality ticks go to HR and management — an absence
that is explained rather than an unexplained gap.

---

## 6 · What each person sees

### The employee
Dashboard → their own outstanding work first. **My Evaluation** for the form.
**Scorecard** for their own history and result. They never see their manager's
ratings.

### The manager (HOD)
Everything above, plus **My Team** — the people they rate. The queue shows *their
own* progress and **nothing about whether the employee has submitted**: the query
does not fetch it, the row type cannot hold it, and the sort is by due date
rather than by how long each has been waiting.

### The supervisor
Everything an employee sees, plus **Production Team** — the sheets they fill in.

### HR and the MD
All of the above, plus:

| Screen | What it is for |
|---|---|
| **Dashboard** | The company's state: outstanding work, the pipeline, the spread of scores, strongest and weakest sections, the next three months |
| **Reports** | The review queue, Evaluation and Increment as separate tabs |
| **Form Builder** | The questions |
| **Evaluation Cycles** | Create, launch, distribute, track |
| **Production Appraisals** | The worker rounds |
| **Evaluation Due** | Who is due a review, and creating it |
| **Increments** | Who is due a rise, by team |
| **Team review** | The roster, and the way into anybody's scorecard |
| **Settings** | General · Users · Evaluation periods · Messages · Departments · Recycle bin |

---

## 7 · Messages

### How one gets sent

Every message in the system leaves by **one function**. That is what makes the
pause switch, the rate limit, the delivery log and the no-token rule apply
everywhere without being restated.

```
something happens
      ↓
the event picks a template and a recipient
      ↓
sendNotification  ← the single chokepoint
      ├─ is outbound paused?            → stop, and log the attempt
      ├─ is this the MD?                → only one template reaches them
      ├─ has HR edited this wording?    → use theirs
      ├─ write the QUEUED row FIRST     → so a crash still leaves evidence
      ├─ send on WhatsApp and/or email
      ├─ record the outcome
      └─ ring the in-app bell
```

### The fourteen messages

| | |
|---|---|
| **To the employee** | self-evaluation invite · reminder · overdue notice · form returned · result available |
| **To the manager** | rating invite · reminder · overdue |
| **To HR** | what is due · increments overdue · forms overdue · report ready · finalised |
| **To management** | review pending — **and nothing else** |

The MD is not appraised and does not chase anybody, so exactly one template
reaches them. That is enforced at the chokepoint, not by filtering each
recipient list.

**No message ever carries a score or a salary figure.** There is no placeholder
that could hold one. A rating in a WhatsApp message is a rating disclosed on a
channel with no access control around it.

HR can **edit the wording** of ten of the fourteen on Settings › Messages. Four
cannot be edited: the three digests compose a list of names at send time and
have a shape rather than a wording, and the closing message differs by
disclosure policy.

### When they go out

A single job runs at **10:00 Asia/Kolkata** every day.

| Rule | |
|---|---|
| **Sunday** | Nothing scheduled sends. The company's weekly off. |
| **Quiet hours** | Nothing sends between 21:00 and 08:00. |
| **Ladder** | 3 days before · on the day · then daily until 7 days late · then silence |
| **Dedupe** | One message per person per day, checked against the delivery log |
| **Backlog** | None. A skipped day is skipped, never queued — a pile delivered on Monday would carry Sunday's reasoning. |

Both the day and the hour are computed **in Asia/Kolkata**, not the server's
zone. The job runs in UTC, so a naive check would call Sunday 00:30 local a
Saturday.

**A person pressing Send is not affected by any of this.** HR distributing links
on a Sunday still works — there is no second run behind a button, so dropping it
would lose the message rather than defer it. The **pause switch** on Settings ›
Messages is the way to stop everything, and both pausing and resuming are
audited with a reason.

---

## 8 · Invite links

- A link is **32 bytes of randomness**, and only its **SHA-256 hash is stored**.
- It is scoped to **one evaluation and one layer** — an employee's link opens
  their form, a manager's opens the rating screen for that person.
- It expires 7 days after the due date, and 10 failed attempts in an hour lock it.
- **No name, code, email or phone ever appears in the URL.** The token appears in
  exactly one URL and is gone by the next hop.
- Re-sending revokes the previous link for that channel and layer, and leaves
  the other channel alone.

---

## 9 · Scoring

- A **section score** is the mean of the answered 0–5 questions in it, to two
  decimals.
- The **overall** is the mean of all answered 0–5 questions.
- Text, numbers, Yes/No and multi-select answers **never enter a score**.
- Self and Manager averages are computed **independently, at each side's own
  submission**, and neither is adjusted afterwards.
- The **gap** is Manager − Self. It is a reporting figure, visible to HR and the
  MD and nobody else. A wide gap is flagged; it is not a verdict.
- The report may show an **Average** of the two, computed on read and stored
  nowhere, shown as an em dash wherever either side is missing.
- **No score is ever overwritten.** A question's score belongs to the layer that
  gave it. The report shows both; it does not reconcile them.
- **A layer that has not been submitted has no score at all** — autosave writes
  answers from the moment a form is opened, and a draft is not a rating.
- Production track: the overall **is** the supervisor's Overall Performance tick.

---

## 10 · The printed pack

Five print routes, all outside the app shell — no sidebar, no theme, nothing
that could leak into a signed document.

| Route | |
|---|---|
| `/print/evaluation/[id]` | one appraisal sheet |
| `/print/report/[id]` | the combined report — HR and MD only, 403 to everybody else |
| `/print/cycle/[id]` | a whole cycle |
| `/print/summary/[cycleId]` | the cover sheet |
| `/print/worker/[id]` | a production sheet |

Rules that apply to all of them:

- **Every colour reaching paper is black, white or a neutral grey.** Who said
  what is carried by three labelled columns — position and text survive a
  monochrome laser; a tint does not.
- **A4, 18mm margins**, sections and signature blocks never split across pages.
- The **grading scale is printed on the sheet**, so somebody who has never used
  the app can read it.
- **Signed where the database says so, ruled where it does not.** A name and a
  date print only where the record holds them; otherwise it is a blank line to
  sign.
- The combined report is **403 to everybody except HR and the MD** — there is no
  redacted edition, because the whole content is both sides of a blind
  evaluation together.

There is **no PDF library**. The browser prints these correctly and names the
file; every alternative would either need headless Chromium, become a second
renderer of a signed document, or send salary figures off-site.

---

## 11 · The shape of the code

```
app/
  (public)/        login, invite handling, error pages
  (app)/           everything behind a login
    dashboard/     scorecard/     my-evaluation/     team/
    reports/       worker-appraisal/    worker-team/
    admin/         cycles · form-builder · due · increments
                   people · settings · worker-appraisals · departments
  print/           print-only routes, no app shell
  api/cron/        the daily job — the only API route
components/
  ui/              shadcn primitives, untouched
  appraise/        the domain components — one form renderer, one chart layer,
                   one action bar, one set of tier colours
lib/
  forms/           assembly, the snapshot, validation
  evaluations/     the state machine, scoring, guards
  worker/          the production module, sharing nothing with the above
  notify/           templates, dispatch, scheduling
  increment/       salary arithmetic, in one place
  analytics/       the dashboard and scorecard queries
supabase/
  migrations/      0001 … 0080, sequential, never edited once applied
```

### Rules a change has to obey

- **One form renderer.** A test walks every `.tsx` and fails if a second one
  appears.
- **Nothing shows a stored enum.** `SCALE_0_5` on screen is a question HR cannot
  answer; every value goes through a label map.
- **The three tier colours mean one thing each** — Self is cyan, Manager is
  pink, Final is indigo — and are never used decoratively. Green is the trend
  colour and is never a tier.
- **Salary is monthly at the edges, annual in the core.** One control does the
  conversion; no caller has to remember which unit is in flight.
- **A PostgREST update that matches no row succeeds.** Every update whose match
  could legitimately find nothing needs `.select()` and a length check — this
  class of silent failure has been found and fixed eight times.
- **Comments describe behaviour, not intention.** A comment describing an
  ambition is how the next person builds against something that is not there.

---

## 12 · Running it

```bash
npm run dev        # http://localhost:3000
npm run build      # must pass with zero TypeScript errors
npm run lint
npm run typecheck
```

Deployed on Vercel from `main`, pinned to `bom1` because the database is in
`ap-south-1`.

### Environment

| Variable | |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | required |
| `SUPABASE_SERVICE_ROLE_KEY` | cron and account creation only |
| `MAYTAPI_*` | WhatsApp |
| `SMTP_*` **or** `RESEND_API_KEY` | email — whichever is set |
| `CRON_SECRET` | required, or the daily job returns 503 |
| `NEXT_PUBLIC_APP_URL` | optional on Vercel; needed for a tunnel or custom domain |

`public/logo.png` is **not optional** — it is the mark on every printed sheet
and on every form.

### Before a real cycle

1. **Check which migrations are applied.** Paste `supabase/whats-applied.sql`
   into the Supabase SQL editor. It reports, per migration, whether the object
   it creates exists. Do not infer this from the phase log.
2. **Two migrations are outstanding right now:**
   - `0080_undo_0079_exception_splice.sql` — until it is applied, creating an
     evaluation from Evaluation Due fails.
   - `0073_notification_templates.sql` — until it is applied, the message editor
     renders but cannot save. Nothing else breaks.
3. **Set `CRON_SECRET`**, or nothing is ever chased.
4. **Decide on email.** WhatsApp works without any of it.

---

## 13 · What is not built

Stated plainly, so none of it is mistaken for an oversight.

| | |
|---|---|
| **A full end-to-end run** | Nothing has been driven from launch to close against live data. This is the highest-value thing left. |
| **Worker analytics** | The production appraisal exists; no dashboard covers it. A worker's history lives only on their own sheets. |
| **Worker self-rating** | Deliberately absent, by instruction. |
| **Due/overdue notifications for evaluations** | The digests, the bell and the job all exist; the wiring for this particular event does not. |
| **Palette** | Three measured contrast failures nobody has acted on — light-mode green↔cyan, and the dark-mode lightness band. Changing them is a token decision. |
| **Exports** | CSV exists for some tables, not all. |
| **Performance** | "Under one second with 500 evaluations" is indexed for and has never been measured. |

### Standing risks

- The **Maytapi token** has never been rotated after being handled in a session.
- **Gmail as the mail sender** caps at ~500/day and locks the account rather
  than failing the message. A verified domain is the better answer and is a
  settings change, not a code change.
- **A supervisor can read and write worker pay** — a deliberate exception to
  salary confinement, confined to the production module.
- **HR can approve and close an increment without the MD** — instructed twice,
  and it removes the second pair of eyes on a pay decision. Reverting it is one
  line in `transitions.ts`, not a migration.

/** Cycle shapes, labels and validation. Plain module — imported by both server and client. */

import { z } from "zod";

import type { Enums } from "@/types/database";

/* ---------- The standard action result (§14) ---------- */

export type CycleResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export function cycleError(code: string, message: string): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } };
}

/* ---------- Disclosure, in plain words ---------- */

/**
 * §13.1 forbids showing a raw enum to a person, and HR is a person. The enum
 * values are never renamed (§0.2) — only ever displayed through this map.
 *
 * The order is deliberate: least to most disclosed, so the radio group reads as
 * a dial rather than as an unordered list.
 */
/**
 * P10-REV item 7. Rewritten entirely.
 *
 * The fourth option — "Employees see everything including lead comments" — is
 * REMOVED, not reworded. It contradicted §5's blindness invariant and §9, and
 * 0021 already deleted the RLS branch that honoured it, so it was an option
 * that promised something the database refuses. 0022's CHECK stops a new cycle
 * selecting it at all.
 *
 * "Final score" is gone from every label: §11 as amended has no final score
 * column and no override. What an employee may see is their own summary, and
 * the decision recorded about them.
 */
export const DISCLOSURE_CHOICES: ReadonlyArray<{
  value: Exclude<Enums<"disclosure_policy">, "FULL">;
  label: string;
  hint: string;
}> = [
  {
    value: "NONE",
    label: "Nothing",
    hint: "The result is recorded but never shown back to them.",
  },
  {
    value: "SCORE_ONLY",
    label: "Their own summary only",
    hint: "Their own ratings and their own written answers, played back. Nothing from their Manager.",
  },
  {
    value: "SCORE_AND_DECISION",
    label: "Summary and outcome",
    hint: "The above, plus the decision recorded: promotion recommendation, and on an increment cycle their new salary and effective date.",
  },
];

/** The default depends on the cycle type — an evaluation has no outcome to show. */
/**
 * "Their own summary only", on both cycle types.
 *
 * AT THE OWNER'S INSTRUCTION. An increment cycle used to default to
 * SCORE_AND_DECISION — their summary plus the pay outcome — on the reasoning
 * that somebody whose salary has just been decided should be told. That is
 * still available and is one click away; it is no longer what happens when
 * nobody chooses.
 *
 * The narrower default is the safer one: it releases only what the employee
 * themselves wrote and rated, and a pay figure reaching somebody before HR
 * meant to release it is not a mistake that can be taken back. §9 leaves the
 * choice with HR either way, and the option carries its own description on the
 * screen.
 */
export function defaultDisclosureFor(_cycleType: "EVALUATION" | "INCREMENT") {
  return "SCORE_ONLY";
}

/** P10-REV item 4. Two large cards, because this decides what happens at the end. */
export const CYCLE_TYPE_CHOICES = [
  {
    value: "EVALUATION" as const,
    label: "Evaluation",
    hint: "A performance check-in. Ratings, learning and areas for improvement. No salary, no increment.",
  },
  {
    value: "INCREMENT" as const,
    label: "Increment",
    hint: "The yearly pay review. Everything in an evaluation, plus salary figures, an MD approval and the interview call.",
  },
];

/** P10-REV item 5. How people arrive. */
/**
 * The two shapes a cycle can have, and there are only two.
 *
 * WHY "ONE PERSON" AND "SEVERAL PEOPLE" ARE NOT SEPARATE OPTIONS HERE.
 *
 * Both are BATCH. The difference between running an increment for one person
 * and running it for forty is how many you tick on step 3 — the same picker,
 * the same launch, the same everything. Offering them as different KINDS would
 * be two controls that must always agree about a thing neither of them
 * decides, and P8P-5 is the record of what happens next: they eventually
 * disagree.
 *
 * So the labels say what actually distinguishes the two — whether you choose
 * the people now or the cycle waits for their dates — and the hints name the
 * cases HR has, including the single-person increment.
 */
export const CYCLE_KIND_CHOICES = [
  {
    value: "BATCH" as const,
    // Was "All at once", which read as "the whole company" and made a
    // one-person increment look like it did not fit.
    label: "Choose the people now",
    hint: "You pick who is in it and launch them together — one person, a department, or everybody. Use this for the annual round and for a single person's increment.",
    preset: "all" as const,
  },
  {
    value: "ROLLING" as const,
    label: "As they become due",
    hint: "The cycle stays open and each person is added when their own date arrives. Use this for new-joiner check-ins and for increments that follow each person's joining date.",
    preset: "all" as const,
  },
];

/**
 * The same question, asked of an INCREMENT cycle.
 *
 * Both are BATCH. They differ only in which list step 3 opens on — the people
 * an increment is actually owed to, or everybody. That is a filter, not a
 * mechanism, so it is a `preset` here rather than a third `cycle_kind`: two
 * stored values that always launch identically would be two things that must
 * agree about something neither decides (P8P-5).
 *
 * "As they become due" is deliberately absent. It exists in the schema and
 * works, but the screen that adds people to a rolling cycle as their dates
 * arrive (`/admin/due`) is still the gap P10-REV recorded — offering it here
 * would be offering a cycle that goes nowhere.
 */
export const INCREMENT_KIND_CHOICES = [
  {
    value: "BATCH" as const,
    label: "Due now or next month",
    hint: "Opens the list filtered to people whose next increment has arrived or falls within a month. Anyone already overdue is included.",
    preset: "due" as const,
  },
  {
    value: "BATCH" as const,
    label: "All employees",
    hint: "The whole list, unfiltered. Use this when you are paying somebody early, or off their normal cycle.",
    preset: "all" as const,
  },
];


/* ---------- Basics (wizard step 1) ---------- */

export const cycleBasicsSchema = z.object({
  name: z.string().trim().min(2, "Give the cycle a name, e.g. Q3 FY26.").max(80),
  period_label: z
    .string()
    .trim()
    .min(2, "Add the period employees will see, e.g. Oct-Dec 25 (Q3).")
    .max(80),
  // §11: |Lead − Self| ≥ threshold flags the question for the MD. Zero would
  // flag every question on every evaluation and make the collision view useless.
  variance_threshold: z.coerce
    .number()
    .int("Use a whole number.")
    .min(1, "A threshold of 0 would flag every single question.")
    .max(10, "The rating scale only goes to 10."),
  // FULL is refused at the boundary as well as by 0022's CHECK: a Zod error
  // names the field, where a constraint violation reaches HR as a database
  // message about a relation they have never heard of.
  disclosure: z.enum(["NONE", "SCORE_ONLY", "SCORE_AND_DECISION"]),
  cycle_type: z.enum(["EVALUATION", "INCREMENT"]).default("EVALUATION"),
  cycle_kind: z.enum(["BATCH", "ROLLING"]).default("BATCH"),
  default_self_days: z.coerce.number().int().min(1).max(365).default(14),
  default_lead_days: z.coerce.number().int().min(1).max(365).default(21),
});

export type CycleBasicsInput = z.infer<typeof cycleBasicsSchema>;

/* ---------- Dates (wizard step 2) ---------- */

const dateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");

/**
 * Order is checked here as well as in the CHECK constraint from 0003, because a
 * constraint violation surfaces as a Postgres error string and this needs to
 * name the field that is wrong.
 *
 * "None in the past" applies to the DUE dates only. starts_on is allowed to be
 * in the past so HR can record a cycle that opened on the 1st while they were
 * still assembling the roster — refusing that would force them to lie about the
 * date on the employee's form.
 */
export const cycleDatesSchema = z
  .object({
    starts_on: dateString,
    self_due_on: dateString,
    lead_due_on: dateString,
    md_due_on: dateString,
  })
  .superRefine((value, ctx) => {
    const issue = (path: keyof typeof value, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });

    if (value.self_due_on < value.starts_on) {
      issue("self_due_on", "Employees cannot be due before the cycle opens.");
    }
    if (value.lead_due_on < value.self_due_on) {
      issue("lead_due_on", "Leads review after employees submit, so this must be later.");
    }
    if (value.md_due_on < value.lead_due_on) {
      issue("md_due_on", "The MD decides last, so this must be later still.");
    }
    if (value.self_due_on < today()) {
      issue("self_due_on", "This due date has already passed.");
    }
  });

export type CycleDatesInput = z.infer<typeof cycleDatesSchema>;

/** Today as an ISO date, in the server's zone. Shared so every check agrees. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whole days between two ISO dates. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * Step 2's plain-language summary: "Employees get 14 days. Leads get 7 days
 * after that." A window expressed in dates makes HR do the arithmetic; a window
 * expressed in days is the thing they actually care about.
 */
export function describeWindows(dates: Partial<CycleDatesInput>): string[] {
  const { starts_on, self_due_on, lead_due_on } = dates;
  const out: string[] = [];

  if (starts_on && self_due_on) {
    out.push(`Employees get ${plural(daysBetween(starts_on, self_due_on), "day")}.`);
  }
  if (self_due_on && lead_due_on) {
    out.push(`Leads get ${plural(daysBetween(self_due_on, lead_due_on), "day")} after that.`);
  }
  /* The MD line is gone with the field that fed it. It said "The MD gets 0
     days to finalise" whenever the two dates matched, which is what they now
     always do — and since 0039 the MD is an optional step on an evaluation
     cycle, so there is no window to describe. */
  return out;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/* ---------- Participants (wizard step 3) ---------- */

export const participantRowSchema = z.object({
  profileId: z.string().uuid(),
  leadId: z.string().uuid().nullable(),
  included: z.boolean(),
});

export const participantsSchema = z.array(participantRowSchema);

export type ParticipantRow = z.infer<typeof participantRowSchema>;

/* ---------- The readiness report ---------- */

/**
 * P10: "returns a structured readiness report, never a boolean".
 *
 * A boolean tells HR that something is wrong and leaves them to find it across
 * three screens. Every issue therefore carries the people or departments it is
 * about and, where one exists, the link that fixes it.
 */
export type ReadinessIssue = {
  code: string;
  /** One sentence, addressed to HR, naming what is wrong. */
  message: string;
  /** The specific people or departments involved, so the fix is obvious. */
  subjects: string[];
  /** Where to go to fix it, when a single screen fixes it. */
  href?: string;
  hrefLabel?: string;
};

export type ReadinessReport = {
  cycleId: string;
  /** Included, active, non-excluded participants. */
  participantCount: number;
  blocking: ReadinessIssue[];
  warnings: ReadinessIssue[];
  /** Purely derived: blocking.length === 0. Never sent instead of the lists. */
  canLaunch: boolean;
};

/**
 * The sentence shown beside a disabled launch button.
 *
 * P10: "the disabled state explains why in text beside it — never a silent
 * disabled button." A disabled control with no explanation is the single most
 * common dead end in an admin tool: the person is not told what to do, so they
 * click it repeatedly and then ask someone.
 */
export function describeLaunchBlock(report: ReadinessReport): string | null {
  if (report.canLaunch) return null;
  const [first] = report.blocking;
  if (!first) return null;
  return report.blocking.length === 1
    ? first.message
    : `${first.message} (and ${plural(report.blocking.length - 1, "other issue")}).`;
}

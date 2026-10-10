/** Auth and provisioning schemas. Kept out of the "use server" files, which may only export async functions. */

import { z } from "zod";

import type { Enums } from "@/types/database";

export type AppRole = Enums<"app_role">;

export const emailSchema = z
  .string()
  .min(1, "Enter your work email")
  .email("That does not look like an email address")
  .transform((value) => value.trim().toLowerCase());

/**
 * Applied where a password is *chosen*, not where it is typed. Enforcing
 * complexity at the sign-in screen would tell an attacker the rules and help
 * nobody who is simply trying to get in.
 *
 * 72 is bcrypt's ceiling — anything beyond it is silently ignored, and a
 * password that quietly loses its tail is worse than one that was refused.
 */
/* -- WHY THERE IS A FLOOR AT ALL, AND WHY IT MOVED.
      It was ten, then six, and is now four — each time at the owner's
      instruction, and each time because the rule was the thing stopping the
      plan rather than protecting anything.
      They want everybody started on `firstname123` and changed by the person
      later if they want to. Ten characters refused most of those, so the rule
      was the thing stopping the plan.

      The cost is worth stating once and then not repeating: a predictable
      password is guessable by anybody who knows the person's name, and this
      system holds appraisal ratings and salary figures. What limits the damage
      is that the two most sensitive things are confined by DATABASE policy
      rather than by the login — §5 keeps salary to HR and the MD and blindness
      keeps each rating layer from the other side, so a guessed employee account
      reads that person's own form and nothing else. The exposure is real and
      bounded, and it is the owner's call to make.

      THE PROVIDER HAS ITS OWN FLOOR, six by default, and this no longer
      matches it — see `MIN_PASSWORD_LENGTH` below for what that means and where
      it is changed. `firstname123` clears both for any name of three letters or
      more.

      72 is bcrypt's ceiling — anything beyond it is silently ignored, and a
      password that quietly loses its tail is worse than one that was refused. -- */
/**
 * The password everybody starts on: their first name and 123.
 *
 * ONE IMPLEMENTATION, used by the create form and by the CSV import. Two copies
 * of "what password does a new person get" would drift, and the drift would
 * show up as HR reading out a password that does not work.
 *
 * Lowercased and stripped of anything that is not a letter, because HR reads
 * this down a phone: "O'Brien" becomes `obrien123`, not `o'brien123`, and
 * nobody has to be told where the apostrophe goes.
 *
 * The `123456` tail is the edge case, stated rather than left to fail: a
 * two-letter first name gives `jo123`, which is five characters and below the
 * floor below — so the suffix grows instead of the schema being weakened. It is
 * still deterministic, and the field shows it in plain text either way.
 */
export function defaultPasswordFor(fullName: string): string {
  const first = (fullName.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (first === "") return "";
  const simple = `${first}123`;
  return simple.length >= 6 ? simple : `${first}123456`;
}

/**
 * The shortest password this application will accept.
 *
 * FOUR, AT THE OWNER'S INSTRUCTION — "4, 5, 6, 10 or more". One constant, read
 * by the schema, by both `minLength` attributes and by every hint, so the form
 * cannot promise a rule the server does not apply. That was a real bug once:
 * one field said ten while the label beside it promised six.
 *
 * IT IS NOT THE ONLY FLOOR, AND THAT IS WORTH KNOWING BEFORE IT SURPRISES
 * SOMEBODY. Supabase Auth enforces a minimum of its own — six by default — and
 * refuses anything shorter itself. Lowering this alone does not lower that; the
 * dashboard setting is Authentication → Sign In / Providers → Minimum password
 * length. Until it is changed, a five-character password is accepted by the
 * form and refused by the provider — so that refusal is caught and turned into
 * a sentence naming the setting, rather than arriving as a raw provider error.
 */
export const MIN_PASSWORD_LENGTH = 4;

export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(72, "Use 72 characters or fewer");

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
});

/* ---------- Provisioning ---------- */

/**
 * The access levels HR can grant, in plain language — no enum values anywhere
 * in the interface (§13.5).
 *
 * EMPLOYEE is listed but never optional: there is no user of this system who
 * does not fill in their own appraisal. HOD and SUPERVISOR are granted *in
 * addition*, which is §9's simultaneous-roles case made concrete.
 */
export const ACCESS_LEVELS: ReadonlyArray<{
  value: AppRole;
  label: string;
  description: string;
  always?: boolean;
}> = [
  {
    value: "EMPLOYEE",
    label: "Employee",
    description: "Fills in their own appraisal. Everyone gets this.",
    always: true,
  },
  {
    value: "HOD",
    label: "Head of Department",
    description: "Also reviews the people who report to them.",
  },
  {
    value: "SUPERVISOR",
    label: "Supervisor",
    description: "Also reviews shop-floor workers who report to them.",
  },
  {
    value: "HR_ADMIN",
    label: "HR Admin",
    description: "Manages questions, cycles, people and settings.",
  },
  {
    value: "MD",
    label: "Managing Director",
    description: "Sees every appraisal and records the final decision.",
  },
];

/**
 * The whole person, in one save.
 *
 * It used to collect five fields, which left employee code, work mobile,
 * designation, the reporting line and the joining date with nowhere to go —
 * three of them had no form at all and could only be set by hand in SQL. Two of
 * those are not cosmetic: §10 sends every invite to `phone_e164`, and since
 * AMEND-3 a HOD with no contact details BLOCKS a cycle launch.
 *
 * Salary IS collected here, at the owner's explicit instruction — reversing
 * P19B-7, which kept it off this form on the grounds that a CTC has to append to
 * `salary_history` and that belongs where the history is visible. The objection
 * is answered rather than overruled: these three fields do not write a bare
 * number onto the record, they compose the opening `salary_history` rows (§18
 * P19C-2), so the append-only history is correct from the first save instead of
 * starting blank.
 *
 * All three are optional. §5 salary confinement still holds absolutely — this
 * screen is HR/MD-only, no figure reaches an audit diff, and nothing here is
 * readable by a HOD or an employee.
 */
/** The set the database will actually accept for `app_role`. */
const ROLE_VALUES = new Set<string>(ACCESS_LEVELS.map((level) => level.value));

/**
 * A salary needs the date it starts from.
 *
 * A joining salary with no joining date is half a record: the figure lands, but
 * `salary_effective_from` is null — so the next CORRECTION overwrites today's
 * pay unconditionally (P19-9) — and there is no date to count the first
 * increment from, so nobody is ever reminded about it. Reported as "I added a
 * salary but not the joining date and it saved without any alert".
 *
 * ONE RULE, called by the dialog before it submits and by `createUser` after
 * it parses, in the same words, so the form can never accept what the server
 * then refuses (P13-6). The browser half exists so the refusal arrives beside
 * the field with everything else still typed; the server half is the guard
 * (§9). Keyed by the field the fix belongs in.
 */
/** One sentence, used by the schema, the edit path and the dialog, so the
 *  three cannot drift into saying different things about one rule. */
export const JOINING_DATE_REQUIRED =
  "Enter their date of joining — their reviews and increments are counted from it";

export function salaryDateProblems(input: {
  joiningSalary: number | null | undefined;
  dateOfJoining: string | null | undefined;
  incrementAmount: number | null | undefined;
  lastIncrementDate: string | null | undefined;
}): Record<string, string> {
  const problems: Record<string, string> = {};
  const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

  if (has(input.joiningSalary) && !has(input.dateOfJoining)) {
    problems.date_of_joining =
      "Add their date of joining — the joining salary is counted from that date.";
  }
  if (has(input.incrementAmount) && !has(input.lastIncrementDate)) {
    problems.last_increment_date =
      "Add the date of that increment — an amount cannot be placed without it.";
  }
  return problems;
}

export const createUserSchema = z.object({
  full_name: z.string().trim().min(2, "Enter their full name").max(120),
  email: emailSchema,
  /* -- Whether the address came from a PERSON or was derived for us.

        A production worker's auth identity still needs one — `profiles.id`
        references `auth.users(id)` and every RLS policy compares `auth.uid()`
        against it — so the importer derives an internal address on a `.invalid`
        domain when none was given. `profiles.email` is then left NULL (0071),
        because the profile is what the product reads and it should say
        honestly that there is no address.

        Defaults to true: the create form always asks for one, so only the
        importer ever sets this false. -- */
  email_supplied: z.boolean().default(true),
  password: newPasswordSchema,
  department_id: z.string().uuid("Choose a department").or(z.literal("")).optional(),
  /*
     THE CHECKBOXES POST AN EMPTY STRING FOR EVERY LEVEL LEFT UNTICKED.
     `<input name="roles" value={checked ? level.value : ""}>` submits either
     way, so a person granted only EMPLOYEE arrives here as
     ["EMPLOYEE", "", "", "", ""].

     "" is not an `app_role`, and Postgres rejects the WHOLE insert on it — one
     bad element fails all five rows. That is what produced "the account was
     created but the access level was not applied": the account and the profile
     were already written, and only the role grant blew up.

     Filtering to known values here is the backstop. The form no longer emits
     the empties in the first place, but a schema that accepts any string for a
     column that is an enum will be wrong again the next time somebody adds a
     field to that form.
  */
  roles: z
    .array(z.string())
    .transform((values) => values.filter((value) => ROLE_VALUES.has(value)))
    .refine((values) => values.length > 0, "Choose at least one access level"),

  employee_code: z.string().trim().max(40).optional().or(z.literal("")),
  /**
   * Normalised to E.164 server-side, not here: `normaliseToE164` is
   * `server-only` and returns a structured reason so the field can say WHY a
   * number was refused (P11-12). This only checks it looks like a phone number.
   */
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[0-9+\-()\s]*$/, "A phone number can only contain digits, spaces, + - and ( )")
    .optional()
    .or(z.literal("")),
  /* ---------- The work contact (0081) ----------
     OPTIONAL, AND BLANK MEANS "USE THE PERSONAL ONE". That is the whole of the
     feature's safety: somebody who never fills these in behaves exactly as they
     did before, so there is no state in which adding two columns makes a person
     unreachable.

     Only administrative messages go here — HR digests, report-ready, finalised.
     Somebody's own appraisal and their team's reach the personal pair, because
     those are about them as a person in the company rather than about their
     job function. The rule lives in `lib/notify/contacts.ts`; these two fields
     just hold the addresses.

     Same shapes as the personal pair, deliberately: `work_email` reuses the
     email check and `work_phone` the same permissive one, since it is the
     server-side normaliser that gives the real answer with a reason (P11-12).
     Two fields that hold the same kind of value should refuse the same things. */
  work_email: z.string().trim().email("That does not look like an email address").optional().or(z.literal("")),
  work_phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[0-9+\-()\s]*$/, "A phone number can only contain digits, spaces, + - and ( )")
    .optional()
    .or(z.literal("")),

  designation: z.string().trim().max(120).optional().or(z.literal("")),
  reports_to: z.string().uuid().optional().or(z.literal("")),
  /** 0083's second reviewer. A profile id by the time it reaches here. */
  co_reviewer_id: z.string().uuid().optional().or(z.literal("")),
  date_of_joining: z.string().optional().or(z.literal("")),
  employment_type: z.enum(["PERMANENT", "PROBATION", "CONTRACT", "TRAINEE"]).default("PERMANENT"),
  last_increment_date: z.string().optional().or(z.literal("")),
  increment_frequency_months: z.coerce.number().int().min(1).max(60).default(12),

  /* ---------- Compensation (optional) ----------
     A blank string has to survive `z.coerce.number()`, which turns "" into 0 —
     and a joining salary of zero is not the same fact as "not recorded". The
     preprocess is what keeps the difference. */
  /* §7: which MODULE they are in — the staff 0-5 form or the shop-floor tick
     sheet. Independent of department, because both modules have people in the
     same teams. */
  track: z.enum(["STAFF", "WORKER"]).default("STAFF"),
  /* -- WHETHER THE MISSING-NUMBER RULE BELOW IS A REFUSAL OR A NOTE.

        True on the form: HR is entering one person and has the number to
        hand, so refusing costs nothing and closes the gap at the only moment
        it is cheap.

        False from the importer, deliberately. One bad row imports NOTHING
        (P19C-8), so refusing here would fail a whole payroll file over a blank
        cell — at the one moment HR most wants it to go in. The row lands and
        carries a note naming the gap instead, which is the same call FIX-64
        made for an unresolvable manager. Same idiom as `email_supplied`
        above: a boolean the importer sets to relax a rule the form always
        meets. -- */
  phone_required: z.boolean().default(true),
  /* -- A JOINING DATE IS REQUIRED ON THE FORM, at the owner's instruction.
        Every review and increment date is counted from it (0076): somebody
        entered without one never appears on Evaluation Due, never reaches an
        increment, and has nowhere for a joining salary to start (0110). The
        importer sets this false and NOTES the gap instead, for the reason
        `phone_required` gives: one bad row imports nothing (P19C-8). -- */
  joining_required: z.boolean().default(true),
  joining_ctc: money("Joining salary"),
  /* -- NO `current_ctc` (0109). A salary is joining plus every rise, so there
        is nothing here to state — and a field that is accepted and then
        ignored is worse than one that is refused: the caller is told nothing,
        and the figure simply does not appear. The rise below is what moves it. -- */
  last_increment_amount: money("Last increment amount"),

  /**
   * Earlier rises, oldest first — one entry per `increment_N_date` /
   * `increment_N_amount` pair on the import sheet.
   *
   * `last_increment_*` above records the newest rise and cannot describe the
   * ones before it, so a sheet carrying two years of increments had one of them
   * silently dropped. `provisionPerson` folds both into one ledger.
   *
   * Defaults to empty: the create form asks for a single figure, so only the
   * importer ever fills this.
   */
  increments: z
    .array(
      z.object({
        effective_from: z.string(),
        amount: z.number().positive(),
      }),
    )
    .default([]),
  })
  /* ---------- At least reachable, for anybody the system writes to ----------
     §10 sends every invite over WhatsApp and/or email, and P11 makes the
     mobile the channel that actually works — email needs SMTP configured
     (AMEND-4) and WhatsApp does not. A Backend Team person with no number is
     therefore somebody whose form link has one way to arrive instead of two,
     and PR-9 already makes a HOD with no contact details a HARD BLOCK at
     launch. Refusing it here is the same rule, moved to the moment somebody is
     being entered — which is the moment the number is to hand.

     PRODUCTION TEAM ARE EXEMPT, and that is not an oversight. Nothing in the
     system ever writes to a worker: there is no worker template and no notify
     path, because their supervisor fills the sheet (WORKER-1). Requiring a
     number they will never be sent anything on would block a real import for
     no benefit — F53 deliberately made even their EMAIL optional. */
  .superRefine((value, ctx) => {
    if (value.phone_required && value.track === "STAFF" && !value.phone?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phone"],
        message: "Enter a mobile number — this is where their form link is sent",
      });
    }
    if (value.joining_required && !value.date_of_joining?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["date_of_joining"],
        message: JOINING_DATE_REQUIRED,
      });
    }
  });

/** An optional rupee figure. Empty means "not recorded", never zero. */
function money(label: string) {
  return z.preprocess(
    (value) => {
      if (value === null || value === undefined) return undefined;
      // Accept what people actually paste out of a spreadsheet: ₹, commas,
      // Indian digit grouping. Refusing "₹4,80,000" would send HR to a
      // calculator for no reason.
      const text = String(value).replace(/[₹,\s]/g, "");
      return text === "" ? undefined : Number(text);
    },
    z
      .number({ invalid_type_error: `${label} must be a number` })
      .positive(`${label} must be more than zero`)
      .max(100_000_000, `${label} looks too large — check the figure`)
      .optional(),
  );
}

export type CreateUserInput = z.infer<typeof createUserSchema>;

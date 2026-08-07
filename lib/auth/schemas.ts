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
export const newPasswordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
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

export const createUserSchema = z.object({
  full_name: z.string().trim().min(2, "Enter their full name").max(120),
  email: emailSchema,
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
  designation: z.string().trim().max(120).optional().or(z.literal("")),
  reports_to: z.string().uuid().optional().or(z.literal("")),
  date_of_joining: z.string().optional().or(z.literal("")),
  employment_type: z.enum(["PERMANENT", "PROBATION", "CONTRACT", "TRAINEE"]).default("PERMANENT"),
  last_increment_date: z.string().optional().or(z.literal("")),
  increment_frequency_months: z.coerce.number().int().min(1).max(60).default(12),

  /* ---------- Compensation (optional) ----------
     A blank string has to survive `z.coerce.number()`, which turns "" into 0 —
     and a joining salary of zero is not the same fact as "not recorded". The
     preprocess is what keeps the difference. */
  joining_ctc: money("Joining salary"),
  current_ctc: money("Current salary"),
  last_increment_amount: money("Last increment amount"),
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

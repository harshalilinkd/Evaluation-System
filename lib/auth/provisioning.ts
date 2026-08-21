"use server";

/** HR provisioning: create a person, set their department and access level. */

import { revalidatePath } from "next/cache";

import { INCREMENT_PAIR, parseCsv, toIsoDate, toRecords } from "@/lib/auth/csv";
import { checkRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import {
  ACCESS_LEVELS,
  createUserSchema,
  defaultPasswordFor,
  emailSchema,
  MIN_PASSWORD_LENGTH,
  newPasswordSchema,
  type AppRole,
  type CreateUserInput,
} from "@/lib/auth/schemas";

/**
 * The access levels a CSV row may ask for, by name.
 *
 * BOTH DERIVED FROM `ACCESS_LEVELS`, never listed here — a second list is a list
 * that stops matching the first, and the failure would be a role the interface
 * offers and the importer silently refuses.
 *
 * Accepted is every value, so a previous export carrying EMPLOYEE still
 * imports. SUGGESTED drops it, because it is granted to everybody and cannot be
 * withheld (P8-3) — naming it in an error message would tell HR to type a value
 * that changes nothing.
 */
/**
 * An email cell, or nothing.
 *
 * A SPREADSHEET WRITES "NOT APPLICABLE" AS A DASH. Twenty-odd production
 * workers in a real payroll export carried `-` in the email column, which is
 * exactly what a person means by "they have not got one" — and the importer read
 * it as an address and refused every one of those rows. Blank, a dash, an en or
 * em dash, "n/a" and "na" all mean the same thing and are all treated as empty.
 *
 * Lower-cased, because every lookup here is.
 */
/**
 * The most recent rise this row describes, from whichever column carried it.
 *
 * ONE IMPLEMENTATION, because three things are derived from it and they must
 * agree: `last_increment_date` (when the increment calendar counts from),
 * `salary_effective_from` (since when they have been on today's figure), and
 * the ledger's own newest row. 0068 made the same rule authoritative in SQL —
 * "once there is a recorded rise, that is when they were last given one".
 *
 * Null when there are no rises at all. That is not the same as the joining
 * date, and the two callers differ on what to do about it.
 */
function newestRise(input: {
  last_increment_date?: string;
  increments?: ReadonlyArray<{ effective_from: string }>;
}): string | null {
  const dates = [
    ...(input.last_increment_date ? [input.last_increment_date] : []),
    ...(input.increments ?? []).map((entry) => entry.effective_from),
  ];
  return dates.length === 0 ? null : dates.sort().at(-1)!;
}

function normaliseEmailCell(value: string | undefined): string {
  const text = (value ?? "").trim().toLowerCase();
  return /^(-{1,2}|–|—|n\/a|na)$/.test(text) ? "" : text;
}

const IMPORTABLE_ROLES = new Set<string>(ACCESS_LEVELS.map((level) => level.value));
const SUGGESTED_ROLES = ACCESS_LEVELS.filter((level) => !level.always).map((level) => level.value);
// The ONE implementation of "what a pay change is". Delegated to rather than
// reimplemented — see the compensation block in `updatePerson`.
import { addSalaryChange } from "@/lib/employment/actions";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";

// ACCESS_LEVELS and the schemas live in ./schemas — a "use server" module may
// only export async functions.

export type ProvisionState = {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  /**
   * The profile just created. The form keys itself on this so a success clears
   * the fields.
   *
   * Without it a saved form sits there still full, which is indistinguishable
   * from nothing having happened — so the next thing HR does is press Save
   * again, and the second attempt reports "somebody already has that email
   * address" about the person it just created a second earlier. A boolean would
   * not do: two successes in a row must produce two different values, or adding
   * a second person leaves the first one's details in the fields.
   */
  createdId?: string;
};

/**
 * Create a person who can sign in.
 *
 * On the service-role key: creating an auth user is an admin-API operation and
 * there is no other way to do it. **Only that one call uses it.** The profile
 * and the role grants go through the ordinary authenticated client, so RLS still
 * decides whether this HR user may write them — which means a bug in the guard
 * below cannot quietly hand someone MD access. CLAUDE.md §0.5 is extended for
 * provisioning; see §18 P8.
 */
export async function createUser(
  _prev: ProvisionState,
  formData: FormData,
): Promise<ProvisionState> {
  // §9: every server action re-checks the role before writing.
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { error: auth.error.message };

  const parsed = createUserSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    password: formData.get("password"),
    department_id: formData.get("department_id") ?? "",
    roles: formData.getAll("roles").map(String),
    employee_code: formData.get("employee_code") ?? "",
    /* -- §7: `profiles.track` decides which MODULE somebody is in, and it is
          independent of their department. A shop-floor worker in Printing and a
          staff member in Printing are both real; the department says which team
          they are on, the track says which form they fill.
          Never inferred from a department or a job title — both change, and a
          person quietly moving between modules would move which appraisal they
          receive. -- */
    track: formData.get("track") ?? "STAFF",
    phone: formData.get("phone") ?? "",
    work_email: formData.get("work_email") ?? "",
    work_phone: formData.get("work_phone") ?? "",
    designation: formData.get("designation") ?? "",
    reports_to: formData.get("reports_to") ?? "",
    co_reviewer_id: formData.get("co_reviewer_id") ?? "",
    date_of_joining: formData.get("date_of_joining") ?? "",
    employment_type: String(formData.get("employment_type") ?? "PERMANENT"),
    last_increment_date: formData.get("last_increment_date") ?? "",
    increment_frequency_months: formData.get("increment_frequency_months") ?? 12,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors };
  }

  /* -- The one refusal that CAN apply on a create: naming the same person as
        both managers. "Themselves" cannot — they have no id yet — and the
        database's own CHECK covers that case for ever.

        Said here as well as in the edit dialog and 0084's launch, deliberately:
        the launch silently skips a second reviewer who is also the lead, so
        without this HR would set one, see it saved, and never learn why the
        third form did not appear (§13.4). -- */
  if (parsed.data.co_reviewer_id && parsed.data.co_reviewer_id === parsed.data.reports_to) {
    return {
      error: "The second reviewer has to be somebody other than their manager.",
      fieldErrors: {
        co_reviewer_id: "Their manager already rates them — choose a different person",
      },
    };
  }

  const result = await provisionPerson(parsed.data, auth.session.profile.id);
  if (!result.ok) return { error: result.error };

  revalidatePath("/admin/settings");
  revalidatePath("/admin/people");

  return {
    ok: true,
    createdId: result.profileId,
    message: `${parsed.data.full_name} can now sign in. Their password is the one you typed — tell it to them yourself.`,
  };
}

/**
 * Create one person, all the way through: auth account, profile, employment
 * record, opening salary history and role grants.
 *
 * Extracted so the single form and the CSV import cannot diverge. Two write
 * paths for "create a person" would eventually disagree about which fields are
 * saved and what gets audited — and the disagreement would only surface on
 * whichever path is used less, which is the one nobody is watching.
 *
 * Returns a message rather than throwing (§14). The caller decides whether that
 * is a form error or one row of an import report.
 */
/**
 * Amend somebody who is already on the system, from an import row.
 *
 * WHY THIS EXISTS. The import could create people and not update them, so
 * re-uploading a corrected file failed every row with "somebody already has that
 * email address" — and the correction HR had just made was the reason they were
 * uploading it. The employment and question imports have always updated; this
 * one was the odd path out.
 *
 * FOUR RULES, and each of them is about not destroying something.
 *
 * 1. THE PASSWORD IS IGNORED. The template carries a password column because
 *    creating an account needs one. Applying it on an update would reset the
 *    password of everybody in the file every time HR corrected a department —
 *    silently locking out the whole company from a spreadsheet.
 *
 * 2. A BLANK COLUMN MEANS "NOT IN THIS FILE", never "set it to nothing"
 *    (P19D-4). A file of corrected phone numbers must not wipe designations.
 *
 * 3. SALARY IS NOT TOUCHED. `salary_history` is append-only for every caller
 *    (P19-3), so a re-import would either duplicate an opening row or write a
 *    pay change nobody decided. A pay change is a deliberate act on the
 *    Employment tab, not a side effect of fixing a typo.
 *
 * 4. ROLES ARE DIFFED, NOT REPLACED, and HR cannot remove their own
 *    administrator access here — FIX-14, where a wholesale replace deleted the
 *    caller's own HR row and then could not re-insert it, demoting them to
 *    EMPLOYEE from an edit that never touched access.
 */
async function amendPerson(
  profileId: string,
  input: CreateUserInput,
  actorProfileId: string,
): Promise<{ ok: true; profileId: string } | { ok: false; error: string }> {
  const supabase = await createClient();

  /* -- Rule 2, as a helper. `undefined` drops the key from the patch entirely,
        so PostgREST leaves the column alone rather than writing null. -- */
  const keep = <T,>(v: T | null | undefined): T | undefined =>
    v === null || v === undefined || v === "" ? undefined : (v as T);

  let phoneE164: string | undefined;
  if (input.phone) {
    const { normaliseToE164 } = await import("@/lib/notify/phone");
    const result = normaliseToE164(input.phone);
    if (!result.ok) return { ok: false, error: `That mobile number is not usable: ${result.reason}` };
    phoneE164 = result.e164;
  }

  /* -- The work number goes through the SAME normaliser (0081).
        0081's CHECK constraint requires E.164 on that column, so a number typed
        as "98765 43210" would be refused by the database with a constraint
        violation rather than by the form with a sentence. Normalising here is
        what keeps the refusal readable — and it has to be the same function, or
        the two columns would accept different things. -- */
  let workPhoneE164: string | undefined;
  if (input.work_phone) {
    const { normaliseToE164 } = await import("@/lib/notify/phone");
    const result = normaliseToE164(input.work_phone);
    if (!result.ok) {
      return { ok: false, error: `That official mobile number is not usable: ${result.reason}` };
    }
    workPhoneE164 = result.e164;
  }

  const patch = {
    full_name: keep(input.full_name),
    employee_code: keep(input.employee_code),
    phone_e164: phoneE164,
    work_phone_e164: workPhoneE164,
    work_email: keep(input.work_email),
    department_id: keep(input.department_id),
    designation: keep(input.designation),
    reports_to: keep(input.reports_to),
    co_reviewer_id: keep(input.co_reviewer_id),
    date_of_joining: keep(input.date_of_joining),
    track: keep(input.track),
  };

  const { data: amended, error: profileError } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", profileId)
    // The zero-rows class, for the sixth time: an update that matches nothing
    // succeeds, and this one would then report a row as imported.
    .select("id");

  if (profileError) {
    return {
      ok: false,
      error: /duplicate|unique/i.test(profileError.message)
        ? "That employee code is already used by somebody else."
        : `Could not update them: ${profileError.message}`,
    };
  }
  if (!amended || amended.length === 0) {
    return { ok: false, error: "Their record could not be updated. Check you still have access." };
  }

  /* -- Employment: only the columns this file carried, and only when it carried
        one. `coalesce` on the database side is not available through PostgREST,
        so the patch simply omits what is blank. -- */
  const employmentPatch = {
    employment_type: keep(input.employment_type),
    last_increment_date: keep(input.last_increment_date),
    increment_frequency_months: keep(input.increment_frequency_months),
  };
  if (Object.values(employmentPatch).some((v) => v !== undefined)) {
    const { error } = await supabase
      .from("employment_records")
      .update(employmentPatch)
      .eq("profile_id", profileId);
    // Not fatal. The profile is corrected either way, and naming the gap beats
    // failing a row whose main purpose already succeeded (P19B-8).
    if (error) {
      return { ok: false, error: `Their details were updated but the employment record was not: ${error.message}` };
    }
  }

  /* -- FILL `salary_effective_from` WHERE IT IS EMPTY, and only there.
        Anybody imported before it was written has it null, so Current pay shows
        an em dash and a later CORRECTION would be treated as moving today's pay
        rather than fixing the past (P19-9). Re-uploading the same file should
        repair that.

        THE `.is(..., null)` IS THE WHOLE SAFETY OF IT. F24-11 keeps salary
        untouched on a re-import, and this obeys that: a record where a real
        salary change has since set the date matches nothing and is left exactly
        as it is. It fills a gap; it never overwrites an answer. -- */
  const startedOn = newestRise(input) ?? (input.date_of_joining || null);
  if (startedOn) {
    await supabase
      .from("employment_records")
      .update({ salary_effective_from: startedOn })
      .eq("profile_id", profileId)
      .is("salary_effective_from", null);
  }

  /* -- RESTORING PAY ONTO AN EMPTY LEDGER, AND ONLY AN EMPTY ONE.
        Rule 3 above says salary is not touched on a re-import, and that rule is
        intact: `salary_history` is append-only for every caller (P19-3), so a
        second upload must never append a rise nobody decided or a duplicate
        opening row.

        An EMPTY ledger is a different case, and it is the one that made
        somebody reach for "delete every account and import them again".
        RESET-CYCLES-AND-PAY-ARMED.sql empties the pay history and blanks both
        salary columns deliberately — and after it, a re-upload of the same
        spreadsheet restored every fact about a person EXCEPT what they are
        paid, because this path refused to write it. Deleting the accounts to
        get around that costs their logins, their roles and their joining dates.

        THE THREE `null` TESTS ARE THE WHOLE SAFETY OF IT, the same device the
        `salary_effective_from` fill above uses: no pay row, no current figure
        and no baseline. Anybody who has ever been paid anything on this system
        fails all three and is left exactly as they are. It fills a gap; it
        never overwrites an answer. -- */
  const salaryOffered = input.joining_ctc !== undefined || input.current_ctc !== undefined;

  if (salaryOffered) {
    const [pay, record] = await Promise.all([
      supabase.from("salary_history").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
      supabase
        .from("employment_records")
        .select("profile_id, current_ctc, joining_ctc")
        .eq("profile_id", profileId)
        .maybeSingle(),
    ]);

    const ledgerEmpty =
      (pay.count ?? 0) === 0 &&
      (record.data?.current_ctc ?? null) === null &&
      (record.data?.joining_ctc ?? null) === null;

    if (ledgerEmpty) {
      const ledger = buildLedger(input);
      const lastIncrementOn = newestRise(input);

      /* -- The same two columns the create path writes, and for the same
            reason: somebody joining on ₹1,80,000 with no rise yet IS on
            ₹1,80,000, so leaving `current_ctc` blank would be false. -- */
      const figures = {
        current_ctc: input.current_ctc ?? input.joining_ctc ?? null,
        joining_ctc: input.joining_ctc ?? null,
        salary_effective_from: lastIncrementOn ?? input.date_of_joining ?? null,
        last_increment_date: lastIncrementOn,
      };

      const written = record.data
        ? await supabase
            .from("employment_records")
            .update(figures)
            .eq("profile_id", profileId)
            /* -- Re-asserted at the write, not only at the read above. Between
                  the two, another import row or the Employment tab may have put
                  a figure there — and a lost race here would overwrite a real
                  salary. A PostgREST update matching no row is a success with
                  zero rows, which is why `.select()` is what tells them apart
                  (the silent-write class, ninth appearance). -- */
            .is("current_ctc", null)
            .is("joining_ctc", null)
            .select("profile_id")
        : await supabase
            .from("employment_records")
            .insert({ profile_id: profileId, ...figures })
            .select("profile_id");

      if (written.error) {
        return {
          ok: false,
          error: `Their details were updated but the salary was not: ${written.error.message}`,
        };
      }

      if ((written.data ?? []).length > 0) {
        const salaryRows = composeOpeningPay(
          profileId,
          input,
          ledger,
          actorProfileId,
          "Recorded when the roster was re-imported.",
        );

        if (salaryRows.length > 0) {
          const { error } = await supabase.from("salary_history").insert(salaryRows);
          if (error) {
            return {
              ok: false,
              error: `Their details and today's salary were saved, but the pay history was not: ${error.message}`,
            };
          }
        }
      }
    }
  }

  /* -- Rule 4. Everyone holds EMPLOYEE and it is never removed (P8-3). -- */
  const wanted = new Set<string>(["EMPLOYEE", ...input.roles]);
  const { data: held } = await supabase
    .from("user_roles")
    .select("role")
    .eq("profile_id", profileId);
  const have = new Set((held ?? []).map((r) => r.role as string));

  const toAdd = [...wanted].filter((r) => !have.has(r));
  const toRemove = [...have].filter((r) => r !== "EMPLOYEE" && !wanted.has(r));

  // Adds first: a partial failure then leaves MORE access rather than less,
  // which is visible and harmless. The reverse is silent (FIX-14).
  if (toAdd.length > 0) {
    await supabase
      .from("user_roles")
      .insert(toAdd.map((role) => ({ profile_id: profileId, role: role as AppRole })));
  }
  if (toRemove.length > 0) {
    const selfDemotion = profileId === actorProfileId && toRemove.some((r) => r === "HR_ADMIN");
    if (!selfDemotion) {
      await supabase
        .from("user_roles")
        .delete()
        .eq("profile_id", profileId)
        .in("role", toRemove as AppRole[]);
    }
  }

  // §12, and no figure in the diff (§5, P19-10) — no salary is written here at
  // all, so there is none to leak.
  await supabase.rpc("log_admin_action", {
    p_entity: "profile",
    p_entity_id: profileId,
    p_action: "person.amended_by_import",
    p_diff: { fields: Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined) } as Json,
  });

  return { ok: true, profileId };
}

/**
 * The rises this row describes, oldest first.
 *
 * Lifted out of the create path so the re-import path cannot grow a second
 * reading of the same columns. Two readings would eventually disagree about a
 * pay ledger, which is the one place a disagreement is expensive.
 */
function buildLedger(input: CreateUserInput): Array<{ effective_from: string; amount?: number }> {
  const byDate = new Map<string, number | undefined>();
  if (input.last_increment_date) {
    byDate.set(input.last_increment_date, input.last_increment_amount);
  }
  for (const entry of input.increments ?? []) {
    byDate.set(entry.effective_from, entry.amount);
  }
  const ledger = [...byDate.entries()]
    .map(([effective_from, amount]) => ({ effective_from, amount }))
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  return ledger;
}

/**
 * The opening `salary_history` rows for somebody whose ledger is EMPTY.
 *
 * Extracted from `provisionPerson` UNCHANGED, and now called by both paths: an
 * account being created, and a re-import filling a ledger with nothing in it.
 * A second copy of this arithmetic would be a second answer to "what were they
 * paid before this rise", on the table §12 makes evidence.
 */
function composeOpeningPay(
  profileId: string,
  input: CreateUserInput,
  ledger: Array<{ effective_from: string; amount?: number }>,
  actorProfileId: string,
  note: string,
): Array<{
  profile_id: string;
  effective_from: string;
  previous_ctc: number | null;
  new_ctc: number;
  hike_amount: number | null;
  hike_pct: number | null;
  reason: string;
  recorded_by: string;
  note: string;
}> {
  const salaryRows: Array<{
    profile_id: string;
    effective_from: string;
    previous_ctc: number | null;
    new_ctc: number;
    hike_amount: number | null;
    hike_pct: number | null;
    reason: string;
    recorded_by: string;
    note: string;
  }> = [];

  /* -- NO JOINING ROW. The baseline is `joining_ctc` on the employment record,
        written above, and the ledger renders it as row 1 (0043).

        It used to be appended here as a `salary_history` row with reason
        JOINING. That reads well and breaks the moment somebody records a
        joining salary AFTER a revision already exists — the revision path
        measured it against today's salary and filed the first pay a person ever
        received as a rise. A baseline that cannot be compared against anything
        cannot be got wrong that way. -- */

  /* -- THE CHAIN IS ANCHORED ON TODAY'S SALARY AND WALKS BACKWARDS.
        Forward from `joining_ctc` was the obvious direction and is the wrong
        one: joining 25,000 plus a recorded rise of 5,000 comes to 30,000, and
        if the record says they are on 32,000 today the ledger's newest row
        would contradict the record it sits beside. Today's figure is the one
        thing known for certain, so each rise is subtracted from it in turn and
        the oldest `previous_ctc` falls where it falls — which is honest about
        there having been earlier rises nobody typed in.

        For a single entry this is byte-for-byte the arithmetic that was here
        before, which is what makes it safe to widen rather than a second
        algorithm sitting beside the first. -- */
  if (input.current_ctc !== undefined && ledger.length > 0) {
    let newCtc = input.current_ctc;
    let newest = true;

    for (const entry of ledger.slice().reverse()) {
      /* The increment amount is what makes the previous figure knowable.
         Failing that, the baseline does — which is what makes the FIRST
         revision measure against what somebody joined on. */
      const hike = entry.amount;
      const previous = hike !== undefined ? newCtc - hike : (input.joining_ctc ?? null);
      const usable = previous !== null && previous > 0;

      /* -- STOP BEFORE WRITING A ROW WE CANNOT STAND BEHIND.
            The newest row's `new_ctc` is `current_ctc` — a figure on the
            record. Every older row's is one this loop derived, and it is only
            worth writing while the step above it worked out. Caught by the
            suite: rises adding to more than the salary produced a row saying
            somebody was moved to ₹1,000, which is not something anybody
            typed. The newest row is still written with a null previous, which
            is the long-standing behaviour for a rise with no amount. -- */
      if (!usable && !newest) break;

      salaryRows.push({
        profile_id: profileId,
        effective_from: entry.effective_from,
        previous_ctc: usable ? previous : null,
        new_ctc: newCtc,
        hike_amount: hike ?? null,
        hike_pct: usable && hike !== undefined ? Math.round((hike / previous) * 10000) / 100 : null,
        reason: "ANNUAL_INCREMENT",
        recorded_by: actorProfileId,
        note,
      });

      /* Stop rather than guess. An entry with no amount leaves nothing to
         subtract, and a previous figure at or below zero means the amounts do
         not describe this salary — either way the older rows would be fiction. */
      if (!usable || hike === undefined) break;
      newCtc = previous;
      newest = false;
    }
  }

  return salaryRows;
}

async function provisionPerson(
  input: CreateUserInput,
  actorProfileId: string,
): Promise<{ ok: true; profileId: string } | { ok: false; error: string }> {
  // Everyone is an employee; the chosen levels are granted on top.
  const roles = Array.from(new Set<string>(["EMPLOYEE", ...input.roles])) as AppRole[];

  const admin = createServiceClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    // HR vouched for the address by typing it; there is no inbox round-trip to
    // wait for, and an unconfirmed account cannot sign in.
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });

  if (createError || !created?.user) {
    const duplicate = /already|exists|registered/i.test(createError?.message ?? "");
    const tooShort = passwordTooShortForProvider(createError?.message);
    return {
      ok: false,
      error: duplicate
        ? "Somebody already has that email address."
        : (tooShort ?? "Could not create the account. Try again, or check the email address."),
    };
  }

  const profileId = created.user.id;

  // From here on, the ordinary client — RLS applies (profiles: hr updates
  // anything, user_roles: hr writes). The on_auth_user_created trigger has
  // already made the profile row; this fills in what only HR knows.
  const supabase = await createClient();

  /* -- The phone, normalised HERE and not in the browser.
        §10 requires E.164 with +91 as the default country, and `normaliseToE164`
        returns a structured reason rather than null so the message can say WHAT
        is wrong with the number (P11-12). A landline and a nine-digit typo need
        different fixes. -- */
  let phoneE164: string | null = null;
  if (input.phone) {
    const { normaliseToE164 } = await import("@/lib/notify/phone");
    const result = normaliseToE164(input.phone);
    if (!result.ok) {
      return { ok: false, error: `That mobile number is not usable: ${result.reason}` };
    }
    phoneE164 = result.e164;
  }

  /* -- The work number, through the same normaliser (0081) and refused with the
        same kind of sentence. Null clears it, which is what a person emptying
        the field means — and clearing it simply returns them to the personal
        pair rather than making them unreachable. -- */
  let workPhoneE164: string | null = null;
  if (input.work_phone) {
    const { normaliseToE164 } = await import("@/lib/notify/phone");
    const result = normaliseToE164(input.work_phone);
    if (!result.ok) {
      return { ok: false, error: `That official mobile number is not usable: ${result.reason}` };
    }
    workPhoneE164 = result.e164;
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      work_phone_e164: workPhoneE164,
      work_email: input.work_email ? input.work_email : null,
      full_name: input.full_name,
      department_id: input.department_id ? input.department_id : null,
      employee_code: input.employee_code ? input.employee_code : null,
      track: input.track === "WORKER" ? "WORKER" : "STAFF",
      /* -- A PRODUCTION WORKER'S PROFILE CARRIES NO ADDRESS (0071).

            They never sign in — their supervisor fills the sheet (WORKER-1) —
            so the address is not a contact route, not a credential and not an
            identifier. `profiles.id` still references `auth.users(id)`, and
            every RLS policy compares `auth.uid()` against it, so the IDENTITY
            still needs one; it gets a derived internal address on a `.invalid`
            domain that nothing can deliver to. This column deliberately does
            not repeat it.

            Only where none was given. A worker who DOES have a real address
            keeps it — the rule is that one is not required, not that one is
            refused. -- */
      email: input.track === "WORKER" && !input.email_supplied ? null : undefined,
      phone_e164: phoneE164,
      designation: input.designation ? input.designation : null,
      reports_to: input.reports_to ? input.reports_to : null,
      co_reviewer_id: input.co_reviewer_id ? input.co_reviewer_id : null,
      // 0024: the ONE joining date. `employment_records` no longer has a copy.
      date_of_joining: input.date_of_joining ? input.date_of_joining : null,
      is_active: true,
    })
    .eq("id", profileId);

  if (profileError) {
    return {
      ok: false,
      error:
        /duplicate|unique/i.test(profileError.message)
          ? "That employee code is already used by somebody else."
          : "The account was created but their details could not be saved. Open Team review and complete the record.",
    };
  }

  /* -- SEVERAL RISES, NOT ONE. A sheet carrying "Increment Amt 2025" and
        "Increment Amt 2026" describes a LEDGER — joining, then 2025, then 2026
        — and one `last_increment_*` pair could only ever record the newest of
        them. The rest were lost, and a percentage computed against a salary two
        rises old is wrong in a way nobody can see afterwards.

        ONE LIST, TWO WAYS TO WRITE INTO IT. `last_increment_date` /
        `last_increment_amount` is folded in as simply another entry, so a file
        that uses only those behaves exactly as it always did, and a file that
        uses both gets the union rather than one silently ignoring the other.
        A numbered entry wins a shared date, because it is the more specific
        statement.

        BUILT HERE, BEFORE THE EMPLOYMENT RECORD, because the record's
        `last_increment_date` is derived from it — see below. -- */
  const ledger = buildLedger(input);

  /* -- THE CLOCK COMES FROM THE NEWEST RISE, whichever column carried it.
        0068 made the pay ledger authoritative for `last_increment_date` — "once
        there is a recorded rise, that is when they were last given one" — and
        this is the same rule at the point of import.

        Without it, filling in only the numbered pairs and leaving
        `last_increment_date` blank would write the history correctly and leave
        the employment record with NO last increment date, so the increment
        calendar would not know when the next one falls due. HR would have
        entered everything and been silently dropped from the schedule. -- */
  const lastIncrementOn = newestRise(input);

  /* -- WHEN TODAY'S SALARY TOOK EFFECT, which is a different question.
        `last_increment_date` answers "when were they last given a rise" and is
        null for somebody who has never had one. `salary_effective_from` answers
        "since when have they been on this figure" — and for a new joiner that
        is the day they joined, not nothing.

        The import never wrote it at all, so Current pay rendered an em dash for
        every person it created. Only `apply_salary_to_record` (0068) set it,
        and that runs on the Add-salary-change path alone.

        It also decides whether a later CORRECTION is treated as fixing the past
        or as moving today's pay (P19-9), so leaving it null made every imported
        person's first correction unconditionally overwrite their current
        salary. -- */
  const salaryEffectiveFrom = lastIncrementOn ?? input.date_of_joining ?? null;

  /* -- The employment record, when there is anything to put in it.
        Created here rather than on a second screen: the increment reminder is
        derived from these dates, and a person created without them is a person
        nobody is reminded about. -- */
  const hasEmployment =
    Boolean(input.date_of_joining) ||
    input.joining_ctc !== undefined ||
    input.current_ctc !== undefined;

  if (hasEmployment) {
    const { error: employmentError } = await supabase.from("employment_records").insert({
      profile_id: profileId,
      last_increment_date: lastIncrementOn,
      salary_effective_from: salaryEffectiveFrom,
      increment_frequency_months: input.increment_frequency_months,
      employment_type: input.employment_type,
      // The figure on the record is what they are paid TODAY. If HR gave only a
      // joining salary, that is still today's salary.
      /* -- Somebody joining on ₹1,80,000 with no rise yet IS on ₹1,80,000, so
            leaving `current_ctc` blank would be false. The two columns start
            equal and diverge at the first revision, which is the only thing
            that moves `current_ctc` afterwards. -- */
      current_ctc: input.current_ctc ?? input.joining_ctc ?? null,
      joining_ctc: input.joining_ctc ?? null,
    });

    if (employmentError) {
      // Not fatal: the account and the profile are real and usable. Naming the
      // gap beats rolling back a working account over a date.
      return {
        ok: false,
        error:
          "The account was created, but their employment dates were not saved. Open their Employment tab and add them.",
      };
    }
  }

  /* -- Opening pay history.
        This is what answers P19B-7's objection to collecting salary here. The
        figures do not just sit on the record as a number with no provenance —
        they compose the same `salary_history` rows the Employment tab would
        have written, so the append-only history is right from the first save
        rather than starting empty and being back-filled from memory later.

        Two rows at most, and only where the dates make them true:
          JOINING           the joining salary, effective their joining date
          ANNUAL_INCREMENT  the current salary, effective their last increment

        `previous_ctc` and the hike are DERIVED, never accepted (P19-7): a caller
        that could send its own previous figure could write a history that
        disagrees with the record it came from, and this table's only job is to
        be evidence. -- */
  const salaryRows = composeOpeningPay(
    profileId,
    input,
    ledger,
    actorProfileId,
    "Recorded when the account was created.",
  );

  if (salaryRows.length > 0) {
    const { error: salaryError } = await supabase.from("salary_history").insert(salaryRows);
    if (salaryError) {
      return {
        ok: false,
        error:
          "The account was created, but their pay history was not saved. Open their Employment tab and add it.",
      };
    }
  }

  const { error: rolesError } = await supabase.from("user_roles").upsert(
    roles.map((role) => ({ profile_id: profileId, role })),
    // DO NOTHING, not DO UPDATE. A grant is (profile_id, role) and nothing
    // else, so there is no column an update could set — and the trigger has
    // already granted EMPLOYEE, so a conflict on that row is the normal case
    // rather than an error.
    { onConflict: "profile_id,role", ignoreDuplicates: true },
  );

  if (rolesError) {
    // §0.7: fail loudly. This used to swallow the database's message entirely,
    // which is why an invalid enum value looked like an unexplained refusal —
    // the sentence named the symptom and nothing that would let anybody find
    // the cause.
    return {
      ok: false,
      error: `The account was created but the access level was not applied (${rolesError.message}). Set it from the row menu.`,
    };
  }

  // §12: every role change is audited. Written through the service client
  // because the audit insert policy admits only the transition function — see
  // the P5 note; this is the second gated path it anticipated.
  // NO SALARY FIGURE IN THE DIFF (P19-10). §12 wants the change recorded and §5
  // forbids the figure leaving HR and the MD — and 0013 lets a lead read
  // audit_log for their own reports, so a CTC here would walk straight past the
  // confinement invariant. `salary_recorded` says a figure exists without
  // saying what it is.
  await admin.from("audit_log").insert({
    actor_id: actorProfileId,
    entity: "profile",
    entity_id: profileId,
    action: "profile.created",
    diff: {
      after: {
        full_name: input.full_name,
        email: input.email,
        department_id: input.department_id || null,
        roles,
        salary_recorded: salaryRows.length > 0,
      },
    },
  });

  return { ok: true, profileId };
}

/** Deactivate or reactivate. §17 and §12: people are switched off, never deleted. */
export async function setUserActive(
  _prev: ProvisionState,
  formData: FormData,
): Promise<ProvisionState> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { error: auth.error.message };

  const profileId = String(formData.get("profile_id") ?? "");
  const active = String(formData.get("is_active") ?? "") === "true";

  if (!profileId) return { error: "No person was selected." };
  if (profileId === auth.session.profile.id) {
    // Locking the last admin out of their own system is a support call nobody
    // enjoys, and the database cannot undo it for them.
    return { error: "You cannot deactivate your own account." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ is_active: active })
    .eq("id", profileId);

  if (error) return { error: "Could not update that account." };

  await createServiceClient()
    .from("audit_log")
    .insert({
      actor_id: auth.session.profile.id,
      entity: "profile",
      entity_id: profileId,
      action: active ? "profile.reactivated" : "profile.deactivated",
    });

  revalidatePath("/admin/settings");
  return { ok: true, message: active ? "Account reactivated." : "Account deactivated." };
}

/* ---------- Edit ---------- */

/**
 * Amend somebody's details — now everything the add form asks for.
 *
 * It used to stop at the profile, on the reasoning that the email, the password
 * and the salary each belong somewhere else. Two of those three turned out to
 * belong NOWHERE: there is no password-reset flow anywhere in this product and
 * no way to correct a mistyped address, so a typo at creation could only be
 * fixed in the Supabase dashboard. That is not a deliberate omission, it is a
 * hole, and it is closed here.
 *
 * Three blocks are added, and each is INERT unless it was filled in:
 *
 *   email          only acts when it differs from the current one
 *   new_password   only acts when non-empty; blank keeps their current one
 *   new_ctc        only acts when a figure is typed, and then requires an
 *                  effective date, a reason and a note
 *
 * `warnings` rather than early returns for these three: the profile is already
 * saved and correct by the time they run, and discarding good edits because a
 * provider rejected an email address is the P19B-8 mistake. What failed is named
 * and the dialog stays open.
 */
export async function updatePerson(
  _prev: ProvisionState,
  formData: FormData,
): Promise<ProvisionState> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { error: auth.error.message };

  const profileId = String(formData.get("profile_id") ?? "").trim();
  if (!profileId) return { error: "No person was selected." };

  const fullName = String(formData.get("full_name") ?? "").trim();
  if (fullName.length < 2) {
    return { error: "Check the highlighted fields.", fieldErrors: { full_name: "Enter their name" } };
  }

  const departmentId = String(formData.get("department_id") ?? "").trim();
  const reportsTo = String(formData.get("reports_to") ?? "").trim();
  const coReviewer = String(formData.get("co_reviewer_id") ?? "").trim();

  // Their own lead is a cycle nobody can resolve, and P10-7's self-led case is
  // already a hard block at launch — refused here so it never reaches one.
  if (reportsTo && reportsTo === profileId) {
    return {
      error: "Somebody cannot report to themselves.",
      fieldErrors: { reports_to: "Choose a different person" },
    };
  }

  /* -- A SECOND reviewer (0083), refused where it would not be a SECOND
        opinion. Both refusals are the same rule from different sides: rating
        yourself is not a second opinion, and it would hand one person both
        sides of a blind pair (§5); the same person as their manager is one
        opinion recorded twice, on two forms.

        0083's CHECK constraint and 0084's launch both refuse these too. Three
        places deliberately: the constraint is the backstop, the launch is what
        actually decides, and this is the only one that can say WHY at the
        moment somebody is choosing (§13.4). Without it the launch would simply
        ignore a second reviewer HR had carefully set, with nothing on screen
        to explain the silence. -- */
  if (coReviewer && coReviewer === profileId) {
    return {
      error: "Somebody cannot be their own second reviewer.",
      fieldErrors: { co_reviewer_id: "Choose a different person" },
    };
  }
  if (coReviewer && coReviewer === reportsTo) {
    return {
      error: "The second reviewer has to be somebody other than their manager.",
      fieldErrors: {
        co_reviewer_id: "Their manager already rates them — choose a different person",
      },
    };
  }

  /* -- THE SAME CONTACT RULE THE CREATE PATH HAS, restated because this
        function validates by hand rather than through `createUserSchema`.

        Without it the rule would be cosmetic: somebody could be created with a
        number and then have it cleared on the very next screen. Two copies is
        the cost of two validation styles, and they are asserted to carry the
        same sentence so a change to one that misses the other is caught.

        Production Team are exempt here for the reason the schema gives: no
        template addresses a worker, so a number is something they would never
        be written to on. -- */
  const track: "STAFF" | "WORKER" =
    String(formData.get("track") ?? "STAFF") === "WORKER" ? "WORKER" : "STAFF";

  // §10 wants E.164 with +91 as the default, and the normaliser says WHAT is
  // wrong rather than returning null (P11-12).
  let phoneE164: string | null = null;
  const phone = String(formData.get("phone") ?? "").trim();
  if (!phone && track === "STAFF") {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { phone: "Enter a mobile number — this is where their form link is sent" },
    };
  }
  if (phone) {
    const { normaliseToE164 } = await import("@/lib/notify/phone");
    const result = normaliseToE164(phone);
    if (!result.ok) {
      return {
        error: `That mobile number is not usable: ${result.reason}`,
        fieldErrors: { phone: result.reason },
      };
    }
    phoneE164 = result.e164;
  }

  const supabase = await createClient();

  /* -- THE OFFICIAL PAIR WAS POSTED AND NEVER READ (0081).
        The create path took `work_email` and `work_phone` off the form; this
        one did not, so HR typed both, pressed Save, everything else was
        written, and the two columns stayed null — which reads as "it saved and
        then vanished", because that is exactly what happened.

        Same normaliser and the same refusal wording as the personal number, so
        a landline or a nine-digit typo is named rather than stored. -- */
  const workPhone = String(formData.get("work_phone") ?? "").trim();
  let workPhoneE164: string | null = null;
  if (workPhone) {
    const { normaliseToE164 } = await import("@/lib/notify/phone");
    const result = normaliseToE164(workPhone);
    if (!result.ok) {
      return { error: `That official mobile number is not usable: ${result.reason}` };
    }
    workPhoneE164 = result.e164;
  }

  const workEmail = String(formData.get("work_email") ?? "").trim();
  if (workEmail) {
    const parsedWorkEmail = emailSchema.safeParse(workEmail);
    if (!parsedWorkEmail.success) {
      return {
        error: "Check the highlighted fields.",
        fieldErrors: {
          work_email: parsedWorkEmail.error.issues[0]?.message ?? "Enter a valid email address",
        },
      };
    }
  }

  const { data: before } = await supabase
    .from("profiles")
    .select(
      "full_name, employee_code, designation, department_id, reports_to, co_reviewer_id, date_of_joining, phone_e164, work_email, work_phone_e164",
    )
    .eq("id", profileId)
    .maybeSingle();

  const after = {
    full_name: fullName,
    employee_code: String(formData.get("employee_code") ?? "").trim() || null,
    // Derived once, above, because the contact rule reads it too.
    track,
    designation: String(formData.get("designation") ?? "").trim() || null,
    department_id: departmentId || null,
    reports_to: reportsTo || null,
    co_reviewer_id: coReviewer || null,
    date_of_joining: String(formData.get("date_of_joining") ?? "").trim() || null,
    phone_e164: phoneE164,
    // Null clears the pair, which is what emptying the field means: they fall
    // back to the personal details rather than becoming unreachable (0081).
    work_email: workEmail || null,
    work_phone_e164: workPhoneE164,
  };

  /* -- `.select()` so a refused write REPORTS itself. A PostgREST update that
        matches no row succeeds with zero rows, which is how a save says
        "Saved" over something it never stored — the class §18 has now recorded
        eight times (FIX-14, F15-14, F22-5, 0066, 0069). -- */
  const { data: updated, error } = await supabase
    .from("profiles")
    .update(after)
    .eq("id", profileId)
    .select("id");

  if (!error && (updated?.length ?? 0) === 0) {
    return { error: "Those details were not saved — this account may not be yours to edit." };
  }

  if (error) {
    return {
      error: /duplicate|unique/i.test(error.message)
        ? "That employee code is already used by somebody else."
        : "Could not save those details.",
    };
  }

  /* -- Everything from here is a separate act on a record that is already
        saved. A failure names itself instead of throwing away the edits above. */
  const warnings: string[] = [];

  /* ---------- Sign-in credentials ----------

     ON THE SERVICE-ROLE KEY. §0.5 permits it for "the single Admin API call
     that creates an auth user", and this is a second call — so this WIDENS that
     permission from creating an account to creating **or amending** one. The
     justification is P8-2's, word for word: there is no other way. `auth.users`
     is not reachable through PostgREST at all, so no RLS policy could grant
     this and none should. Everything else about the person still goes through
     the authenticated client above, so RLS still decides it.

     Recorded here rather than absorbed silently — CLAUDE.md §0.5 needs the
     amendment, and §0.2 means that is the owner's call, not mine. */
  const emailInput = String(formData.get("email") ?? "").trim();
  const passwordInput = String(formData.get("new_password") ?? "");

  if (emailInput || passwordInput) {
    // Read separately rather than widening the `before` select: `after` is the
    // UPDATE payload as well as the diff, and an email in it would write the
    // new address before the auth account had accepted it.
    const { data: account } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", profileId)
      .maybeSingle();
    const currentEmail = (account?.email ?? "").toLowerCase();

    const credentials: { email?: string; password?: string; email_confirm?: boolean } = {};

    if (emailInput && emailInput.toLowerCase() !== currentEmail) {
      const parsed = emailSchema.safeParse(emailInput);
      if (!parsed.success) {
        return {
          error: "Check the highlighted fields.",
          fieldErrors: { email: parsed.error.issues[0]?.message ?? "Enter a valid email address" },
        };
      }
      credentials.email = parsed.data;
      /* Confirmed outright. Supabase's default is to email a confirmation link
         and leave the old address live until it is followed — but §10 sends
         every invite to `profiles.email`, and an address that is half-changed
         is exactly the split identity this block exists to prevent. HR is
         making the change deliberately, from a screen only HR can reach. */
      credentials.email_confirm = true;
    }

    if (passwordInput) {
      const parsed = newPasswordSchema.safeParse(passwordInput);
      if (!parsed.success) {
        return {
          error: "Check the highlighted fields.",
          fieldErrors: {
            new_password:
              parsed.error.issues[0]?.message ?? `Use at least ${MIN_PASSWORD_LENGTH} characters`,
          },
        };
      }
      credentials.password = parsed.data;
    }

    if (credentials.email || credentials.password) {
      const { error: authError } = await createServiceClient().auth.admin.updateUserById(
        profileId,
        credentials,
      );

      if (authError) {
        /* -- The same provider floor the create path hits, on the path where a
              password is CHANGED. Without this the message is GoTrue's own
              "at least 6 characters", which reads as a contradiction of the
              hint beside the field that had just accepted it. -- */
        const tooShort = passwordTooShortForProvider(authError.message);
        warnings.push(
          /registered|already|duplicate|exists/i.test(authError.message)
            ? "their sign-in details — somebody already uses that email address"
            : `their sign-in details — ${tooShort ?? authError.message}`,
        );
      } else {
        if (credentials.email) {
          /* `profiles.email` MIRRORS `auth.users`, and the mirror is not
             cosmetic: they sign in against auth.users and every notification is
             addressed from profiles. Leaving one behind means mail goes to an
             address they no longer have, and nothing on any screen would say
             so. */
          const { error: mirrorError } = await supabase
            .from("profiles")
            .update({ email: credentials.email })
            .eq("id", profileId);

          if (mirrorError) {
            warnings.push(
              "the email on their record — they sign in with the new address, but the record still shows the old one",
            );
          }
        }

        /* §12. A credential change is its own event, so it gets its own row
           rather than being folded into the details diff.

           THE PASSWORD IS NEVER IN IT — not the value, not a hash, not a
           length. `password_reset: true` is the whole fact worth recording, and
           0013 lets a lead read audit_log for their own reports. */
        await createServiceClient().from("audit_log").insert({
          actor_id: auth.session.profile.id,
          entity: "profile",
          entity_id: profileId,
          action: "profile.credentials_changed",
          diff: {
            before: { email: account?.email ?? null },
            after: {
              email: credentials.email ?? account?.email ?? null,
              password_reset: Boolean(credentials.password),
            },
          } as Json,
        });
      }
    }
  }

  /* -- The employment block.
        Type, last increment and frequency are ordinary personnel data and are
        editable here, so this form matches the one that creates somebody.

        `next_increment_date` is untouched: 0023's trigger derives it from these
        three, and a second implementation would drift from the reminder. -- */
  const employmentType = String(formData.get("employment_type") ?? "").trim();
  const lastIncrement = String(formData.get("last_increment_date") ?? "").trim();
  const frequency = Number(formData.get("increment_frequency_months") ?? 12);

  if (employmentType) {
    const { error: employmentError } = await supabase.from("employment_records").upsert(
      {
        profile_id: profileId,
        employment_type: employmentType,
        last_increment_date: lastIncrement || null,
        increment_frequency_months: Number.isFinite(frequency) && frequency > 0 ? frequency : 12,
      },
      { onConflict: "profile_id" },
    );

    if (employmentError) {
      // Not fatal: the profile is saved and correct. Naming the gap beats
      // discarding good edits over a date (P19B-8).
      return {
        error: "Their details were saved, but the employment dates were not. Open Employment & pay and set them.",
      };
    }
  }

  /* ---------- Compensation ----------

     A pay change, IF one was typed. Blank means "not changing it", never
     "set it to nothing" — the same rule the bulk import follows (P19D-4).

     DELEGATED, never reimplemented. `addSalaryChange` already computes the
     previous figure, the hike and the percentage from the record rather than
     accepting them from the caller (P19-7), appends to `salary_history` before
     it moves `current_ctc`, refuses to let a backdated CORRECTION overwrite a
     later figure (P19-9), and audits with no amount in the diff (P19-10). A
     second write path here would be a second definition of what a pay change
     is, and the two would disagree on the path nobody is watching (PC-1).

     It runs AFTER the employment upsert on purpose: it refuses outright when
     there is no `employment_records` row, and the block above is what creates
     one for somebody who has never had employment details set. */
  const newCtc = String(formData.get("new_ctc") ?? "").replace(/[₹,\s]/g, "").trim();
  if (newCtc) {
    const salary = await addSalaryChange({
      profileId,
      newCtc,
      effectiveFrom: String(formData.get("salary_effective_from") ?? "").trim(),
      // Validated by `addSalaryChange`'s own enum, not trusted here. The cast
      // is derived from that function's parameter so the two cannot drift.
      reason: String(
        formData.get("salary_reason") ?? "",
      ) as Parameters<typeof addSalaryChange>[0]["reason"],
      note: String(formData.get("salary_note") ?? "").trim(),
    });

    if (!salary.ok) warnings.push(`the pay change — ${salary.error.message}`);
  }

  /* -- Access levels. DIFFED, not replaced wholesale.
        ⚠ THE WHOLESALE VERSION LOCKED HR OUT OF THEIR OWN ACCOUNT.

        It ran `delete … where role <> 'EMPLOYEE'` and then re-inserted the
        desired set. Those are two separate PostgREST requests, and
        `user_roles_hr_all` gates both on `is_admin()`, which reads `user_roles`
        for `auth.uid()`. So when HR edited THEMSELVES:

          1. the delete removed their own HR_ADMIN row — permitted, because it
             was still there when the statement began;
          2. the re-insert arrived as a new request, `is_admin()` was now false,
             and RLS refused it;
          3. neither call checked its error, so it failed in silence.

        Editing your own phone number demoted you to EMPLOYEE. P8P-6's
        replace-wholesale reasoning is right for department mappings — nothing
        there can revoke the permission doing the writing — and wrong here.

        Diffing also means the common case, an edit that does not touch access
        at all, issues NO write to this table and cannot fail. EMPLOYEE is never
        touched: there is no user of this system who does not fill in their own
        appraisal (P8-3). -- */
  const desired = new Set<string>([
    "EMPLOYEE",
    ...formData.getAll("roles").map(String).filter(Boolean),
  ]);

  const { data: currentRoleRows, error: rolesReadError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("profile_id", profileId);

  if (rolesReadError) {
    warnings.push(`the access level — ${rolesReadError.message}`);
  } else {
    const current = new Set((currentRoleRows ?? []).map((r) => String(r.role)));
    const toAdd = [...desired].filter((r) => r !== "EMPLOYEE" && !current.has(r));
    let toRemove = [...current].filter((r) => r !== "EMPLOYEE" && !desired.has(r));

    /* -- You cannot take your own admin access away.
          P8-4 already refuses self-deactivation, for the same reason: locking
          the last administrator out is a support call the database cannot
          undo, and here it would happen by ticking a box. The rest of the
          edit still saves — the details are correct and re-typing them would
          be the wrong next move. -- */
    const isSelf = profileId === auth.session.profile.id;
    const selfDemotion = isSelf && toRemove.filter((r) => r === "HR_ADMIN" || r === "MD");
    if (selfDemotion && selfDemotion.length > 0) {
      toRemove = toRemove.filter((r) => r !== "HR_ADMIN" && r !== "MD");
      warnings.push(
        "your own administrator access was left unchanged — ask another administrator to change it",
      );
    }

    // Added BEFORE anything is removed, so a partial failure leaves more
    // access rather than less.
    if (toAdd.length > 0) {
      const { error } = await supabase
        .from("user_roles")
        .upsert(
          toAdd.map((role) => ({ profile_id: profileId, role: role as AppRole })),
          { onConflict: "profile_id,role", ignoreDuplicates: true },
        );
      if (error) warnings.push(`the access level — ${error.message}`);
    }

    if (toRemove.length > 0) {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("profile_id", profileId)
        // Every member came out of `user_roles.role`, so it is an app_role by
        // construction; the Set widened it to string on the way through.
        .in("role", toRemove as AppRole[]);
      if (error) warnings.push(`the access level — ${error.message}`);
    }
  }

  const roles = desired;

  // §12. No salary field passes through this action, so no figure can reach a
  // diff — 0013 lets a lead read audit_log for their own reports (P19-10).
  await createServiceClient().from("audit_log").insert({
    actor_id: auth.session.profile.id,
    entity: "profile",
    entity_id: profileId,
    action: "profile.updated",
    diff: { before: before ?? null, after, roles: [...roles] } as Json,
  });

  revalidatePath("/admin/settings");
  revalidatePath("/admin/people");
  // The pay change moves figures the increment calendar reads.
  revalidatePath("/admin/increments");

  /* -- Something optional failed, and the dialog stays open saying which.
        Not `ok`, because the person's record is not in the state HR asked for;
        not a bare failure either, because the details above genuinely saved and
        re-typing them would be the wrong next move. -- */
  if (warnings.length > 0) {
    return {
      error: `${fullName}'s details were saved, but ${warnings.join("; and ")}. Nothing else was lost — fix that one field and save again.`,
    };
  }

  return { ok: true, createdId: profileId, message: `${fullName}'s details were saved.` };
}

/**
 * Whether the provider refused a password for being too short, and what to do.
 *
 * OUR FLOOR IS FOUR AND SUPABASE'S IS ITS OWN — six unless the project says
 * otherwise. Lowering ours does not lower theirs, so a five-character password
 * now passes the form and can still be refused at the account. GoTrue answers
 * "Password should be at least 6 characters", which is true, unactionable from
 * inside this app, and reads as a bug in the form that had just accepted it.
 *
 * Named separately from every other auth failure because the fix is a SETTING
 * rather than a retry (§0.7, §13.4).
 */
function passwordTooShortForProvider(message: string | undefined): string | null {
  if (!message) return null;
  if (!/password/i.test(message)) return null;
  if (!/at least|too short|minimum|length/i.test(message)) return null;
  return (
    `${message.replace(/\.$/, "")}. That limit is Supabase's, not this app's — ` +
    "raise the password or lower it in the Supabase dashboard under " +
    "Authentication → Sign In / Providers → Minimum password length."
  );
}

/* ---------- Delete ---------- */

/**
 * WHY DELETING SOMEBODY USUALLY REFUSES, AND WHAT REFUSES IT.
 *
 * §17 AND §12 BOTH SAY PEOPLE ARE SWITCHED OFF, NOT ERASED, AND THAT STANDS.
 *
 * P4-5 recorded the consequence years before any of this existed:
 * `audit_log.actor_id` has no ON DELETE clause, so once somebody has acted
 * their profile cannot be removed — Postgres refuses it. The same holds for an
 * evaluation they are the subject or the lead of, a production appraisal, a pay
 * row, and anybody who reports to them.
 *
 * So this is not "delete a person". It is "undo a person who was created by
 * mistake and has done nothing yet", which is the only case the database will
 * permit and the only one §17 does not forbid. Everything else is deactivation,
 * and the message says so rather than failing with a constraint violation.
 *
 * ONE IMPLEMENTATION, shared by the single delete and the bulk one. Two copies
 * would eventually disagree about what counts as "has done nothing", and the
 * disagreement would show up as one screen refusing what the other allowed.
 */
type PersonBlockers = {
  asEvaluatee: number;
  asLead: number;
  asWorker: number;
  asRater: number;
  pay: number;
  reports: number;
  acted: number;
};

const EMPTY_BLOCKERS: PersonBlockers = {
  asEvaluatee: 0,
  asLead: 0,
  asWorker: 0,
  asRater: 0,
  pay: 0,
  reports: 0,
  acted: 0,
};

/**
 * Named separately, never totalled.
 *
 * "2 evaluations and a pay history" tells HR which thing to look at, where "4
 * references" does not — and the people reporting to them in particular have a
 * fix nobody would guess from a bare count: move them to another manager first.
 */
function describeBlockers(counts: PersonBlockers): string[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const out: string[] = [];
  if (counts.asEvaluatee > 0)
    out.push(plural(counts.asEvaluatee, "evaluation of them", "evaluations of them"));
  if (counts.asLead > 0) out.push(plural(counts.asLead, "evaluation they rate", "evaluations they rate"));
  if (counts.asWorker > 0)
    out.push(plural(counts.asWorker, "production appraisal of them", "production appraisals of them"));
  if (counts.asRater > 0)
    out.push(
      plural(counts.asRater, "production appraisal they rate", "production appraisals they rate"),
    );
  if (counts.pay > 0) out.push("pay history");
  if (counts.reports > 0) out.push(`${plural(counts.reports, "person", "people")} reporting to them`);
  if (counts.acted > 0) out.push("a recorded history of actions");
  return out;
}

/** Anything else is not a uuid and has no business being interpolated into a filter. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Run `work` over `items`, `size` at a time. */
async function inBatches<T>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(work));
  }
}

/**
 * What still depends on each of these people.
 *
 * FOUR QUERIES FOR THE WHOLE BATCH, not four per person: "delete all" over a
 * roster of fifty would otherwise be two hundred round trips, which is a server
 * action that times out rather than one that answers.
 *
 * `audit_log` is the exception and is counted per person — it is the one table
 * here that can hold thousands of rows for a single administrator, so reading
 * its rows back to group them in TypeScript would pull the whole trail across
 * the wire. It is also asked LAST, of the people nothing else has ruled out
 * already, so the expensive check runs on the smallest set.
 */
async function blockersFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<Map<string, PersonBlockers>> {
  const clean = [...new Set(ids)].filter((id) => UUID_SHAPE.test(id));
  const found = new Map<string, PersonBlockers>(clean.map((id) => [id, { ...EMPTY_BLOCKERS }]));
  if (clean.length === 0) return found;

  /* -- Only ever counts against somebody who was ASKED about. An `or` filter
        returns a row when EITHER side matches, so the other side's id belongs
        to somebody this batch is not deleting — counting it would refuse a
        person for a reason that is not theirs. -- */
  const bump = (id: string | null | undefined, key: keyof PersonBlockers) => {
    if (!id) return;
    const row = found.get(id);
    if (row) row[key] += 1;
  };

  const list = clean.join(",");

  const [evaluations, workers, pay, reports] = await Promise.all([
    supabase
      .from("evaluations")
      .select("evaluatee_id, lead_id")
      .or(`evaluatee_id.in.(${list}),lead_id.in.(${list})`),
    supabase
      .from("worker_evaluations")
      .select("worker_id, supervisor_id")
      .or(`worker_id.in.(${list}),supervisor_id.in.(${list})`),
    supabase.from("salary_history").select("profile_id").in("profile_id", clean),
    /* -- The org chart is one table (§7's shared infrastructure), and 0001's
          self-FK means a manager cannot be removed while anybody still points
          at them. This is the commonest real refusal and the one the old
          message could not name — it fell through to "Could not delete that
          account", which sends somebody to me rather than to the fix. -- */
    supabase.from("profiles").select("reports_to").in("reports_to", clean),
  ]);

  for (const row of evaluations.data ?? []) {
    bump(row.evaluatee_id, "asEvaluatee");
    bump(row.lead_id, "asLead");
  }
  for (const row of workers.data ?? []) {
    bump(row.worker_id, "asWorker");
    bump(row.supervisor_id, "asRater");
  }
  for (const row of pay.data ?? []) bump(row.profile_id, "pay");
  for (const row of reports.data ?? []) bump(row.reports_to, "reports");

  const stillClear = clean.filter(
    (id) => describeBlockers(found.get(id) ?? EMPTY_BLOCKERS).length === 0,
  );

  /* -- head:true — the count is the whole answer, and reading the rows would
        pull every action they have ever taken. Bounded concurrency for the
        reason P15-5 bounded the print pack: fifty simultaneous requests do not
        fail cleanly, they queue inside the pooler and the screen hangs on the
        slowest. -- */
  await inBatches(stillClear, 8, async (id) => {
    const { count } = await supabase
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("actor_id", id);
    const row = found.get(id);
    if (row) row.acted = count ?? 0;
  });

  return found;
}

/**
 * Destroy one auth account, nothing having been found to depend on it. Returns
 * the reason it could not be, or null once it is gone.
 *
 * THE AUDIT ROW IS WRITTEN AFTER THE DELETE, NOT BEFORE.
 *
 * §12 wants the record and it has to carry what was destroyed, so the person is
 * read first — that half is unchanged. But writing the row before the attempt
 * means a refusal leaves `audit_log` asserting somebody was deleted while they
 * are still on the roster, and across a bulk run that is a trail nobody can
 * trust. `audit_log.entity_id` carries no foreign key (P3-2), so the row still
 * outlives the profile it describes.
 */
async function destroyAccount(
  actorId: string,
  person: { id: string; full_name: string; email: string | null },
): Promise<string | null> {
  /* -- The auth account is the root: `profiles` hangs off it with ON DELETE
        CASCADE (0001), so removing the account takes the profile and its role
        grants with it. Deleting the profile alone would leave an account that
        can still sign in and whose trigger would rebuild a bare profile on next
        login. -- */
  const { error } = await createServiceClient().auth.admin.deleteUser(person.id);

  if (error) {
    /* -- GoTrue answers "Database error deleting user" and nothing more, so
          WHICH constraint refused is not knowable from here. The message says
          what is true and what to do instead, rather than a phrase HR would
          have to interpret (§0.7, §13.4). -- */
    return "something in the system still refers to them — deactivate them instead";
  }

  await createServiceClient().from("audit_log").insert({
    actor_id: actorId,
    entity: "profile",
    entity_id: person.id,
    action: "profile.deleted",
    diff: { before: { full_name: person.full_name, email: person.email } } as Json,
  });

  return null;
}

/**
 * Delete somebody outright — but only somebody nothing depends on.
 *
 * The server counts what refers to them and names it; the dialog says so up
 * front rather than making HR click to discover a refusal.
 */
export async function deletePerson(
  _prev: ProvisionState,
  formData: FormData,
): Promise<ProvisionState> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { error: auth.error.message };

  const profileId = String(formData.get("profile_id") ?? "").trim();
  if (!profileId) return { error: "No person was selected." };
  if (profileId === auth.session.profile.id) {
    return { error: "You cannot delete your own account." };
  }

  const supabase = await createClient();

  const { data: person } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("id", profileId)
    .maybeSingle();

  if (!person) return { error: "That person no longer exists." };

  const blockers = describeBlockers(
    (await blockersFor(supabase, [profileId])).get(profileId) ?? EMPTY_BLOCKERS,
  );

  if (blockers.length > 0) {
    return {
      error:
        `${person.full_name} cannot be deleted — the system holds ${blockers.join(", ")}. ` +
        `Deactivate them instead: they stop being able to sign in and drop out of new cycles, and the record stays intact.`,
    };
  }

  const failure = await destroyAccount(auth.session.profile.id, person);
  if (failure) return { error: `${person.full_name} could not be deleted — ${failure}.` };

  revalidatePath("/admin/settings");
  revalidatePath("/admin/people");
  return { ok: true, message: `${person.full_name} was deleted.` };
}

export type DeletePeopleState = {
  ok?: boolean;
  error?: string;
  /** How many accounts were actually destroyed. */
  deleted?: number;
  /** Those that were refused, and the reason each was refused. */
  kept?: { id: string; name: string; reason: string }[];
  message?: string;
};

/**
 * Delete several accounts at once.
 *
 * THE SAME RULE AS THE SINGLE DELETE, APPLIED PERSON BY PERSON. A batch does
 * not relax §17: anybody the system still holds a record of is KEPT and named,
 * rather than the whole run failing because one of fifty has an evaluation.
 * FIX-5 drew this line for the question bank and it holds here — HR asked for
 * these to go, so the honest outcome is that the ones that can go do, and the
 * rest come back with the reason and the alternative.
 *
 * Never the caller's own account, whatever was ticked. P8-4 refuses
 * self-deactivation for the same reason — locking the last administrator out is
 * a support call the database cannot undo — and a select-all makes that one
 * careless press rather than a decision.
 */
export async function deletePeople(
  _prev: DeletePeopleState,
  formData: FormData,
): Promise<DeletePeopleState> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { error: auth.error.message };

  const ids = readProfileIds(formData);
  if (ids.length === 0) return { error: "Nobody was selected." };

  const supabase = await createClient();

  const { data: people, error: readError } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", ids);

  if (readError) return { error: "Could not read those people. Nothing was deleted." };
  if (!people || people.length === 0) return { error: "Those people no longer exist." };

  const kept: { id: string; name: string; reason: string }[] = [];

  const candidates = people.filter((person) => {
    if (person.id === auth.session.profile.id) {
      kept.push({
        id: person.id,
        name: person.full_name,
        reason: "this is your own account — deleting it would lock you out",
      });
      return false;
    }
    return true;
  });

  const blockers = await blockersFor(
    supabase,
    candidates.map((person) => person.id),
  );

  const deletable = candidates.filter((person) => {
    const reasons = describeBlockers(blockers.get(person.id) ?? EMPTY_BLOCKERS);
    if (reasons.length === 0) return true;
    kept.push({
      id: person.id,
      name: person.full_name,
      reason: `the system holds ${reasons.join(", ")} — deactivate them instead`,
    });
    return false;
  });

  let deleted = 0;

  /* -- Six at a time. Each delete is an Admin API call rather than a database
        write, so this is NOT one transaction and does not pretend to be
        (P19C-9): every person's outcome is reported individually, and a partial
        run is recoverable by reading the result rather than by inspecting the
        database. -- */
  await inBatches(deletable, 6, async (person) => {
    const failure = await destroyAccount(auth.session.profile.id, person);
    if (failure) kept.push({ id: person.id, name: person.full_name, reason: failure });
    else deleted += 1;
  });

  revalidatePath("/admin/settings");
  revalidatePath("/admin/people");

  const accounts = (n: number) => `${n} ${n === 1 ? "account" : "accounts"}`;

  return {
    ok: true,
    deleted,
    kept: kept.sort((a, b) => a.name.localeCompare(b.name)),
    message:
      kept.length === 0
        ? `${accounts(deleted)} deleted.`
        : deleted === 0
          ? `Nothing was deleted. ${accounts(kept.length)} kept:`
          : `${accounts(deleted)} deleted, ${kept.length} kept:`,
  };
}

/**
 * Switch several accounts off — or back on.
 *
 * THIS IS WHAT §17 ACTUALLY OFFERS, so it belongs beside the bulk delete rather
 * than one dialog at a time. Almost everybody on a real roster is undeletable
 * by design: `audit_log` refuses DELETE for every caller including a superuser
 * (P4-4), so once somebody has acted their profile is permanent. Telling HR
 * "deactivate them instead" and then leaving them to do it fifty times is the
 * complaint that brought the bulk delete in, one step further along.
 *
 * Deactivation is reversible, which is why this one does not stop to confirm:
 * the same control switches them back on.
 */
export async function setPeopleActive(
  _prev: DeletePeopleState,
  formData: FormData,
): Promise<DeletePeopleState> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { error: auth.error.message };

  const active = String(formData.get("is_active") ?? "") === "true";
  const ids = readProfileIds(formData).filter((id) => id !== auth.session.profile.id);

  if (ids.length === 0) {
    return {
      error:
        readProfileIds(formData).length === 0
          ? "Nobody was selected."
          : "That is your own account — deactivating it would lock you out.",
    };
  }

  const supabase = await createClient();

  /* -- `.select()` IS THE DETECTION, not decoration. A PostgREST update that
        matches no row is a SUCCESS with zero rows, so without this the screen
        would report accounts switched off that RLS had refused — the silent
        write this log has now recorded eight times (FIX-14, F15-14, 0066,
        0069, F22-5). -- */
  const { data: changed, error } = await supabase
    .from("profiles")
    .update({ is_active: active })
    .in("id", ids)
    .select("id, full_name");

  if (error) return { error: "Could not update those accounts. Nothing was changed." };

  const done = changed ?? [];

  // §12: one row per person, never one carrying a list. Somebody asking why an
  // account is switched off should find a row about that account (P14-5).
  if (done.length > 0) {
    await createServiceClient()
      .from("audit_log")
      .insert(
        done.map((person) => ({
          actor_id: auth.session.profile.id,
          entity: "profile",
          entity_id: person.id,
          action: active ? "profile.reactivated" : "profile.deactivated",
        })),
      );
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/people");

  const missed = ids.length - done.length;
  const accounts = (n: number) => `${n} ${n === 1 ? "account" : "accounts"}`;

  return {
    ok: true,
    message: `${accounts(done.length)} ${active ? "reactivated" : "deactivated"}${
      missed > 0 ? `. ${missed} could not be changed` : ""
    }.`,
  };
}

/** The selection, as the dialog sends it. */
function readProfileIds(formData: FormData): string[] {
  try {
    const parsed: unknown = JSON.parse(String(formData.get("ids") ?? "[]"));
    return Array.isArray(parsed)
      ? [...new Set(parsed.map(String).filter((id) => UUID_SHAPE.test(id)))]
      : [];
  } catch {
    return [];
  }
}

/* ---------- Bulk import ---------- */

export type ImportRowResult = {
  line: number;
  name: string;
  ok: boolean;
  error?: string;
  /** True when this row amended somebody already on the system. */
  updated?: boolean;
  /**
   * Landed, but with something worth saying — currently only a manager that
   * could not be set because the file has people reporting to each other in a
   * circle. Deliberately not an error: the account is real and usable, and one
   * unresolved field should not fail a row (P19B-8's reasoning).
   */
  note?: string;
  /**
   * The password this account was CREATED with, so HR can hand it over.
   *
   * ONLY WAY THEY WILL EVER SEE IT. Supabase stores a bcrypt hash and nothing
   * else — there is no query, no screen and no admin call that returns a
   * password, here or anywhere. Once this run is off the screen the only route
   * back is to set a new one on the person's record.
   *
   * Absent on an update: the import ignores the password column for somebody
   * who already exists (F24-9), so reporting one would be reporting a change
   * that did not happen.
   *
   * Absent for a production worker: theirs is a long random string they never
   * use, because they do not sign in (WORKER-1). Printing it would be noise
   * beside the people who actually need one.
   */
  password?: string;
};

export type ImportState = {
  ran?: boolean;
  /** People this run AMENDED rather than created. */
  updated?: number;
  error?: string;
  created?: number;
  failed?: number;
  rows?: ImportRowResult[];
};

/**
 * Create many people from a CSV.
 *
 * Two rules shape this action.
 *
 * **Every row is validated before any row is created.** A file that is half
 * wrong should be fixed and re-uploaded, not left as fourteen accounts that
 * exist and six that do not — because the second attempt then fails on the
 * fourteen duplicates and HR has to work out by hand which is which.
 *
 * **It is not one transaction, and it does not pretend to be.** Creating an auth
 * user is an Admin API call, not a database write, so it cannot be rolled back
 * by anything here. The honest design is therefore a per-row report: every row
 * says whether it landed and why not, so a partial run is recoverable by reading
 * the screen rather than by inspecting the database.
 */
export async function importUsers(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { error: auth.error.message };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file first." };
  }
  // A generous ceiling that still refuses something pasted in by accident.
  if (file.size > 2_000_000) {
    return { error: "That file is larger than 2 MB. Split it and import in batches." };
  }

  const { records, missing } = toRecords(parseCsv(await file.text()));

  if (missing.length > 0) {
    return {
      error: `The file is missing a required column: ${missing.join(", ")}. Download the template and use its header row.`,
    };
  }
  if (records.length === 0) {
    return { error: "That file has a header row but no people in it." };
  }
  if (records.length > 500) {
    return { error: `That file has ${records.length} rows. Import 500 at a time.` };
  }

  const supabase = await createClient();

  // Departments by name AND by code, both lower-cased: HR exports from one
  // system and types into another, and being strict about which of the two a
  // column holds would reject a file that is entirely unambiguous.
  const { data: departments } = await supabase.from("departments").select("id, name, code");
  const departmentBy = new Map<string, string>();
  for (const d of departments ?? []) {
    departmentBy.set(d.name.trim().toLowerCase(), d.id);
    if (d.code) departmentBy.set(d.code.trim().toLowerCase(), d.id);
  }

  // Leads are named by email, which is the only identifier a spreadsheet
  // reliably carries and the only one that is unique.
  const { data: existing } = await supabase.from("profiles").select("id, email");
  /* -- Every address this FILE will create, so a manager three rows down can be
        found. Read before the rows are validated, because a row cannot know
        what is further down the file. -- */
  const emailsInThisFile = new Set(
    records.map((r) => normaliseEmailCell(r.email)).filter(Boolean),
  );

  const profileByEmail = new Map<string, string>();
  for (const p of existing ?? []) {
    if (p.email) profileByEmail.set(p.email.trim().toLowerCase(), p.id);
  }

  /* -- Pass 1: validate everything. -- */
  const prepared: Array<{
    line: number;
    name: string;
    input: CreateUserInput;
    /** Set only when their manager is another row in this file. */
    leadEmail?: string;
    /**
     * A field that could not be set, said in the report rather than failing the
     * row. Currently only a manager or a second reviewer named by an address
     * nobody has — the account is real and usable without either (P19B-8).
     */
    note?: string;
    /** The same, for a second reviewer (0083). Blank for almost everybody. */
    coEmail?: string;
    /** What a NEW account would be created with, so the run can report it. */
    shownPassword?: string;
  }> = [];
  const rows: ImportRowResult[] = [];

  records.forEach((record, index) => {
    const line = index + 2; // +1 for the header, +1 because people count from 1
    const name = record.full_name ?? "";

    const joining = toIsoDate(record.date_of_joining ?? "");
    const lastIncrement = toIsoDate(record.last_increment_date ?? "");
    if (joining === null || lastIncrement === null) {
      rows.push({ line, name, ok: false, error: "A date is not DD-MM-YYYY." });
      return;
    }

    const departmentText = (record.department ?? "").trim().toLowerCase();
    const departmentId = departmentText ? departmentBy.get(departmentText) : "";
    if (departmentText && !departmentId) {
      rows.push({ line, name, ok: false, error: `No department called "${record.department}".` });
      return;
    }

    /* -- A MANAGER MAY BE IN THE SAME FILE.
          The message used to say "import their manager first", which assumes a
          file of reports and a separate file of managers. What HR actually
          exports is the ORG CHART — one file where most people's manager is
          three rows above them — and that file could never import at all,
          because every `reports_to` was resolved against the database alone.

          So a manager is now looked for in the database first and in this
          file second, and the commit below creates people in dependency order.

          A NAME IN NEITHER IS A NOTE, NOT A REFUSAL, and that changed after it
          bit: an export naming two managers who were no longer on the system
          failed NINE rows, and because one bad row imports nothing (P19C-8) all
          fifty-one people were held back over nine cells. That is the wrong
          trade. P19B-8 settled the principle for the circular case already —
          the account is real and usable, and one unresolved field should not
          fail a row — and an unknown manager is the same shape: the person is
          created without one and the row says so, in the report HR is reading
          anyway. Nothing is silent; nothing is lost. -- */
    const leadEmail = normaliseEmailCell(record.reports_to);
    const leadId = leadEmail ? profileByEmail.get(leadEmail) : "";
    const leadIsInThisFile = Boolean(leadEmail) && !leadId && emailsInThisFile.has(leadEmail);
    const leadMissing = Boolean(leadEmail) && !leadId && !leadIsInThisFile;

    /* -- THE SECOND REVIEWER (0083), on exactly the same terms as the manager
          above: database first, this file second, and a name in neither is a
          note rather than a refusal. It is optional for almost everybody, which
          makes failing a whole file over one even harder to justify. -- */
    const coEmail = normaliseEmailCell(record.second_reviewer);
    const coId = coEmail ? profileByEmail.get(coEmail) : "";
    const coIsInThisFile = Boolean(coEmail) && !coId && emailsInThisFile.has(coEmail);
    const coMissing = Boolean(coEmail) && !coId && !coIsInThisFile;

    /* -- REFUSED WHERE IT WOULD NOT BE A SECOND OPINION. The same two rules the
          Settings dialog and 0084's launch both apply, said here at the moment
          somebody can still fix the spreadsheet. Without them a file would
          import cleanly and the launch would then ignore a second reviewer HR
          had carefully set, with nothing on screen to explain the silence. -- */
    /* -- Their OWN address, from the raw cell: the derived one is not built
          until further down, and a worker's is synthesised from their employee
          code in any case — which no second reviewer would ever be named by. -- */
    const ownEmail = normaliseEmailCell(record.email);
    if (coEmail && ownEmail && coEmail === ownEmail) {
      rows.push({
        line,
        name,
        ok: false,
        error: `${name} cannot be their own second reviewer. Leave the column blank, or name somebody else.`,
      });
      return;
    }
    if (coEmail && leadEmail && coEmail === leadEmail) {
      rows.push({
        line,
        name,
        ok: false,
        error: `The second reviewer has to be somebody other than their manager — this row names ${record.second_reviewer} for both. Their manager already rates them.`,
      });
      return;
    }

    /* -- WHICH MODULE, in plain words or in the enum.
          The screens say "Backend Team" and "Production Team" (TRACK_LABELS),
          so those are what somebody copies off one; STAFF and WORKER are
          accepted too because that is what the database calls them and a
          previous export carries them. Blank is STAFF, so a file written before
          this column existed imports exactly as it did. -- */
    const trackText = (record.track ?? "").trim().toLowerCase();
    const track =
      trackText === "" ? "STAFF"
      : /worker|production/.test(trackText) ? "WORKER"
      : /staff|backend/.test(trackText) ? "STAFF"
      : null;
    if (track === null) {
      rows.push({
        line, name, ok: false,
        error: `"${record.track}" is not a team. Use Backend Team or Production Team.`,
      });
      return;
    }

    /* -- A PRODUCTION WORKER NEED NOT HAVE AN EMAIL, and most do not.
          They never sign in — their supervisor rates them (WORKER-1) — but a
          profile still requires an auth account, which requires an address. So
          one is derived from the employee code: deterministic, so re-importing
          the same file finds the same person rather than making a second, and
          on a `.invalid` domain, which RFC 2606 reserves precisely so that
          nothing can ever be delivered to it. Nothing is ever sent there in any
          case — `deliver` skips a person with no phone and no real address.

          The code is REQUIRED in that case, because it is the only thing
          keeping one worker's account distinct from another's. -- */
    // A dash means "they have not got one" — see `normaliseEmailCell`.
    const emailText = normaliseEmailCell(record.email);
    const codeText = (record.employee_code ?? "").trim();
    let email = emailText;
    if (!email) {
      if (track !== "WORKER") {
        rows.push({
          line, name, ok: false,
          error: "An email is required for the Backend Team — they sign in with it.",
        });
        return;
      }
      if (!codeText) {
        rows.push({
          line, name, ok: false,
          error: "No email and no employee code. A production worker needs a code — it is what their record is keyed on.",
        });
        return;
      }
      email = `${codeText.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@production.linkdprints.invalid`;
    }

    /* -- A password nobody uses, for an account nobody signs into.
          Asking HR to invent one per worker is asking for twenty-five throwaway
          secrets to be typed into a spreadsheet, which is worse than generating
          one they never see. Long and random, because it still guards an
          account. -- */
    /* -- A BLANK PASSWORD COLUMN NOW MEANS `firstname123` FOR STAFF, at the
          owner's instruction — the same default the create form fills in, from
          the same function, so a person created either way gets the same
          password. HR was otherwise typing it once per row down a spreadsheet.

          A production worker still gets a long random one they never see: they
          do not sign in (WORKER-1), so a guessable password there would be
          exposure with no purpose. -- */
    const password =
      (record.password ?? "").trim() ||
      (track === "WORKER"
        ? `wk-${crypto.randomUUID()}${crypto.randomUUID()}`
        : defaultPasswordFor(record.full_name ?? ""));

    /* -- Reported back only for somebody who signs in. A worker's is random and
          unusable by design, and printing twenty-five of those would bury the
          handful HR has to read out. -- */
    const shownPassword = track === "WORKER" ? undefined : password;

    /* -- MONTHLY OR ANNUAL, and the database is annual (0061).
          A payroll sheet is usually monthly, and 32000 read as a year is ₹2,667
          a month — out by twelve on every percentage, report and printed sheet,
          and low enough to look plausible. Stating the unit once per row is what
          makes that impossible rather than careful. -- */
    /* -- BLANK MEANS MONTHLY, ON BOTH TRACKS, at the owner's instruction.
          F53-7 made it monthly for Production and annual for Backend, on the
          reasoning that a CTC is quoted per year as consistently as a wage is
          quoted per month. The owner's own payroll sheet states BOTH per month,
          so the split default was wrong about the file it exists to read — and
          a split default is also the harder one to hold in your head while
          filling twenty rows in.

          The DIRECTION of the remaining risk is what makes this safe. A monthly
          figure read as annual is out by twelve DOWNWARDS — ₹32,000 becomes
          ₹2,667 a month, which is low enough to look plausible on a screen and
          is the incident this column was added to prevent. The reverse, an
          annual figure read as monthly, is out by twelve UPWARDS — ₹4,80,000
          becomes ₹57.6 lakh a year, which nobody scrolls past. Defaulting to
          monthly puts the survivable mistake on the blank column.

          Either value is still accepted on either track. This decides only what
          a BLANK means. -- */
    /* -- AN UNRECOGNISED ACCESS LEVEL IS REFUSED, not dropped.
          `createUserSchema` filters `roles` against ROLE_VALUES, so a value it
          does not know simply vanished — and the template's own hint said
          "Manager", which is not one of them. Anybody following it imported as
          a plain employee, with no error anywhere: a HOD who cannot review
          their team, or a supervisor who never appears in a production round's
          rater picker, discovered weeks later when somebody goes looking for
          them. §0.7 — fail loudly.

          Split on anything that is not a letter or underscore, so "HOD
          HR_ADMIN", "HOD, HR_ADMIN" and "HOD/HR_ADMIN" all work. -- */
    const askedRoles = (record.roles ?? "")
      .split(/[^A-Za-z_]+/)
      .map((r) => r.trim().toUpperCase())
      .filter(Boolean);
    const unknownRole = askedRoles.find((r) => !IMPORTABLE_ROLES.has(r));
    if (unknownRole) {
      rows.push({
        line,
        name,
        ok: false,
        error: `"${unknownRole}" is not an access level. Use ${SUGGESTED_ROLES.join(", ")}, or leave it blank.`,
      });
      return;
    }

    /* -- EARLIER RISES: every `increment_N_date` / `increment_N_amount` pair.
          Read from the RECORD rather than from a fixed list of two, so a sheet
          carrying a third or fourth year is imported without this file
          changing. Sorted by date, not by N — the numbering is how a
          spreadsheet lays columns out, and nothing stops somebody putting 2026
          in the first pair. -- */
    const incrementPairs = new Map<string, { date?: string; amount?: string }>();
    for (const [header, value] of Object.entries(record)) {
      const match = INCREMENT_PAIR.exec(header);
      if (!match || value === "") continue;
      const [, n, field] = match;
      if (!n || !field) continue;
      const pair = incrementPairs.get(n) ?? {};
      if (field === "date") pair.date = value;
      else pair.amount = value;
      incrementPairs.set(n, pair);
    }

    const increments: Array<{ effective_from: string; amount: number }> = [];
    for (const [n, pair] of incrementPairs) {
      /* -- A DATE WITH NO AMOUNT IS NOT A RISE, so it is skipped rather than
            refused. A real export carries a row for every year whether or not
            anything was given — a joiner's first year, a year nobody was
            reviewed — and refusing those would mean deleting cells to describe
            something that did not happen. Nothing is recorded, which is the
            truth: there was no rise that year. -- */
      if (!pair.amount) continue;

      /* -- An AMOUNT with no date is still refused. It cannot be placed in the
            ledger at all, and guessing a date would put somebody's increment
            schedule months out with nothing on screen to show for it. -- */
      if (!pair.date) {
        rows.push({
          line, name, ok: false,
          error: `increment_${n}_amount has no date beside it. Fill in increment_${n}_date, or clear the amount.`,
        });
        return;
      }
      const when = toIsoDate(pair.date);
      if (!when) {
        rows.push({
          line, name, ok: false,
          error: `increment_${n}_date is not DD-MM-YYYY.`,
        });
        return;
      }
      const figure = Number(pair.amount.replace(/[₹,\s]/g, ""));
      if (!Number.isFinite(figure)) {
        rows.push({
          line, name, ok: false,
          error: `increment_${n}_amount ("${pair.amount}") is not a rupee amount.`,
        });
        return;
      }
      /* -- ZERO IS NOT A RISE, and is very common: a joiner's first year, or a
            year somebody was reviewed and given nothing. Recording it would put
            a 0% increment in the pay ledger and move their increment clock to
            that date, so the next one would be counted from a rise that never
            happened. Skipped, exactly as a blank is. -- */
      if (figure <= 0) continue;
      increments.push({ effective_from: when, amount: figure });
    }

    const unitText = (record.salary_unit ?? "").trim().toLowerCase();
    const perMonth = unitText === "" || /^month/.test(unitText);
    if (unitText && !perMonth && !/^annual|^year/.test(unitText)) {
      rows.push({
        line, name, ok: false,
        error: `"${record.salary_unit}" is not a salary unit. Use MONTHLY or ANNUAL.`,
      });
      return;
    }
    /* Multiplied as TEXT, before the schema's own parser sees it, so ₹, commas
       and Indian grouping are still accepted exactly as they are on an annual
       row (P19C-5). */
    const annual = (raw: string | undefined): string => {
      const text = (raw ?? "").trim();
      if (!perMonth || text === "") return text;
      const n = Number(text.replace(/[₹,\s]/g, ""));
      return Number.isFinite(n) ? String(Math.round(n * 12)) : text;
    };

    const parsed = createUserSchema.safeParse({
      full_name: name,
      email,
      /* -- Whether a PERSON gave it. The auth identity needs an address either
            way; `profiles.email` is left NULL when we derived one (0071), so
            the profile says honestly that there is none rather than carrying a
            fabricated one that would look like a contact route. -- */
      email_supplied: emailText !== "",
      // A blank number NOTES rather than refuses here — see the schema.
      phone_required: false,
      password,
      track,
      department_id: departmentId ?? "",
      roles: askedRoles.concat("EMPLOYEE"),
      employee_code: record.employee_code ?? "",
      phone: record.phone ?? "",
      /* Optional, and blank for almost everybody — see IMPORT_COLUMNS. */
      work_email: record.work_email ?? "",
      work_phone: record.work_phone ?? "",
      designation: record.designation ?? "",
      reports_to: leadId ?? "",
      co_reviewer_id: coId ?? "",
      date_of_joining: joining,
      employment_type: (record.employment_type || "PERMANENT").toUpperCase(),
      last_increment_date: lastIncrement,
      increment_frequency_months: record.increment_frequency_months || 12,
      joining_ctc: annual(record.joining_ctc),
      current_ctc: annual(record.current_ctc),
      last_increment_amount: annual(record.last_increment_amount),
      /* -- The SAME unit as the three figures above, because they describe the
            same pay. A rise stated per month beside a salary stated per month
            has to be scaled with it, or the ledger would subtract an annual
            amount from a monthly one. Multiplied here rather than where the
            pairs are read, because the unit is not resolved until below. -- */
      increments: increments.map((entry) => ({
        ...entry,
        amount: perMonth ? entry.amount * 12 : entry.amount,
      })),
    });

    if (!parsed.success) {
      rows.push({ line, name, ok: false, error: parsed.error.issues[0]?.message ?? "Invalid row." });
      return;
    }

    // `leadEmail` travels only when the manager is in this file — the commit
    // resolves it once that person exists.
    /* -- Both halves in one sentence, because a row missing both should not
          produce two lines HR has to read as one fact. -- */
    /* -- A Backend Team person with no number is NOTED, never refused.
          The form refuses it, because HR entering one person has the number to
          hand. Refusing it here would fail a whole payroll file over a blank
          cell, since one bad row imports nothing (P19C-8) — so the row lands
          and says what is missing, which is FIX-64's call for an unresolvable
          manager. Production Team are exempt: nothing is ever sent to them. -- */
    const noMobile =
      parsed.data.track === "STAFF" && !parsed.data.phone?.trim();

    const dropped = [
      leadMissing ? `no manager — nobody has ${record.reports_to}` : null,
      coMissing ? `no second reviewer — nobody has ${record.second_reviewer}` : null,
      noMobile ? "no mobile number — their form link can only go by email" : null,
    ].filter(Boolean);

    prepared.push({
      line,
      name,
      input: parsed.data,
      leadEmail: leadIsInThisFile ? leadEmail : undefined,
      coEmail: coIsInThisFile ? coEmail : undefined,
      shownPassword,
      note:
        dropped.length > 0
          ? `Imported with ${dropped.join(" and ")}. Add them and re-upload, or set it on the person.`
          : undefined,
    });
  });

  // A duplicate inside the file itself. The database would catch it on the
  // second row, but only after creating the first — and the error it gives back
  // ("somebody already has that email") is misleading when the somebody is four
  // rows above in the same upload.
  const seen = new Set<string>();
  for (const item of prepared) {
    if (seen.has(item.input.email)) {
      rows.push({
        line: item.line,
        name: item.name,
        ok: false,
        error: `${item.input.email} appears more than once in this file.`,
      });
      continue;
    }
    seen.add(item.input.email);
  }

  if (rows.some((r) => !r.ok)) {
    return {
      ran: true,
      created: 0,
      failed: rows.filter((r) => !r.ok).length,
      rows: rows.sort((a, b) => a.line - b.line),
      error: "Nothing was imported. Fix the rows below and upload the file again.",
    };
  }

  /* -- Pass 2: create, or AMEND where they are already here.

        An email already on the system used to fail the row — so re-uploading a
        corrected file failed on every person it was correcting, which is the one
        time HR most wants to upload again. Existing people are matched by email
        and updated; `amendPerson` carries the rules that make that safe (the
        password is ignored, a blank column is left alone, salary is untouched,
        roles are diffed).

        Matched on EMAIL because it is the identifier the account is keyed on and
        the one a spreadsheet reliably carries (P19C-14). An employee code can be
        blank on a new joiner and can legitimately be corrected by this very
        file. -- */
  const alreadyHere = await supabase
    .from("profiles")
    .select("id, email")
    .in("email", prepared.map((p) => p.input.email.toLowerCase()));
  const idByEmail = new Map(
    (alreadyHere.data ?? []).map((p) => [(p.email ?? "").toLowerCase(), p.id] as const),
  );

  /* -- MANAGERS BEFORE THEIR REPORTS.

        `reports_to` is a profile id, so somebody whose manager is also being
        created by this file cannot be written until that manager exists. Rather
        than demanding HR sort the spreadsheet, the work is done here: anybody
        whose manager is already resolved goes next, and each person created
        resolves themselves for the rows still waiting.

        A LOOP UNTIL NO PROGRESS, not a topological sort. It is the same result
        with one useful difference — what is left over when progress stops is
        exactly the set caught in a cycle, so they can be reported rather than
        silently dropped or ordered arbitrarily. -- */
  const resolved = new Map(profileByEmail);
  const waiting = [...prepared];

  let created = 0;
  let updated = 0;
  // Read out here: `auth` is a union, and its narrowing does not survive into a
  // closure the compiler cannot prove runs after the guard.
  const actorId = auth.session.profile.id;

  async function write(
    item: (typeof prepared)[number],
    leadId: string | undefined,
    coId: string | undefined,
  ) {
    const already = idByEmail.get(item.input.email.toLowerCase());
    let input = item.input;
    if (leadId) input = { ...input, reports_to: leadId };
    if (coId) input = { ...input, co_reviewer_id: coId };

    const result = already
      ? await amendPerson(already, input, actorId)
      : await provisionPerson(input, actorId);

    if (result.ok) {
      if (already) updated += 1;
      else created += 1;
      // What makes the next pass able to place their reports.
      resolved.set(item.input.email.toLowerCase(), already ?? result.profileId);
      rows.push({
        line: item.line,
        name: item.name,
        ok: true,
        updated: Boolean(already),
        /* -- Only on a CREATION. An update ignores the password column
              entirely (F24-9), so reporting one would be reporting a change
              that did not happen. -- */
        password: already ? undefined : item.shownPassword,
        note: item.note,
      });
    } else {
      rows.push({ line: item.line, name: item.name, ok: false, error: result.error });
    }
  }

  let progress = true;
  while (waiting.length > 0 && progress) {
    progress = false;
    for (let i = 0; i < waiting.length; ) {
      const item = waiting[i]!;
      const leadId = item.leadEmail ? resolved.get(item.leadEmail) : undefined;
      const coId = item.coEmail ? resolved.get(item.coEmail) : undefined;

      /* -- BOTH managers, or come back to them. A second reviewer is a profile
            id like the first, so somebody whose Design Coordinator is further
            down this file cannot be written until that person exists — and
            writing them early with the column blank would leave a designer on
            the two-form flow with nothing on screen to say why. -- */
      if ((item.leadEmail && !leadId) || (item.coEmail && !coId)) {
        i += 1;
        continue;
      }

      waiting.splice(i, 1);
      await write(item, leadId, coId);
      progress = true;
    }
  }

  /* -- WHAT IS LEFT IS A CIRCLE: A reports to B and B reports to A, or a longer
        ring of the same. Nobody in it can be created first, so each is written
        WITHOUT a manager and told so — the account is real and usable, and the
        one field that cannot be resolved is named rather than the whole row
        being failed over it. -- */
  for (const item of waiting) {
    /* -- Whatever DID resolve still travels: a circle in the reporting line
          should not also cost somebody their second reviewer, which may be
          perfectly resolvable. -- */
    await write(
      item,
      item.leadEmail ? resolved.get(item.leadEmail) : undefined,
      item.coEmail ? resolved.get(item.coEmail) : undefined,
    );
    const row = rows.find((r) => r.line === item.line);
    if (row?.ok) {
      const unresolved =
        item.leadEmail && !resolved.get(item.leadEmail) ? "manager" : "second reviewer";
      row.note = `Created, but their ${unresolved} could not be set — this file has them naming each other in a circle. Set it from Team review.`;
    }
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/people");

  const failed = rows.filter((r) => !r.ok).length;
  return { ran: true, created, updated, failed, rows: rows.sort((a, b) => a.line - b.line) };
}

/** The template HR downloads, served as a string the browser turns into a file. */
export async function getImportTemplate(): Promise<string> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return "";
  const { importTemplate } = await import("@/lib/auth/csv");
  return importTemplate();
}

/**
 * Sets one person's second reviewer (0083) from a single control, rather than
 * the whole `updatePerson` form — the cycle wizard needs to change ONE field
 * on ONE profile from a table row, and dragging in twenty other fields for
 * that is how a screen ends up overwriting things nobody meant to touch.
 *
 * WRITES `profiles.co_reviewer_id` DIRECTLY. `launch_cycle` (0084) reads it
 * straight from the profile at launch time — there is no separate per-cycle
 * override the way there is for the reporting manager (P3-6) — so this is
 * the one and only place a second reviewer assignment lives, and changing it
 * here is exactly as permanent as changing it in Settings. Pre-filling the
 * wizard from this same column is what makes that true rather than
 * surprising: HR is looking at the person's actual, current assignment and
 * correcting it, not setting something scoped to one round.
 *
 * The SAME two refusals `updatePerson` enforces, because a second reviewer
 * that fails one of them there and succeeds here is a rule with two answers:
 * rating yourself is not a second opinion (§5), and the same person as their
 * manager is one opinion recorded twice on two forms.
 */
export async function setSecondReviewer(
  profileId: string,
  coReviewerId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { ok: false, error: auth.error.message };

  if (coReviewerId === profileId) {
    return { ok: false, error: "Somebody cannot be their own second reviewer." };
  }

  const supabase = await createClient();

  if (coReviewerId) {
    const { data: current } = await supabase
      .from("profiles")
      .select("reports_to")
      .eq("id", profileId)
      .maybeSingle();
    if (current?.reports_to === coReviewerId) {
      return {
        ok: false,
        error: "The second reviewer has to be somebody other than their manager.",
      };
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ co_reviewer_id: coReviewerId })
    .eq("id", profileId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/cycles/new");
  revalidatePath("/admin/settings");
  return { ok: true };
}

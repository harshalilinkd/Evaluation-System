"use server";

/** HR provisioning: create a person, set their department and access level. */

import { revalidatePath } from "next/cache";

import { parseCsv, toIsoDate, toRecords } from "@/lib/auth/csv";
import { checkRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import {
  createUserSchema,
  emailSchema,
  newPasswordSchema,
  type AppRole,
  type CreateUserInput,
} from "@/lib/auth/schemas";
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
    designation: formData.get("designation") ?? "",
    reports_to: formData.get("reports_to") ?? "",
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

  const patch = {
    full_name: keep(input.full_name),
    employee_code: keep(input.employee_code),
    phone_e164: phoneE164,
    department_id: keep(input.department_id),
    designation: keep(input.designation),
    reports_to: keep(input.reports_to),
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
    return {
      ok: false,
      error: duplicate
        ? "Somebody already has that email address."
        : "Could not create the account. Try again, or check the email address.",
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

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      full_name: input.full_name,
      department_id: input.department_id ? input.department_id : null,
      employee_code: input.employee_code ? input.employee_code : null,
      track: input.track === "WORKER" ? "WORKER" : "STAFF",
      phone_e164: phoneE164,
      designation: input.designation ? input.designation : null,
      reports_to: input.reports_to ? input.reports_to : null,
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
      last_increment_date: input.last_increment_date ? input.last_increment_date : null,
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

  if (input.current_ctc !== undefined && input.last_increment_date) {
    // The increment amount is what makes the previous figure knowable. Without
    // it the row still stands as "this is the salary from this date", with the
    // hike left null rather than invented.
    /* -- The increment amount makes the previous figure knowable; failing
          that, the baseline does. Falling back to `joining_ctc` is what makes
          the FIRST revision measure against what somebody joined on, which is
          the rule the ledger follows everywhere else. -- */
    const hike = input.last_increment_amount;
    const previous =
      hike !== undefined
        ? input.current_ctc - hike
        : (input.joining_ctc ?? null);

    salaryRows.push({
      profile_id: profileId,
      effective_from: input.last_increment_date,
      previous_ctc: previous !== null && previous > 0 ? previous : null,
      new_ctc: input.current_ctc,
      hike_amount: hike ?? null,
      hike_pct:
        previous !== null && previous > 0 && hike !== undefined
          ? Math.round((hike / previous) * 10000) / 100
          : null,
      reason: "ANNUAL_INCREMENT",
      recorded_by: actorProfileId,
      note: "Recorded when the account was created.",
    });
  }

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

  // Their own lead is a cycle nobody can resolve, and P10-7's self-led case is
  // already a hard block at launch — refused here so it never reaches one.
  if (reportsTo && reportsTo === profileId) {
    return {
      error: "Somebody cannot report to themselves.",
      fieldErrors: { reports_to: "Choose a different person" },
    };
  }

  // §10 wants E.164 with +91 as the default, and the normaliser says WHAT is
  // wrong rather than returning null (P11-12).
  let phoneE164: string | null = null;
  const phone = String(formData.get("phone") ?? "").trim();
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

  const { data: before } = await supabase
    .from("profiles")
    .select("full_name, employee_code, designation, department_id, reports_to, date_of_joining, phone_e164")
    .eq("id", profileId)
    .maybeSingle();

  const after = {
    full_name: fullName,
    employee_code: String(formData.get("employee_code") ?? "").trim() || null,
    track: (String(formData.get("track") ?? "STAFF") === "WORKER"
      ? "WORKER"
      : "STAFF") as "STAFF" | "WORKER",
    designation: String(formData.get("designation") ?? "").trim() || null,
    department_id: departmentId || null,
    reports_to: reportsTo || null,
    date_of_joining: String(formData.get("date_of_joining") ?? "").trim() || null,
    phone_e164: phoneE164,
  };

  const { error } = await supabase.from("profiles").update(after).eq("id", profileId);
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
            new_password: parsed.error.issues[0]?.message ?? "Use at least 10 characters",
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
        warnings.push(
          /registered|already|duplicate|exists/i.test(authError.message)
            ? "their sign-in details — somebody already uses that email address"
            : `their sign-in details — ${authError.message}`,
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

/* ---------- Delete ---------- */

/**
 * Delete somebody outright — but only somebody nothing depends on.
 *
 * §17 AND §12 BOTH SAY PEOPLE ARE SWITCHED OFF, NOT ERASED, AND THAT STANDS.
 *
 * P4-5 recorded the consequence years before this action existed: `audit_log`
 * .actor_id has no ON DELETE clause, so once somebody has acted their profile
 * cannot be removed — Postgres refuses it. The same is true of an evaluation
 * they are the subject or the lead of.
 *
 * So this is not "delete a person". It is "undo a person who was created by
 * mistake and has done nothing yet", which is the only case the database will
 * permit and the only one §17 does not forbid. Everything else is deactivation,
 * and the message says so rather than failing with a constraint violation.
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
    .select("full_name, email")
    .eq("id", profileId)
    .maybeSingle();

  if (!person) return { error: "That person no longer exists." };

  // head:true — the counts are the whole answer, and reading the rows to decide
  // one button would pull every evaluation they have ever been part of.
  const [{ count: asEvaluatee }, { count: asLead }, { count: acted }, { count: pay }] =
    await Promise.all([
      supabase
        .from("evaluations")
        .select("id", { count: "exact", head: true })
        .eq("evaluatee_id", profileId),
      supabase.from("evaluations").select("id", { count: "exact", head: true }).eq("lead_id", profileId),
      supabase.from("audit_log").select("id", { count: "exact", head: true }).eq("actor_id", profileId),
      supabase
        .from("salary_history")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", profileId),
    ]);

  // Named separately, not totalled: "2 evaluations and a pay history" tells HR
  // which thing to look at, where "4 references" does not.
  const blockers: string[] = [];
  if ((asEvaluatee ?? 0) > 0) blockers.push(`${asEvaluatee} evaluation(s) of them`);
  if ((asLead ?? 0) > 0) blockers.push(`${asLead} evaluation(s) they lead`);
  if ((acted ?? 0) > 0) blockers.push("a recorded history of actions");
  if ((pay ?? 0) > 0) blockers.push("pay history");

  if (blockers.length > 0) {
    return {
      error:
        `${person.full_name} cannot be deleted — the system holds ${blockers.join(", ")}. ` +
        `Deactivate them instead: they stop being able to sign in and drop out of new cycles, and the record stays intact.`,
    };
  }

  // Logged BEFORE the delete. audit_log.entity_id carries no foreign key, so the
  // row outlives what it describes — the only remaining evidence they existed.
  await createServiceClient().from("audit_log").insert({
    actor_id: auth.session.profile.id,
    entity: "profile",
    entity_id: profileId,
    action: "profile.deleted",
    diff: { before: person } as Json,
  });

  // The auth account is the root: `profiles` hangs off it with ON DELETE CASCADE
  // (0001), so removing the account takes the profile and its role grants with
  // it. Deleting the profile alone would leave an account that can still sign in
  // and whose trigger would rebuild a bare profile on next login.
  const { error } = await createServiceClient().auth.admin.deleteUser(profileId);
  if (error) {
    return {
      error: /foreign key|violates/i.test(error.message)
        ? `${person.full_name} is still referenced somewhere and cannot be deleted. Deactivate them instead.`
        : "Could not delete that account.",
    };
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/people");
  return { ok: true, message: `${person.full_name} was deleted.` };
}

/* ---------- Bulk import ---------- */

export type ImportRowResult = {
  line: number;
  name: string;
  ok: boolean;
  error?: string;
  /** True when this row amended somebody already on the system. */
  updated?: boolean;
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
  const profileByEmail = new Map<string, string>();
  for (const p of existing ?? []) {
    if (p.email) profileByEmail.set(p.email.trim().toLowerCase(), p.id);
  }

  /* -- Pass 1: validate everything. -- */
  const prepared: Array<{ line: number; name: string; input: CreateUserInput }> = [];
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

    const leadEmail = (record.reports_to ?? "").trim().toLowerCase();
    const leadId = leadEmail ? profileByEmail.get(leadEmail) : "";
    if (leadEmail && !leadId) {
      rows.push({
        line,
        name,
        ok: false,
        // Ordering is the usual cause, and it has a fix HR can act on.
        error: `Nobody here has the email ${record.reports_to}. Import their Manager first, or leave this blank and set it afterwards.`,
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
    const emailText = (record.email ?? "").trim();
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
    const password =
      (record.password ?? "").trim() ||
      (track === "WORKER" ? `wk-${crypto.randomUUID()}${crypto.randomUUID()}` : "");

    /* -- MONTHLY OR ANNUAL, and the database is annual (0061).
          A payroll sheet is usually monthly, and 32000 read as a year is ₹2,667
          a month — out by twelve on every percentage, report and printed sheet,
          and low enough to look plausible. Stating the unit once per row is what
          makes that impossible rather than careful. Blank is ANNUAL, so an older
          file is unchanged. -- */
    const unitText = (record.salary_unit ?? "").trim().toLowerCase();
    const perMonth = /^month/.test(unitText);
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
      password,
      track,
      department_id: departmentId ?? "",
      // Split on anything that is not a letter or underscore, so "HOD HR_ADMIN",
      // "HOD, HR_ADMIN" and "HOD/HR_ADMIN" all work.
      roles: (record.roles ?? "")
        .split(/[^A-Za-z_]+/)
        .map((r) => r.trim().toUpperCase())
        .filter(Boolean)
        .concat("EMPLOYEE"),
      employee_code: record.employee_code ?? "",
      phone: record.phone ?? "",
      designation: record.designation ?? "",
      reports_to: leadId ?? "",
      date_of_joining: joining,
      employment_type: (record.employment_type || "PERMANENT").toUpperCase(),
      last_increment_date: lastIncrement,
      increment_frequency_months: record.increment_frequency_months || 12,
      joining_ctc: annual(record.joining_ctc),
      current_ctc: annual(record.current_ctc),
      last_increment_amount: annual(record.last_increment_amount),
    });

    if (!parsed.success) {
      rows.push({ line, name, ok: false, error: parsed.error.issues[0]?.message ?? "Invalid row." });
      return;
    }

    prepared.push({ line, name, input: parsed.data });
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

  let created = 0;
  let updated = 0;
  for (const item of prepared) {
    const already = idByEmail.get(item.input.email.toLowerCase());
    const result = already
      ? await amendPerson(already, item.input, auth.session.profile.id)
      : await provisionPerson(item.input, auth.session.profile.id);

    if (result.ok) {
      if (already) updated += 1;
      else created += 1;
      rows.push({ line: item.line, name: item.name, ok: true, updated: Boolean(already) });
    } else {
      rows.push({ line: item.line, name: item.name, ok: false, error: result.error });
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

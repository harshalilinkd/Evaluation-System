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

  /* -- Access levels. Replaced wholesale rather than diffed, for the same
        reason department mappings are (P8P-6): unticking a level has to
        actually remove it, and a diff leaves stale grants behind. EMPLOYEE is
        never removed — there is no user of this system who does not fill in
        their own appraisal (P8-3). -- */
  const roles = new Set<string>(["EMPLOYEE", ...formData.getAll("roles").map(String).filter(Boolean)]);

  await supabase.from("user_roles").delete().eq("profile_id", profileId).neq("role", "EMPLOYEE");

  const extra = [...roles].filter((r) => r !== "EMPLOYEE");
  if (extra.length > 0) {
    await supabase
      .from("user_roles")
      .upsert(
        extra.map((role) => ({ profile_id: profileId, role: role as AppRole })),
        { onConflict: "profile_id,role", ignoreDuplicates: true },
      );
  }

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
};

export type ImportState = {
  ran?: boolean;
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
        error: `Nobody here has the email ${record.reports_to}. Import their HOD first, or leave this blank and set it afterwards.`,
      });
      return;
    }

    const parsed = createUserSchema.safeParse({
      full_name: name,
      email: record.email ?? "",
      password: record.password ?? "",
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
      joining_ctc: record.joining_ctc ?? "",
      current_ctc: record.current_ctc ?? "",
      last_increment_amount: record.last_increment_amount ?? "",
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

  /* -- Pass 2: create. -- */
  let created = 0;
  for (const item of prepared) {
    const result = await provisionPerson(item.input, auth.session.profile.id);
    if (result.ok) {
      created += 1;
      rows.push({ line: item.line, name: item.name, ok: true });
    } else {
      rows.push({ line: item.line, name: item.name, ok: false, error: result.error });
    }
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/people");

  const failed = rows.filter((r) => !r.ok).length;
  return { ran: true, created, failed, rows: rows.sort((a, b) => a.line - b.line) };
}

/** The template HR downloads, served as a string the browser turns into a file. */
export async function getImportTemplate(): Promise<string> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return "";
  const { importTemplate } = await import("@/lib/auth/csv");
  return importTemplate();
}

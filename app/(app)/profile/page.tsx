/** /profile — your own account. Every signed-in person, no role required. */

import type { Metadata } from "next";

import { ProfileClient, type ProfileView } from "@/app/(app)/profile/profile-client";
import { ROLE_LABELS, type AppRole } from "@/components/appraise/nav-config";
import { requireAuth } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your profile" };

export default async function Page() {
  /* -- §9: the guard is the first statement. NO ROLE, deliberately — this is
        the one screen that belongs to whoever is signed in, and gating it would
        mean somebody could not change their own password. -- */
  const { profile, roles } = await requireAuth();

  const supabase = await createClient();
  const { data: department } = profile.department_id
    ? await supabase.from("departments").select("name").eq("id", profile.department_id).maybeSingle()
    : { data: null };

  const view: ProfileView = {
    fullName: profile.full_name,
    email: profile.email,
    /* -- ALL FOUR CONTACTS, none of them resolved against another.
          `contactFor` (0081) picks work-or-personal when a message is SENT and
          that stays — it is what keeps somebody with no official address
          reachable. A SCREEN doing the same thing shows one value and hides
          another that is on the record, which is how "which number do you have
          for me?" becomes a question the app cannot answer. -- */
    phone: profile.phone_e164,
    workEmail: profile.work_email,
    workPhone: profile.work_phone_e164,
    employeeCode: profile.employee_code,
    designation: profile.designation,
    departmentName: department?.name ?? null,
    /* -- EMPLOYEE is dropped, for P7-11's reason: everybody holds it, so
          listing it teaches people the line says nothing. What is left is what
          is actually distinctive about this account, and an empty list reads as
          "Employee" in the component. -- */
    roleLabels: roles
      .filter((r): r is AppRole => r !== "EMPLOYEE")
      .map((r) => ROLE_LABELS[r]),
  };

  return <ProfileClient view={view} />;
}

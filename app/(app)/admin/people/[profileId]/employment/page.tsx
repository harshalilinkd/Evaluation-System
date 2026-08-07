/** /admin/people/[id]/employment — one person's employment and pay. HR + MD only. */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmploymentClient } from "@/app/(app)/admin/people/[profileId]/employment/employment-client";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { getEmployment } from "@/lib/employment/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Employment" };

export default async function Page({ params }: { params: Promise<{ profileId: string }> }) {
  /* -- §5's salary confinement. HR and the MD only. The guard is the first
        statement, so a HOD is redirected before any markup exists to be hidden;
        0023's policies are what actually protect the data. -- */
  const { roles } = await requireRole(["HR_ADMIN", "MD"]);
  const { profileId } = await params;

  const supabase = await createClient();
  const { data: person } = await supabase
    .from("profiles")
    .select("id, full_name, employee_code, designation, department_id")
    .eq("id", profileId)
    .maybeSingle();

  if (!person) notFound();

  const { data: department } = person.department_id
    ? await supabase.from("departments").select("name").eq("id", person.department_id).maybeSingle()
    : { data: null };

  const detail = await getEmployment(profileId);
  if (!detail.ok) {
    return <ErrorState title="Could not load this record" body={detail.error.message} />;
  }

  return (
    <EmploymentClient
      person={{
        id: person.id,
        name: person.full_name,
        employeeCode: person.employee_code,
        designation: person.designation,
        departmentName: department?.name ?? null,
      }}
      detail={detail.data}
      // §9: HR writes the record; HR and the MD may both append pay history.
      canEditRecord={roles.includes("HR_ADMIN")}
    />
  );
}

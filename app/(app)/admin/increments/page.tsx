/** /admin/increments — the increment calendar. HR's planning screen. */

import type { Metadata } from "next";

import { IncrementsClient } from "@/app/(app)/admin/increments/increments-client";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { getIncrementCalendar } from "@/lib/employment/queries";

export const metadata: Metadata = { title: "Increments" };

export default async function Page() {
  /* -- §5's salary confinement. HR and the MD only, and the guard is the first
        statement so a HOD is redirected before any markup exists to be hidden.
        0023's policies are the real protection — this is the clean exit. -- */
  const session = await requireRole(["HR_ADMIN", "MD"]);
  // §9: the MD reads the employment record; HR writes it. The import is a
  // write, so the panel is HR's alone — and `import_employment` re-checks
  // `is_hr()` in SQL, because a hidden panel is not a permission. It now opens
  // from a header button rather than sitting below the calendar; the gate is
  // unchanged and still decided here, on the server.
  const canImport = session.roles.includes("HR_ADMIN");

  const calendar = await getIncrementCalendar();
  if (!calendar.ok) {
    return <ErrorState title="Could not load the increment calendar" body={calendar.error.message} />;
  }

  const departments = [
    ...new Set(calendar.data.rows.map((r) => r.departmentName).filter((v): v is string => Boolean(v))),
  ].sort();

  // No wrapper: the grid is full-bleed and owns the viewport height itself.
  return (
    <IncrementsClient calendar={calendar.data} departments={departments} canImport={canImport} />
  );
}

/** /admin/cycles/new — the four-step wizard. P10 screen 2. */

import type { Metadata } from "next";

import { WizardClient } from "@/app/(app)/admin/cycles/new/wizard-client";
import { ErrorState } from "@/components/appraise/states";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { listStaffProfiles } from "@/lib/cycles/queries";
import { dueProfileIds } from "@/lib/due/queries";
import { jobSkillCountsByDepartment } from "@/lib/cycles/validate";

export const metadata: Metadata = { title: "New cycle" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ increment_for?: string; evaluate?: string }>;
}) {
  // §9: the guard is the first statement.
  await requireRole(ADMIN_ROLES);

  const [people, counts, params] = await Promise.all([
    listStaffProfiles(),
    jobSkillCountsByDepartment(),
    searchParams,
  ]);

  /* -- "Start increment" on the increment calendar links here with the person's
        id, and this page ignored it — so the one route in the product whose
        whole purpose is starting an increment opened on EVALUATION, and HR had
        to notice and change it. A link that lands on the wrong setting is
        worse than no link: the default is the thing people accept.

        Only the TYPE is preselected, not the roster. Step 3 is where people are
        chosen and it opens on everybody by design; silently narrowing it to one
        person from a query string would hide the other 46 behind a filter
        nobody set. -- */
  const startingAnIncrement = Boolean(params.increment_for);

  if (!people.ok) return <ErrorState title="Could not load people" body={people.error.message} />;
  if (!counts.ok) return <ErrorState title="Could not load mappings" body={counts.error.message} />;

  return (
    <WizardClient
      people={people.data}
      jobSkillCounts={Object.fromEntries(counts.data)}
      initial={null}
      presetCycleType={startingAnIncrement ? "INCREMENT" : undefined}
      /* ?increment_for=due means a whole ROUND, from the increment calendar:
         everybody overdue or due within the month, ticked on arrival. Any other
         value is one person and behaves as it always did. */
      preselect={
        params.increment_for === "due"
          ? "increment-due"
          : /* From Evaluation Due: everybody whose review is due or already
               late, ticked on arrival, with the name and period prefilled. */
            params.evaluate === "due"
            ? "evaluation-due"
            : undefined
      }
      /* The people whose evaluation is due, resolved on the server from the
         same PENDING items the Evaluation Due screen lists — so the button's
         count and the wizard's ticks cannot describe different sets. */
      evaluationDueIds={params.evaluate === "due" ? await dueProfileIds() : undefined}
    />
  );
}

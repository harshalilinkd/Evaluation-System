/** /admin/form-builder/worker — the Worker Performance Appraisal form, as a Form Builder tab. */

import type { Metadata } from "next";

import { BuilderTabs } from "@/app/(app)/admin/form-builder/builder-tabs";
import { WorkerFormClient } from "@/app/(app)/admin/form-builder/worker/worker-form-client";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { listWorkerQuestions, toWorkerFormDefinition } from "@/lib/worker/questions";

export const metadata: Metadata = { title: "Worker form" };

export default async function WorkerFormPage() {
  // §9: the guard is the first statement, so a non-administrator is redirected
  // before any markup exists to be hidden. The WRITES are HR-only (AMEND-2);
  // reading the form is something the MD may do.
  await requireRole(ADMIN_ROLES);

  const questions = await listWorkerQuestions();

  return (
    <div className="space-y-5">
      <BuilderTabs />
      <WorkerFormClient
        questions={questions}
        preview={toWorkerFormDefinition(questions)}
      />
    </div>
  );
}

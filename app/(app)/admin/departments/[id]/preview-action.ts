"use server";

/** Assembles a department's form on demand, for the preview drawer. */

import { checkRole } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { previewFormForDepartment } from "@/lib/forms/preview";
import type { FormDefinition } from "@/lib/forms/types";

export type PreviewResult =
  | { ok: true; data: FormDefinition }
  | { ok: false; error: { code: string; message: string } };

/**
 * §9: every server action re-checks the role. A preview exposes the whole
 * question bank for a department, which is HR's business and nobody else's.
 */
export async function loadDepartmentPreview(departmentId: string): Promise<PreviewResult> {
  const auth = await checkRole(ADMIN_ROLES);
  if (!auth.ok) return { ok: false, error: auth.error };

  const result = await previewFormForDepartment(departmentId);
  if (!result.ok) return { ok: false, error: result.error };

  return { ok: true, data: result.data };
}

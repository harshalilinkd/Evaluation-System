"use server";

/** Renaming, reordering and parking form sections. HR only, audited (§9, §12). */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkRole } from "@/lib/auth/guards";
import { SECTION_LABELS, SECTION_ORDER, type QuestionSection } from "@/lib/forms/labels";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

export type SectionActionState = {
  ok?: boolean;
  message?: string;
  error?: string;
};

/*
 * §9 as amended: HR writes configuration, the MD reads it. A section name is on
 * every form in the company, so this is configuration in the strongest sense.
 */
const HR = ["HR_ADMIN"] as const;

const VALID = new Set<string>(SECTION_ORDER);

/**
 * Narrows a posted string to a real section.
 *
 * The runtime check and the type both come from `SECTION_ORDER`, so a section
 * added to the enum without being added there is refused rather than written —
 * which is the safe failure: a row keyed by a value nothing renders would be a
 * heading nobody can see or fix.
 */
function asSection(value: string): QuestionSection | null {
  return VALID.has(value) ? (value as QuestionSection) : null;
}

const labelSchema = z
  .string()
  .trim()
  .min(1, "A section needs a name.")
  .max(80, "That name is too long for a heading.");

/**
 * Rename one section.
 *
 * The section itself — the enum value — is untouched and cannot be reached from
 * here. §5 freezes it into every launched evaluation, so renaming the VALUE
 * would rewrite what people were asked in appraisals that have been signed.
 * This changes what it is called, which is the safe half of the same idea
 * (P8P-1).
 */
export async function renameSection(
  _prev: SectionActionState,
  formData: FormData,
): Promise<SectionActionState> {
  const auth = await checkRole(HR);
  if (!auth.ok) return { error: auth.error.message };

  const section = asSection(String(formData.get("section") ?? ""));
  if (!section) return { error: "That is not a section of the form." };

  const parsed = labelSchema.safeParse(String(formData.get("label") ?? ""));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "That name will not do." };

  const supabase = await createClient();

  const { data: before } = await supabase
    .from("form_sections")
    .select("label")
    .eq("section", section)
    .maybeSingle();

  const { error } = await supabase
    .from("form_sections")
    .update({ label: parsed.data })
    .eq("section", section);

  if (error) return { error: "Could not rename that section." };

  await supabase.rpc("log_admin_action", {
    p_entity: "form_section",
    p_entity_id: null as unknown as string,
    p_action: "section.renamed",
    p_diff: {
      // The section is named in the diff rather than in entity_id: `form_sections`
      // is keyed by an enum, not a uuid, and audit_log's entity_id is a uuid
      // column. The enum value is the identifier that matters here.
      section,
      before: { label: before?.label ?? SECTION_LABELS[section] },
      after: { label: parsed.data },
    } as Json,
  });

  revalidateEverywhere();
  return { ok: true, message: `Renamed to "${parsed.data}".` };
}

/** The whole order at once, so the stored positions can never disagree with the list. */
export async function reorderSections(
  _prev: SectionActionState,
  formData: FormData,
): Promise<SectionActionState> {
  const auth = await checkRole(HR);
  if (!auth.ok) return { error: auth.error.message };

  let sections: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("sections") ?? "[]"));
    if (Array.isArray(parsed)) sections = parsed.map(String);
  } catch {
    sections = [];
  }

  /* -- Every section, exactly once. A partial list would leave the ones it
        omitted holding stale positions, and two sections claiming the same
        place is a form whose order changes between page loads. -- */
  if (
    sections.length !== SECTION_ORDER.length ||
    new Set(sections).size !== sections.length ||
    sections.some((s) => !VALID.has(s))
  ) {
    return { error: "That is not a complete ordering of the form." };
  }

  const supabase = await createClient();

  for (const [index, name] of sections.entries()) {
    const section = asSection(name);
    if (!section) return { error: "That is not a complete ordering of the form." };
    const { error } = await supabase
      .from("form_sections")
      .update({ sort_order: (index + 1) * 10 })
      .eq("section", section);
    if (error) return { error: "Could not save the new order." };
  }

  await supabase.rpc("log_admin_action", {
    p_entity: "form_section",
    p_entity_id: null as unknown as string,
    p_action: "section.reordered",
    p_diff: { after: { order: sections } } as Json,
  });

  revalidateEverywhere();
  return { ok: true, message: "Order saved." };
}

/**
 * Park a section, or bring it back.
 *
 * Not a delete: the enum value stays and so do its questions. A parked section
 * simply stops being assembled into new forms — which is the reversible version
 * of what HR usually means by "take this off the form".
 */
export async function setSectionActive(
  _prev: SectionActionState,
  formData: FormData,
): Promise<SectionActionState> {
  const auth = await checkRole(HR);
  if (!auth.ok) return { error: auth.error.message };

  const section = asSection(String(formData.get("section") ?? ""));
  if (!section) return { error: "That is not a section of the form." };

  const active = String(formData.get("is_active") ?? "") === "true";

  const supabase = await createClient();
  const { error } = await supabase
    .from("form_sections")
    .update({ is_active: active })
    .eq("section", section);

  if (error) return { error: "Could not update that section." };

  await supabase.rpc("log_admin_action", {
    p_entity: "form_section",
    p_entity_id: null as unknown as string,
    p_action: active ? "section.restored" : "section.parked",
    p_diff: { section } as Json,
  });

  revalidateEverywhere();
  return {
    ok: true,
    message: active
      ? "Back on the form."
      : "Parked. Its questions are untouched and launched evaluations are unaffected.",
  };
}

/*
 * A section name appears on the form, the builder, the reports and the printed
 * pack, so a rename has to reach all of them. Listed explicitly rather than
 * revalidating the layout, because that would drop every cached page in the app
 * for a change to one heading.
 */
function revalidateEverywhere() {
  for (const path of [
    "/admin/form-builder",
    "/admin/form-builder/questions",
    "/admin/questions",
    "/my-evaluation",
    "/team",
    "/reports",
    "/scorecard",
  ]) {
    revalidatePath(path);
  }
}

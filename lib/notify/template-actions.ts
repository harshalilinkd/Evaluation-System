"use server";

/** HR editing the wording of a message (0073). §9: configuration is HR's write. */

import { revalidatePath } from "next/cache";

import { checkRole } from "@/lib/auth/guards";
import {
  EDITABLE_TEMPLATES,
  NOT_EDITABLE_BECAUSE,
  loadOverrides,
  placeholdersFor,
  validateTemplate,
  type EditableTemplate,
  type TemplateProblem,
} from "@/lib/notify/overrides";
import { TEMPLATE_LABELS, type TemplateKey } from "@/lib/notify/templates";
import { templatePreviewList } from "@/lib/notify/preview";
import { createClient } from "@/lib/supabase/server";

export type TemplateSaveResult =
  | { ok: true }
  | { ok: false; message: string; problems?: TemplateProblem[] };

/**
 * Every template, with HR's wording where they have written some and the
 * default where they have not.
 *
 * THE DEFAULT COMES FROM THE PREVIEW, not from the template function directly.
 * `previewTemplates()` renders each one with `{employee}`-shaped placeholders
 * already in place (P23-7 — never with a real person, because that would put a
 * live invite token on a settings screen). So what HR starts editing is exactly
 * what the screen has always shown them, with the placeholders they may keep.
 */
export async function listTemplates(): Promise<EditableTemplate[]> {
  const supabase = await createClient();
  const overrides = await loadOverrides(supabase);
  const defaults = templatePreviewList();

  return defaults.map((preview) => {
    const key = preview.key as TemplateKey;
    const override = overrides.get(key);
    const editable = EDITABLE_TEMPLATES.has(key);

    return {
      key,
      label: TEMPLATE_LABELS[key] ?? preview.label,
      editable,
      lockedBecause: editable ? undefined : NOT_EDITABLE_BECAUSE[key],
      subject: override?.subject ?? preview.subject ?? "",
      body: override?.body ?? preview.body,
      customised: override !== undefined,
      placeholders: editable ? placeholdersFor(key) : [],
    };
  });
}

export async function saveTemplate(input: {
  key: string;
  subject: string;
  body: string;
}): Promise<TemplateSaveResult> {
  const auth = await checkRole(["HR_ADMIN"]);
  if (!auth.ok) return { ok: false, message: auth.error.message };

  const key = input.key as TemplateKey;

  /* -- CHECKED HERE, AND AGAIN BY THE DATABASE.
        `save_notification_template` is granted to `authenticated`, so it is
        callable straight through PostgREST with a payload of the caller's
        choosing — the CHECK on the table is what actually stops a link being
        stored. This runs first so HR reads a sentence naming the problem rather
        than a constraint violation (§0.7). -- */
  if (!EDITABLE_TEMPLATES.has(key)) {
    return { ok: false, message: "That message cannot be reworded." };
  }

  const problems = validateTemplate(key, input.subject, input.body);
  if (problems.length > 0) {
    return { ok: false, message: "Some of this cannot be sent as written.", problems };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_notification_template", {
    p_key: key,
    p_subject: input.subject.trim(),
    p_body: input.body.trim(),
  });

  if (error) return { ok: false, message: `Not saved: ${error.message}` };

  revalidatePath("/admin/settings");
  return { ok: true };
}

/** Back to the wording the product shipped with. The row is deleted, not blanked. */
export async function resetTemplate(key: string): Promise<TemplateSaveResult> {
  const auth = await checkRole(["HR_ADMIN"]);
  if (!auth.ok) return { ok: false, message: auth.error.message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reset_notification_template", { p_key: key });

  if (error) return { ok: false, message: `Not reset: ${error.message}` };

  revalidatePath("/admin/settings");
  return { ok: true };
}

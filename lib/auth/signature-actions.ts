"use server";

/** Your own signature image. Nobody sets anybody else's here. */

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: { code: string; message: string } };

/** 0065's CHECK, restated where the person can be told about it in a sentence. */
const SHAPE = /^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/=]+$/;
const MAX_CHARS = 400_000;

/**
 * Set or clear the signature on YOUR OWN profile.
 *
 * `.eq("id", profile.id)` is not belt and braces over RLS — it is the whole
 * authorisation. `profiles_guard_self_update` lets a person change any column
 * this codebase has not explicitly frozen, and HR may change anybody's row, so
 * without this an HR administrator calling with another id would sign as them.
 * A signature is the one field where writing somebody else's is the entire
 * thing that must not happen.
 */
export async function saveMySignature(dataUri: string | null): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return { ok: false, error: { code: "NOT_SIGNED_IN", message: "Your session has ended." } };
  }

  if (dataUri !== null) {
    if (!SHAPE.test(dataUri)) {
      return {
        ok: false,
        error: {
          code: "NOT_AN_IMAGE",
          message: "That is not a PNG, JPEG or GIF image.",
        },
      };
    }
    if (dataUri.length > MAX_CHARS) {
      return {
        ok: false,
        error: {
          code: "TOO_LARGE",
          message: "That image is too large. Signatures should be under 300KB.",
        },
      };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ signature_image: dataUri })
    .eq("id", profile.id);

  if (error) {
    return { ok: false, error: { code: "SAVE_FAILED", message: error.message } };
  }

  // Every printed sheet renders from it.
  revalidatePath("/admin/settings");
  revalidatePath("/print", "layout");
  return { ok: true };
}

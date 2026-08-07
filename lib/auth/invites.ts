/** Invite token issue and verification. CLAUDE.md §10 — exact requirements. */

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { generateToken, hashToken } from "@/lib/auth/invite-token";

// The pure primitives live in ./invite-token so they can be exercised directly;
// this module is the server-only half that talks to the database.
export {
  hashToken,
  inviteUrl,
  maskEmail,
  MAX_ATTEMPTS_PER_HOUR,
} from "@/lib/auth/invite-token";

/* ---------- Results ---------- */

export type InviteChannel = "whatsapp" | "email";

export type IssueResult =
  | {
      ok: true;
      data: {
        inviteId: string;
        expiresAt: string;
        /**
         * The plaintext token, returned exactly once and never again.
         *
         * It is not stored, not logged, and cannot be re-displayed — only the
         * SHA-256 hash reaches the database (§10). The caller has one chance to
         * build the link and hand it to the delivery channel. If it is lost,
         * the only remedy is to issue a new token, which revokes this one.
         */
        token: string;
      };
    }
  | { ok: false; error: { code: string; message: string } };

export type VerifyStatus =
  | "OK"
  | "INVALID"
  | "EXPIRED"
  | "USED"
  | "REVOKED"
  | "RATE_LIMITED";

export type VerifyResult =
  | {
      status: "OK";
      inviteId: string;
      evaluationId: string;
      profileId: string;
      /** Server-side only. Never rendered unmasked and never put in a URL. */
      email: string;
    }
  | { status: Exclude<VerifyStatus, "OK">; inviteId: string | null };

/* ---------- issueInviteToken ---------- */

/**
 * Mint a single-use link for one evaluation on one channel.
 *
 * Expiry is the cycle's `self_due_on` + 7 days, derived in SQL so it cannot
 * drift from §10 by being recomputed differently in two places. Issuing revokes
 * any existing active token for the same (evaluation, channel), so a resend
 * immediately invalidates whatever went out before.
 *
 * The token is generated here, hashed here, and only the hash crosses the wire.
 */
export async function issueInviteToken(
  evaluationId: string,
  channel: InviteChannel,
): Promise<IssueResult> {
  const supabase = await createClient();

  const token = generateToken();

  const { data, error } = await supabase.rpc("issue_invite_token", {
    p_evaluation_id: evaluationId,
    p_channel: channel,
    p_token_hash: hashToken(token),
  });

  if (error) {
    // The token is deliberately absent from this message. §12 forbids secrets
    // in logs, and an error string is the easiest place for one to leak.
    return { ok: false, error: { code: error.code ?? "ISSUE_FAILED", message: error.message } };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { ok: false, error: { code: "ISSUE_FAILED", message: "No invite was created." } };
  }

  return {
    ok: true,
    data: { inviteId: row.id, expiresAt: row.expires_at, token },
  };
}

/* ---------- verifyInviteToken ---------- */

/**
 * Resolve a token to its evaluation, or say why it cannot be resolved.
 *
 * Everything that matters happens in one SQL call: the lookup, the rolling
 * hourly rate limit, the attempt increment and the audit write. Splitting them
 * across round-trips would leave a window where two concurrent guesses each read
 * a count of 9 and both proceed.
 *
 * Never throws on a bad token — an invalid, expired or locked link is an
 * expected outcome with a page of its own, not an exception.
 */
export async function verifyInviteToken(token: string): Promise<VerifyResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("verify_invite_token", {
    p_token_hash: hashToken(token),
  });

  if (error) {
    return { status: "INVALID", inviteId: null };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { status: "INVALID", inviteId: null };

  if (row.status === "OK") {
    return {
      status: "OK",
      inviteId: row.invite_id as string,
      evaluationId: row.evaluation_id as string,
      profileId: row.profile_id as string,
      email: row.email as string,
    };
  }

  return {
    status: row.status as Exclude<VerifyStatus, "OK">,
    inviteId: (row.invite_id as string | null) ?? null,
  };
}

/* ---------- consumeInviteToken ---------- */

export type ConsumeFailure = "INVALID" | "EXPIRED" | "REVOKED" | "WRONG_RECIPIENT";

export type ConsumeResult =
  | { status: "OK"; evaluationId: string }
  | { status: ConsumeFailure };

/**
 * Mark the link used, once the session exists and belongs to the person it was
 * issued to. Takes the invite id rather than the token: by this point the token
 * has done its job and should not be carried any further than it must.
 */
export async function consumeInviteToken(inviteId: string): Promise<ConsumeResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("consume_invite_token", {
    p_invite_id: inviteId,
  });

  if (error) return { status: "INVALID" };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { status: "INVALID" };

  if (row.status === "OK") {
    return { status: "OK", evaluationId: row.evaluation_id as string };
  }
  return { status: row.status as ConsumeFailure };
}


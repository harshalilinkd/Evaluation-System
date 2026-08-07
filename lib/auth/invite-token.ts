/** Token generation, hashing and display. Pure — kept out of the server-only module so it is testable. */

import { createHash, randomBytes } from "node:crypto";

/** §10: 32 bytes of cryptographic randomness, base64url. */
export const TOKEN_BYTES = 32;

/** §10: 10 attempts per token per hour. Enforced in SQL; repeated here for copy. */
export const MAX_ATTEMPTS_PER_HOUR = 10;

/**
 * base64url so the token survives a WhatsApp message and a copy-paste without
 * a single character needing escaping — a link that arrives subtly altered
 * fails verification and looks, to the employee, like the system is broken.
 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * SHA-256, hex.
 *
 * This must produce byte-for-byte what the database compares against. Two
 * implementations of "how we hash" is how every token silently stops matching
 * at once, so there is exactly one, and a test asserts it agrees with the
 * digest computed in SQL.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * The link to send.
 *
 * §10: the token is the entire URL payload — no name, employee code, email or
 * phone. It goes in the path, never a query string, because query strings are
 * what analytics and access logs capture most readily.
 */
export function inviteUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  return `${base}/invite/${token}`;
}

/**
 * "p•••a@company.com" — enough for someone to recognise their own inbox, not
 * enough to disclose an address to whoever is holding the link.
 */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!domain) return "•••";
  const head = local.slice(0, 1);
  const tail = local.length > 2 ? local.slice(-1) : "";
  return `${head}•••${tail}@${domain}`;
}

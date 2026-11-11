import { createHash } from "node:crypto";

/**
 * SHA-256 hex digest of a raw access or refresh token — what a token row
 * stores instead of the token when `auth.hashTokensAtRest` is on.
 */
export function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Whether a stored token value is a digest rather than a raw JWT. A JWT always
 * contains dots, so the two forms cannot be confused.
 */
export function isTokenDigest(stored: unknown): boolean {
  return typeof stored === "string" && DIGEST_PATTERN.test(stored);
}

/**
 * Every stored form a presented token may have: its digest (rows issued with
 * `auth.hashTokensAtRest` on) and the raw value (rows issued with it off, or
 * before it was turned on). Lookups match either, so switching the option in
 * either direction never signs anyone out.
 */
export function storedTokenForms(token: string): string[] {
  return [tokenDigest(token), token];
}

/** Raw tokens of rows issued in this process, for handing back to the caller. */
const plainTokens = new WeakMap<object, string>();

/** Remember the raw token of a freshly issued row whose column holds a digest. */
export function rememberPlainToken(row: unknown, token: string): void {
  if (typeof row === "object" && row !== null) plainTokens.set(row, token);
}

/**
 * The raw token of a row: the one remembered at issue, else the stored value
 * when it is not a digest. `undefined` for a hashed row loaded from storage —
 * its raw token exists only with the client.
 */
export function plainTokenOf(row: object, stored: unknown): string | undefined {
  const remembered = plainTokens.get(row);

  if (remembered !== undefined) return remembered;

  return typeof stored === "string" && !isTokenDigest(stored) ? stored : undefined;
}

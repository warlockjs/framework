import type { AuthCredentials } from "../contracts/types";

/** Credentials without the password: the identity fields used to look a user up. */
export type AuthIdentifiers = Omit<AuthCredentials, "password">;

/**
 * Normalize one email-like identifier: trim it and lower-case it.
 *
 * This is the single rule the login lookup and the login throttle both use,
 * so `" Sara@x.io"` and `"sara@x.io"` are the same account to both.
 */
export function normalizeEmailIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Trim every string identifier value, leaving other values untouched. This is
 * the "as sent" form the login lookup falls back to for legacy rows.
 */
export function trimIdentifiers(identifiers: AuthIdentifiers): AuthIdentifiers {
  const trimmed: AuthIdentifiers = {};

  for (const [key, value] of Object.entries(identifiers)) {
    trimmed[key] = typeof value === "string" ? value.trim() : value;
  }

  return trimmed;
}

/**
 * Default credential normalization: trim string values and lower-case the
 * `email` field.
 */
export function defaultNormalizeCredentials(identifiers: AuthIdentifiers): AuthIdentifiers {
  const normalized = trimIdentifiers(identifiers);

  if (typeof normalized.email === "string") {
    normalized.email = normalizeEmailIdentifier(normalized.email);
  }

  return normalized;
}

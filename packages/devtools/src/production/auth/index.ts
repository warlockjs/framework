import type { DevtoolsErrorCode } from "../contracts";
import type {
  DevtoolsAuthDeps,
  DevtoolsAuthService,
  DevtoolsCrypto,
  DevtoolsPasskeys,
} from "./types";

export type * from "./types";

/**
 * The accounts, sessions and two-factor service of the production monitor.
 *
 * Owner: WP-2.
 */
export function createDevtoolsAuth(_deps: DevtoolsAuthDeps): DevtoolsAuthService {
  throw new Error("not implemented");
}

/**
 * The password rules: at least 8 characters, at most 72 bytes (UTF-8), not in
 * the built-in common list (compared lower-cased), not equal to the email
 * (lower-cased). Returns the failing rule's error code, or `null`.
 *
 * Owner: WP-2.
 */
export function checkPasswordPolicy(
  _password: string,
  _email: string | null,
): DevtoolsErrorCode | null {
  throw new Error("not implemented");
}

/** 32 random bytes, base64url (43 characters): session, CSRF and invite tokens. Owner: WP-2. */
export function generateToken(): string {
  throw new Error("not implemented");
}

/** SHA-256 hex of a token: what the store keeps. Owner: WP-2. */
export function hashToken(_token: string): string {
  throw new Error("not implemented");
}

/**
 * A random temporary password for `warlock devtools:reset-admin`: 20
 * characters from an unambiguous alphabet, passes `checkPasswordPolicy`.
 *
 * Owner: WP-2.
 */
export function generateTemporaryPassword(): string {
  throw new Error("not implemented");
}

/** Core's password hashing, encryption and TOTP helpers, loaded lazily. Owner: WP-2. */
export async function defaultDevtoolsCrypto(): Promise<DevtoolsCrypto> {
  throw new Error("not implemented");
}

/**
 * Passkey ceremonies over `@simplewebauthn/server`, or `null` when that
 * package cannot be imported.
 *
 * Owner: WP-2.
 */
export async function loadDevtoolsPasskeys(): Promise<DevtoolsPasskeys | null> {
  throw new Error("not implemented");
}

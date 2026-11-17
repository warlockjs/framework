import { randomBytes } from "node:crypto";
import type { DevtoolsApiErrorBody, DevtoolsErrorCode } from "./contracts";

/**
 * Why production mode refused to start. Each code names one missing or
 * invalid setting; the message says which and how to fix it.
 */
export const DEVTOOLS_CONFIG_CODES = {
  DT001:
    "Devtools production mode needs a dashboard path. Set DEVTOOLS_PATH (for example /ops-7f3k2q) or devtools.production.path.",
  DT002:
    'The devtools dashboard path must start with "/", be at least 8 characters, use only letters, digits, "-", "_", ".", "~" and "/", and not be "/__warlock".',
  DT003:
    "Devtools production mode has no admin yet. Set DEVTOOLS_ADMIN_EMAIL with DEVTOOLS_ADMIN_PASSWORD or DEVTOOLS_SETUP_TOKEN, or run `warlock devtools:reset-admin --email <email>`.",
  DT004:
    "DEVTOOLS_ADMIN_PASSWORD does not meet the password rules (at least 8 characters, at most 72 bytes, not a common password, not the email). Choose another one.",
  DT005:
    "Devtools production mode stores its accounts in the database. Install @warlock.js/cascade and configure a database connection.",
  DT006:
    "Devtools production mode encrypts two-factor secrets with the app key. Set encryption.key (64 hex characters) in src/config/encryption.ts.",
  DT007:
    "A devtools production option has an invalid value. The message names the option and the accepted values.",
  DT008:
    "The devtools tables are missing. Add devtoolsMigrations from @warlock.js/devtools/production to database.migrations in warlock.config.ts and run `warlock migrate`.",
  DT009: "Set either DEVTOOLS_ADMIN_PASSWORD or DEVTOOLS_SETUP_TOKEN, not both.",
  DT010:
    "DEVTOOLS_SETUP_TOKEN must be at least 32 characters. Generate one with: openssl rand -base64 32",
} as const;

/** A production configuration error code (`DT001`–`DT010`). */
export type DevtoolsConfigCode = keyof typeof DEVTOOLS_CONFIG_CODES;

/**
 * Thrown while the devtools connector boots in production when the monitor is
 * enabled but cannot start safely. It stops the app from booting, so a
 * misconfigured deploy fails at once instead of serving an unprotected
 * dashboard.
 */
export class DevtoolsProductionConfigError extends Error {
  public readonly code: DevtoolsConfigCode;

  public constructor(code: DevtoolsConfigCode, detail?: string) {
    super(`[${code}] ${detail ? `${detail} ` : ""}${DEVTOOLS_CONFIG_CODES[code]}`);
    this.name = "DevtoolsProductionConfigError";
    this.code = code;
  }
}

/** The message every API error code answers with: what failed and what to do next. */
export const DEVTOOLS_ERROR_MESSAGES: Record<DevtoolsErrorCode, string> = {
  "auth.invalid-credentials":
    "The email or password is not correct. Check both and try again; after several failed tries, wait 15 minutes.",
  "auth.invalid-code":
    "The code is not correct or has expired. Enter the current 6-digit code from your authenticator app, or a recovery code.",
  "auth.invalid-setup-token":
    "This setup link is not valid. Use the link built from DEVTOOLS_SETUP_TOKEN, or run `warlock devtools:reset-admin`.",
  "auth.password-too-short": "Use a password of at least 8 characters.",
  "auth.password-too-long": "Use a password of at most 72 bytes (about 72 letters).",
  "auth.password-common": "This password is too common. Choose one that is harder to guess.",
  "auth.password-same-as-email": "The password must not be your email address. Choose another one.",
  "auth.password-unchanged": "Choose a new password that differs from the current one.",
  "auth.wrong-current-password": "The current password is not correct. Enter it again.",
  "auth.busy": "The server is busy checking other sign-ins. Wait a few seconds and try again.",
  "invite.invalid":
    "This invite link is not valid, was already used, or has expired. Ask an admin for a new one.",
  "invite.email-taken": "An account with this email already exists. Sign in instead.",
  "account.not-found": "This account no longer exists. Reload the list.",
  "account.last-admin": "This is the last admin. Make another account an admin first.",
  "account.self": "You cannot do this to your own account. Ask another admin.",
  "account.last-factor":
    "This is your only second factor. Add another one (an authenticator app or a passkey) before removing it.",
  "role.forbidden": "Only admins can do this. Ask an admin.",
  "csrf.invalid": "This page is out of date. Reload the dashboard and try again.",
  "passkey.unavailable":
    "Passkeys are not available on this server (the @simplewebauthn/server package is not installed). Use an authenticator app instead.",
  "passkey.failed": "The passkey could not be verified. Try again, or use your authenticator app.",
  "explain.not-allowed": "Only admins can run EXPLAIN. Ask an admin.",
  "explain.unsupported":
    "This query cannot be explained: only PostgreSQL SELECT/WITH queries and MongoDB find, aggregate and count commands can.",
  "explain.elsewhere":
    "Only the instance that ran this query can explain it, and this request reached another one. Try again later or from that instance.",
  "explain.failed":
    "The database could not explain this query. The reference is in the server log.",
  "request.not-found":
    "This request is no longer stored. Requests are kept for a limited time (24 hours by default).",
  "request.invalid-filter": "A filter value is not valid. Check the status, method and dates.",
  "stream.too-many":
    "Too many live views are open for this session. Close another dashboard tab and reload.",
  "input.invalid": "Some fields are missing or not valid. Check the form and try again.",
  "server.error":
    "The dashboard could not complete this action. Try again; if it keeps failing, give your admin the reference shown.",
};

/** The HTTP status each code answers with. */
export const DEVTOOLS_ERROR_STATUS: Record<DevtoolsErrorCode, number> = {
  "auth.invalid-credentials": 401,
  "auth.invalid-code": 401,
  "auth.invalid-setup-token": 401,
  "auth.password-too-short": 422,
  "auth.password-too-long": 422,
  "auth.password-common": 422,
  "auth.password-same-as-email": 422,
  "auth.password-unchanged": 422,
  "auth.wrong-current-password": 401,
  "auth.busy": 503,
  "invite.invalid": 410,
  "invite.email-taken": 409,
  "account.not-found": 404,
  "account.last-admin": 409,
  "account.self": 409,
  "account.last-factor": 409,
  "role.forbidden": 403,
  "csrf.invalid": 403,
  "passkey.unavailable": 501,
  "passkey.failed": 401,
  "explain.not-allowed": 403,
  "explain.unsupported": 400,
  "explain.elsewhere": 409,
  "explain.failed": 502,
  "request.not-found": 404,
  "request.invalid-filter": 400,
  "stream.too-many": 429,
  "input.invalid": 422,
  "server.error": 500,
};

/** A short reference id (8 characters, base32 alphabet) to quote to support. */
export function createErrorRef(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let ref = "";

  for (const byte of bytes) ref += alphabet[byte % alphabet.length];

  return ref;
}

/**
 * An error a dashboard route answers with. The production error handler turns
 * it into `{ error, code, ref?, instance? }` with `statusCode`.
 */
export class DevtoolsApiError extends Error {
  public readonly code: DevtoolsErrorCode;
  public readonly statusCode: number;
  public readonly ref: string | undefined;
  public readonly instance: string | undefined;

  public constructor(
    code: DevtoolsErrorCode,
    options: { ref?: string; instance?: string; cause?: unknown } = {},
  ) {
    super(
      DEVTOOLS_ERROR_MESSAGES[code],
      options.cause === undefined ? {} : { cause: options.cause },
    );
    this.name = "DevtoolsApiError";
    this.code = code;
    this.statusCode = DEVTOOLS_ERROR_STATUS[code];
    this.ref = options.ref;
    this.instance = options.instance;
  }

  /** The JSON body this error answers with. */
  public toBody(): DevtoolsApiErrorBody {
    return {
      error: this.message,
      code: this.code,
      ...(this.ref === undefined ? {} : { ref: this.ref }),
      ...(this.instance === undefined ? {} : { instance: this.instance }),
    };
  }
}

/**
 * Raised by a store when a unique value is taken (an email) so callers can
 * answer with their own error code.
 */
export class DevtoolsStoreConflictError extends Error {
  public constructor(public readonly field: string) {
    super(`A devtools record with this ${field} already exists.`);
    this.name = "DevtoolsStoreConflictError";
  }
}

/**
 * Built-in secret-key denylist — the redaction floor that applies with no
 * configuration at all.
 *
 * ## Why a default list exists
 *
 * Path-based `redact.paths` is a *tool*; it only protects an application whose
 * every call site was configured correctly, and nothing warns you when one
 * wasn't. The overwhelmingly common leak is mundane and needs no attacker
 * input: `log.error("auth", "login", "failed", { headers: req.headers, body:
 * req.body })` puts a live bearer token and a cleartext password into every
 * sink. A key denylist that runs by default turns redaction from a tool into a
 * default protection.
 *
 * ## Matching semantics — exact, on a normalized key
 *
 * Keys are compared after {@link normalizeRedactKey}: lower-cased with every
 * non-alphanumeric character removed. So one entry covers every spelling
 * convention a codebase might use —
 * `apiKey` / `api_key` / `API-KEY` / `apikey` all normalize to `apikey`.
 *
 * The match is **exact on the normalized key, not a substring**. That is a
 * deliberate trade: substring matching (`*token*`) would also swallow
 * `tokenCount`, `passwordUpdatedAt`, `secretsLoaded` — silent, hard-to-debug
 * data loss in the one place engineers look when something is broken. An exact
 * list is auditable: you can read it and know precisely what disappears. The
 * cost is that unusual spellings are missed, which is why the list carries the
 * concrete wire-format variants that actually show up in HTTP headers
 * (`x-api-key`, `proxy-authorization`, `set-cookie`) and why apps can extend it
 * with `redact.keys`.
 *
 * ## What is deliberately NOT here
 *
 * `key`, `auth`, `hash`, `signature`, `salt`, `id` — all too generic. Each
 * would redact far more non-secret fields than secret ones (`key` alone would
 * blank out every `key` in a keyed collection). Applications that want them
 * add them via `redact.keys`.
 */

/**
 * Normalize a key for denylist comparison: lower-case, strip every
 * non-alphanumeric character. Collapses `apiKey`, `api_key`, `API-KEY`,
 * `Api Key` and `apikey` onto a single entry.
 */
export function normalizeRedactKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The default denylist, in source spelling. Anything whose normalized key
 * matches one of these is replaced by the configured censor (`"[REDACTED]"`
 * by default) at any depth of `context`, `message`, or an `Error`'s own
 * enumerable properties.
 *
 * Exported so applications can inspect, log, or build on the exact set they
 * are getting rather than guessing at it.
 */
export const DEFAULT_REDACT_KEYS: readonly string[] = [
  // --- Passwords ---------------------------------------------------------
  "password",
  "passwd",
  "pwd",
  "passphrase",
  "passwordHash",
  "currentPassword",
  "newPassword",
  "passwordConfirmation",

  // --- Shared secrets ----------------------------------------------------
  "secret",
  "clientSecret",
  "appSecret",
  "apiSecret",
  "secretKey",

  // --- Tokens ------------------------------------------------------------
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
  "authToken",
  "apiToken",
  "bearerToken",
  "csrfToken",
  "sessionToken",
  "resetToken",
  "verificationToken",
  "jwt",
  "otp",

  // --- Keys --------------------------------------------------------------
  "apiKey",
  "privateKey",
  "encryptionKey",
  "signingKey",

  // --- HTTP credential headers -------------------------------------------
  // Header names are matched in their wire spelling; normalization removes
  // the dashes, so `x-api-key` and `X_API_KEY` both land on `xapikey`.
  "authorization",
  "proxyAuthorization",
  "x-api-key",
  "x-auth-token",
  "cookie",
  "set-cookie",

  // --- Session / credential containers -----------------------------------
  // `sessionId` is a bearer credential: whoever reads it from a log can
  // replay the session. Teams that log it deliberately for correlation can
  // drop it via `redact.keys` + `defaultKeys: false`, or keep a prefix with a
  // function censor.
  "sessionId",
  "credentials",
  "credential",
  "connectionString",

  // --- Financial / high-sensitivity PII ----------------------------------
  "creditCard",
  "creditCardNumber",
  "cardNumber",
  "cvv",
  "cvc",
  "ssn",
  "socialSecurityNumber",
  "iban",
  "taxId",
];

/**
 * The default denylist, pre-normalized. Frozen at module load so the hot path
 * never rebuilds it.
 */
export const DEFAULT_REDACT_KEY_SET: ReadonlySet<string> = new Set(
  DEFAULT_REDACT_KEYS.map(normalizeRedactKey),
);

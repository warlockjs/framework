import type { EnvironmentOverride } from "./detect-environment-overrides";

/**
 * Key names shaped like a secret. Matched values are redacted in the printed
 * line even though the key itself is still named — knowing WHICH secret was
 * overridden is useful, the value never is.
 */
const SECRET_KEY_PATTERN =
  /(PASS|PWD|SECRET|TOKEN|KEY|CREDENTIAL|DSN|CONNECTION_STRING|AUTH|PRIVATE)/i;

/**
 * Key names that usually hold a connection URL (`REDIS_URL`, `MONGODB_URI`).
 * Such a value is redacted whole when it contains `@`, which is where a URL
 * carries its credentials.
 */
const URL_KEY_PATTERN = /(URL|URI)/i;

/**
 * The userinfo part of any `scheme://user:password@host` value.
 */
const URL_USERINFO_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)[^/?#@\s]*@/gi;

const REDACTED_PLACEHOLDER = "<redacted>";

/**
 * The value as it may be printed: redacted whole for a secret-shaped key or a
 * URL-shaped key with credentials, otherwise with any URL userinfo masked.
 */
function printableValue(key: string, value: string): string {
  if (SECRET_KEY_PATTERN.test(key)) return REDACTED_PLACEHOLDER;

  if (URL_KEY_PATTERN.test(key) && value.includes("@")) return REDACTED_PLACEHOLDER;

  return value.replace(URL_USERINFO_PATTERN, `$1${REDACTED_PLACEHOLDER}@`);
}

/**
 * Tell the developer, one line per key, which `.env` values the ambient
 * process environment silently beat.
 *
 * Uses `console.warn` (stderr) rather than the `log` singleton on purpose:
 * this runs from `loadEnvironmentFiles()`, ahead of the logger connector in
 * the boot sequence, so any channel configured through `log.*` has nowhere to
 * deliver to yet. Same reasoning as `console.error` in
 * `src/http/boot-port-preflight.ts`.
 */
export function reportEnvironmentOverrides(overrides: EnvironmentOverride[]): void {
  for (const override of overrides) {
    const effectiveValue = printableValue(override.key, String(override.effectiveValue));
    const fileValue = printableValue(override.key, String(override.fileValue));

    console.warn(
      `[env] ${override.key}=${effectiveValue} is in effect from the process environment, overriding .env's ${override.key}=${fileValue}`,
    );
  }
}

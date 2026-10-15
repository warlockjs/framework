import type { EnvironmentOverride } from "./detect-environment-overrides";

/**
 * Key names shaped like a secret. Matched values are redacted in the printed
 * line even though the key itself is still named — knowing WHICH secret was
 * overridden is useful, the value never is.
 */
const SECRET_KEY_PATTERN = /(PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|DSN|CONNECTION_STRING)/i;

const REDACTED_PLACEHOLDER = "<redacted>";

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
    const isSecretShaped = SECRET_KEY_PATTERN.test(override.key);
    const effectiveValue = isSecretShaped ? REDACTED_PLACEHOLDER : override.effectiveValue;
    const fileValue = isSecretShaped ? REDACTED_PLACEHOLDER : override.fileValue;

    console.warn(
      `[env] ${override.key}=${effectiveValue} is in effect from the process environment, overriding .env's ${override.key}=${fileValue}`,
    );
  }
}

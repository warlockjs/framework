/** Deadline for one provider HTTP request when `timeoutMs` is not configured. */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 5000;

/**
 * Resolve and validate a provider's `timeoutMs` — the deadline for each token,
 * profile and key-set request it makes. Throws naming the provider when the
 * value cannot be used as a timer delay.
 */
export function providerTimeoutMs(provider: string, value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_PROVIDER_TIMEOUT_MS;

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new Error(
      `${provider} provider timeoutMs must be a positive integer no greater than 2147483647 ` +
        `(set auth.providers.<name>.timeoutMs, or leave it unset for ${DEFAULT_PROVIDER_TIMEOUT_MS}).`,
    );
  }

  return timeoutMs;
}

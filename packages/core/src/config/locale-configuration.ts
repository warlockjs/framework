export type LocaleConfiguration = {
  defaultLocaleCode: string;
  localeCodes: string[];
};

type AppLocaleConfiguration = {
  localeCode?: unknown;
  localeCodes?: unknown;
};

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((candidate) => typeof candidate === "string")
  );
}

/**
 * Resolve the fail-closed locale configuration used by every request.
 */
export function resolveLocaleConfiguration(
  localeCode: unknown,
  localeCodes: unknown,
): LocaleConfiguration {
  const defaultLocaleCode =
    typeof localeCode === "string" && localeCode.length > 0 ? localeCode : "en";

  return {
    defaultLocaleCode,
    localeCodes: isNonEmptyStringArray(localeCodes) ? localeCodes : [defaultLocaleCode],
  };
}

/**
 * A default outside the declared list makes every fallback contradictory, so
 * configuration loading must stop before the application can accept requests.
 */
export function assertLocaleConfiguration(config: AppLocaleConfiguration): void {
  const { defaultLocaleCode } = resolveLocaleConfiguration(
    config.localeCode,
    config.localeCodes,
  );

  if (
    isNonEmptyStringArray(config.localeCodes) &&
    !config.localeCodes.includes(defaultLocaleCode)
  ) {
    throw new Error(
      `app.localeCodes does not include the resolved default locale "${defaultLocaleCode}". ` +
        `Add "${defaultLocaleCode}" to app.localeCodes or change app.localeCode; ` +
        `boot cannot continue with a default that the application does not support.`,
    );
  }
}

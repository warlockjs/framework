import type { AppConfigurations } from "../utils/types";
import { configSpecialHandlers } from "./config-special-handlers";
import { assertLocaleConfiguration } from "./locale-configuration";

/**
 * Enforce request-locale configuration when app config loads.
 */
export const registerAppConfig = async (config: AppConfigurations): Promise<void> => {
  assertLocaleConfiguration(config);

  // Load dayjs locales from the legacy app.locales integration.
  const locales = config.locales || ["en"];

  for (const locale of locales) {
    if (locale === "en") continue; // English is default

    try {
      await import(`dayjs/locale/${locale}.js`);
    } catch (error) {
      console.warn(`   ⚠️  Failed to load dayjs locale: ${locale}`);
    }
  }
};

configSpecialHandlers.register("app", registerAppConfig);

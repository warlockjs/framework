import { LogConfigurations, setLogConfigurations } from "../logger";
import { MailConfigurations, setMailConfigurations } from "../mail";
import { AppConfigurations } from "../utils/types";
import { configSpecialHandlers } from "./config-special-handlers";

/**
 * App Config Handler
 * Handles locale loading for dayjs
 */
export const registerAppConfig = async (config: AppConfigurations) => {
  // Load dayjs locales based on app.localeCodes
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

/**
 * Log Config Handler
 * Sets log configurations in @warlock.js/core
 */
export const registerLogConfig = async (logConfig: LogConfigurations) => {
  try {
    setLogConfigurations(logConfig);
  } catch (error) {
    // @warlock.js/core might not be available in all projects
    console.warn("   ⚠️  Could not set log configurations");
  }
};

configSpecialHandlers.register("log", registerLogConfig);

/**
 * Mail Config Handler
 * Sets mail configurations in @warlock.js/core
 */
export const registerMailConfig = async (mailConfig: MailConfigurations) => {
  try {
    setMailConfigurations(mailConfig);
  } catch (error) {
    // @warlock.js/core might not be available in all projects
    console.warn("   ⚠️  Could not set mail configurations");
  }
};

configSpecialHandlers.register("mail", registerMailConfig);

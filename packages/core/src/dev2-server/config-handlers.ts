import { setLogConfigurations } from "./../logger";
import { setMailConfigurations } from "./../mail";
import type { ConfigLoader } from "./config-loader";

/**
 * Register Special Config Handlers
 * This file contains all special handling logic for specific configs
 * Keep ConfigLoader clean by registering handlers here
 */
export function registerConfigHandlers(configLoader: ConfigLoader): void {
  /**
   * App Config Handler
   * Handles locale loading for dayjs
   */
  configLoader.registerSpecialHandler("app", async appConfig => {
    // Load dayjs locales based on app.localeCodes
    const locales = appConfig.localeCodes || ["en"];

    for (const locale of locales) {
      if (locale === "en") continue; // English is default

      try {
        await import(`dayjs/locale/${locale}.js`);
      } catch (error) {
        console.warn(`   ⚠️  Failed to load dayjs locale: ${locale}`);
      }
    }
  });

  /**
   * Log Config Handler
   * Sets log configurations in @warlock.js/core
   */
  configLoader.registerSpecialHandler("log", async logConfig => {
    try {
      setLogConfigurations(logConfig);
    } catch (error) {
      // @warlock.js/core might not be available in all projects
      console.warn("   ⚠️  Could not set log configurations");
    }
  });

  /**
   * Mail Config Handler
   * Sets mail configurations in @warlock.js/core
   */
  configLoader.registerSpecialHandler("mail", async mailConfig => {
    try {
      setMailConfigurations(mailConfig);
    } catch (error) {
      // @warlock.js/core might not be available in all projects
      console.warn("   ⚠️  Could not set mail configurations");
    }
  });

  // Add more special handlers here as needed
  // Example:
  // configLoader.registerSpecialHandler("custom", async (customConfig) => {
  //   // Your custom handling logic
  // });
}

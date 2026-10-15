import { env, type AppConfigurations } from "@warlock.js/core";

const appConfigurations: AppConfigurations = {
  appName: env("APP_NAME", "warlock-pnpm-acceptance"),
  timezone: "UTC",
  baseUrl: env("BASE_URL", "http://localhost:3711"),
  localeCode: "en",
  localeCodes: ["en"],
};

export default appConfigurations;

import { env, type AppConfigurations } from "@warlock.js/core";

const appConfigurations: AppConfigurations = {
  appName: env("APP_NAME", "warlock-runtime-acceptance"),
  timezone: "UTC",
  baseUrl: env("BASE_URL", "http://127.0.0.1:4719"),
  localeCode: "en",
  localeCodes: ["en"],
};

export default appConfigurations;

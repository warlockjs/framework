import {
  env,
  storageConfigurations,
  uploadsPath,
  type StorageConfigurations,
} from "@warlock.js/core";

/**
 * Driver is chosen per environment: leave STORAGE_DRIVER unset in development
 * (local files) and set it to `r2` or `aws` in production.
 */
const storageOptions: StorageConfigurations = {
  default: env("STORAGE_DRIVER", "local"),
  drivers: {
    local: storageConfigurations.local({
      root: uploadsPath(),
      urlPrefix: "/uploads",
    }),
    aws: storageConfigurations.aws({
      accessKeyId: env("AWS_ACCESS_KEY_ID"),
      secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
      region: env("AWS_REGION"),
      bucket: env("AWS_BUCKET"),
    }),
    r2: storageConfigurations.r2({
      bucket: env("R2_BUCKET"),
      endpoint: env("R2_ENDPOINT"),
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
      accountId: env("R2_ACCOUNT_ID"),
      region: env("R2_REGION", "auto"),
      publicDomain: env("R2_BASE_URL"),
      // Keys live under the app name by default, so apps sharing one bucket
      // do not overwrite each other's files. Set R2_PREFIX to choose another.
      prefix: env("R2_PREFIX", env("APP_NAME", "warlock.js")),
    }),
  },
};

export default storageOptions;

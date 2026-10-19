import { SecretStoreError } from "./errors";
import type { SecretsConfigurations } from "./types";

/** Resolve and enforce policy before looking up even an already cached store. */
export function resolveSecretsDriver(options: SecretsConfigurations): "auto" | "memory" {
  const driver = options.driver ?? process.env.SECRETS_DRIVER ?? "auto";
  if (driver !== "auto" && driver !== "memory") throw new SecretStoreError("INVALID_DRIVER");
  if (
    driver === "memory" &&
    process.env.NODE_ENV === "production" &&
    options.allowMemoryInProduction !== true
  ) {
    throw new SecretStoreError("MEMORY_IN_PRODUCTION");
  }
  return driver;
}

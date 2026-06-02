import { UploadsConfigurations } from "./uploads-types.mjs";

//#region ../../@warlock.js/core/src/http/uploads-config.d.ts
/**
 * Default uploads configuration values
 *
 * These defaults are used when no configuration is provided
 * or when specific keys are missing from the app config.
 */
declare const UPLOADS_DEFAULTS: UploadsConfigurations;
/**
 * Get uploads configuration value
 *
 * Retrieves a configuration value from the `uploads` section of app config,
 * falling back to the provided default or the built-in default.
 *
 * @param key - Configuration key to retrieve
 * @param defaultValue - Optional default value if not found
 * @returns The configuration value
 *
 * @example
 * ```typescript
 * const naming = uploadsConfig("name"); // "random" or "original"
 * const length = uploadsConfig("randomLength", 32);
 * ```
 */
declare function uploadsConfig<K extends keyof UploadsConfigurations>(key: K, defaultValue?: UploadsConfigurations[K]): UploadsConfigurations[K];
//#endregion
export { UPLOADS_DEFAULTS, uploadsConfig };
//# sourceMappingURL=uploads-config.d.mts.map
//#region ../../@warlock.js/core/src/config/types.d.ts
/**
 * Config registry interface.
 *
 * Extended via module augmentation by generated typings.
 * Each key represents a config file name (e.g., "database", "app").
 *
 * @example Generated augmentation:
 * ```typescript
 * declare module "@warlock.js/core" {
 *   interface ConfigRegistry {
 *     app: true;
 *     database: true;
 *     storage: true;
 *   }
 * }
 * ```
 */
interface ConfigRegistry {}
/**
 * Config name type.
 *
 * Extracts config names from the registry interface.
 * Falls back to `string` if no configs are registered.
 */
type ConfigName = keyof ConfigRegistry extends never ? string : keyof ConfigRegistry;
/**
 * Config key registry interface.
 *
 * Extended via module augmentation by generated typings.
 * Each key is a dot-notation path (e.g., "database.host").
 *
 * @example Generated augmentation:
 * ```typescript
 * declare module "@warlock.js/core" {
 *   interface ConfigKeyRegistry {
 *     "app.appName": true;
 *     "database.host": true;
 *   }
 * }
 * ```
 */
interface ConfigKeyRegistry {}
/**
 * Config key type.
 *
 * Extracts config key paths from the registry interface.
 * Falls back to `string` if no keys are registered.
 */
type ConfigKey = keyof ConfigKeyRegistry extends never ? string : keyof ConfigKeyRegistry;
//#endregion
export { ConfigKey, ConfigKeyRegistry, ConfigName, ConfigRegistry };
//# sourceMappingURL=types.d.mts.map
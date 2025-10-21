import baseConfig from "@mongez/config";

/**
 * Augmentable config keys interface
 * Users augment this to add their config keys
 */
export interface ConfigKeysRegistry {
  // Empty by default - augmented by generated types
}

/**
 * Config keys type - derived from registry or fallback to string
 */
export type ConfigKeys = [keyof ConfigKeysRegistry] extends [never]
  ? string
  : keyof ConfigKeysRegistry;

/**
 * Config type mapping interface
 * Users can augment this to add return types for specific config keys
 *
 * Example:
 *   declare module "@warlock.js/core" {
 *     interface ConfigTypeMap {
 *       database: import("@warlock.js/cascade").DatabaseConfigurations;
 *       app: import("@warlock.js/core").AppConfigurations;
 *     }
 *   }
 */
export interface ConfigTypeMap {
  // Empty by default - users augment this for deep typing
}

/**
 * Typed configuration wrapper with autocomplete support
 *
 * This wraps @mongez/config with type-safe keys that are
 * auto-generated from your src/config/ directory.
 *
 * Usage:
 *   import { config } from "@warlock.js/core";
 *   const dbConfig = config.get("database"); // ✅ Autocomplete!
 *   const appName = config.get("app"); // ✅ Type-safe!
 */
export const config = {
  get<K extends ConfigKeys>(
    key: K,
    defaultValue?: any,
  ): K extends keyof ConfigTypeMap ? ConfigTypeMap[K] : any {
    return baseConfig.get(key, defaultValue);
  },

  key(fullKey: string, defaultValue?: any) {
    return baseConfig.get(fullKey, defaultValue);
  },
  set<K extends ConfigKeys>(key: K, value: any): void {
    baseConfig.set(key, value);
  },

  has(key: ConfigKeys): boolean {
    // mongez/config doesn't have has(), so we check if value exists
    return baseConfig.get(key) !== undefined;
  },

  all(): Record<string, any> {
    // mongez/config uses list() instead of all()
    return baseConfig.list();
  },
};

// Re-export other utilities from base config if needed
export default config;

import { WarlockConfig } from "./types.mjs";

//#region ../../@warlock.js/core/src/warlock-config/warlock-config.manager.d.ts
/**
 * Warlock Config Manager
 *
 * Manages lazy loading of the pre-compiled warlock.config.js file
 * from the .warlock/cache directory.
 */
declare class WarlockConfigManager {
  /**
   * Cached config instance
   */
  private config?;
  /**
   * Loading promise to prevent duplicate loads
   */
  private loading?;
  /**
   * Load warlock.config.js (cached after first load)
   *
   * @returns The resolved Warlock configuration
   */
  load(): Promise<WarlockConfig | undefined>;
  /**
   * Internal load implementation
   *
   * The ESM loader hook transpiles `warlock.config.ts` on import â€” no
   * separate compile-to-disk step is needed.
   */
  private doLoad;
  /**
   * Get config value by key (dot notation supported)
   *
   * @example
   * config.get("server.port") // Returns 3000
   * config.get("cli.commands") // Returns array of commands
   *
   * @param key - Config key (supports dot notation), autocompletes for first level only
   * @returns The config value
   * @throws Error if config is not loaded
   */
  get<Key extends keyof WarlockConfig>(key: Key, defaultValue?: WarlockConfig[Key]): WarlockConfig[Key];
  /**
   * Lazy get - loads config if not already loaded
   *
   * @example
   * const port = await config.lazyGet("server");
   *
   * @param key - Config key (supports dot notation), autocompletes for first level only
   * @param defaultValue - Default value if config key is undefined
   * @returns The config value
   */
  lazyGet<Key extends keyof WarlockConfig>(key: Key, defaultValue?: WarlockConfig[Key]): Promise<WarlockConfig[Key]>;
  /**
   * Check if config is loaded
   */
  get isLoaded(): boolean;
  /**
   * Get the entire config object
   *
   * @throws Error if config is not loaded
   */
  getAll(): WarlockConfig;
  /**
   * Reload config (useful for HMR/development)
   */
  reload(): Promise<void>;
}
/**
 * Exported singleton instance
 *
 * @example
 * import { warlockConfig } from "@warlock.js/core";
 *
 * // Lazy load and get value
 * const port = await warlockConfig.lazyGet("server.port");
 *
 * // Or load first, then get
 * await warlockConfig.load();
 * const commands = warlockConfig.get("cli.commands");
 */
declare const warlockConfigManager: WarlockConfigManager;
//#endregion
export { WarlockConfigManager, warlockConfigManager };
//# sourceMappingURL=warlock-config.manager.d.mts.map
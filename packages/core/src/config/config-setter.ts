import baseConfig from "@mongez/config";
import type { ConfigRegistry } from "./types";

/**
 * Register a config group under its name.
 *
 * The write side of the config store, kept separate from the `config` accessor
 * on purpose: `config` is a read-only surface and widening it would invite app
 * code to mutate configuration at runtime. Registration is a boot-time act.
 *
 * Exported chiefly so the production build's generated config loader has a
 * specifier the consuming app actually declares — `@warlock.js/core` — rather
 * than `@mongez/config`, which is core's dependency and not the app's.
 *
 * @example
 * ```typescript
 * import { setConfig } from "@warlock.js/core";
 * import databaseConfig from "../../src/config/database";
 *
 * setConfig("database", databaseConfig);
 * ```
 */
export function setConfig<K extends keyof ConfigRegistry>(name: K, value: ConfigRegistry[K]): void;
export function setConfig(name: string, value: unknown): void;
export function setConfig(name: string, value: unknown): void {
  baseConfig.set(name, value);
}

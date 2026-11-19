/** Where a worker remembers that the application's modules were loaded. */
export const APP_MODULES_LOADED_KEY = Symbol.for("warlock.core.testAppModulesLoaded");

export const APP_MODULES_ROOT_KEY = Symbol.for("warlock.core.testAppModulesRoot");

export type LoadedHolder = {
  [APP_MODULES_LOADED_KEY]?: Promise<void>;
  [APP_MODULES_ROOT_KEY]?: string;
};

/**
 * Whether this worker already loaded the application's modules.
 *
 * @internal
 */
export function hasLoadedAppModules(): boolean {
  return (globalThis as LoadedHolder)[APP_MODULES_LOADED_KEY] !== undefined;
}

/**
 * Forget the loaded application modules, so the next
 * `createTestHttpServer({ loadAppModules: true })` imports them again through
 * the importer it is given. `tests.lifetime: "worker-isolated"` calls this at
 * every file boundary, after the module registry was reset.
 *
 * @internal
 */
export function forgetLoadedAppModules(): void {
  (globalThis as LoadedHolder)[APP_MODULES_LOADED_KEY] = undefined;
}

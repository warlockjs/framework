import { SpecialFilesCollector } from "./special-files-collector.mjs";
import { FileManager } from "./file-manager.mjs";

//#region ../../@warlock.js/core/src/dev-server/module-loader.d.ts
declare global {
  var __currentModuleFile: FileManager | undefined;
}
/**
 * Loads application modules through the ESM loader hook. The hook stamps
 * `?v=N` on every import, so each reload is a fresh module without any
 * userland cache-busting plumbing.
 */
declare class ModuleLoader {
  private readonly specialFilesCollector;
  private readonly loadedModules;
  constructor(specialFilesCollector: SpecialFilesCollector);
  /**
   * Eagerly load every special file at boot, in the canonical order so
   * later phases (e.g. routes) see state earlier phases registered.
   */
  loadAll(): Promise<void>;
  /**
   * Import a file through the loader hook. For routes, scopes the import in
   * `router.withSourceFile()` so the added routes carry their origin.
   */
  loadModule<T = unknown>(file: FileManager, type: string): Promise<T | undefined>;
  /**
   * Reload a previously-loaded special file. The version-bump that makes the
   * import fresh is done by the caller (layer-executor) before invoking this.
   * Routes are removed from the registry first so re-registration is clean.
   */
  reloadModule(file: FileManager): Promise<void>;
  /**
   * Run every cleanup hook the file registered (or `$cleanup` on its exports)
   * and reset the list. Called once per HMR reload.
   */
  runCleanup(file: FileManager): void;
  /**
   * Clean up after a file whose source was deleted from disk.
   */
  cleanupDeletedModule(file: FileManager): void;
  /**
   * Scan a freshly-loaded module for cleanup handlers and register them on
   * the FileManager so they run before the next reload. Priority: explicit
   * `export function cleanup()` → `.$cleanup` on any exported value.
   */
  private registerCleanup;
}
//#endregion
export { ModuleLoader };
//# sourceMappingURL=module-loader.d.mts.map
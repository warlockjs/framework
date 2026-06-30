import { pathToFileURL } from "node:url";
import { router } from "../router/router";
import { devLogError, formatModuleNotFoundError } from "./dev-logger";
import type { CleanupFunction, FileManager } from "./file-manager";
import type { SpecialFileType, SpecialFilesCollector } from "./special-files-collector";

declare global {
  var __currentModuleFile: FileManager | undefined;
}

/**
 * Thrown when a special file (route/event/main/locale) fails to import or
 * register. Carries the file that failed and the original cause so a broken
 * module surfaces with its origin instead of vanishing into a 404.
 */
export class ModuleLoadError extends Error {
  public constructor(
    public readonly type: string,
    public readonly file: FileManager,
    public readonly cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to load ${type}: ${file.relativePath} - ${reason}`);
    this.name = "ModuleLoadError";
  }
}

/**
 * The four "special" file kinds that the dev server eagerly imports at boot.
 * Order matters: locales first (used by everything), events before main so
 * listeners are registered when main runs, routes last so handlers are bound.
 */
const SPECIAL_TYPES: readonly SpecialFileType[] = ["locale", "event", "main", "route"] as const;

/**
 * Loads application modules through the ESM loader hook. The hook stamps
 * `?v=N` on every import, so each reload is a fresh module without any
 * userland cache-busting plumbing.
 */
export class ModuleLoader {
  private readonly loadedModules = new Map<string, unknown>();

  constructor(private readonly specialFilesCollector: SpecialFilesCollector) {}

  /**
   * Eagerly load every special file at boot, in the canonical order so
   * later phases (e.g. routes) see state earlier phases registered.
   *
   * A failing module no longer vanishes silently: each failure is collected
   * (so one broken file doesn't hide the others) and, once every file has been
   * attempted, an aggregate error is thrown. The boot callers
   * (`DevelopmentServer.start`, the HTTP test bootstrap) already wrap this in a
   * try/catch that logs and aborts the boot — so a broken route module aborts
   * boot loudly rather than booting into a surface that 404s.
   */
  public async loadAll(): Promise<void> {
    const failures: ModuleLoadError[] = [];

    for (const type of SPECIAL_TYPES) {
      for (const file of this.specialFilesCollector.getFilesByType(type)) {
        try {
          await this.loadModule(file, type);
        } catch (error) {
          failures.push(
            error instanceof ModuleLoadError ? error : new ModuleLoadError(type, file, error),
          );
        }
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `${failures.length} module(s) failed to load during boot:\n` +
          failures.map((failure) => `  - ${failure.message}`).join("\n"),
      );
    }
  }

  /**
   * Import a file through the loader hook. For routes, scopes the import in
   * `router.withSourceFile()` so the added routes carry their origin.
   */
  public async loadModule<T = unknown>(
    file: FileManager,
    type: string,
  ): Promise<T | undefined> {
    if (file.relativePath.endsWith(".env")) return undefined;

    globalThis.__currentModuleFile = file;

    try {
      const fileUrl = pathToFileURL(file.absolutePath).href;

      const load = async () => {
        const module = (await import(fileUrl)) as Record<string, unknown>;
        this.loadedModules.set(file.absolutePath, module);
        this.registerCleanup(file, module);
        return module as T;
      };

      return type === "route"
        ? await router.withSourceFile(file.relativePath, load)
        : await load();
    } catch (error: any) {
      if (error.code === "ERR_MODULE_NOT_FOUND") {
        devLogError(formatModuleNotFoundError(error));
      } else {
        // Pass the error through so devLogError prints the stack. With dev
        // source maps enabled, frames remap to the original `.ts` line/col
        // (e.g. the actual call site of an undefined symbol) instead of
        // vanishing — a one-line "x is not defined" is undebuggable.
        devLogError(
          `Failed to load ${type}: ${file.relativePath} - ${error?.message || error}`,
          error,
        );
      }

      // RETHROW after logging. Previously this returned undefined, so a route
      // file that threw on import or registration disappeared with no boot
      // error — the whole surface 404'd silently. Boot callers abort on the
      // throw; the HMR batch-reload handler catches it, keeps the server
      // alive, and shows it loudly.
      throw error instanceof ModuleLoadError ? error : new ModuleLoadError(type, file, error);
    } finally {
      globalThis.__currentModuleFile = undefined;
    }
  }

  /**
   * Reload a previously-loaded special file. The version-bump that makes the
   * import fresh is done by the caller (layer-executor) before invoking this.
   * Routes are removed from the registry first so re-registration is clean.
   */
  public async reloadModule(file: FileManager): Promise<void> {
    const moduleType = this.specialFilesCollector.getFileType(file.relativePath);
    if (!moduleType) return;

    this.runCleanup(file);

    if (moduleType === "route") {
      router.removeRoutesBySourceFile(file.relativePath);
    }

    this.loadedModules.delete(file.absolutePath);
    await this.loadModule(file, moduleType);
  }

  /**
   * Run every cleanup hook the file registered (or `$cleanup` on its exports)
   * and reset the list. Called once per HMR reload.
   */
  public runCleanup(file: FileManager): void {
    for (const hook of file.cleanup) {
      try {
        if (typeof hook === "function") {
          hook();
        } else if (hook && typeof (hook as { unsubscribe?: () => void }).unsubscribe === "function") {
          (hook as { unsubscribe: () => void }).unsubscribe();
        }
      } catch {
        // Cleanup errors shouldn't break HMR.
      }
    }
    file.resetCleanup();
  }

  /**
   * Clean up after a file whose source was deleted from disk.
   */
  public cleanupDeletedModule(file: FileManager): void {
    this.loadedModules.delete(file.absolutePath);

    if (file.type === "route") {
      router.removeRoutesBySourceFile(file.relativePath);
    }

    this.runCleanup(file);
  }

  /**
   * Scan a freshly-loaded module for cleanup handlers and register them on
   * the FileManager so they run before the next reload. Priority: explicit
   * `export function cleanup()` → `.$cleanup` on any exported value.
   */
  private registerCleanup(file: FileManager, module: Record<string, unknown>): void {
    if (typeof module.cleanup === "function") {
      file.addCleanup(module.cleanup as CleanupFunction);
      return;
    }

    const cleanups: CleanupFunction[] = [];

    for (const exportedValue of Object.values(module)) {
      const cleanup = (exportedValue as { $cleanup?: unknown })?.$cleanup;
      if (typeof cleanup === "function") {
        cleanups.push(cleanup.bind(exportedValue) as CleanupFunction);
      }
    }

    if (cleanups.length > 0) {
      file.addCleanup(cleanups);
    }
  }
}

import type { AppModuleImporter } from "../loader/app-module-importer";
import {
  APP_MODULES_LOADED_KEY,
  APP_MODULES_ROOT_KEY,
  type LoadedHolder,
} from "./app-modules-state";

/**
 * Load the app's modules (`routes.ts`, `main.ts`, events, ...) once per process.
 * `setupTest()` calls it right after boot and `createTestHttpServer()` calls it
 * again, so whichever comes first loads and the other reuses the result.
 *
 * @internal
 */
export async function loadAppModulesOnce(
  importModule: AppModuleImporter | undefined,
): Promise<void> {
  const holder = globalThis as LoadedHolder;
  const root = process.cwd();

  // Modules loaded for another project root say nothing about this one.
  if (holder[APP_MODULES_ROOT_KEY] !== root) {
    holder[APP_MODULES_LOADED_KEY] = undefined;
  }

  holder[APP_MODULES_ROOT_KEY] = root;
  holder[APP_MODULES_LOADED_KEY] ??= (async () => {
    const { loadTestAppModules } = await import("./load-test-app-modules");

    await loadTestAppModules(importModule);
  })().catch((error: unknown) => {
    // A failed load may be retried by the next server.
    holder[APP_MODULES_LOADED_KEY] = undefined;
    throw error;
  });

  await holder[APP_MODULES_LOADED_KEY];
}

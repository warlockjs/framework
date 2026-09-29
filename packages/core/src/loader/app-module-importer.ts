/**
 * How the framework imports APPLICATION modules (config, routes, events, ...).
 *
 * Dev and start use native `import()` — one module graph, nothing to do. Under
 * Vitest the test files run through vite-node while a native `import()` from
 * framework code does not, so one worker would hold two copies of every app
 * class and `instanceof` would fail. `setupTest({ importModule })` installs a
 * hook here so app modules are imported from inside the test's own graph.
 *
 * The state lives on `globalThis` because the framework can be loaded twice in
 * one worker (vite-node copy and native copy) and both must see the same hook.
 */
export type AppModuleImporter = (fileUrl: string) => Promise<unknown>;

const IMPORTER_KEY = Symbol.for("warlock.core.appModuleImporter");

type ImporterHolder = { [IMPORTER_KEY]?: AppModuleImporter };

/**
 * Install (or clear, with `undefined`) the importer used for app modules.
 */
export function setAppModuleImporter(importer: AppModuleImporter | undefined): void {
  (globalThis as ImporterHolder)[IMPORTER_KEY] = importer;
}

/**
 * Import an app module through the installed hook, else natively.
 */
export async function importAppModule(fileUrl: string): Promise<any> {
  const importer = (globalThis as ImporterHolder)[IMPORTER_KEY];

  if (importer) return importer(fileUrl);

  return import(fileUrl);
}

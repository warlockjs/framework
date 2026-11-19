/**
 * Per-file module isolation for a worker-scoped runtime
 * (`tests.lifetime: "worker-isolated"`).
 *
 * The worker keeps its connectors, bootstrap and fakes between files, while
 * every file gets a fresh module graph and none of the Vitest state the previous
 * file left behind:
 *
 * - the module registry (`vi.resetModules()`): application modules import again,
 *   so their module-level caches, singletons and `vi.mock` factories start empty;
 * - fake timers, spies, stubbed environment variables and stubbed globals.
 *
 * Only inlined modules are re-evaluated. Packages Vitest externalizes (every
 * `@warlock.js/*` package installed from `node_modules`) are loaded by Node and
 * keep their one instance, which is what keeps the open connections alive.
 */
import { forgetLoadedAppModules, hasLoadedAppModules } from "./app-modules-state";
import { testRuntimeScope, timeTestStep } from "./test-runtime-scope";

const MANAGER_KEY = Symbol.for("@warlock.js/core:tests:connectors-manager");

type ManagerHost = typeof globalThis & { [MANAGER_KEY]?: unknown };

/** What one per-file reset did; for specs and the setup profile. */
export type FreshModuleGraphReport = {
  modulesReset: boolean;
};

/**
 * Reset Vitest's per-file state. Safe to call when Vitest is not loaded: the
 * report says nothing was reset.
 */
export async function resetFileModuleGraph(): Promise<FreshModuleGraphReport> {
  const { vi } = await import("vitest");

  // Order matters: real timers first, so nothing below waits on a fake clock.
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();

  return { modulesReset: true };
}

const SILENCER_KEY = Symbol.for("@warlock.js/test:silence-re-registration");

/**
 * Test-only switch the model and use case registries check: while it exists,
 * "already registered" warnings are counted here instead of logged, but only
 * for a name an earlier file window registered. A fresh module graph per file
 * registers the same names again by design; two registrations of one name
 * inside the same file window are a real duplicate and still warn.
 *
 * @internal
 */
export type ReRegistrationSilencer = {
  count: number;
  /** Names registered since the last file boundary. */
  current: Set<string>;
  /** Names registered in an earlier file window. Only these are silenced. */
  previous: Set<string>;
};

export function installReRegistrationSilencer(): ReRegistrationSilencer {
  const host = globalThis as { [key: symbol]: ReRegistrationSilencer | undefined };

  return (host[SILENCER_KEY] ??= { count: 0, current: new Set(), previous: new Set() });
}

/**
 * Everything a file boundary does for a fresh module graph: undo the
 * application modules the previous file loaded (use cases and models
 * unregister, listeners unsubscribe, their routes go), forget that they were
 * loaded so the next `createTestHttpServer({ loadAppModules: true })` imports
 * them through this file's module graph, then reset Vitest's own state.
 */
export async function prepareFreshFile(): Promise<void> {
  const silencer = installReRegistrationSilencer();

  if (silencer.count > 0 && process.env.WARLOCK_TEST_PROFILE === "1") {
    console.debug(
      `[vitest-setup] ${silencer.count} duplicate model / use case registration warning(s) hidden for the previous file`,
    );
  }

  silencer.count = 0;

  for (const name of silencer.current) silencer.previous.add(name);

  silencer.current.clear();

  if (hasLoadedAppModules()) {
    const { disposeLoadedAppModules } = await import("./load-test-app-modules");

    await timeTestStep("appModulesDispose", async () => {
      await disposeLoadedAppModules();
    });
  }

  forgetLoadedAppModules();
  await resetFileModuleGraph();
}

/**
 * Remember the connectors manager the worker booted, so a later file can tell
 * that the framework was re-evaluated (and the connectors it holds are gone from
 * view) instead of silently running against an empty manager.
 */
export function rememberConnectorsManager(manager: unknown): void {
  (globalThis as ManagerHost)[MANAGER_KEY] = manager;
}

/**
 * Whether the connectors manager this file sees is the one the worker booted.
 * It is not when `@warlock.js/core` is inlined (for example `server.deps.inline`,
 * or a workspace link resolved outside `node_modules`), because
 * `vi.resetModules()` then re-evaluates it too.
 */
export function connectorsManagerSurvived(manager: unknown): boolean {
  const booted = (globalThis as ManagerHost)[MANAGER_KEY];

  return booted === undefined || booted === manager;
}

export const CONNECTORS_MANAGER_LOST_MESSAGE =
  'tests.lifetime: "worker-isolated" needs @warlock.js/core to stay externalized: the connectors manager this file imported is not the one the worker booted, so every open connection is out of reach. Remove @warlock.js/* from `server.deps.inline` and install the packages from node_modules.';

/** Whether the open worker runtime gives every file a fresh module graph. */
export function usesFreshModuleGraph(): boolean {
  return testRuntimeScope().freshModules === true;
}

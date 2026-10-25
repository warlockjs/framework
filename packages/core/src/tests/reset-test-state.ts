/**
 * Process-local state a worker-scoped test runtime returns to its boot state
 * between files.
 *
 * With `tests.lifetime: "worker"` the framework boots once per Vitest worker, so
 * whatever a file leaves behind in memory is still there for the next file. The
 * database has its own reset (`tests.resetDatabase`) and the fakes are reinstalled
 * by the lifecycle (mail, queue, cache, storage, clock, ids, secrets). This module
 * covers the rest:
 *
 * - routes a file registered by hand (the route table goes back to the snapshot
 *   taken once the application booted);
 * - the request context a file entered and never left;
 * - a real in-memory cache store, when the cache fake is switched off.
 *
 * Imports are lazy: a worker that never touches the router or the cache does not
 * pay for loading them just to reset them, and unit-mode runtimes never reach
 * this module.
 */

/** What one reset did, for the setup profile and for tests. */
export type TestStateResetReport = {
  /** Whether the route table was restored to the boot snapshot. */
  routesRestored: boolean;
  /** Whether a real in-memory cache driver was emptied. */
  cacheFlushed: boolean;
};

/**
 * Remember the route table as the state to come back to. Called once the
 * application booted, and again after its modules loaded.
 */
export async function captureTestRouterSnapshot(): Promise<void> {
  const { router } = await import("../router/router");

  router.captureBootSnapshot();
}

/**
 * Reset the in-memory state a file may have changed.
 */
export async function resetTestRuntimeState(): Promise<TestStateResetReport> {
  const { router } = await import("../router/router");
  const { requestContext } = await import("../http/context/request-context");

  requestContext.clear();

  return {
    routesRestored: router.restoreBootSnapshot(),
    cacheFlushed: await flushRealMemoryCache(),
  };
}

/**
 * Empty the cache's current driver when it is a real in-memory one.
 *
 * The cache fake installs a fresh store for every file already; this is for an
 * app that opted out of it (`fakes: { cache: false }`) and still runs the memory
 * driver. Drivers that talk to Redis or a file are left alone: truncating shared
 * infrastructure is the app's decision, made in `tests.resetBetweenFiles`.
 */
async function flushRealMemoryCache(): Promise<boolean> {
  const { cache, MemoryCacheDriver } = await import("@warlock.js/cache");
  const driver = cache.currentDriver;

  if (!(driver instanceof MemoryCacheDriver)) return false;

  await driver.flush();

  return true;
}

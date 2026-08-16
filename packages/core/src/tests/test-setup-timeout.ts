/**
 * The setup bound for the worker test lifecycle.
 *
 * Owns one decision: how long a `setupTest` attempt may run before the
 * lifecycle gives up on it. `vitest-setup.ts` owns what giving up MEANS.
 *
 * This is a HANG GUARD, not a startup-performance deadline. A cold database, a
 * container that has just been started, a first-run migration — all of those are
 * legitimately slow and none of them are a stuck lifecycle. The default is
 * therefore generous on purpose: it exists so that a setup which will never
 * finish fails with a sentence a caller can act on, instead of stranding the
 * lifecycle in `starting` where `teardownTest`'s wait-then-re-enter path spins
 * until the worker dies of heap exhaustion.
 */
import type { GenericObject } from "@mongez/reinforcements";
import { config } from "../config";

/**
 * Two minutes. Chosen to sit far above any healthy bootstrap and far below the
 * point where a human stops watching — a stuck worker should announce itself
 * while someone is still looking at the terminal.
 */
export const DEFAULT_TEST_SETUP_TIMEOUT = 120_000;

/**
 * A scheduled expiry the lifecycle can cancel when the attempt settles first.
 *
 * @internal
 */
export type TestTimeoutHandle = {
  cancel: () => void;
};

/**
 * How the lifecycle schedules its expiry.
 *
 * Injectable so a spec can prove the bound in milliseconds instead of outliving
 * a real one — see {@link TestLifecycleRegistry.scheduleTimeout}. Deliberately
 * internal: the public API stays the `setupTest` / `teardownTest` pair.
 *
 * @internal
 */
export type TestTimeoutScheduler = (
  timeout: number,
  onExpiry: () => void,
) => TestTimeoutHandle;

/**
 * The real scheduler.
 *
 * `unref` matters: a pending hang guard must never be the reason a worker stays
 * alive after its tests have finished.
 *
 * @internal
 */
export const scheduleRealTimeout: TestTimeoutScheduler = (timeout, onExpiry) => {
  const timer = setTimeout(onExpiry, timeout);

  timer.unref?.();

  return { cancel: () => clearTimeout(timer) };
};

/**
 * Read `tests.setupTimeout`, or `undefined` when the project has not set one.
 *
 * Only meaningful once config files are loaded — before that, every project
 * looks like a project without a `tests` config.
 *
 * @throws when the key is present but is not a positive finite number of
 * milliseconds. Falling back to the default would silently erase a project's
 * configuration, which is the same defect the connector precedence rules out.
 */
export function readConfiguredSetupTimeout(): number | undefined {
  // `config.get` resolves an absent key to its default, and ITS default is
  // `null` — not `{}` — so the explicit `{}` is what keeps this from throwing
  // "Cannot read properties of null" on a project with no `src/config/tests.ts`.
  const testsConfig = config.get<GenericObject>("tests", {});
  const configured = testsConfig?.setupTimeout as unknown;

  if (configured === undefined) {
    return undefined;
  }

  if (typeof configured !== "number" || !Number.isFinite(configured) || configured <= 0) {
    throw new Error(
      `tests.setupTimeout must be a positive number of milliseconds, but it is ${JSON.stringify(configured)}. Remove the key to use the default of ${DEFAULT_TEST_SETUP_TIMEOUT}ms.`,
    );
  }

  return configured;
}

/**
 * The message a caller sees when the bound expires.
 *
 * Names three things, because a hang guard that only says "timed out" sends the
 * reader to the framework's source: what state the lifecycle is stuck in, what
 * bound it exceeded, and how to raise that bound.
 */
export function describeExpiredSetup(timeout: number): string {
  return (
    `setupTest() did not finish within ${timeout}ms and is stuck in the "starting" state. ` +
    "The lifecycle is now poisoned: whatever that attempt had already started is not known to be " +
    "closed, so later setupTest() calls refuse until the Vitest worker is recycled. " +
    `If your cold start is legitimately slower than this, raise the bound with \`tests.setupTimeout\` ` +
    `in \`src/config/tests.ts\` — milliseconds, default ${DEFAULT_TEST_SETUP_TIMEOUT}.`
  );
}

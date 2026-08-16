/**
 * Lifecycle bookkeeping for the worker test runtime.
 *
 * Owns one thing: WHERE the state lives. `setupTest` / `teardownTest` own what
 * the transitions mean.
 *
 * The storage rule is the defect this module exists to fix. A module-scoped
 * `let` is rebuilt for every test file — measured across `forks|threads` ×
 * `isolate true|false` in `proofs/2026-08-12-nova-vitest-setupfiles-lifetime.md`
 * — while the worker itself, and every socket, pool and timer it holds, can
 * survive that rebuild. State that resets precisely where live resources do not
 * is not a guard; it is a lie about what is running.
 *
 * `globalThis` is the right scope for it: one per process for a fork worker, one
 * per thread for a thread worker, never shared between distinct workers — which
 * is exactly the boundary the resources themselves live inside.
 */
import type {
  RequestedTestConnectors,
  TestConnectorsSelection,
} from "./test-connectors-selection";
import type { TestTimeoutScheduler } from "./test-setup-timeout";

/**
 * The transitions the lifecycle serializes through.
 *
 * ```
 * idle -> starting -> ready -> stopping -> idle
 *                                      \-> poisoned
 * ```
 *
 * `poisoned` is reached when the shutdown layer reports a failure: the runtime
 * is neither up nor provably down, so the next `setupTest` must refuse rather
 * than stack a second runtime on top of leaked resources.
 *
 * @internal No state API is public.
 */
export type TestLifecycleState = "idle" | "starting" | "ready" | "stopping" | "poisoned";

/**
 * The single in-flight setup attempt that concurrent `setupTest` callers share.
 *
 * @internal
 */
export type TestSetupAttempt = {
  /**
   * What the caller that opened the attempt asked for, before config was read.
   */
  readonly requested: RequestedTestConnectors;

  /**
   * Settles once the attempt has consulted project config, and therefore doubles
   * as the "config is readable now" barrier a later caller needs before it can
   * resolve its own config-derived selection and compare the two. Rejects with
   * the startup error when the attempt fails before reaching that point.
   */
  readonly effectiveSelection: Promise<TestConnectorsSelection>;

  /**
   * The attempt itself. Resolves when the runtime is ready, rejects with the
   * original startup error.
   */
  readonly completion: Promise<void>;
};

/**
 * @internal
 */
export type TestLifecycleRegistry = {
  state: TestLifecycleState;
  activeSelection?: TestConnectorsSelection;
  setupAttempt?: TestSetupAttempt;
  teardownAttempt?: Promise<void>;

  /**
   * How the setup bound is scheduled. Specs replace it to prove the guard in
   * milliseconds rather than outliving a real two-minute timeout; production
   * leaves it unset and gets {@link scheduleRealTimeout}.
   *
   * It lives here, on the runtime-context registry, for the same reason the
   * state does: a spec that could only reach a module-level slot would be
   * relying on the very rebuild this module exists to survive.
   */
  scheduleTimeout?: TestTimeoutScheduler;

  /**
   * Overrides `tests.setupTimeout` and the default. Internal, for specs — the
   * public surface stays the `setupTest` / `teardownTest` pair.
   */
  setupTimeoutOverride?: number;
};

/**
 * Where the registry hangs off the runtime context.
 *
 * @internal Exported for specs, which must be able to reach the same slot the
 * implementation uses — a spec that could only reset module state would be
 * testing the very assumption this module rejects. Deliberately not re-exported
 * from `src/tests/index.ts`.
 */
export const TEST_LIFECYCLE_REGISTRY_KEY = Symbol.for("@warlock.js/core:tests:lifecycle");

type TestLifecycleHost = typeof globalThis & {
  [TEST_LIFECYCLE_REGISTRY_KEY]?: TestLifecycleRegistry;
};

/**
 * Read the runtime context's lifecycle registry, creating it on first use.
 *
 * @internal
 */
export function getTestLifecycleRegistry(): TestLifecycleRegistry {
  const host = globalThis as TestLifecycleHost;
  const registry = host[TEST_LIFECYCLE_REGISTRY_KEY];

  if (registry) {
    return registry;
  }

  const freshRegistry: TestLifecycleRegistry = { state: "idle" };

  host[TEST_LIFECYCLE_REGISTRY_KEY] = freshRegistry;

  return freshRegistry;
}

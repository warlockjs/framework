/**
 * Worker test lifecycle — `setupTest` / `teardownTest`.
 *
 * Implements `contracts/2026-08-12-test-worker-lifecycle.md`. The pair is
 * context-scoped, not "once per worker": Vitest runs `setupFiles` before EVERY
 * test file and rebuilds the module registry each time, so the harness that
 * calls `setupTest` owns pairing it with `teardownTest` in the same runtime
 * context.
 *
 * Ownership, stated once because teardown is wider than it looks:
 *
 * - the runtime assumes exclusive ownership of the process-local
 *   `connectorsManager` for its lifetime;
 * - it owns the framework bootstrap, the application shutdown hooks, and the
 *   connectors it starts — including the `connectors: false` case, where
 *   bootstrap still registers hooks;
 * - teardown is MANAGER-WIDE. `connectorsManager.shutdown()` has no selective
 *   ownership handle, so a lifecycle that started two connectors still closes
 *   every connector the manager holds. Mixing `setupTest` with manual connector
 *   startup in the same process is unsupported for exactly that reason.
 * - HTTP global setup stays separately owned by `startHttpTestServer` /
 *   `stopHttpTestServer`.
 */
import { Application } from "../application/application";
import { bootstrap } from "../bootstrap";
import { loadConfigFiles } from "../config/load-config-files";
import { connectorsManager } from "../connectors";
import { filesOrchestrator } from "../dev-server/files-orchestrator";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager";
import {
  describeConnectorsSelection,
  isSameConnectorsSelection,
  normalizeConnectorNames,
  readRequestedConnectors,
  resolveEffectiveConnectors,
} from "./test-connectors-selection";
import type {
  RequestedTestConnectors,
  TestConnectorsSelection,
} from "./test-connectors-selection";
import { getTestLifecycleRegistry } from "./test-lifecycle-state";
import type { TestLifecycleRegistry, TestSetupAttempt } from "./test-lifecycle-state";
import {
  DEFAULT_TEST_SETUP_TIMEOUT,
  describeExpiredSetup,
  readConfiguredSetupTimeout,
  scheduleRealTimeout,
} from "./test-setup-timeout";
import type { TestTimeoutHandle } from "./test-setup-timeout";

export type { TestConnectorsSelection } from "./test-connectors-selection";

export type TestSetupOptions = {
  /**
   * Which connectors to start.
   *
   * Precedence is `explicit non-undefined option > tests.connectors config >
   * true`. Omitting the property, or passing `undefined`, lets project config
   * apply — so an optional variable that happens to be `undefined` cannot erase
   * it.
   */
  connectors?: TestConnectorsSelection;
};

/**
 * Raised by the lifecycle itself, never by the runtime it manages — a conflict
 * between two calls, or a refusal to reuse a runtime that did not close.
 */
export class TestLifecycleError extends Error {
  public constructor(message: string) {
    super(message);

    this.name = "TestLifecycleError";
  }
}

const POISONED_MESSAGE =
  "setupTest() refuses to start a test runtime: an earlier teardownTest() reported a shutdown failure, so the connectors, ports and pools it owned are not known to be closed. Restart the Vitest worker before setting up again, or call teardownTest() to retry the shutdown — the lifecycle only returns to idle on a fully successful retry.";

/**
 * Bootstrap the test runtime and start the selected connectors.
 *
 * ⚠ Runs once per TEST FILE, not once per worker: `setupFiles` is executed for
 * every file and its module registry is rebuilt with it, measured across both
 * pools with isolation on and off. The lifecycle state lives on the runtime
 * context rather than in this module precisely so that a rebuild cannot hide a
 * runtime that is still up.
 *
 * Repeated calls:
 *
 * - concurrent calls with the same effective selection share one startup;
 * - while ready, the same effective selection is a no-op;
 * - while starting or ready, a DIFFERENT effective selection rejects and leaves
 *   the live runtime untouched;
 * - a failed setup unwinds and returns to idle, so a clean retry is allowed;
 * - after a successful `teardownTest`, a later setup may use a different
 *   selection.
 *
 * @example
 * // let project config decide, falling back to the default set
 * await setupTest();
 *
 * @example
 * // bootstrap only — no connectors, whatever config says
 * await setupTest({ connectors: false });
 */
export async function setupTest(options?: TestSetupOptions): Promise<void> {
  const registry = getTestLifecycleRegistry();
  const requested = readRequestedConnectors(options?.connectors);

  if (registry.state === "poisoned") {
    throw new TestLifecycleError(POISONED_MESSAGE);
  }

  if (registry.state === "stopping" && registry.teardownAttempt) {
    await settled(registry.teardownAttempt);

    return setupTest(options);
  }

  if (registry.state === "ready") {
    assertReadySelectionMatches(registry.activeSelection, requested);

    return;
  }

  if (registry.state === "starting" && registry.setupAttempt) {
    const attempt = registry.setupAttempt;

    await assertPendingSetupMatches(attempt, requested);

    return attempt.completion;
  }

  return startTestRuntime(requested);
}

/**
 * Shut the test runtime down and release the lifecycle.
 *
 * - idle is a no-op;
 * - concurrent calls share one attempt;
 * - a call made while setup is still running waits for that attempt to settle,
 *   then closes the runtime if it succeeded;
 * - the local "ready" state is always cleared, including when shutdown rejects;
 * - a shutdown rejection is surfaced, never swallowed, and poisons the
 *   lifecycle — a reported close failure is not proof that anything closed, so
 *   later `setupTest` calls refuse until the worker is restarted or a retry
 *   fully succeeds.
 *
 * ⚠ Individual connector shutdown failures are caught and logged inside
 * `connectorsManager.shutdown()`, so they never reach this function and never
 * poison anything. This lifecycle can only surface what that layer reports.
 */
export async function teardownTest(): Promise<void> {
  const registry = getTestLifecycleRegistry();

  if (registry.state === "stopping" && registry.teardownAttempt) {
    return registry.teardownAttempt;
  }

  if (registry.state === "starting" && registry.setupAttempt) {
    // A runtime that is still opening cannot be closed halfway. Wait for the
    // attempt to settle: a failed one has already unwound itself and left the
    // lifecycle idle, which the re-entry below then reads as "nothing to do".
    await settled(registry.setupAttempt.completion);

    return teardownTest();
  }

  if (registry.state === "idle") {
    return;
  }

  registry.state = "stopping";

  // Deferred by a microtask so the registry is fully published before the
  // attempt's first line runs — a synchronous throw would otherwise reach the
  // `finally` below, and reset the state, before this function had recorded
  // that a teardown was in flight at all.
  const attempt = Promise.resolve().then(() => runTestRuntimeShutdown());

  registry.teardownAttempt = attempt;

  return attempt;
}

/**
 * The setup attempt's hang guard, as the lifecycle consumes it.
 *
 * The bound's POLICY — the default, the config key, the message — lives in
 * `test-setup-timeout.ts`. What expiry MEANS lives here.
 *
 * @internal
 */
type SetupBound = {
  /**
   * Rejects with the expiry error. Never resolves: the attempt is the only side
   * of the race that can succeed.
   */
  readonly expiry: Promise<never>;

  /**
   * Re-aim the bound at `next` ms measured from when the ATTEMPT STARTED, once
   * config has made `tests.setupTimeout` readable.
   */
  rearm(next: number): void;

  /** The race is over — cancel whatever timer is still pending. */
  settle(): void;

  /** Whether the bound, rather than the attempt, won the race. */
  hasExpired(): boolean;
};

/**
 * Arm the hang guard for one setup attempt.
 *
 * Armed at the default BEFORE the attempt runs, because `tests.setupTimeout` is
 * not readable until the attempt has loaded config — and loading config is
 * itself one of the steps that can hang. `rearm` then narrows or widens it the
 * moment config arrives.
 */
function armSetupBound(registry: TestLifecycleRegistry): SetupBound {
  const schedule = registry.scheduleTimeout ?? scheduleRealTimeout;
  const armedAt = Date.now();

  let handle: TestTimeoutHandle | undefined;
  let expired = false;
  let closed = false;
  let expire: (error: unknown) => void = () => undefined;

  const expiry = new Promise<never>((_resolve, reject) => {
    expire = reject;
  });

  // Only `awaitSetupWithinBound` observes this, and only until the attempt wins
  // — after that nobody is listening, and an unobserved rejection surfaces as an
  // unhandled rejection that fails an unrelated test file. Same reason as the
  // `effectiveSelection` barrier below.
  expiry.catch(() => undefined);

  const expireNow = (bound: number): void => {
    if (closed) {
      return;
    }

    closed = true;
    expired = true;

    handle?.cancel();
    handle = undefined;

    expire(new TestLifecycleError(describeExpiredSetup(bound)));
  };

  const armFor = (bound: number, delay: number): void => {
    if (closed) {
      return;
    }

    handle?.cancel();

    // Already overdue. A bound the attempt has ALREADY exceeded must fire now,
    // not be rescheduled for time that was spent before it was known.
    if (delay <= 0) {
      expireNow(bound);

      return;
    }

    handle = schedule(delay, () => expireNow(bound));
  };

  const initialBound = registry.setupTimeoutOverride ?? DEFAULT_TEST_SETUP_TIMEOUT;

  armFor(initialBound, initialBound);

  return {
    expiry,

    // Measured from `armedAt`, never from now: adding a configured bound to the
    // time already spent would make the real bound default-plus-configured, and
    // a project that lowered the key would get a LONGER guard than the default.
    rearm: (next) => armFor(next, next - (Date.now() - armedAt)),

    settle: () => {
      closed = true;

      handle?.cancel();
      handle = undefined;
    },

    hasExpired: () => expired,
  };
}

/**
 * Race one setup attempt against its bound.
 *
 * The losing attempt is NOT cancellable — nothing here can interrupt a bootstrap
 * stuck in a socket connect — so when the bound wins, the lifecycle is poisoned
 * and every later state write from that abandoned attempt is dropped. That
 * dropping happens in `runTestRuntimeStartup`, guarded on `hasExpired()`;
 * without it the still-running attempt would quietly overwrite `poisoned` with
 * `ready` or `idle` and hand the next caller a runtime nobody owns.
 */
async function awaitSetupWithinBound(
  attempt: Promise<void>,
  bound: SetupBound,
  registry: TestLifecycleRegistry,
): Promise<void> {
  try {
    await Promise.race([attempt, bound.expiry]);
  } catch (error) {
    if (bound.hasExpired()) {
      registry.state = "poisoned";
      registry.activeSelection = undefined;
      registry.setupAttempt = undefined;
    }

    throw error;
  } finally {
    bound.settle();
  }
}

/**
 * Open a new setup attempt and publish it before it runs.
 */
function startTestRuntime(requested: RequestedTestConnectors): Promise<void> {
  const registry = getTestLifecycleRegistry();

  let publishEffectiveSelection: (selection: TestConnectorsSelection) => void = () => undefined;
  let failEffectiveSelection: (error: unknown) => void = () => undefined;

  const effectiveSelection = new Promise<TestConnectorsSelection>((resolve, reject) => {
    publishEffectiveSelection = resolve;
    failEffectiveSelection = reject;
  });

  // Only the mixed explicit/config comparison ever awaits this barrier, so its
  // rejection is usually unobserved — and an unobserved rejection would surface
  // as an unhandled rejection and fail an unrelated test file.
  effectiveSelection.catch(() => undefined);

  const bound = armSetupBound(registry);

  const attempt = Promise.resolve().then(() =>
    runTestRuntimeStartup(requested, publishEffectiveSelection, failEffectiveSelection, bound),
  );

  // The attempt outlives a bound that beat it, and by then `completion` has
  // already rejected with the expiry error — so the attempt's own late rejection
  // has no observer. Same unhandled-rejection hazard as above.
  attempt.catch(() => undefined);

  // `teardownTest` waits on this same promise, which is how a teardown requested
  // during setup inherits the bound. There is deliberately no second timer and
  // no separate teardown deadline.
  const completion = awaitSetupWithinBound(attempt, bound, registry);

  registry.state = "starting";
  registry.setupAttempt = { requested, effectiveSelection, completion };

  return completion;
}

/**
 * The startup attempt itself.
 *
 * On failure: best-effort unwind, reset bookkeeping, rethrow the ORIGINAL error
 * unchanged. A cleanup failure is a secondary diagnostic and never replaces the
 * cause the caller needs to read.
 */
async function runTestRuntimeStartup(
  requested: RequestedTestConnectors,
  publishEffectiveSelection: (selection: TestConnectorsSelection) => void,
  failEffectiveSelection: (error: unknown) => void,
  bound: SetupBound,
): Promise<void> {
  const registry = getTestLifecycleRegistry();

  try {
    Application.setEnvironment("test");

    await warlockConfigManager.load();
    await bootstrap();

    await filesOrchestrator.init();
    await loadConfigFiles(true);

    // The first point at which `tests.setupTimeout` is readable at all. An
    // invalid value throws from here and takes the normal failure path — falling
    // back to the default would silently erase what the project configured.
    const configuredTimeout = readConfiguredSetupTimeout();

    if (configuredTimeout !== undefined) {
      bound.rearm(configuredTimeout);
    }

    // Resolved here and not at call time: the config layer is only readable once
    // the four steps above have run.
    const effectiveSelection = resolveEffectiveConnectors(requested);

    // Every state write below is conditional on this attempt still being the one
    // the lifecycle is waiting for. Once the bound has expired the lifecycle is
    // poisoned and this attempt is abandoned — it may still be running, but it
    // no longer speaks for the runtime.
    if (!bound.hasExpired()) {
      registry.activeSelection = effectiveSelection;
    }

    publishEffectiveSelection(effectiveSelection);

    await startSelectedConnectors(effectiveSelection);

    if (!bound.hasExpired()) {
      registry.state = "ready";
      registry.setupAttempt = undefined;
    }
  } catch (error) {
    failEffectiveSelection(error);

    await unwindPartialStartup();

    if (!bound.hasExpired()) {
      registry.state = "idle";
      registry.activeSelection = undefined;
      registry.setupAttempt = undefined;
    }

    console.error("[vitest-setup] Failed to setup test environment:", error);

    throw error;
  }
}

/**
 * `false` means none at all. Everything else starts something: an array starts
 * exactly those, and `true` starts the default set — all but http, which is the
 * global setup's job and shared across every worker.
 */
async function startSelectedConnectors(selection: TestConnectorsSelection): Promise<void> {
  if (selection === false) {
    return;
  }

  if (Array.isArray(selection)) {
    await connectorsManager.start(normalizeConnectorNames(selection));

    return;
  }

  await connectorsManager.startWithout(["http"]);
}

/**
 * Best-effort teardown of whatever a failed startup managed to start.
 *
 * Runs while an error is already in flight, so no step here may throw and every
 * step is attempted independently.
 */
async function unwindPartialStartup(): Promise<void> {
  // Two steps rather than one: `connectorsManager.shutdown()` runs the
  // application hooks itself, but it runs them FIRST and does not isolate their
  // rejection — so a hook that rejects would take the connector teardown down
  // with it and leave every connector up. Both calls are idempotent, so running
  // the hooks on their own first costs nothing and means neither failure can
  // skip the other step.
  await attemptCleanupStep("application shutdown hooks", () => Application.runShutdownHooks());
  await attemptCleanupStep("connectors shutdown", () => connectorsManager.shutdown());
}

/**
 * Run one cleanup step, isolating its failure so the next step still runs.
 */
async function attemptCleanupStep(step: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    // Reported, not thrown — it is secondary to the startup error about to be
    // rethrown, and losing that one to this would be the worse outcome.
    console.error(`[vitest-setup] Cleanup after a failed setup did not complete (${step}):`, error);
  }
}

/**
 * The teardown attempt itself.
 */
async function runTestRuntimeShutdown(): Promise<void> {
  const registry = getTestLifecycleRegistry();
  let shutdownSucceeded = false;

  try {
    // Manager-wide, and deliberately called whatever the selection was: with
    // `connectors: false` nothing was started, but bootstrap still registered
    // application shutdown hooks, and the manager runs those first (see
    // `connectors-manager.ts` — `Application.runShutdownHooks()` is its first
    // line). Skipping the call to "match" an empty selection would leak them.
    await connectorsManager.shutdown();

    shutdownSucceeded = true;
  } finally {
    // In a `finally`, not after the `await`: a rejected shutdown must not leave
    // the lifecycle claiming a runtime it no longer owns. Poisoned rather than
    // idle, because a cleared flag does not prove that ports, sockets, pools or
    // timers closed.
    registry.activeSelection = undefined;
    registry.setupAttempt = undefined;
    registry.teardownAttempt = undefined;
    registry.state = shutdownSucceeded ? "idle" : "poisoned";
  }
}

/**
 * Reject when a ready runtime was set up with a different selection.
 */
function assertReadySelectionMatches(
  activeSelection: TestConnectorsSelection | undefined,
  requested: RequestedTestConnectors,
): void {
  if (activeSelection === undefined) {
    return;
  }

  // Config is loaded by the time anything is ready, so the config-derived layer
  // is resolvable right here.
  const requestedSelection = resolveEffectiveConnectors(requested);

  assertSelectionsMatch(activeSelection, requestedSelection);
}

/**
 * Reject when an in-flight setup attempt is starting a different selection.
 */
async function assertPendingSetupMatches(
  attempt: TestSetupAttempt,
  requested: RequestedTestConnectors,
): Promise<void> {
  const pending = attempt.requested;

  // Two calls that both defer to project config resolve to the same thing by
  // construction — knowable without waiting for config to load.
  if (!pending.isExplicit && !requested.isExplicit) {
    return;
  }

  if (pending.isExplicit && requested.isExplicit) {
    assertSelectionsMatch(pending.selection, requested.selection);

    return;
  }

  // Mixed: one side is config-derived and config is not readable until the
  // running attempt has loaded it, so wait for that barrier first.
  const activeSelection = await attempt.effectiveSelection;
  const requestedSelection = resolveEffectiveConnectors(requested);

  assertSelectionsMatch(activeSelection, requestedSelection);
}

/**
 * Name both selections: a caller looking at this message has to be able to tell
 * which call to change without reading the framework's source.
 */
function assertSelectionsMatch(
  activeSelection: TestConnectorsSelection,
  requestedSelection: TestConnectorsSelection,
): void {
  if (isSameConnectorsSelection(activeSelection, requestedSelection)) {
    return;
  }

  throw new TestLifecycleError(
    `setupTest() is already using ${describeConnectorsSelection(activeSelection)}, and this call asked for ${describeConnectorsSelection(requestedSelection)}. One test runtime serves one connector selection — call teardownTest() before setting up a different one.`,
  );
}

/**
 * Await an attempt for its state transition only, not its result.
 */
function settled(attempt: Promise<void>): Promise<void> {
  return attempt.catch(() => undefined);
}

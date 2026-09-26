import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_LIFECYCLE_REGISTRY_KEY } from "../../../src/tests/test-lifecycle-state";
import type { TestLifecycleRegistry } from "../../../src/tests/test-lifecycle-state";
import { scheduleRealTimeout } from "../../../src/tests/test-setup-timeout";
import type { TestTimeoutScheduler } from "../../../src/tests/test-setup-timeout";

/**
 * The worker test lifecycle — `setupTest` / `teardownTest`.
 *
 * Subject: `contracts/2026-08-12-test-worker-lifecycle.md`. This file carries
 * items 1, 3–10 and 12 of that contract's required proof matrix. Item 2 belongs
 * to the generator and item 11 to contract A; neither is asserted here.
 *
 * SCOPE: what the lifecycle ASKS the framework to do — which connectors it
 * starts, how many times it bootstraps, when it shuts the manager down, and what
 * it rejects with. Everything underneath (`bootstrap`, the files orchestrator,
 * config loading, the connectors manager) is mocked: none of it is the subject
 * and all of it is slow.
 *
 * ⚠ Read `resetLifecycleRegistry` before adding a case. Lifecycle state lives on
 * `globalThis`, deliberately, so `vi.resetModules()` does NOT reset it — that is
 * the defect being fixed, not an inconvenience to work around.
 */

const startMock = vi.fn(async () => undefined);
const startWithoutMock = vi.fn(async () => undefined);
const runShutdownHooksMock = vi.fn(async () => undefined);

/**
 * Mirrors the real manager, whose first line is `await
 * Application.runShutdownHooks()` (`src/connectors/connectors-manager.ts`), so a
 * test can see that reaching the manager is what tears the application hooks
 * down. The lifecycle itself calls the hooks directly only on the unwind path.
 */
const shutdownMock = vi.fn(async () => {
  await runShutdownHooksMock();
});

const configGetMock = vi.fn();
const setEnvironmentMock = vi.fn();
const bootstrapMock = vi.fn(async () => undefined);
const loadConfigFilesMock = vi.fn(async () => undefined);
const filesOrchestratorInitMock = vi.fn(async () => undefined);
const warlockConfigLoadMock = vi.fn(async () => undefined);

vi.mock("../../../src/connectors", () => ({
  connectorsManager: {
    start: (...args: unknown[]) => startMock(...(args as [])),
    startWithout: (...args: unknown[]) => startWithoutMock(...(args as [])),
    shutdown: (...args: unknown[]) => shutdownMock(...(args as [])),
  },
}));

vi.mock("../../../src/config", () => ({
  config: {
    // Mirrors @mongez/config: an absent key resolves to the default, and the
    // default default is `null`.
    get: (...args: unknown[]) => configGetMock(...args),
  },
}));

vi.mock("../../../src/application/application", () => ({
  Application: {
    setEnvironment: (...args: unknown[]) => setEnvironmentMock(...args),
    runShutdownHooks: (...args: unknown[]) => runShutdownHooksMock(...(args as [])),
  },
}));

vi.mock("../../../src/bootstrap", () => ({
  bootstrap: (...args: unknown[]) => bootstrapMock(...(args as [])),
}));

vi.mock("../../../src/config/load-config-files", () => ({
  loadConfigFiles: (...args: unknown[]) => loadConfigFilesMock(...(args as [])),
}));

vi.mock("../../../src/dev-server/files-orchestrator", () => ({
  filesOrchestrator: {
    init: (...args: unknown[]) => filesOrchestratorInitMock(...(args as [])),
  },
}));

vi.mock("../../../src/warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: {
    load: (...args: unknown[]) => warlockConfigLoadMock(...(args as [])),
  },
}));

type LifecycleModule = typeof import("../../../src/tests/vitest-setup");

/**
 * Import a fresh copy of the lifecycle module — a module-registry rebuild, which
 * is what Vitest does before every test file even when the worker itself is
 * reused (`proofs/2026-08-12-nova-vitest-setupfiles-lifetime.md`).
 */
async function importFreshLifecycle(): Promise<LifecycleModule> {
  vi.resetModules();

  return import("../../../src/tests/vitest-setup");
}

/**
 * Drop the runtime context's lifecycle registry.
 *
 * Reaching into `globalThis` is the point: the registry has to be cleared at the
 * scope it actually lives at. A spec that could reset it by re-importing the
 * module would be asserting the very thing the contract rejects.
 */
function resetLifecycleRegistry(): void {
  delete (globalThis as Record<symbol, unknown>)[TEST_LIFECYCLE_REGISTRY_KEY];
}

type Deferred = {
  readonly promise: Promise<undefined>;
  resolve(): void;
  reject(error: unknown): void;
};

/**
 * A gate a test can hold a lifecycle step open with, so a second call lands
 * while the first is genuinely in flight.
 */
function createDeferred(): Deferred {
  let resolveGate: () => void = () => undefined;
  let rejectGate: (error: unknown) => void = () => undefined;

  const promise = new Promise<undefined>((resolve, reject) => {
    resolveGate = () => resolve(undefined);
    rejectGate = reject;
  });

  return { promise, resolve: () => resolveGate(), reject: (error) => rejectGate(error) };
}

type ScheduledTimeout = {
  readonly timeout: number;
  readonly fire: () => void;
  cancelled: boolean;
};

/**
 * A scheduler the test drives by hand.
 *
 * Two things it makes assertable that a real timer cannot: every delay the
 * lifecycle asked for — which is how "measured from when the attempt started"
 * and "one timer, not two" are checked — and expiry on demand, instead of
 * outliving a bound measured in minutes.
 */
function createTimeoutRecorder() {
  const scheduled: ScheduledTimeout[] = [];

  const scheduleTimeout: TestTimeoutScheduler = (timeout, onExpiry) => {
    const entry: ScheduledTimeout = { timeout, fire: onExpiry, cancelled: false };

    scheduled.push(entry);

    return {
      cancel: () => {
        entry.cancelled = true;
      },
    };
  };

  return {
    scheduleTimeout,
    delays: () => scheduled.map((entry) => entry.timeout),
    cancelledCount: () => scheduled.filter((entry) => entry.cancelled).length,
    fireLatest: () => scheduled[scheduled.length - 1]?.fire(),
  };
}

/**
 * Publish a lifecycle registry carrying the internal injection points.
 *
 * Written straight onto the runtime context rather than through the module,
 * for the same reason `resetLifecycleRegistry` reaches into `globalThis`: that
 * is the scope the implementation actually reads.
 */
function primeLifecycleRegistry(overrides: Partial<TestLifecycleRegistry>): void {
  const registry: TestLifecycleRegistry = { state: "idle", ...overrides };

  (globalThis as Record<symbol, unknown>)[TEST_LIFECYCLE_REGISTRY_KEY] = registry;
}

/**
 * Read back the same runtime-context slot `primeLifecycleRegistry` writes.
 *
 * Used where the observable is the lifecycle's own state rather than a mock
 * call — the expiry path writes `poisoned` and nothing else in this file can
 * see that write.
 */
function readLifecycleRegistry(): TestLifecycleRegistry {
  return (globalThis as Record<symbol, unknown>)[
    TEST_LIFECYCLE_REGISTRY_KEY
  ] as TestLifecycleRegistry;
}

/**
 * Freeze `Date.now` and hand back the dial.
 *
 * The re-arm subtracts the time the attempt has already spent, so proving it is
 * measured from the attempt's START rather than from the moment config arrived
 * needs an elapsed value the assertion can name exactly. A wall clock gives a
 * number that is neither exact nor reproducible.
 */
function freezeClock(startedAt: number): (now: number) => void {
  let now = startedAt;

  vi.spyOn(Date, "now").mockImplementation(() => now);

  return (next) => {
    now = next;
  };
}

/**
 * Let an abandoned attempt run itself out inside the test that abandoned it.
 *
 * A setup the bound gave up on is not cancellable and keeps going; draining it
 * here keeps its trailing mock calls from landing in the next test's counters.
 */
async function flushAbandonedAttempt(): Promise<void> {
  await nextTurn();
}

/**
 * One macrotask turn.
 *
 * The whole microtask queue is drained before it resolves, which is what makes
 * it usable as a fence: under an injected scheduler every step the lifecycle
 * takes between "the timer fired" and "the caller's promise settled" is a
 * microtask, so anything still pending here is not slow — it is stuck.
 */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Where a promise got to, without ever awaiting it.
 */
type PromiseSettlement = {
  readonly type: "pending" | "fulfilled" | "rejected";
  readonly reason?: unknown;
};

/**
 * Watch `promise` for one turn and report where it got to.
 *
 * `await expect(promise).rejects` cannot tell a rejection apart from a promise
 * that never settles: both make the spec wait, and only the runner's own 10s
 * timeout ends the second one. Standing rule 3 wants a spec proving a hang to
 * ASSERT, so the wait is fenced here instead — a `pending` result is the hang,
 * stated as a value the assertion can name.
 */
async function settleWithinOneTurn(promise: Promise<unknown>): Promise<PromiseSettlement> {
  let settlement: PromiseSettlement = { type: "pending" };

  promise.then(
    () => {
      settlement = { type: "fulfilled" };
    },
    (reason) => {
      settlement = { type: "rejected", reason };
    },
  );

  await nextTurn();

  return settlement;
}

beforeEach(() => {
  resetLifecycleRegistry();

  startMock.mockReset().mockResolvedValue(undefined);
  startWithoutMock.mockReset().mockResolvedValue(undefined);
  runShutdownHooksMock.mockReset().mockResolvedValue(undefined);
  shutdownMock.mockReset().mockImplementation(async () => {
    await runShutdownHooksMock();
  });
  configGetMock.mockReset().mockReturnValue(null);
  setEnvironmentMock.mockReset();
  bootstrapMock.mockReset().mockResolvedValue(undefined);
  loadConfigFilesMock.mockReset().mockResolvedValue(undefined);
  filesOrchestratorInitMock.mockReset().mockResolvedValue(undefined);
  warlockConfigLoadMock.mockReset().mockResolvedValue(undefined);

  // The lifecycle reports startup failures and secondary cleanup failures on
  // stderr. Every one of them is asserted here, so silence the duplicate.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  resetLifecycleRegistry();
  vi.restoreAllMocks();
});

describe("proof 1 — effective connector selection precedence", () => {
  it("lets an explicit `false` beat a config that says `true`", async () => {
    configGetMock.mockReturnValue({ connectors: true });

    const { setupTest } = await importFreshLifecycle();

    await setupTest({ connectors: false });

    expect(startMock).not.toHaveBeenCalled();
    expect(startWithoutMock).not.toHaveBeenCalled();
  });

  it("lets an explicit `true` beat a config that says `false`", async () => {
    // The 4.13 flip: config used to win, so this call started nothing.
    configGetMock.mockReturnValue({ connectors: false });

    const { setupTest } = await importFreshLifecycle();

    await setupTest({ connectors: true });

    expect(startWithoutMock).toHaveBeenCalledWith(["http"]);
  });

  it("lets an explicit list beat a differing config list", async () => {
    configGetMock.mockReturnValue({ connectors: ["cache"] });

    const { setupTest } = await importFreshLifecycle();

    await setupTest({ connectors: ["database"] });

    expect(startMock).toHaveBeenCalledWith(["database"]);
  });

  it("falls through to config when the option is omitted entirely", async () => {
    configGetMock.mockReturnValue({ connectors: ["database"] });

    const { setupTest } = await importFreshLifecycle();

    await setupTest();

    expect(startMock).toHaveBeenCalledWith(["database"]);
  });

  it("falls through to config when the caller passes an empty options object", async () => {
    configGetMock.mockReturnValue({ connectors: false });

    const { setupTest } = await importFreshLifecycle();

    await setupTest({});

    expect(startMock).not.toHaveBeenCalled();
    expect(startWithoutMock).not.toHaveBeenCalled();
  });

  it("falls through to config when `connectors` is explicitly `undefined`", async () => {
    // An optional variable holding `undefined` must never erase project config.
    configGetMock.mockReturnValue({ connectors: false });

    const { setupTest } = await importFreshLifecycle();

    await setupTest({ connectors: undefined });

    expect(startMock).not.toHaveBeenCalled();
    expect(startWithoutMock).not.toHaveBeenCalled();
  });

  it("falls through to the default when the project has no `tests` config", async () => {
    configGetMock.mockReturnValue(null);

    const { setupTest } = await importFreshLifecycle();

    await expect(setupTest()).resolves.toBeUndefined();

    expect(startWithoutMock).toHaveBeenCalledWith(["http"]);
  });
});

describe("proof 3 — same-option repeated and concurrent setup runs one startup", () => {
  it("does not bootstrap twice after the module registry is rebuilt", async () => {
    // The defect: the old module-scoped `isSetupComplete` was rebuilt with the
    // module, so the second call bootstrapped a runtime that was already live.
    const first = await importFreshLifecycle();

    await first.setupTest({ connectors: false });

    const second = await importFreshLifecycle();

    await second.setupTest({ connectors: false });

    expect(bootstrapMock).toHaveBeenCalledTimes(1);
  });

  it("is a no-op while ready with the same selection", async () => {
    const { setupTest } = await importFreshLifecycle();

    await setupTest({ connectors: ["database"] });
    await setupTest({ connectors: ["database"] });

    expect(bootstrapMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it("treats a reordered, duplicated list as the same selection", async () => {
    const { setupTest } = await importFreshLifecycle();

    await setupTest({ connectors: ["database", "cache"] });
    await setupTest({ connectors: ["cache", "database", "cache"] });

    expect(bootstrapMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it("shares one attempt between concurrent calls with the same selection", async () => {
    const gate = createDeferred();

    bootstrapMock.mockImplementationOnce(() => gate.promise);

    const { setupTest } = await importFreshLifecycle();

    const first = setupTest({ connectors: false });
    const second = setupTest({ connectors: false });

    gate.resolve();

    await Promise.all([first, second]);

    expect(bootstrapMock).toHaveBeenCalledTimes(1);
  });

  it("shares one attempt between concurrent calls that both defer to config", async () => {
    configGetMock.mockReturnValue({ connectors: ["database"] });

    const gate = createDeferred();

    bootstrapMock.mockImplementationOnce(() => gate.promise);

    const { setupTest } = await importFreshLifecycle();

    const first = setupTest();
    const second = setupTest({});

    gate.resolve();

    await Promise.all([first, second]);

    expect(bootstrapMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledTimes(1);
  });
});

describe("proof 4 — different-option setup rejects without mutating the live runtime", () => {
  it("rejects while ready and names both selections", async () => {
    const { setupTest } = await importFreshLifecycle();

    await setupTest({ connectors: ["database"] });

    startMock.mockClear();

    await expect(setupTest({ connectors: ["cache"] })).rejects.toThrow(
      /already using .*"database".*asked for .*"cache"/s,
    );

    expect(startMock).not.toHaveBeenCalled();
    expect(startWithoutMock).not.toHaveBeenCalled();
    expect(shutdownMock).not.toHaveBeenCalled();
    expect(bootstrapMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a concurrent call that asked for a different selection", async () => {
    const gate = createDeferred();

    bootstrapMock.mockImplementationOnce(() => gate.promise);

    const { setupTest } = await importFreshLifecycle();

    const first = setupTest({ connectors: ["database"] });
    const second = setupTest({ connectors: false });

    await expect(second).rejects.toThrow(/One test runtime serves one connector selection/);

    gate.resolve();

    await expect(first).resolves.toBeUndefined();

    expect(bootstrapMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledExactlyOnceWith(["database"]);
  });

  it("rejects a config-derived call that conflicts with an in-flight explicit one", async () => {
    // The mixed case: the second caller cannot know its own effective selection
    // until the running attempt has loaded config, so it has to wait for that
    // barrier before it can tell "same" from "different".
    configGetMock.mockReturnValue({ connectors: false });

    const gate = createDeferred();

    bootstrapMock.mockImplementationOnce(() => gate.promise);

    const { setupTest } = await importFreshLifecycle();

    const first = setupTest({ connectors: ["database"] });
    const second = setupTest();

    gate.resolve();

    await expect(first).resolves.toBeUndefined();
    await expect(second).rejects.toThrow(/One test runtime serves one connector selection/);

    expect(bootstrapMock).toHaveBeenCalledTimes(1);
  });

  it("rejects while ready even when the conflict comes from config", async () => {
    configGetMock.mockReturnValue({ connectors: ["cache"] });

    const { setupTest } = await importFreshLifecycle();

    await setupTest({ connectors: ["database"] });

    await expect(setupTest()).rejects.toThrow(/already using .*"database"/s);
  });
});

describe("proof 5 — partial startup failure unwinds, preserves the error, and retries clean", () => {
  const boundaries = [
    ["warlock config", () => warlockConfigLoadMock],
    ["bootstrap", () => bootstrapMock],
    ["files orchestrator", () => filesOrchestratorInitMock],
    ["config files", () => loadConfigFilesMock],
    ["connector startup", () => startWithoutMock],
  ] as const;

  it.each(boundaries)(
    "unwinds and rethrows the original error when %s fails",
    async (_boundary, readMock) => {
      const startupError = new Error("boundary failed");

      readMock().mockRejectedValueOnce(startupError);

      const { setupTest } = await importFreshLifecycle();

      await expect(setupTest({ connectors: true })).rejects.toBe(startupError);

      expect(runShutdownHooksMock).toHaveBeenCalled();
      expect(shutdownMock).toHaveBeenCalled();
    },
  );

  it("returns to idle so a clean retry works", async () => {
    bootstrapMock.mockRejectedValueOnce(new Error("boundary failed"));

    const { setupTest } = await importFreshLifecycle();

    await expect(setupTest({ connectors: false })).rejects.toThrow("boundary failed");

    await expect(setupTest({ connectors: false })).resolves.toBeUndefined();

    expect(bootstrapMock).toHaveBeenCalledTimes(2);
  });

  it("never lets a cleanup failure replace the startup error", async () => {
    const startupError = new Error("bootstrap exploded");

    bootstrapMock.mockRejectedValueOnce(startupError);
    shutdownMock.mockRejectedValueOnce(new Error("cleanup exploded"));

    const { setupTest } = await importFreshLifecycle();

    await expect(setupTest({ connectors: false })).rejects.toBe(startupError);
  });

  it("attempts every cleanup step even when an earlier one fails", async () => {
    const startupError = new Error("bootstrap exploded");

    bootstrapMock.mockRejectedValueOnce(startupError);
    runShutdownHooksMock.mockRejectedValueOnce(new Error("shutdown hook exploded"));

    const { setupTest } = await importFreshLifecycle();

    await expect(setupTest({ connectors: false })).rejects.toBe(startupError);

    expect(shutdownMock).toHaveBeenCalledTimes(1);
  });

  it("allows a retry with a different selection after a failed setup", async () => {
    bootstrapMock.mockRejectedValueOnce(new Error("boundary failed"));

    const { setupTest } = await importFreshLifecycle();

    await expect(setupTest({ connectors: ["database"] })).rejects.toThrow("boundary failed");

    await expect(setupTest({ connectors: false })).resolves.toBeUndefined();
  });
});

describe("proof 6 — idle and concurrent teardown are idempotent", () => {
  it("does nothing when the lifecycle is idle", async () => {
    const { teardownTest } = await importFreshLifecycle();

    await expect(teardownTest()).resolves.toBeUndefined();

    expect(shutdownMock).not.toHaveBeenCalled();
    expect(runShutdownHooksMock).not.toHaveBeenCalled();
  });

  it("shares one attempt between concurrent teardown calls", async () => {
    const { setupTest, teardownTest } = await importFreshLifecycle();

    await setupTest({ connectors: false });

    const gate = createDeferred();

    shutdownMock.mockImplementationOnce(() => gate.promise);

    const first = teardownTest();
    const second = teardownTest();

    gate.resolve();

    await Promise.all([first, second]);

    expect(shutdownMock).toHaveBeenCalledTimes(1);
  });

  it("is still a no-op when called twice in a row", async () => {
    const { setupTest, teardownTest } = await importFreshLifecycle();

    await setupTest({ connectors: false });

    await teardownTest();
    await teardownTest();

    expect(shutdownMock).toHaveBeenCalledTimes(1);
  });

  it("waits for an in-flight setup and then closes the runtime it opened", async () => {
    const gate = createDeferred();

    bootstrapMock.mockImplementationOnce(() => gate.promise);

    const { setupTest, teardownTest } = await importFreshLifecycle();

    const setup = setupTest({ connectors: true });
    const teardown = teardownTest();

    expect(shutdownMock).not.toHaveBeenCalled();

    gate.resolve();

    await expect(setup).resolves.toBeUndefined();
    await expect(teardown).resolves.toBeUndefined();

    expect(shutdownMock).toHaveBeenCalledTimes(1);

    // The ordering is the whole guarantee: a teardown that closed the manager
    // while the connectors were still coming up would leave the runtime the
    // setup then finishes opening — up, unowned, and unclosable.
    expect(startWithoutMock.mock.invocationCallOrder[0]).toBeLessThan(
      shutdownMock.mock.invocationCallOrder[0],
    );
  });

  it("leaves the lifecycle idle after closing a runtime it waited for", async () => {
    const gate = createDeferred();

    bootstrapMock.mockImplementationOnce(() => gate.promise);

    const { setupTest, teardownTest } = await importFreshLifecycle();

    const setup = setupTest({ connectors: true });
    const teardown = teardownTest();

    gate.resolve();

    await setup;
    await teardown;

    // Idle, not "ready" — the finishing setup must not be able to publish a
    // ready runtime behind a teardown that has already closed it.
    await teardownTest();

    expect(shutdownMock).toHaveBeenCalledTimes(1);
  });

  it("does not shut down a second time when the setup it waited for failed", async () => {
    const gate = createDeferred();

    bootstrapMock.mockImplementationOnce(() => gate.promise);

    const { setupTest, teardownTest } = await importFreshLifecycle();

    const setup = setupTest({ connectors: false });
    const teardown = teardownTest();

    gate.reject(new Error("bootstrap exploded"));

    await expect(setup).rejects.toThrow("bootstrap exploded");
    await expect(teardown).resolves.toBeUndefined();

    // Exactly the one call the failed setup's own unwind made.
    expect(shutdownMock).toHaveBeenCalledTimes(1);
  });
});

describe("proof 7 — a shutdown rejection surfaces, clears ready, and poisons reuse", () => {
  it("rejects with the shutdown failure rather than swallowing it", async () => {
    const shutdownError = new Error("port would not close");

    const { setupTest, teardownTest } = await importFreshLifecycle();

    await setupTest({ connectors: false });

    shutdownMock.mockRejectedValueOnce(shutdownError);

    await expect(teardownTest()).rejects.toBe(shutdownError);
  });

  it("refuses a later setup and tells the caller to restart the worker", async () => {
    const { setupTest, teardownTest } = await importFreshLifecycle();

    await setupTest({ connectors: false });

    shutdownMock.mockRejectedValueOnce(new Error("port would not close"));

    await expect(teardownTest()).rejects.toThrow("port would not close");

    await expect(setupTest({ connectors: false })).rejects.toThrow(
      /Restart the Vitest worker before setting up again/,
    );

    expect(bootstrapMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the poison across a module-registry rebuild", async () => {
    const first = await importFreshLifecycle();

    await first.setupTest({ connectors: false });

    shutdownMock.mockRejectedValueOnce(new Error("port would not close"));

    await expect(first.teardownTest()).rejects.toThrow("port would not close");

    const second = await importFreshLifecycle();

    await expect(second.setupTest({ connectors: false })).rejects.toThrow(
      /Restart the Vitest worker before setting up again/,
    );
  });

  it("stays poisoned when the teardown retry fails again", async () => {
    const { setupTest, teardownTest } = await importFreshLifecycle();

    await setupTest({ connectors: false });

    shutdownMock.mockRejectedValueOnce(new Error("first close failure"));

    await expect(teardownTest()).rejects.toThrow("first close failure");

    shutdownMock.mockRejectedValueOnce(new Error("second close failure"));

    await expect(teardownTest()).rejects.toThrow("second close failure");

    await expect(setupTest({ connectors: false })).rejects.toThrow(
      /Restart the Vitest worker before setting up again/,
    );
  });

  it("returns to idle only on a fully successful teardown retry", async () => {
    const { setupTest, teardownTest } = await importFreshLifecycle();

    await setupTest({ connectors: false });

    shutdownMock.mockRejectedValueOnce(new Error("port would not close"));

    await expect(teardownTest()).rejects.toThrow("port would not close");

    await expect(teardownTest()).resolves.toBeUndefined();

    await expect(setupTest({ connectors: true })).resolves.toBeUndefined();

    expect(startWithoutMock).toHaveBeenCalledWith(["http"]);
    expect(bootstrapMock).toHaveBeenCalledTimes(2);
  });
});

describe("proof 8 — a successful teardown permits setup with a different selection", () => {
  it("accepts a different selection after teardown", async () => {
    const { setupTest, teardownTest } = await importFreshLifecycle();

    await setupTest({ connectors: ["database"] });
    await teardownTest();

    await expect(setupTest({ connectors: false })).resolves.toBeUndefined();

    expect(bootstrapMock).toHaveBeenCalledTimes(2);
    expect(startMock).toHaveBeenCalledExactlyOnceWith(["database"]);
  });

  it("accepts a different selection after teardown across a module-registry rebuild", async () => {
    const first = await importFreshLifecycle();

    await first.setupTest({ connectors: ["database"] });
    await first.teardownTest();

    const second = await importFreshLifecycle();

    await expect(second.setupTest({ connectors: true })).resolves.toBeUndefined();

    expect(startWithoutMock).toHaveBeenCalledWith(["http"]);
  });
});

describe("proof 9 — teardown is manager-wide, not selective", () => {
  it("shuts the whole manager down even when setup started only a subset", async () => {
    const { setupTest, teardownTest } = await importFreshLifecycle();

    await setupTest({ connectors: ["database"] });
    await teardownTest();

    // No selective handle exists, and this call must not pretend one does.
    expect(shutdownMock).toHaveBeenCalledExactlyOnceWith();
  });
});

describe("proof 10 — `connectors: false` bootstraps and still tears down application hooks", () => {
  it("starts no connectors but still bootstraps", async () => {
    const { setupTest } = await importFreshLifecycle();

    await setupTest({ connectors: false });

    expect(bootstrapMock).toHaveBeenCalledTimes(1);
    expect(warlockConfigLoadMock).toHaveBeenCalledTimes(1);
    expect(filesOrchestratorInitMock).toHaveBeenCalledTimes(1);
    expect(loadConfigFilesMock).toHaveBeenCalledTimes(1);
    expect(startMock).not.toHaveBeenCalled();
    expect(startWithoutMock).not.toHaveBeenCalled();
  });

  it("still tears the bootstrap-registered application hooks down", async () => {
    const { setupTest, teardownTest } = await importFreshLifecycle();

    await setupTest({ connectors: false });
    await teardownTest();

    expect(shutdownMock).toHaveBeenCalledTimes(1);
    expect(runShutdownHooksMock).toHaveBeenCalledTimes(1);
    expect(startMock).not.toHaveBeenCalled();
  });
});

describe("proof 12 — every setup attempt is bounded by `tests.setupTimeout`", () => {
  /**
   * The bound the specs arm with. Any value works — the point of injecting the
   * scheduler is that no test ever waits one out — but it has to be recognisable
   * in the recorded delays and in the rejection message.
   */
  const INJECTED_BOUND = 60_000;

  it("arms the shipped default when nothing overrides it", async () => {
    const timers = createTimeoutRecorder();

    primeLifecycleRegistry({ scheduleTimeout: timers.scheduleTimeout });

    const { setupTest } = await importFreshLifecycle();

    await setupTest({ connectors: false });

    // 120s, the value the changelog and the `test-service` skill publish. Every
    // other case here injects a bound, so without this one the number a project
    // actually gets would be asserted nowhere.
    expect(timers.delays()).toEqual([120_000]);
  });

  it("settles the stuck setup as a rejection in the turn the bound fires", async () => {
    const timers = createTimeoutRecorder();
    const gate = createDeferred();

    primeLifecycleRegistry({
      scheduleTimeout: timers.scheduleTimeout,
      setupTimeoutOverride: INJECTED_BOUND,
    });

    // Held open for the rest of the spec: this attempt is the hang the bound
    // exists to convert into a sentence.
    bootstrapMock.mockImplementationOnce(() => gate.promise);

    const { setupTest } = await importFreshLifecycle();

    const setup = setupTest({ connectors: false });

    timers.fireLatest();

    // Read, not awaited. Every sibling case below awaits the rejection, and an
    // await cannot distinguish "rejected" from "never settles" — remove the race
    // in `awaitSetupWithinBound` and they run until the runner kills the file
    // with a timeout instead of an assertion. This one names the difference.
    const settlement = await settleWithinOneTurn(setup);

    expect(settlement.type).toBe("rejected");
    expect((settlement.reason as Error | undefined)?.message).toMatch(
      /did not finish within 60000ms and is stuck in the "starting" state/,
    );

    // The other half of the same turn, and the reason this is one spec rather
    // than two: the expiry is what writes the poison, so a bound that never wins
    // the race leaves this reading `starting` — the stranded state itself.
    expect(readLifecycleRegistry().state).toBe("poisoned");

    gate.resolve();

    await flushAbandonedAttempt();
  });

  it("rejects with a message naming the stuck state, the bound, and how to raise it", async () => {
    const timers = createTimeoutRecorder();
    const gate = createDeferred();

    primeLifecycleRegistry({
      scheduleTimeout: timers.scheduleTimeout,
      setupTimeoutOverride: INJECTED_BOUND,
    });

    bootstrapMock.mockImplementationOnce(() => gate.promise);

    const { setupTest } = await importFreshLifecycle();

    const setup = setupTest({ connectors: false });

    // Armed before the attempt runs: config, which could itself hang, is not
    // readable yet.
    expect(timers.delays()).toEqual([INJECTED_BOUND]);

    timers.fireLatest();

    // All three, because "setup timed out" alone sends the reader into the
    // framework's source to find out what to do about it.
    await expect(setup).rejects.toThrow(
      /did not finish within 60000ms and is stuck in the "starting" state/,
    );
    await expect(setup).rejects.toThrow(/raise the bound with `tests\.setupTimeout`/);

    gate.resolve();

    await flushAbandonedAttempt();
  });

  it("leaves the lifecycle poisoned so a later setupTest refuses", async () => {
    const timers = createTimeoutRecorder();
    const gate = createDeferred();

    primeLifecycleRegistry({
      scheduleTimeout: timers.scheduleTimeout,
      setupTimeoutOverride: INJECTED_BOUND,
    });

    bootstrapMock.mockImplementationOnce(() => gate.promise);

    const { setupTest } = await importFreshLifecycle();

    const setup = setupTest({ connectors: false });

    timers.fireLatest();

    await expect(setup).rejects.toThrow(/is stuck in the "starting" state/);

    // Nothing here knows what the abandoned attempt had already opened, so a
    // second runtime must not be stacked on top of it.
    await expect(setupTest({ connectors: false })).rejects.toThrow(
      /Restart the Vitest worker before setting up again/,
    );

    gate.resolve();

    await flushAbandonedAttempt();
  });

  it("keeps the poison when the abandoned attempt succeeds later", async () => {
    const timers = createTimeoutRecorder();
    const gate = createDeferred();

    primeLifecycleRegistry({
      scheduleTimeout: timers.scheduleTimeout,
      setupTimeoutOverride: INJECTED_BOUND,
    });

    bootstrapMock.mockImplementationOnce(() => gate.promise);

    const { setupTest } = await importFreshLifecycle();

    const setup = setupTest({ connectors: false });

    timers.fireLatest();

    await expect(setup).rejects.toThrow(/is stuck in the "starting" state/);

    // The losing attempt is not cancellable: it runs on and reaches its own
    // "ready" write. Letting that land would overwrite the poison with a claim
    // that a runtime nobody is holding is up.
    gate.resolve();

    await flushAbandonedAttempt();

    await expect(setupTest({ connectors: false })).rejects.toThrow(
      /Restart the Vitest worker before setting up again/,
    );
  });

  it("keeps the poison when the abandoned attempt fails later", async () => {
    const timers = createTimeoutRecorder();
    const gate = createDeferred();

    primeLifecycleRegistry({
      scheduleTimeout: timers.scheduleTimeout,
      setupTimeoutOverride: INJECTED_BOUND,
    });

    bootstrapMock.mockImplementationOnce(() => gate.promise);

    const { setupTest } = await importFreshLifecycle();

    const setup = setupTest({ connectors: false });

    timers.fireLatest();

    await expect(setup).rejects.toThrow(/is stuck in the "starting" state/);

    // The other half of the same hazard: the abandoned attempt's failure path
    // would return the lifecycle to `idle`, which is a stronger claim than
    // "poisoned" and an unearned one.
    gate.reject(new Error("bootstrap exploded"));

    await flushAbandonedAttempt();

    await expect(setupTest({ connectors: false })).rejects.toThrow(
      /Restart the Vitest worker before setting up again/,
    );
  });

  it("bounds a teardown waiting on the stuck setup with that same timer", async () => {
    const timers = createTimeoutRecorder();
    const gate = createDeferred();

    primeLifecycleRegistry({
      scheduleTimeout: timers.scheduleTimeout,
      setupTimeoutOverride: INJECTED_BOUND,
    });

    bootstrapMock.mockImplementationOnce(() => gate.promise);

    const { setupTest, teardownTest } = await importFreshLifecycle();

    const setup = setupTest({ connectors: false });
    const teardown = teardownTest();

    timers.fireLatest();

    await expect(setup).rejects.toThrow(/is stuck in the "starting" state/);

    // Bounded, not hanging: without the setup bound this teardown waits on an
    // attempt that never settles.
    await expect(teardown).resolves.toBeUndefined();

    // ONE timer. The teardown inherits the bound by awaiting the same attempt;
    // the contract forbids a second deadline and a recursive re-entry.
    expect(timers.delays()).toEqual([INJECTED_BOUND]);
    expect(shutdownMock).toHaveBeenCalledTimes(1);

    gate.resolve();

    await flushAbandonedAttempt();
  });

  it("re-arms from `tests.setupTimeout`, measured from when the attempt started", async () => {
    const timers = createTimeoutRecorder();
    const advanceClock = freezeClock(1_000);

    primeLifecycleRegistry({
      scheduleTimeout: timers.scheduleTimeout,
      setupTimeoutOverride: INJECTED_BOUND,
    });

    configGetMock.mockReturnValue({ setupTimeout: 9_000 });

    // 400ms of the attempt is already gone by the time config is readable.
    loadConfigFilesMock.mockImplementationOnce(async () => {
      advanceClock(1_400);

      return undefined;
    });

    const { setupTest } = await importFreshLifecycle();

    await setupTest({ connectors: false });

    // 8600, not 9000: a bound re-armed from "now" would be the time already
    // spent PLUS the configured bound, so lowering the key would lengthen the
    // guard.
    expect(timers.delays()).toEqual([INJECTED_BOUND, 8_600]);
  });

  it("expires immediately when the configured bound is already spent", async () => {
    const timers = createTimeoutRecorder();
    const advanceClock = freezeClock(1_000);
    const gate = createDeferred();

    primeLifecycleRegistry({
      scheduleTimeout: timers.scheduleTimeout,
      setupTimeoutOverride: INJECTED_BOUND,
    });

    configGetMock.mockReturnValue({ setupTimeout: 500 });

    loadConfigFilesMock.mockImplementationOnce(async () => {
      advanceClock(2_000);

      return undefined;
    });

    // Held open so the attempt cannot outrun an expiry it has already earned.
    startWithoutMock.mockImplementationOnce(() => gate.promise);

    const { setupTest } = await importFreshLifecycle();

    await expect(setupTest({ connectors: true })).rejects.toThrow(
      /did not finish within 500ms/,
    );

    // No second entry: an exceeded bound fires, it is not rescheduled for time
    // the attempt has already burned.
    expect(timers.delays()).toEqual([INJECTED_BOUND]);

    gate.resolve();

    await flushAbandonedAttempt();
  });

  const invalidTimeouts = [
    ["zero", 0],
    ["negative", -1],
    ["non-numeric", "5000"],
  ] as const;

  it.each(invalidTimeouts)(
    "rejects a %s `tests.setupTimeout` instead of falling back to the default",
    async (_label, configured) => {
      const timers = createTimeoutRecorder();

      primeLifecycleRegistry({
        scheduleTimeout: timers.scheduleTimeout,
        setupTimeoutOverride: INJECTED_BOUND,
      });

      configGetMock.mockReturnValue({ setupTimeout: configured });

      const { setupTest } = await importFreshLifecycle();

      // Silently using the default would erase what the project configured —
      // the same defect the connector precedence rules out.
      await expect(setupTest({ connectors: false })).rejects.toThrow(
        /tests\.setupTimeout must be a positive number of milliseconds/,
      );

      // And it fails through the ordinary partial-startup path.
      expect(shutdownMock).toHaveBeenCalledTimes(1);
      expect(timers.delays()).toEqual([INJECTED_BOUND]);
    },
  );

  it("cancels the timer when the setup finishes first, and stays usable", async () => {
    const timers = createTimeoutRecorder();

    primeLifecycleRegistry({
      scheduleTimeout: timers.scheduleTimeout,
      setupTimeoutOverride: INJECTED_BOUND,
    });

    const { setupTest } = await importFreshLifecycle();

    await setupTest({ connectors: false });

    // A hang guard that outlives the attempt it guards is a leaked timer.
    expect(timers.cancelledCount()).toBe(1);

    // And the runtime is genuinely ready — not poisoned by a stale expiry.
    await expect(setupTest({ connectors: false })).resolves.toBeUndefined();

    expect(bootstrapMock).toHaveBeenCalledTimes(1);
  });
});

describe("proof 12 — the production scheduler the lifecycle falls back to", () => {
  /**
   * Every case above injects `registry.scheduleTimeout`, which leaves the
   * shipped `scheduleRealTimeout` — the one a project actually runs — asserted
   * nowhere. These four exercise it directly, on real timers.
   *
   * In MILLISECONDS on purpose: the point of the injected scheduler is that no
   * spec waits out a bound measured in minutes, and that constraint does not
   * stop being true just because the subject is the real one.
   */
  const REAL_DELAY = 5;

  /**
   * The wall-clock fence these specs wait behind. Deliberately far above
   * {@link REAL_DELAY} rather than tight to it: a fence that raced the timer
   * would trade a guard for a flake.
   */
  const REAL_FENCE = 60;

  /**
   * Node's timer prototype, reached through an actual timer rather than an
   * internal import.
   *
   * Spying here — instead of stubbing `setTimeout` — is what lets one spec
   * observe `unref` while the other three still run the real timer.
   */
  function timerPrototype(): { unref: () => unknown } {
    const probe = setTimeout(() => undefined, 0);
    const prototype = Object.getPrototypeOf(probe);

    clearTimeout(probe);

    return prototype;
  }

  /**
   * Wait long enough that a fired timer has definitely fired.
   */
  function waitPastTheDelay(): Promise<void> {
    return new Promise((resolve) => setTimeout(() => resolve(), REAL_FENCE));
  }

  it("fires its callback after the delay", async () => {
    const onExpiry = vi.fn();

    const handle = scheduleRealTimeout(REAL_DELAY, onExpiry);

    // Scheduled, not run inline. `armSetupBound` arms BEFORE the attempt runs,
    // so a scheduler that called back synchronously would mark the bound
    // expired before there was anything to bound.
    expect(onExpiry).not.toHaveBeenCalled();

    await waitPastTheDelay();

    expect(onExpiry).toHaveBeenCalledTimes(1);

    handle.cancel();
  });

  it("does not fire its callback once cancelled", async () => {
    const onExpiry = vi.fn();

    const handle = scheduleRealTimeout(REAL_DELAY, onExpiry);

    handle.cancel();

    await waitPastTheDelay();

    // The branch `armSetupBound.settle()` calls into when the attempt wins the
    // race — proof 12g asserts the cancel COUNT against an injected scheduler,
    // and this is the half that says the count means something.
    expect(onExpiry).not.toHaveBeenCalled();
  });

  it("is safe to cancel twice", async () => {
    const onExpiry = vi.fn();

    const handle = scheduleRealTimeout(REAL_DELAY, onExpiry);

    handle.cancel();

    // `armSetupBound` really does cancel one handle twice: `armFor` cancels the
    // pending handle before it decides what to do next, and an already-overdue
    // re-arm then falls into `expireNow`, which cancels that same still-assigned
    // handle again. A cancel that only tolerated one call would throw from
    // inside the hang guard, on the path proof 12e covers.
    expect(() => handle.cancel()).not.toThrow();

    await waitPastTheDelay();

    expect(onExpiry).not.toHaveBeenCalled();
  });

  it("unrefs the timer it schedules", async () => {
    const unrefSpy = vi.spyOn(timerPrototype(), "unref");
    const onExpiry = vi.fn();

    const handle = scheduleRealTimeout(REAL_DELAY, onExpiry);

    // ⚠ What is observable from here is the CALL, on the timer this scheduler
    // just created. Whether an unref'd timer actually lets a Vitest worker exit
    // is a property of the event loop and is NOT measured by this spec or any
    // other in this file.
    expect(unrefSpy).toHaveBeenCalledTimes(1);

    handle.cancel();
  });
});

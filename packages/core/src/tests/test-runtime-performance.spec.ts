import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clockFake } from "./fakes/clock-fake";
import { idsFake } from "./fakes/ids-fake";
import { ids } from "../utils/ids";
import { getTestLifecycleRegistry } from "./test-lifecycle-state";
import { configureTestWorker, getTestRuntimeStats, testRuntimeScope } from "./test-runtime-scope";
import { trackOpenTestServer } from "./open-test-servers";
import { setupTest, teardownTest } from "./vitest-setup";

const mocks = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  bootstrap: vi.fn(async () => undefined),
  init: vi.fn(async () => undefined),
  load: vi.fn(async () => undefined),
  appConfig: vi.fn(async () => undefined),
  unitConfig: vi.fn(async () => undefined),
  startWithout: vi.fn(async () => undefined),
  shutdown: vi.fn(async () => undefined),
  resetDatabase: vi.fn(async () => [] as string[]),
  captureSnapshot: vi.fn(async () => undefined),
  resetState: vi.fn(async () => ({ routesRestored: true, cacheFlushed: false })),
}));
vi.mock("./reset-test-database", () => ({ resetTestDatabase: mocks.resetDatabase }));
vi.mock("./reset-test-state", () => ({
  captureTestRouterSnapshot: mocks.captureSnapshot,
  resetTestRuntimeState: mocks.resetState,
}));
vi.mock("../application/application", () => ({
  Application: { setEnvironment: vi.fn(), runShutdownHooks: vi.fn() },
}));
vi.mock("../bootstrap", () => ({ bootstrap: mocks.bootstrap }));
vi.mock("../warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: { load: mocks.load },
}));
vi.mock("../config/load-config-files", () => ({ loadConfigFiles: mocks.appConfig }));
vi.mock("./load-unit-config", () => ({ loadUnitConfig: mocks.unitConfig }));
vi.mock("../dev-server/files-orchestrator", () => ({ filesOrchestrator: { init: mocks.init } }));
vi.mock("../connectors", () => ({
  connectorsManager: {
    observeTimings: vi.fn(),
    startWithout: mocks.startWithout,
    shutdown: mocks.shutdown,
  },
}));
vi.mock("../config", () => ({
  config: {
    get: (key: string) =>
      key === "tests" ? mocks.settings : mocks.settings[key.replace(/^tests\./, "")],
  },
}));

const options = { importModule: async () => ({}), fakes: { cache: false, storage: false } };
let cleanup: () => Promise<void> = async () => undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings = {};
  Object.assign(getTestLifecycleRegistry(), {
    state: "idle",
    activeSelection: undefined,
    setupAttempt: undefined,
    teardownAttempt: undefined,
  });
  Object.assign(testRuntimeScope(), {
    lifetime: "file",
    fileOpen: false,
    boundary: undefined,
    mode: undefined,
    unitConfig: undefined,
    worker: undefined,
    cleanupRegistered: false,
    shutdown: undefined,
    bootstraps: 0,
    files: 0,
    profiles: [],
    profile: undefined,
    summaryPrinted: false,
    shutdownMs: undefined,
  });
  configureTestWorker({ pool: "forks", watch: false, isolate: false }, (callback) => {
    cleanup = callback;
  });
});
afterEach(async () => {
  await teardownTest();
  await cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("test runtime performance modes", () => {
  it("keeps file lifetime as the default", async () => {
    for (let file = 0; file < 3; file += 1) {
      await setupTest(options);
      await teardownTest();
    }
    expect(mocks.bootstrap).toHaveBeenCalledTimes(3);
    expect(mocks.shutdown).toHaveBeenCalledTimes(3);
  });

  it("boots once for multiple files, resets fixtures, clock and ids, and awaits worker shutdown once", async () => {
    let records: string[] = ["stale"];
    const reset = vi.fn(async () => {
      records = [];
    });
    mocks.settings = { lifetime: "worker", resetBetweenFiles: reset };
    for (let file = 0; file < 4; file += 1) {
      await setupTest({ ...options, file: `service-${file}.test.ts` });
      expect(records).toEqual([]);
      expect(clockFake.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(ids.uuid()).toBe(idsFake.uuid(1));
      records.push("fixture");
      clockFake.travel(60000);
      await setupTest(options); // repeated calls within a file do not reset fixtures
      expect(records).toEqual(["fixture"]);
      await teardownTest();
    }
    expect(getTestRuntimeStats()).toEqual({ bootstraps: 1, files: 4 });
    expect(mocks.bootstrap).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(4);
    expect(mocks.shutdown).not.toHaveBeenCalled();
    await cleanup();
    await cleanup();
    expect(mocks.shutdown).toHaveBeenCalledTimes(1);
  });

  it("truncates the database and closes leaked test servers before each worker-lifetime file", async () => {
    const order: string[] = [];
    mocks.resetDatabase.mockImplementation(async () => {
      order.push("database");
      return [];
    });
    mocks.settings = {
      lifetime: "worker",
      resetDatabase: { except: ["countries"] },
      resetBetweenFiles: () => {
        order.push("hook");
      },
    };
    const leaked = vi.fn(async () => {
      order.push("server");
    });
    await setupTest(options);
    trackOpenTestServer({ close: leaked });
    await teardownTest();
    await setupTest(options);
    expect(leaked).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["database", "hook", "server", "database", "hook"]);
    expect(mocks.resetDatabase).toHaveBeenNthCalledWith(1, { except: ["countries"] });
  });

  it("resets the in-memory runtime state before each worker-lifetime file, after leaked servers close", async () => {
    const order: string[] = [];
    mocks.resetState.mockImplementation(async () => {
      order.push("state");
      return { routesRestored: true, cacheFlushed: false };
    });
    mocks.resetDatabase.mockImplementation(async () => {
      order.push("database");
      return [];
    });
    mocks.settings = { lifetime: "worker", resetDatabase: true };
    const leaked = vi.fn(async () => {
      order.push("server");
    });

    await setupTest(options);
    // The booted application is captured once, then the first file is reset.
    expect(mocks.captureSnapshot).toHaveBeenCalledTimes(1);
    trackOpenTestServer({ close: leaked });
    await teardownTest();
    await setupTest(options);

    expect(mocks.captureSnapshot).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["state", "database", "server", "state", "database"]);
  });

  it("does not reset the in-memory state under file lifetime", async () => {
    await setupTest(options);
    await teardownTest();
    expect(mocks.resetState).not.toHaveBeenCalled();
    expect(mocks.captureSnapshot).not.toHaveBeenCalled();
  });

  it('opts one file out of the worker lifetime with setupTest({ lifetime: "file" })', async () => {
    mocks.settings = { lifetime: "worker" };

    await setupTest(options);
    await teardownTest();
    expect(mocks.bootstrap).toHaveBeenCalledTimes(1);
    expect(mocks.shutdown).not.toHaveBeenCalled();

    // The opted-out file closes the shared runtime and boots a private one ...
    await setupTest({ ...options, lifetime: "file" });
    expect(mocks.shutdown).toHaveBeenCalledTimes(1);
    expect(mocks.bootstrap).toHaveBeenCalledTimes(2);
    expect(testRuntimeScope().lifetime).toBe("file");

    // ... that its own teardown closes again.
    await teardownTest();
    expect(mocks.shutdown).toHaveBeenCalledTimes(2);

    // The next file is back on the worker lifetime.
    await setupTest(options);
    expect(testRuntimeScope().lifetime).toBe("worker");
    expect(mocks.bootstrap).toHaveBeenCalledTimes(3);
    await teardownTest();
    await setupTest(options);
    expect(mocks.bootstrap).toHaveBeenCalledTimes(3);
  });

  it("opts the first file of a worker out without a prior shared runtime", async () => {
    mocks.settings = { lifetime: "worker" };

    await setupTest({ ...options, lifetime: "file" });
    expect(testRuntimeScope().lifetime).toBe("file");
    await teardownTest();

    expect(mocks.shutdown).toHaveBeenCalledTimes(1);
  });

  it('rejects a lifetime option other than "file"', async () => {
    await expect(setupTest({ ...options, lifetime: "worker" } as never)).rejects.toThrow(
      /only accepts "file"/,
    );
  });

  it("rejects an invalid tests.resetDatabase value", async () => {
    mocks.settings = { lifetime: "worker", resetDatabase: "yes" };
    await expect(setupTest(options)).rejects.toThrow(/resetDatabase must be true/);
  });

  it("does not touch the database under file lifetime", async () => {
    mocks.settings = { resetDatabase: true };
    await setupTest(options);
    await teardownTest();
    expect(mocks.resetDatabase).not.toHaveBeenCalled();
  });

  it("shares concurrent file resets and refuses reuse after a reset failure", async () => {
    const reset = vi.fn(async () => undefined);
    mocks.settings = { lifetime: "worker", resetBetweenFiles: reset };
    await setupTest(options);
    await teardownTest();
    await Promise.all([setupTest(options), setupTest(options)]);
    expect(reset).toHaveBeenCalledTimes(2);
    await teardownTest();
    reset.mockRejectedValueOnce(new Error("reset failed"));
    await expect(setupTest(options)).rejects.toThrow("reset failed");
    await expect(setupTest(options)).rejects.toThrow(/earlier teardownTest/);
  });

  it.each([
    { pool: "threads", watch: false, isolate: false },
    { pool: "forks", watch: true, isolate: false },
    { pool: "forks", watch: false, isolate: true },
  ])("refuses unsafe worker configuration %j", async (configuration) => {
    configureTestWorker(configuration, () => undefined);
    mocks.settings = { lifetime: "worker" };
    await expect(setupTest(options)).rejects.toThrow(/forks.*isolate: false.*vitest run/);
    expect(mocks.startWithout).not.toHaveBeenCalled();
  });

  it("unit mode loads config once without bootstrap, connectors, orchestrator or fakes", async () => {
    for (let file = 0; file < 2; file += 1) {
      await setupTest({ mode: "unit", importModule: options.importModule });
      await teardownTest();
    }
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.unitConfig).toHaveBeenCalledTimes(1);
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.startWithout).not.toHaveBeenCalled();
    expect(clockFake.isInstalled()).toBe(false);
    expect(mocks.shutdown).not.toHaveBeenCalled();
  });

  it("refuses to boot the framework from the unit project, but still allows unit mode", async () => {
    vi.stubEnv("WARLOCK_TEST_PROJECT", "unit");

    await expect(setupTest(options)).rejects.toThrow(/unit project/);
    expect(mocks.bootstrap).not.toHaveBeenCalled();

    await setupTest({ mode: "unit", importModule: options.importModule });
    await teardownTest();
    expect(mocks.unitConfig).toHaveBeenCalledTimes(1);
  });

  it("requires the Vitest importer in unit mode", async () => {
    await expect(setupTest({ mode: "unit" })).rejects.toThrow(/requires importModule/);
  });

  it("skips the native loader when Vitest owns application imports", async () => {
    await setupTest(options);
    expect(mocks.init).toHaveBeenCalledWith({ skipLoader: true });
  });

  it.each(["config", "environment"])(
    "reports one line per file and a worker summary via %s",
    async (source) => {
      if (source === "config") mocks.settings = { profileSetup: true };
      else vi.stubEnv("WARLOCK_TEST_PROFILE", "1");
      const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
      await setupTest({ ...options, file: "service.test.ts" });
      await teardownTest();
      await cleanup();
      const lines = info.mock.calls.map((call) => String(call[0]));
      expect(lines.filter((line) => line.includes('file="service.test.ts"'))).toHaveLength(1);
      expect(lines[0]).toMatch(
        /config=\d+\.\d+ms.*bootstrap=.*orchestrator=.*appConfig=.*connectors=.*fakes=.*teardown=/,
      );
      expect(lines.filter((line) => line.includes("summary"))).toHaveLength(1);
      expect(lines.at(-1)).toContain("files=1 bootstraps=1");
    },
  );
});

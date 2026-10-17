import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_LIFECYCLE_REGISTRY_KEY } from "../../../src/tests/test-lifecycle-state";

/**
 * `setupTest` installs the test fakes after its connectors start, and
 * `teardownTest` restores them before the connectors shut down — so a fake
 * replaces a driver that is already configured, and the real driver it puts
 * back is still connected. The fakes themselves are covered in
 * `src/tests/fakes/fakes.spec.ts`; here only the ordering and the option.
 */

const order: string[] = [];

const installTestFakes = vi.fn(async (_selection?: unknown) => {
  order.push("install fakes");
  return [];
});
const restoreTestFakes = vi.fn(async () => {
  order.push("restore fakes");
});

vi.mock("../../../src/tests/fakes/test-fakes", () => ({
  installTestFakes: (selection?: unknown) => installTestFakes(selection),
  restoreTestFakes: () => restoreTestFakes(),
}));

vi.mock("../../../src/connectors", () => ({
  connectorsManager: {
    start: vi.fn(async () => undefined),
    startWithout: vi.fn(async () => {
      order.push("start connectors");
    }),
    shutdown: vi.fn(async () => {
      order.push("shutdown connectors");
    }),
  },
}));

vi.mock("../../../src/config", () => ({ config: { get: vi.fn(() => null) } }));

vi.mock("../../../src/application/application", () => ({
  Application: { setEnvironment: vi.fn(), runShutdownHooks: vi.fn(async () => undefined) },
}));

vi.mock("../../../src/bootstrap", () => ({ bootstrap: vi.fn(async () => undefined) }));

vi.mock("../../../src/config/load-config-files", () => ({
  loadConfigFiles: vi.fn(async () => undefined),
}));

vi.mock("../../../src/dev-server/files-orchestrator", () => ({
  filesOrchestrator: { init: vi.fn(async () => undefined) },
}));

vi.mock("../../../src/warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: { load: vi.fn(async () => undefined) },
}));

async function freshLifecycle() {
  vi.resetModules();

  return import("../../../src/tests/vitest-setup");
}

describe("setupTest — test fakes", () => {
  beforeEach(() => {
    delete (globalThis as Record<symbol, unknown>)[TEST_LIFECYCLE_REGISTRY_KEY];
    order.length = 0;
    installTestFakes.mockClear();
    restoreTestFakes.mockClear();
  });

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[TEST_LIFECYCLE_REGISTRY_KEY];
  });

  it("installs the fakes after the connectors start and restores them before shutdown", async () => {
    const { setupTest, teardownTest } = await freshLifecycle();

    await setupTest();
    await teardownTest();

    expect(order).toEqual([
      "start connectors",
      "install fakes",
      "restore fakes",
      "shutdown connectors",
    ]);
    // No option: tests.fakes config (then "all on") decides.
    expect(installTestFakes).toHaveBeenCalledWith(undefined);
  });

  it("passes an explicit fakes selection through", async () => {
    const { setupTest, teardownTest } = await freshLifecycle();

    await setupTest({ fakes: { cache: false } });
    await teardownTest();

    expect(installTestFakes).toHaveBeenCalledWith({ cache: false });
  });

  it("still shuts the connectors down when restoring a fake fails", async () => {
    const { setupTest, teardownTest } = await freshLifecycle();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    restoreTestFakes.mockRejectedValueOnce(new Error("restore exploded"));

    await setupTest();
    await expect(teardownTest()).resolves.toBeUndefined();

    expect(order.at(-1)).toBe("shutdown connectors");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

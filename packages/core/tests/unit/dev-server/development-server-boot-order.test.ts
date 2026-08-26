import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D7b — `DevelopmentServer.start()` must call
 * `Application.runStartupValidators()` after app modules load and BEFORE
 * late-phase connectors (http, socket) start, so a rejecting validator stops
 * the dev server before anything binds a port. Every module `start()`
 * touches is mocked at the seam (same pattern as `restart-dev-server.test.ts`
 * / `module-loader-load-failure.test.ts`) so this test drives the real
 * `DevelopmentServer.start()` method, not a re-implementation of it.
 */

const loadAll = vi.hoisted(() => vi.fn(async () => undefined));
const startPhase = vi.hoisted(() => vi.fn(async () => undefined));
const runStartupValidators = vi.hoisted(() => vi.fn(async () => undefined));
const markBooted = vi.hoisted(() => vi.fn());

vi.mock("@mongez/events", () => ({ default: { on: vi.fn(), emit: vi.fn() } }));

vi.mock("@warlock.js/fs", () => ({
  fileExistsAsync: vi.fn(async () => false),
  unlinkAsync: vi.fn(async () => undefined),
}));

vi.mock("../../../src/application", () => ({
  Application: {
    runStartupValidators,
    markBooted,
    environment: "test",
    runtimeStrategy: "development",
  },
}));

vi.mock("../../../src/connectors/connectors-manager", () => ({
  // `list` is read by the ready block after boot, to decide whether a web/SSR
  // surface shares the port. Empty here: this test is about ORDER, and an
  // API-only app is the smaller of the two shapes.
  connectorsManager: { startPhase, list: vi.fn(() => []) },
}));

vi.mock("../../../src/warlock-config", () => ({
  warlockConfigManager: { get: vi.fn(async () => ({})) },
}));

vi.mock("../../../src/dev-server/dev-logger", () => ({
  devLogInfo: vi.fn(),
  devLogReady: vi.fn(),
  devLogSection: vi.fn(),
  devLogWarn: vi.fn(),
  devServeLog: vi.fn(),
}));

vi.mock("../../../src/dev-server/files-orchestrator", () => ({
  filesOrchestrator: {
    init: vi.fn(async () => undefined),
    initializeAll: vi.fn(async () => undefined),
    watchFiles: vi.fn(async () => undefined),
    specialFilesCollector: { collect: vi.fn() },
    getFiles: vi.fn(() => new Map()),
    getDependencyGraph: vi.fn(() => ({})),
    moduleLoader: { loadAll, loadModule: vi.fn() },
    bumpVersion: vi.fn(),
    flushVersionBumps: vi.fn(async () => undefined),
    files: new Map(),
    startCheckingHealth: vi.fn(async () => undefined),
  },
}));

vi.mock("../../../src/dev-server/flags", () => ({ MANIFEST_PATH: "/tmp/manifest.json" }));

vi.mock("../../../src/dev-server/layer-executor", () => ({
  LayerExecutor: vi.fn(),
}));

vi.mock("../../../src/dev-server/restart-dev-server", () => ({
  restartDevServer: vi.fn(async () => false),
}));

vi.mock("../../../src/dev-server/shortcuts", () => ({
  devServerShortcuts: { release: vi.fn() },
}));

vi.mock("../../../src/dev-server/type-generator", () => ({
  typeGenerator: {
    executeGenerateAllCommand: vi.fn(),
    executeTypingsGenerator: vi.fn(),
  },
}));

const { DevelopmentServer } = await import("../../../src/dev-server/development-server");
const { ConnectorLifecyclePhase } = await import("../../../src/connectors/types");

describe("DevelopmentServer.start() — D7 boot-order wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls runStartupValidators after loadAll and before the late connector phase", async () => {
    const server = new DevelopmentServer({ generateTypings: false, healthCheckers: false });

    await server.start();

    expect(loadAll).toHaveBeenCalledOnce();
    expect(runStartupValidators).toHaveBeenCalledOnce();
    expect(startPhase).toHaveBeenCalledWith(ConnectorLifecyclePhase.Late);

    const loadAllOrder = loadAll.mock.invocationCallOrder[0];
    const validatorsOrder = runStartupValidators.mock.invocationCallOrder[0];
    const lateOrder = startPhase.mock.invocationCallOrder[0];

    expect(loadAllOrder).toBeLessThan(validatorsOrder);
    expect(validatorsOrder).toBeLessThan(lateOrder);
  });

  it("a rejecting validator stops the late connector phase from ever starting and propagates out of start()", async () => {
    runStartupValidators.mockRejectedValueOnce(
      new Error('Startup validator "requireJwtSecret" rejected boot: JWT_SECRET is not set'),
    );

    const server = new DevelopmentServer({ generateTypings: false, healthCheckers: false });

    await expect(server.start()).rejects.toThrow(/JWT_SECRET is not set/);

    expect(startPhase).not.toHaveBeenCalledWith(ConnectorLifecyclePhase.Late);
    expect(markBooted).not.toHaveBeenCalled();
  });
});

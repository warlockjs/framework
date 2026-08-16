import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_LIFECYCLE_REGISTRY_KEY } from "../../../src/tests/test-lifecycle-state";

/**
 * `setupTest`'s connector selection — the cases the public contract names.
 *
 * SCOPE: this file asserts ONLY which connectors `setupTest` asks the manager to
 * start. Everything `setupTest` does before that decision — env, bootstrap, the
 * files orchestrator, config loading — is mocked away, because none of it is the
 * subject and all of it is slow. The lifecycle state machine around the decision
 * is `setup-test-lifecycle.test.ts`.
 *
 * Two defects live in this decision, both reported by @Fig on 2026-08-12:
 *
 *   1. `config.get("tests")` returns `null` for an absent key (it defaults to
 *      `null`, not `{}`), and the old code dereferenced it — so an app with no
 *      `src/config/tests.ts` crashed with "Cannot read properties of null".
 *      `warlock add test` does not generate that file, so the DEFAULT path threw.
 *
 *   2. The old code read `testConfig.connectors || connectors`, which discards a
 *      configured `false`, and every non-array value then fell into
 *      `startWithout(["http"])` — so `connectors: false` started EVERYTHING but
 *      http, from config and from the caller alike. The type and three places in
 *      `skills/test-service/SKILL.md` promise it starts none.
 *
 * ⚠ A third change lands here: 4.13 let config win over the parameter, and
 * `contracts/2026-08-12-test-worker-lifecycle.md` flips that to
 * `explicit non-undefined call > tests.connectors config > true`. The last case
 * below is the one that changed direction.
 */

const startMock = vi.fn(async () => undefined);
const startWithoutMock = vi.fn(async () => undefined);
const shutdownMock = vi.fn(async () => undefined);
const configGetMock = vi.fn();

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
    // default default is `null` — which is exactly what the first defect ate.
    get: (...args: unknown[]) => configGetMock(...args),
  },
}));

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

/**
 * Import a fresh copy of the module.
 */
async function freshSetupTest() {
  vi.resetModules();

  const module = await import("../../../src/tests/vitest-setup");

  return module.setupTest;
}

/**
 * Drop the runtime context's lifecycle registry.
 *
 * ⚠ `vi.resetModules()` is NOT enough on its own any more, and that is the
 * point: lifecycle state lives on `globalThis` so it survives the module
 * registry rebuild Vitest performs before every test file. Without this reset,
 * every case after the first would hit a "ready" runtime and reject.
 */
function resetLifecycleRegistry(): void {
  delete (globalThis as Record<symbol, unknown>)[TEST_LIFECYCLE_REGISTRY_KEY];
}

describe("setupTest — connector selection", () => {
  beforeEach(() => {
    resetLifecycleRegistry();

    startMock.mockReset().mockResolvedValue(undefined);
    startWithoutMock.mockReset().mockResolvedValue(undefined);
    shutdownMock.mockReset().mockResolvedValue(undefined);
    configGetMock.mockReset();
  });

  afterEach(() => {
    resetLifecycleRegistry();
    vi.restoreAllMocks();
  });

  it("can be called with no arguments at all", async () => {
    // Found by @Nova: the signature destructured a REQUIRED parameter, so
    // `setupTest()` threw "Cannot destructure property 'connectors' of
    // 'undefined'" before reaching any of the logic below — and calling it with
    // no arguments is the most likely thing a new user types.
    configGetMock.mockReturnValue(null);

    const setupTest = await freshSetupTest();

    await expect(setupTest()).resolves.not.toThrow();
    expect(startWithoutMock).toHaveBeenCalledWith(["http"]);
  });

  it("does not throw when the app has no `tests` config", async () => {
    // The default path: `warlock add test` never generates src/config/tests.ts.
    configGetMock.mockReturnValue(null);

    const setupTest = await freshSetupTest();

    await expect(setupTest({})).resolves.not.toThrow();
    expect(startWithoutMock).toHaveBeenCalledWith(["http"]);
  });

  it("starts nothing when the config says `connectors: false`", async () => {
    configGetMock.mockReturnValue({ connectors: false });

    const setupTest = await freshSetupTest();

    await setupTest({});

    expect(startMock).not.toHaveBeenCalled();
    expect(startWithoutMock).not.toHaveBeenCalled();
  });

  it("starts nothing when the CALLER passes `connectors: false`", async () => {
    configGetMock.mockReturnValue(null);

    const setupTest = await freshSetupTest();

    await setupTest({ connectors: false });

    expect(startMock).not.toHaveBeenCalled();
    expect(startWithoutMock).not.toHaveBeenCalled();
  });

  it("starts everything except http when `connectors: true`", async () => {
    configGetMock.mockReturnValue(null);

    const setupTest = await freshSetupTest();

    await setupTest({ connectors: true });

    expect(startWithoutMock).toHaveBeenCalledWith(["http"]);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("starts exactly the listed connectors when given an array", async () => {
    configGetMock.mockReturnValue(null);

    const setupTest = await freshSetupTest();

    await setupTest({ connectors: ["database", "logger"] });

    expect(startMock).toHaveBeenCalledWith(["database", "logger"]);
    expect(startWithoutMock).not.toHaveBeenCalled();
  });

  it("lets the caller override the config, including `true` over `false`", async () => {
    // 4.13 documented the opposite — `tests.connectors` beat the parameter, so
    // this call started nothing. The ratified precedence puts an explicit
    // call-site value first, because a value the caller typed is intent and a
    // project default is not.
    configGetMock.mockReturnValue({ connectors: false });

    const setupTest = await freshSetupTest();

    await setupTest({ connectors: true });

    expect(startWithoutMock).toHaveBeenCalledWith(["http"]);
  });
});

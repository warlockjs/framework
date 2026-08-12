import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `setupTest`'s connector selection — the five cases the public contract names.
 *
 * SCOPE: this file asserts ONLY which connectors `setupTest` asks the manager to
 * start. Everything `setupTest` does before that decision — env, bootstrap, the
 * files orchestrator, config loading — is mocked away, because none of it is the
 * subject and all of it is slow.
 *
 * The subject is four lines:
 *
 *   const selected = testConfig?.connectors ?? connectors;
 *   if (selected === false) return;                       // start NOTHING
 *   if (Array.isArray(selected)) start(selected);         // start EXACTLY these
 *   else startWithout(["http"]);                          // start all but http
 *
 * Two defects live there, both reported by @Fig on 2026-08-12:
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
 */

const startMock = vi.fn();
const startWithoutMock = vi.fn();
const configGetMock = vi.fn();

vi.mock("../../../src/connectors", () => ({
  connectorsManager: {
    start: (...args: unknown[]) => startMock(...args),
    startWithout: (...args: unknown[]) => startWithoutMock(...args),
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
  Application: { setEnvironment: vi.fn() },
}));

vi.mock("../../../src/bootstrap", () => ({ bootstrap: vi.fn() }));

vi.mock("../../../src/config/load-config-files", () => ({ loadConfigFiles: vi.fn() }));

vi.mock("../../../src/dev-server/files-orchestrator", () => ({
  filesOrchestrator: { init: vi.fn() },
}));

vi.mock("../../../src/warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: { load: vi.fn() },
}));

/**
 * Import a fresh copy of the module.
 *
 * `setupTest` guards on a module-level `isSetupComplete` flag, so a second call
 * in the same module instance is a no-op — without resetting, every case after
 * the first would silently assert nothing.
 */
async function freshSetupTest() {
  vi.resetModules();

  const module = await import("../../../src/tests/vitest-setup");

  return module.setupTest;
}

describe("setupTest — connector selection", () => {
  beforeEach(() => {
    startMock.mockReset();
    startWithoutMock.mockReset();
    configGetMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("can be called with no arguments at all", async () => {
    // Found by @Nova: the signature destructures a REQUIRED parameter, so
    // `setupTest()` throws "Cannot destructure property 'connectors' of
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

    await setupTest({ connectors: ["database", "logger"] as never });

    expect(startMock).toHaveBeenCalledWith(["database", "logger"]);
    expect(startWithoutMock).not.toHaveBeenCalled();
  });

  it("lets the config override the caller, including `false` over `true`", async () => {
    // Documented in skills/test-service/SKILL.md: `tests.connectors` wins over
    // the parameter. `false` beating `true` is the case the old `||` inverted.
    configGetMock.mockReturnValue({ connectors: false });

    const setupTest = await freshSetupTest();

    await setupTest({ connectors: true });

    expect(startMock).not.toHaveBeenCalled();
    expect(startWithoutMock).not.toHaveBeenCalled();
  });
});

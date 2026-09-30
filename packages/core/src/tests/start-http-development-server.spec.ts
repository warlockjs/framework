import { env, resetEnv } from "@mongez/dotenv";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  load: vi.fn(async () => undefined),
  bootstrap: vi.fn(async () => undefined),
  init: vi.fn(async () => undefined),
  initializeAll: vi.fn(async () => undefined),
  loadAll: vi.fn(async () => undefined),
  loadConfigFiles: vi.fn(async () => undefined),
  startPhase: vi.fn(async () => undefined),
  webConnectorConstruction: vi.fn(async () => undefined),
  webConnectorStart: vi.fn(async () => undefined),
  connectors: [] as Array<{
    name: string;
    lifecyclePhase: string;
    boot: () => Promise<void>;
    start: () => Promise<void>;
  }>,
  shutdown: vi.fn(async () => undefined),
  runStartupValidators: vi.fn(async () => undefined),
  setRuntimeStrategy: vi.fn(),
  setEnvironment: vi.fn(),
}));

vi.mock("../application", () => ({
  Application: {
    setRuntimeStrategy: mocks.setRuntimeStrategy,
    setEnvironment: mocks.setEnvironment,
    runStartupValidators: mocks.runStartupValidators,
  },
}));
vi.mock("../bootstrap", () => ({ bootstrap: mocks.bootstrap }));
vi.mock("../config/load-config-files", () => ({ loadConfigFiles: mocks.loadConfigFiles }));
vi.mock("../connectors/connectors-manager", () => ({
  connectorsManager: {
    list: () => mocks.connectors,
    startPhase: mocks.startPhase,
    shutdown: mocks.shutdown,
  },
}));
vi.mock("../dev-server/files-orchestrator", () => ({
  filesOrchestrator: {
    init: mocks.init,
    initializeAll: mocks.initializeAll,
    moduleLoader: { loadAll: mocks.loadAll },
  },
}));
vi.mock("../warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: { load: mocks.load },
}));

import { resetLoadedEnvironment } from "../utils/load-environment";
import { startHttpTestServer, stopHttpTestServer } from "./start-http-development-server";

const fixtureKey = "WARLOCK_TEST_SERVER_ENV_FIXTURE";
let originalDirectory: string;
let fixtureDirectory: string;

beforeEach(async () => {
  originalDirectory = process.cwd();
  fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), "warlock-test-server-"));
  await writeFile(path.join(fixtureDirectory, ".env"), `${fixtureKey}=development\n`);
  await writeFile(path.join(fixtureDirectory, ".env.test"), `${fixtureKey}=test\n`);
  process.chdir(fixtureDirectory);
  delete process.env.NODE_ENV;
  delete process.env[fixtureKey];
  resetEnv();
  resetLoadedEnvironment();
  vi.clearAllMocks();
  mocks.connectors = [
    {
      // Web's lazy delegate constructs WebConnector (and can create Vite) on
      // its first boot call. This is the construction seam the API must skip.
      name: "web",
      lifecyclePhase: "late",
      boot: mocks.webConnectorConstruction,
      start: mocks.webConnectorStart,
    },
  ];
});

afterEach(async () => {
  await stopHttpTestServer();
  process.chdir(originalDirectory);
  delete process.env.NODE_ENV;
  delete process.env[fixtureKey];
  resetEnv();
  resetLoadedEnvironment();
  await rm(fixtureDirectory, { recursive: true, force: true });
});

describe("startHttpTestServer", () => {
  it("loads .env.test when NODE_ENV is unset before starting the server", async () => {
    await startHttpTestServer();

    expect(process.env.NODE_ENV).toBe("test");
    expect(env(fixtureKey)).toBe("test");
    expect(mocks.load).toHaveBeenCalledOnce();
  });

  it("does not construct the web connector when web is false", async () => {
    await startHttpTestServer({ web: false });

    expect(mocks.webConnectorConstruction).not.toHaveBeenCalled();
  });

  it("constructs the web connector by default", async () => {
    await startHttpTestServer();

    expect(mocks.webConnectorConstruction).toHaveBeenCalledOnce();
  });
});

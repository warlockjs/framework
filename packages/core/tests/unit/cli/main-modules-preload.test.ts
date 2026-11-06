import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const started: string[][] = [];

vi.mock("../../../src/utils/load-environment", () => ({ loadEnvironmentFiles: vi.fn() }));
vi.mock("../../../src/bootstrap", () => ({ bootstrap: vi.fn() }));
vi.mock("../../../src/application", () => ({
  Application: { setRuntimeStrategy: vi.fn(), setEnvironment: vi.fn() },
}));
vi.mock("../../../src/config/load-config-files", () => ({ loadConfigFiles: vi.fn() }));
vi.mock("@warlock.js/fs", () => ({ fileExistsAsync: vi.fn(async () => false) }));

vi.mock("../../../src/warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: {
    load: vi.fn(),
    isLoaded: true,
    get: vi.fn((key: string) =>
      key === "connectors" ? [{ name: "queue" }, { name: "web" }] : undefined,
    ),
  },
}));

vi.mock("../../../src/connectors/register-configured-connectors", () => ({
  registerConfiguredConnectors: vi.fn(() => calls.push("registerConfigured")),
  preflightConfiguredHttpPort: vi.fn(),
}));

vi.mock("../../../src/connectors/connectors-manager", () => ({
  connectorsManager: {
    list: () => [
      { name: "queue", lifecyclePhase: "early" },
      { name: "web", lifecyclePhase: "late" },
      { name: "database", lifecyclePhase: "early" },
    ],
    start: vi.fn(async (names: string[]) => {
      calls.push("connectors");
      started.push(names);
    }),
    startPhase: vi.fn(),
  },
}));

vi.mock("../../../src/connectors/types", () => ({
  ConnectorLifecyclePhase: { Early: "early", Late: "late" },
}));

vi.mock("../../../src/dev-server/files-orchestrator", () => ({
  filesOrchestrator: {
    init: vi.fn(),
    initializeAll: vi.fn(),
    getFiles: vi.fn(() => new Map()),
    specialFilesCollector: { collect: vi.fn() },
    moduleLoader: {
      loadMainModules: vi.fn(async () => {
        calls.push("mains");
      }),
    },
    load: vi.fn(),
  },
}));

const { CLICommand } = await import("../../../src/commands/cli-command");
const { CLICommandsManager } = await import("../../../src/cli/cli-commands.manager");

class PreloadManager extends CLICommandsManager {
  public preload(command: InstanceType<typeof CLICommand>) {
    return this.loadPreloaders(command);
  }
}

const commandWith = (preload: Record<string, unknown>) => {
  const command = new CLICommand("demo");
  command.commandPreload = preload;

  return command;
};

describe("mainModules preload", () => {
  beforeEach(() => {
    calls.length = 0;
    started.length = 0;
  });

  it("starts configured early connectors before module mains load", async () => {
    await new PreloadManager().preload(
      commandWith({ connectors: ["database"], mainModules: true }),
    );

    expect(started[0]).toEqual(["database", "queue"]);
    expect(calls).toEqual(["registerConfigured", "connectors", "mains"]);
  });

  it("leaves a command without mainModules on its declared connectors", async () => {
    await new PreloadManager().preload(commandWith({ connectors: ["database"] }));

    expect(started[0]).toEqual(["database"]);
    expect(calls).not.toContain("mains");
  });
});

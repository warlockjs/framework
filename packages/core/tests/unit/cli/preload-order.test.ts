import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];

vi.mock("../../../src/utils/load-environment", () => ({
  loadEnvironmentFiles: vi.fn(async () => {
    calls.push("loadEnv");
  }),
}));

vi.mock("../../../src/warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: {
    load: vi.fn(async () => {
      calls.push("warlockConfig");
    }),
  },
}));

vi.mock("../../../src/bootstrap", () => ({
  bootstrap: vi.fn(async () => {
    calls.push("bootstrap");
  }),
}));

vi.mock("../../../src/application", () => ({
  Application: {
    setRuntimeStrategy: vi.fn(),
    setEnvironment: vi.fn(() => {
      calls.push("setEnvironment");
    }),
  },
}));

vi.mock("../../../src/dev-server/files-orchestrator", () => ({
  filesOrchestrator: {
    init: vi.fn(async () => {
      calls.push("filesOrchestrator");
    }),
    load: vi.fn(),
  },
}));

vi.mock("../../../src/config/load-config-files", () => ({
  loadConfigFiles: vi.fn(async () => {
    calls.push("configFiles");
  }),
}));

vi.mock("@warlock.js/fs", () => ({
  fileExistsAsync: vi.fn(async () => false),
}));

const { CLICommand } = await import("../../../src/cli/cli-command");
const { CLICommandsManager } = await import("../../../src/cli/cli-commands.manager");
const { Application } = await import("../../../src/application");

/** Exposes the protected preload phase without driving the whole argv flow. */
class PreloadManager extends CLICommandsManager {
  public preload(command: InstanceType<typeof CLICommand>) {
    return this.loadPreloaders(command);
  }
}

const commandWithPreload = (preload: Record<string, unknown>) => {
  const command = new CLICommand("demo");
  command.commandPreload = preload;

  return command;
};

describe("loadPreloaders ordering", () => {
  beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
  });

  it("loads env BEFORE warlock.config.ts is evaluated", async () => {
    // The defect: `warlock.config.ts` runs `env("BUILD_OUT", "dist")` in its
    // module body. Loading config first evaluated that against an empty env
    // store, so every such call silently returned its default.
    await new PreloadManager().preload(commandWithPreload({ warlockConfig: true }));

    expect(calls).toEqual(["loadEnv", "warlockConfig"]);
  });

  it("loads env for a command that never declared it — build and start", async () => {
    // `build` and `start` declare only `warlockConfig`, and previously called
    // `loadEnv()` under no circumstances at all.
    await new PreloadManager().preload(commandWithPreload({ warlockConfig: true }));

    expect(calls).toContain("loadEnv");
  });

  it("sets the environment before loading env, so .env.<NODE_ENV> is picked", async () => {
    // `loadEnv()` reads `process.env.NODE_ENV` at call time to choose
    // `.env.<NODE_ENV>` over `.env`, so the order here decides which file wins.
    await new PreloadManager().preload(
      commandWithPreload({ environemnt: "production", warlockConfig: true }),
    );

    expect(Application.setEnvironment).toHaveBeenCalledWith("production");
    expect(calls.indexOf("setEnvironment")).toBeLessThan(calls.indexOf("loadEnv"));
  });

  it("asks for env exactly once itself, whatever the command declares", async () => {
    // Narrow on purpose: `bootstrap` is mocked here, so this covers only the
    // manager's own calls. `bootstrap()` asks a SECOND time in reality — the
    // once-per-process latch lives in `loadEnvironmentFiles` and is covered by
    // its own spec, not by this one.
    await new PreloadManager().preload(commandWithPreload({ bootstrap: true }));

    expect(calls.filter((call) => call === "loadEnv")).toHaveLength(1);
  });

  it("ignores the deprecated env flag rather than loading a second time", async () => {
    await new PreloadManager().preload(commandWithPreload({ env: true, warlockConfig: true }));

    expect(calls.filter((call) => call === "loadEnv")).toHaveLength(1);
  });
});

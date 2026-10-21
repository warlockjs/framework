import { afterEach, describe, expect, it, vi } from "vitest";
import type { DoctorBootContext } from "../../../src/cli/commands/doctor/check.types";

/**
 * `warlock inspect`: the command definition, `--json` printing exactly the
 * report on stdout (boot progress goes to stderr), and `--section` checked
 * before the app boots.
 */

const hoisted = vi.hoisted(() => ({ booted: 0 }));

vi.mock("../../../src/tooling/inspect/boot-for-inspect", () => ({
  bootForInspect: async () => {
    hoisted.booted += 1;
    console.log("processing 12 files...");

    const context: DoctorBootContext = {
      booted: true,
      routeModules: 0,
      appRoutes: 0,
      totalRoutes: 0,
      moduleFailures: [],
      modelModules: [],
      connectors: { registered: [], configured: [], booted: [], skipped: [], failures: [] },
    };

    return { context, events: [], resolveResourceName: () => undefined, warnings: [] };
  },
  inspectOptionsFromBoot: () => ({ routes: [], importFromApp: async () => undefined }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  hoisted.booted = 0;
});

describe("warlock inspect", () => {
  it("is a registered framework command with the doctor-style read-only preload", async () => {
    const { inspectCommand } = await import("../../../src/cli/commands/inspect.command");
    const { frameworkCommands } = await import("../../../src/cli/framework-cli-commands");

    expect(frameworkCommands).toContain(inspectCommand);
    await inspectCommand.commandPreAction?.({ args: [], options: {} });
    expect(inspectCommand.commandPreload).toEqual({
      runtimeStrategy: "development",
      config: true,
      env: true,
      bootstrap: true,
    });
    expect(inspectCommand.commandOptions.map((option) => option.name)).toEqual(["json", "section"]);
  }, 60_000);

  it("prints only the JSON report on stdout under --json", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdout.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderr.push(args.join(" "));
    });

    const { inspectCommand } = await import("../../../src/cli/commands/inspect.command");

    await inspectCommand.execute({ args: [], options: { json: true, section: "routes,packages" } });

    expect(stdout).toHaveLength(1);
    expect(stderr).toContain("processing 12 files...");

    const report = JSON.parse(stdout[0] ?? "");

    expect(report).toMatchObject({
      schemaVersion: 1,
      sections: ["routes", "packages"],
      routes: [],
    });
    expect(report.models).toBeUndefined();
  });

  it("refuses an unknown section before booting the app", async () => {
    const { inspectCommand } = await import("../../../src/cli/commands/inspect.command");

    await expect(
      inspectCommand.execute({ args: [], options: { section: "controllers" } }),
    ).rejects.toThrow("Unknown inspect section(s): controllers");
    expect(hoisted.booted).toBe(0);
  });
});

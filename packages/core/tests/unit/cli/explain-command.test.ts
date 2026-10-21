import { afterEach, describe, expect, it, vi } from "vitest";
import { explainCommand } from "../../../src/cli/commands/explain.command";
import {
  formatCodeList,
  formatExplanation,
} from "../../../src/cli/commands/explain/explain-command.action";
import { frameworkCommands } from "../../../src/cli/framework-cli-commands";
import { ERROR_CODES } from "../../../src/errors/error-codes";

function captureStdout(): string[] {
  const lines: string[] = [];

  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });

  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("warlock explain", () => {
  it("is a framework command taking an optional code and --json, with no preload", () => {
    expect(frameworkCommands).toContain(explainCommand);
    expect(explainCommand.name).toBe("explain [code-or-file]");
    expect(explainCommand.commandPreload).toBeUndefined();
    expect(explainCommand.commandOptions.map((option) => option.name)).toEqual(["json"]);
  });

  it("prints the title, area, fix, skill and docs link of a code", () => {
    expect(formatExplanation(ERROR_CODES.WL8004)).toEqual([
      "WL8004  A port is already in use",
      "",
      "  Area:     environment (this machine)",
      `  Fix:      ${ERROR_CODES.WL8004.fix}`,
      "  Skill:    run-app",
      "  Docs:     https://warlock.js.org/v/latest/core/cli/error-codes/#wl8004",
      "  Thrown as: PortInUseError",
    ]);
  });

  it("explains a code given in any case", async () => {
    const lines = captureStdout();

    await explainCommand.execute({ args: ["wl3001"], options: {} });

    expect(lines.join("\n")).toContain("A route name is already taken");
    expect(lines.join("\n")).toContain("register-route");
  });

  it("prints the registry entry with its docs URL under --json", async () => {
    const lines = captureStdout();

    await explainCommand.execute({ args: ["WL7101"], options: { json: true } });

    expect(JSON.parse(lines.join("\n"))).toEqual({
      ...ERROR_CODES.WL7101,
      docs: "https://warlock.js.org/v/latest/core/cli/error-codes/#wl7101",
    });
  });

  it("lists every code without an argument", async () => {
    const lines = captureStdout();

    await explainCommand.execute({ args: [], options: {} });

    expect(lines).toEqual(formatCodeList());
    expect(lines).toHaveLength(Object.keys(ERROR_CODES).length);
  });

  it("rejects an unknown code so the CLI exits 1", async () => {
    await expect(explainCommand.execute({ args: ["WL0000"], options: {} })).rejects.toThrow(
      'Unknown error code "WL0000"',
    );
  });
});

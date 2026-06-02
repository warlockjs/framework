import { beforeEach, describe, expect, it } from "vitest";
import { CLICommand } from "../../../src/cli/cli-command";
import { CLICommandsManager } from "../../../src/cli/cli-commands.manager";
import { isMatchingCommandName } from "../../../src/cli/cli-commands.utils";
import type { ResolvedCLICommandOption } from "../../../src/cli/types";

/**
 * Exposes the protected validation/default-application helpers so they can be
 * asserted directly without driving the full `start()` flow (which parses
 * argv and calls `process.exit`).
 */
class TestableManager extends CLICommandsManager {
  public validate(command: CLICommand, options: Record<string, string | boolean | number>) {
    return this.validateOptions(command, options);
  }

  public applyDefaults(command: CLICommand, options: Record<string, string | boolean | number>) {
    return this.applyDefaultOptions(command, options);
  }
}

/** Build a command carrying a single resolved option, bypassing text parsing. */
const commandWithOption = (option: Partial<ResolvedCLICommandOption>): CLICommand => {
  const command = new CLICommand("demo");

  command.commandOptions = [
    { text: "", name: option.name ?? "opt", alias: option.alias ?? "", ...option },
  ];

  return command;
};

describe("CLICommandsManager — register & lookup", () => {
  let manager: TestableManager;

  beforeEach(() => {
    manager = new TestableManager();
  });

  it("registers a command under its base name (first whitespace token)", () => {
    const command = new CLICommand("generate <generator>").alias("g");

    manager.register(command);

    expect(manager.getCommand("generate")).toBe(command);
  });

  it("resolves a command by its alias", () => {
    const command = new CLICommand("migrate").alias("m");

    manager.register(command);

    expect(manager.getCommand("m")).toBe(command);
  });

  it("returns undefined for an unknown name", () => {
    expect(manager.getCommand("nope")).toBeUndefined();
  });

  it("registers several commands at once", () => {
    manager.register(new CLICommand("a"), new CLICommand("b"));

    expect(manager.getCommand("a")).toBeDefined();
    expect(manager.getCommand("b")).toBeDefined();
  });

  it("includes names and aliases in getAllCommandNames", () => {
    manager.register(new CLICommand("seed").alias("s"));

    const names = manager.getAllCommandNames();

    expect(names).toContain("seed");
    expect(names).toContain("s");
  });
});

describe("CLICommandsManager — validateOptions", () => {
  let manager: TestableManager;

  beforeEach(() => {
    manager = new TestableManager();
  });

  it("reports a required option that is absent", () => {
    const command = commandWithOption({ name: "path", required: true });

    const missing = manager.validate(command, {});

    expect(missing).toHaveLength(1);
    expect(missing[0].name).toBe("path");
  });

  it("accepts a required option supplied by its name", () => {
    const command = commandWithOption({ name: "path", required: true });

    expect(manager.validate(command, { path: "x.ts" })).toHaveLength(0);
  });

  it("accepts a required option supplied by its alias", () => {
    const command = commandWithOption({ name: "path", alias: "p", required: true });

    expect(manager.validate(command, { p: "x.ts" })).toHaveLength(0);
  });

  it("ignores optional options that are absent", () => {
    const command = commandWithOption({ name: "fresh", required: false });

    expect(manager.validate(command, {})).toHaveLength(0);
  });
});

describe("CLICommandsManager — applyDefaultOptions", () => {
  let manager: TestableManager;

  beforeEach(() => {
    manager = new TestableManager();
  });

  it("fills in a default when the option is absent", () => {
    const command = commandWithOption({ name: "transaction", defaultValue: true });

    expect(manager.applyDefaults(command, {})).toEqual({ transaction: true });
  });

  it("does not overwrite a provided value with the default", () => {
    const command = commandWithOption({ name: "transaction", defaultValue: true });

    expect(manager.applyDefaults(command, { transaction: false })).toEqual({ transaction: false });
  });

  it("copies an alias-provided value onto the canonical name", () => {
    const command = commandWithOption({ name: "transaction", alias: "t" });

    const result = manager.applyDefaults(command, { t: true });

    expect(result.transaction).toBe(true);
  });

  it("leaves unrelated options untouched", () => {
    const command = commandWithOption({ name: "fresh" });

    expect(manager.applyDefaults(command, { other: "kept" })).toMatchObject({ other: "kept" });
  });
});

describe("isMatchingCommandName", () => {
  it("matches the base name of a command with arguments", () => {
    expect(isMatchingCommandName("generate <generator> [args...]", "generate")).toBe(true);
  });

  it("does not match a different name", () => {
    expect(isMatchingCommandName("generate <generator>", "migrate")).toBe(false);
  });

  it("matches a plain command name", () => {
    expect(isMatchingCommandName("migrate", "migrate")).toBe(true);
  });
});

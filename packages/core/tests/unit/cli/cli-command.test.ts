import { describe, expect, it, vi } from "vitest";
import { CLICommand, command } from "../../../src/cli/cli-command";

/**
 * Unit coverage for `CLICommand` and its `command()` factory. Focus areas:
 * the fluent builder (description / alias / persistent / options), option
 * text parsing into `{ name, alias }` (long+short, either order, value and
 * angle-bracket stripping), the reserved `help` / `-h` guard, and `execute`.
 */
describe("command() factory", () => {
  it("builds a command with name, description, alias, and persistence", () => {
    const built = command({
      name: "migrate",
      description: "Run migrations",
      alias: "m",
      persistent: true,
      action: () => {},
    });

    expect(built).toBeInstanceOf(CLICommand);
    expect(built.name).toBe("migrate");
    expect(built.commandDescription).toBe("Run migrations");
    expect(built.commandAlias).toBe("m");
    expect(built.isPersistent).toBe(true);
  });

  it("wires the action and preAction through", async () => {
    const action = vi.fn();
    const preAction = vi.fn();

    const built = command({ name: "x", action, preAction });

    expect(built.commandAction).toBe(action);
    expect(built.commandPreAction).toBe(preAction);
  });

  it("registers the preload configuration", () => {
    const built = command({
      name: "seed",
      action: () => {},
      preload: { bootstrap: true, connectors: ["database"] },
    });

    expect(built.commandPreload).toEqual({ bootstrap: true, connectors: ["database"] });
  });

  it("defaults persistence to false", () => {
    expect(command({ name: "x", action: () => {} }).isPersistent).toBe(false);
  });
});

describe("CLICommand — fluent builder", () => {
  it("chains setters and returns this", () => {
    const cmd = new CLICommand("base");
    const result = cmd.description("desc").alias("b").persistent();

    expect(result).toBe(cmd);
    expect(cmd.commandDescription).toBe("desc");
    expect(cmd.commandAlias).toBe("b");
    expect(cmd.isPersistent).toBe(true);
  });

  it("records the command source and relative path", () => {
    const cmd = new CLICommand("x").source("plugin").$relativePath("src/app/x/commands/x.ts");

    expect(cmd.commandSource).toBe("plugin");
    expect(cmd.commandRelativePath).toBe("src/app/x/commands/x.ts");
  });
});

describe("CLICommand — option parsing", () => {
  it("parses a long+short option into name and alias", () => {
    const cmd = new CLICommand("x").option({ text: "--port, -p" });

    expect(cmd.commandOptions[0]).toMatchObject({ name: "port", alias: "p" });
  });

  it("parses the reversed short+long order", () => {
    const cmd = new CLICommand("x").option({ text: "-p, --port" });

    expect(cmd.commandOptions[0]).toMatchObject({ name: "port", alias: "p" });
  });

  it("parses a long-only option with an empty alias", () => {
    const cmd = new CLICommand("x").option({ text: "--fresh" });

    expect(cmd.commandOptions[0]).toMatchObject({ name: "fresh", alias: "" });
  });

  it("uses the bare name for a short-only option", () => {
    const cmd = new CLICommand("x").option({ text: "-v" });

    expect(cmd.commandOptions[0]).toMatchObject({ name: "v", alias: "" });
  });

  it("strips an angle-bracket value placeholder from the name", () => {
    const cmd = new CLICommand("x").option({ text: "--table <name>" });

    expect(cmd.commandOptions[0].name).toBe("table");
  });

  it("strips a =value assignment from the name", () => {
    const cmd = new CLICommand("x").option({ text: "--port=3000" });

    expect(cmd.commandOptions[0].name).toBe("port");
  });

  it("registers several options via options()", () => {
    const cmd = new CLICommand("x").options([{ text: "--fresh, -f" }, { text: "--list, -l" }]);

    expect(cmd.commandOptions).toHaveLength(2);
    expect(cmd.commandOptions.map((option) => option.name)).toEqual(["fresh", "list"]);
  });

  it("supports the positional option(name, description, extra) overload", () => {
    const cmd = new CLICommand("x").option("--limit, -L", "Max rows", { type: "number" });
    const option = cmd.commandOptions[0];

    expect(option.name).toBe("limit");
    expect(option.alias).toBe("L");
    expect(option.description).toBe("Max rows");
    expect(option.type).toBe("number");
  });

  it("throws when the long name is the reserved 'help'", () => {
    expect(() => new CLICommand("x").option({ text: "--help" })).toThrow(/reserved/);
  });

  it("throws when the short alias is the reserved 'h'", () => {
    expect(() => new CLICommand("x").option({ text: "--host, -h" })).toThrow(/reserved/);
  });
});

describe("CLICommand — execute", () => {
  it("invokes the action with the provided data", async () => {
    const action = vi.fn();
    const cmd = new CLICommand("x").action(action);
    const data = { args: ["a"], options: { force: true } };

    await cmd.execute(data);

    expect(action).toHaveBeenCalledWith(data);
  });

  it("throws when no action is defined", async () => {
    const cmd = new CLICommand("x");

    await expect(cmd.execute({ args: [], options: {} })).rejects.toThrow(/no action defined/);
  });
});

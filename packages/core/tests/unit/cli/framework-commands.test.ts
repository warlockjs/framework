import { describe, expect, it } from "vitest";
import { addCommand } from "../../../src/cli/commands/add.command";
import { migrateCommand } from "../../../src/cli/commands/migrate.command";
import { routesCommand } from "../../../src/cli/commands/routes.command";
import { seedCommand } from "../../../src/cli/commands/seed.command";
import {
  generateCommand,
  generateModuleCommand,
} from "../../../src/cli/commands/generate/generate.command";

/**
 * Validates the framework command DEFINITIONS — name, alias, preload plan,
 * and parsed option metadata — without executing their actions (which would
 * touch a database / disk). These assert the "planning" surface only.
 */
const optionNames = (command: { commandOptions: { name: string }[] }) =>
  command.commandOptions.map((option) => option.name);

describe("migrateCommand definition", () => {
  it("declares its name and database preload plan", () => {
    expect(migrateCommand.name).toBe("migrate");
    expect(migrateCommand.commandPreload).toEqual({
      config: ["database", "log"],
      env: true,
      connectors: ["database", "logger"],
    });
  });

  it("parses every option into a name with the expected alias", () => {
    const fresh = migrateCommand.commandOptions.find((option) => option.name === "fresh");
    const path = migrateCommand.commandOptions.find((option) => option.name === "path");

    expect(fresh?.alias).toBe("f");
    expect(path?.alias).toBe("p");
  });

  it("keeps the comma-less --pending-only flag (no alias)", () => {
    const pendingOnly = migrateCommand.commandOptions.find(
      (option) => option.name === "pending-only",
    );

    expect(pendingOnly).toBeDefined();
    expect(pendingOnly?.alias).toBe("");
  });
});

describe("seedCommand definition", () => {
  it("plans a full bootstrap with the database/cache/logger connectors", () => {
    expect(seedCommand.name).toBe("seed");
    expect(seedCommand.commandPreload).toMatchObject({
      bootstrap: true,
      config: true,
      connectors: ["database", "cache", "logger"],
    });
  });

  it("carries a defaultValue on the transaction option", () => {
    const transaction = seedCommand.commandOptions.find(
      (option) => option.name === "transaction",
    );

    expect(transaction?.defaultValue).toBe(true);
    expect(transaction?.alias).toBe("t");
  });
});

describe("routesCommand definition", () => {
  it("bootstraps to register routes but starts NO connectors (read-only)", () => {
    expect(routesCommand.name).toBe("routes");
    expect(routesCommand.commandPreload).toEqual({
      config: true,
      env: true,
      bootstrap: true,
    });
    expect(routesCommand.commandPreload?.connectors).toBeUndefined();
  });

  it("declares the filter + json options with their aliases", () => {
    const byName = (name: string) =>
      routesCommand.commandOptions.find((option) => option.name === name);

    expect(byName("method")?.alias).toBe("m");
    expect(byName("path")?.alias).toBe("p");
    expect(byName("name")?.alias).toBe("n");
    expect(byName("json")?.alias).toBe("j");
    expect(byName("json")?.type).toBe("boolean");
  });
});

describe("addCommand definition", () => {
  it("parses a comma-less two-form option to the first token only (no alias)", () => {
    // "--package-manager -pm" has no comma, so only the long form is read and
    // the name is NOT camelCased by the option parser.
    const packageManager = addCommand.commandOptions.find(
      (option) => option.name === "package-manager",
    );

    expect(packageManager).toBeDefined();
    expect(packageManager?.alias).toBe("");
  });

  it("keeps the kebab-case name for --no-install", () => {
    expect(optionNames(addCommand)).toContain("no-install");
  });
});

describe("generate command family definition", () => {
  it("exposes the master generate command with alias g", () => {
    expect(generateCommand.name).toBe("generate <generator> [args...]");
    expect(generateCommand.commandAlias).toBe("g");
  });

  it("registers --force and --dry-run on the master command", () => {
    expect(optionNames(generateCommand)).toEqual(expect.arrayContaining(["force", "dry-run"]));
  });

  it("exposes generate.module with its minimal flag", () => {
    expect(generateModuleCommand.name).toBe("generate.module <name>");
    expect(generateModuleCommand.commandAlias).toBe("gen.m");
    expect(optionNames(generateModuleCommand)).toContain("minimal");
  });
});

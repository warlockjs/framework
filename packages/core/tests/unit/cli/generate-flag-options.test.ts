import { describe, expect, it } from "vitest";
import { CLICommand } from "../../../src/commands/cli-command";
import { CLICommandsManager } from "../../../src/cli/cli-commands.manager";
import { addCommand } from "../../../src/cli/commands/add.command";
import {
  generateCommand,
  generateControllerCommand,
  generateMigrationCommand,
  generateModelCommand,
  generateModuleCommand,
  generateRepositoryCommand,
  generateResourceCommand,
  generateServiceCommand,
} from "../../../src/cli/commands/generate/generate.command";
import { seedCommand } from "../../../src/cli/commands/seed.command";
import type { CommandActionData } from "../../../src/commands/types";

/**
 * #23 — the #21 engine fix only reaches options that DECLARE `type: "boolean"`.
 *
 * `parse-cli-args.ts` skips any option without a declared type, so the generate
 * family and `add` kept both faces of #21 long after the engine was corrected:
 * `--force=false` arrived as the truthy string `"false"` and OVERWROTE existing
 * files, and a bare `--force` swallowed the following positional, losing the
 * module name outright.
 *
 * These tests DRIVE the real command objects. They never inspect an option
 * declaration — a declaration test would pass against a fixture while the CLI
 * stayed broken. Every case resolves a real argv through the manager and
 * asserts what the action is actually handed.
 */

/** Exposes the protected resolution + default-application passes. */
class TestableManager extends CLICommandsManager {
  public resolve(command: CLICommand, argv: string[]) {
    return this.resolveCommandArgs(command, argv);
  }

  public applyDefaults(command: CLICommand, options: Record<string, string | boolean | number>) {
    return this.applyDefaultOptions(command, options);
  }
}

/**
 * Run a real command against a real argv, down the same path
 * `CLICommandsManager.execute` takes — `resolveCommandArgs` →
 * `applyDefaultOptions` → `CLICommand.execute` — and return exactly what the
 * action received.
 *
 * The action alone is swapped for a capture (and restored), so the real
 * generator never touches the disk. Nothing about parsing, coercion, defaults
 * or alias-copying is stubbed: those are what is under test.
 */
async function drive(command: CLICommand, ...argvRest: string[]): Promise<CommandActionData> {
  const manager = new TestableManager();
  const parsed = manager.resolve(command, ["node", "warlock", ...argvRest]);
  const options = manager.applyDefaults(command, parsed.options);

  const realAction = command.commandAction;
  let received: CommandActionData | undefined;

  command.action((data) => {
    received = data;
  });

  try {
    await command.execute({ args: parsed.args, options });
  } finally {
    command.commandAction = realAction;
  }

  return received as CommandActionData;
}

/** Every command that declares `--force, -f` / `--dry-run`. */
const forceCommands: [string, CLICommand, string][] = [
  ["generate", generateCommand, "generate"],
  ["generate.module", generateModuleCommand, "generate.module"],
  ["generate.controller", generateControllerCommand, "generate.controller"],
  ["generate.service", generateServiceCommand, "generate.service"],
  ["generate.model", generateModelCommand, "generate.model"],
  ["generate.repository", generateRepositoryCommand, "generate.repository"],
  ["generate.resource", generateResourceCommand, "generate.resource"],
  ["generate.migration", generateMigrationCommand, "generate.migration"],
];

describe("generate.module — the two faces of #21 (#23)", () => {
  it("hands the generator force=false, not the truthy string 'false'", async () => {
    // `module.generator.ts:41` reads `data.options.force || data.options.f` and
    // `:48` gates the overwrite on it. A string "false" here overwrites files.
    const { options } = await drive(generateModuleCommand, "generate.module", "users", "--force=false");

    expect(options.force).toBe(false);
  });

  it("keeps the module name as a positional when --force comes first", async () => {
    const { options, args } = await drive(generateModuleCommand, "generate.module", "--force", "users");

    expect(options.force).toBe(true);
    expect(args).toEqual(["users"]);
  });

  it("hands the generator dryRun=false for --dry-run=false", async () => {
    // `module.generator.ts:42` — `setDryRun(Boolean(data.options.dryRun))`.
    const { options } = await drive(
      generateModuleCommand,
      "generate.module",
      "users",
      "--dry-run=false",
    );

    expect(options.dryRun).toBe(false);
  });

  it("keeps the module name as a positional when --dry-run comes first", async () => {
    const { options, args } = await drive(
      generateModuleCommand,
      "generate.module",
      "--dry-run",
      "users",
    );

    expect(options.dryRun).toBe(true);
    expect(args).toEqual(["users"]);
  });

  it("hands the generator minimal=false for --minimal=false", async () => {
    // `module.generator.ts:45` — `data.options.minimal || data.options.m`.
    const { options } = await drive(
      generateModuleCommand,
      "generate.module",
      "users",
      "--minimal=false",
    );

    expect(options.minimal).toBe(false);
  });

  it("resolves the -f alias onto force as a real boolean", async () => {
    const { options } = await drive(generateModuleCommand, "generate.module", "users", "-f=false");

    expect(options.f).toBe(false);
    expect(options.force).toBe(false);
  });
});

describe("every generate command that declares --force / --dry-run (#23)", () => {
  it.each(forceCommands)("%s coerces --force=false", async (_label, command, name) => {
    const { options } = await drive(command, name, "target", "--force=false");

    expect(options.force).toBe(false);
  });

  it.each(forceCommands)("%s coerces --dry-run=false", async (_label, command, name) => {
    const { options } = await drive(command, name, "target", "--dry-run=false");

    expect(options.dryRun).toBe(false);
  });

  it.each(forceCommands)("%s keeps the target after a bare --force", async (_label, command, name) => {
    const { options, args } = await drive(command, name, "--force", "target");

    expect(options.force).toBe(true);
    expect(args).toEqual(["target"]);
  });
});

describe("generate.controller / generate.model — the remaining flags (#23)", () => {
  it("coerces --with-validation=false", async () => {
    // `controller.generator.ts:39` — `data.options.withValidation || data.options.v`.
    const { options } = await drive(
      generateControllerCommand,
      "generate.controller",
      "users/user",
      "--with-validation=false",
    );

    expect(options.withValidation).toBe(false);
  });

  it("coerces --with-resource=false", async () => {
    // `model.generator.ts:37` — `data.options.withResource || data.options.rs`.
    const { options } = await drive(
      generateModelCommand,
      "generate.model",
      "users/user",
      "--with-resource=false",
    );

    expect(options.withResource).toBe(false);
  });

  it("coerces --timestamps=false on generate.model", async () => {
    // `model.generator.ts:72` — `options.timestamps !== "false" && !== false`.
    const { options } = await drive(
      generateModelCommand,
      "generate.model",
      "users/user",
      "--timestamps=false",
    );

    expect(options.timestamps).toBe(false);
  });

  it("keeps the model path after a bare --timestamps on generate.migration", async () => {
    // `migration.generator.ts:32` — same boolean read.
    const { options, args } = await drive(
      generateMigrationCommand,
      "generate.migration",
      "--timestamps",
      "users/user",
    );

    expect(options.timestamps).toBe(true);
    expect(args).toEqual(["users/user"]);
  });
});

describe("add — --list / --no-install (#23)", () => {
  it("hands the action list=false, not the truthy string 'false'", async () => {
    // `add-command.action.ts:676` — `if (list)` prints the catalogue and exits 0.
    const { options } = await drive(addCommand, "add", "auth", "--list=false");

    expect(options.list).toBe(false);
  });

  it("keeps the feature list when --no-install is passed FIRST", async () => {
    // `add-command.action.ts:744` — `if (noInstall)`. The declaration used to
    // tell operators to "pass it last" precisely because it swallowed a feature.
    const { options, args } = await drive(addCommand, "add", "--no-install", "auth");

    expect(options.noInstall).toBe(true);
    expect(args).toEqual(["auth"]);
  });
});

/**
 * The other half of the contract: an option whose value is real DATA must not
 * be coerced. These guard against a blanket `type: "boolean"` sweep.
 */
describe("string-valued options are left alone (#23)", () => {
  it("generate.model --table=false stays the literal string", async () => {
    // `model.generator.ts:38` uses it as a table name — `options.table as string`.
    const { options } = await drive(
      generateModelCommand,
      "generate.model",
      "users/user",
      "--table=false",
    );

    expect(options.table).toBe("false");
  });

  it("generate.migration --drop still swallows its column list", async () => {
    // `migration.generator.ts:30` — `options.drop as string`, a column list.
    const { options, args } = await drive(
      generateMigrationCommand,
      "generate.migration",
      "users/user",
      "--drop",
      "email,phone",
    );

    expect(options.drop).toBe("email,phone");
    expect(args).toEqual(["users/user"]);
  });

  it("seed --drop keeps the seeder name that scopes the undo", async () => {
    const { options } = await drive(seedCommand, "seed", "--drop=Users Seeder");

    expect(options.drop).toBe("Users Seeder");
  });

  it("add --package-manager keeps its value", async () => {
    // `add-command.action.ts:747` — passed on as a PackageManager name.
    const { options } = await drive(addCommand, "add", "auth", "--package-manager=pnpm");

    expect(options.packageManager).toBe("pnpm");
  });
});

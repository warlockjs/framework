import { describe, expect, it, vi } from "vitest";
import { CLICommand } from "../../../src/cli/cli-command";
import { CLICommandsManager } from "../../../src/cli/cli-commands.manager";
import { CliOptionValueError, parseCliArgs } from "../../../src/cli/parse-cli-args";
import type { ResolvedCLICommandOption } from "../../../src/cli/types";

/**
 * Type-aware option resolution (#21).
 *
 * `warlock migrate --rollback=false` used to DROP EVERY TABLE: the parser stored
 * `"false"` as a raw string, nothing coerced it, and `if (rollback)` in
 * migrate-action saw a truthy string. Its twin: a bare `--rollback` swallowed the
 * following positional (`--rollback 2024_users.ts` → `rollback: "2024_users.ts"`),
 * so naming one file also dropped everything.
 *
 * The contract asserted here: `parseCliArgs` stays schema-less (and therefore
 * unchanged) until it is handed the resolved command's declared options; with a
 * schema, options declared `type: "boolean"` are coerced, never swallow the next
 * token, and reject values that are neither true-ish nor false-ish. Options that
 * are NOT declared boolean keep the old behaviour exactly.
 */
const argv = (...rest: string[]) => ["node", "warlock", ...rest];

/** The real `migrate` option set, minus the parts irrelevant here. */
const migrateSchema: ResolvedCLICommandOption[] = [
  { text: "--fresh, -f", name: "fresh", alias: "f", type: "boolean" },
  { text: "--rollback, -r", name: "rollback", alias: "r", type: "boolean" },
  { text: "--path, -p", name: "path", alias: "p", type: "string" },
  { text: "--list, -l", name: "list", alias: "l", type: "boolean" },
  { text: "--all, -a", name: "all", alias: "a", type: "boolean" },
  { text: "--compact, -c", name: "compact", alias: "c", type: "boolean" },
  { text: "--pending-only", name: "pending-only", alias: "", type: "boolean" },
];

/** A string-typed option whose legitimate value happens to be the word "false". */
const stringSchema: ResolvedCLICommandOption[] = [
  { text: "--name, -n", name: "name", alias: "n", type: "string" },
];

describe("parseCliArgs — declared boolean options (#21)", () => {
  it("coerces --rollback=false to boolean false", () => {
    const parsed = parseCliArgs(argv("migrate", "--rollback=false"), migrateSchema);

    expect(parsed.options.rollback).toBe(false);
  });

  it("coerces the whole false-ish family", () => {
    expect(parseCliArgs(argv("migrate", "--rollback=0"), migrateSchema).options.rollback).toBe(
      false,
    );
    expect(parseCliArgs(argv("migrate", "--rollback=no"), migrateSchema).options.rollback).toBe(
      false,
    );
    expect(parseCliArgs(argv("migrate", "--rollback=FALSE"), migrateSchema).options.rollback).toBe(
      false,
    );
  });

  it("coerces the whole true-ish family", () => {
    expect(parseCliArgs(argv("migrate", "--rollback=true"), migrateSchema).options.rollback).toBe(
      true,
    );
    expect(parseCliArgs(argv("migrate", "--rollback=1"), migrateSchema).options.rollback).toBe(true);
    expect(parseCliArgs(argv("migrate", "--rollback=yes"), migrateSchema).options.rollback).toBe(
      true,
    );
  });

  it("keeps a bare --flag as true", () => {
    expect(parseCliArgs(argv("migrate", "--rollback"), migrateSchema).options.rollback).toBe(true);
  });

  it("does NOT swallow the next positional after a bare boolean flag", () => {
    const parsed = parseCliArgs(argv("migrate", "--rollback", "2024_users.ts"), migrateSchema);

    expect(parsed.options.rollback).toBe(true);
    expect(parsed.args).toEqual(["2024_users.ts"]);
  });

  it("still swallows the next token for a string-typed option", () => {
    const parsed = parseCliArgs(argv("migrate", "--path", "users.ts"), migrateSchema);

    expect(parsed.options.path).toBe("users.ts");
    expect(parsed.args).toEqual([]);
  });

  it("leaves a string-typed option holding the literal word false", () => {
    const parsed = parseCliArgs(argv("gen", "--name=false"), stringSchema);

    expect(parsed.options.name).toBe("false");
  });

  it("camelCases the schema name so --pending-only=false is matched", () => {
    const parsed = parseCliArgs(argv("migrate", "--pending-only=false"), migrateSchema);

    expect(parsed.options.pendingOnly).toBe(false);
  });

  it("throws on a value that is neither true-ish nor false-ish", () => {
    expect(() => parseCliArgs(argv("migrate", "--rollback=maybe"), migrateSchema)).toThrow(
      CliOptionValueError,
    );
    expect(() => parseCliArgs(argv("migrate", "--rollback=maybe"), migrateSchema)).toThrow(
      /--rollback/,
    );
  });

  it("throws on an empty value rather than guessing", () => {
    expect(() => parseCliArgs(argv("migrate", "--rollback="), migrateSchema)).toThrow(
      CliOptionValueError,
    );
  });

  it("leaves options the command does not declare exactly as before", () => {
    const parsed = parseCliArgs(argv("migrate", "--whatever=false", "--other", "x"), migrateSchema);

    expect(parsed.options.whatever).toBe("false");
    expect(parsed.options.other).toBe("x");
  });
});

describe("parseCliArgs — declared boolean aliases (#21)", () => {
  it("coerces -r=false through the alias", () => {
    expect(parseCliArgs(argv("migrate", "-r=false"), migrateSchema).options.r).toBe(false);
  });

  it("coerces -r=1 through the alias", () => {
    expect(parseCliArgs(argv("migrate", "-r=1"), migrateSchema).options.r).toBe(true);
  });

  it("does NOT swallow the next positional after a bare boolean alias", () => {
    const parsed = parseCliArgs(argv("migrate", "-r", "2024_users.ts"), migrateSchema);

    expect(parsed.options.r).toBe(true);
    expect(parsed.args).toEqual(["2024_users.ts"]);
  });

  it("still swallows the next token for a string-typed alias", () => {
    const parsed = parseCliArgs(argv("migrate", "-p", "users.ts"), migrateSchema);

    expect(parsed.options.p).toBe("users.ts");
    expect(parsed.args).toEqual([]);
  });

  it("throws on an unrecognised alias value, naming the alias as typed", () => {
    expect(() => parseCliArgs(argv("migrate", "-r=maybe"), migrateSchema)).toThrow(/-r/);
  });

  it("expands a bundle of declared boolean flags to true", () => {
    const parsed = parseCliArgs(argv("migrate", "-lac"), migrateSchema);

    expect(parsed.options).toEqual({ l: true, a: true, c: true });
  });

  it("keeps a bundle from swallowing the following positional", () => {
    const parsed = parseCliArgs(argv("migrate", "-la", "users"), migrateSchema);

    expect(parsed.options).toEqual({ l: true, a: true });
    expect(parsed.args).toEqual(["users"]);
  });
});

describe("parseCliArgs — schema-less behaviour is untouched", () => {
  it("still swallows the next token with no schema", () => {
    expect(parseCliArgs(argv("migrate", "--rollback", "file.ts")).options).toEqual({
      rollback: "file.ts",
    });
  });

  it("still stores --key=value as a raw string with no schema", () => {
    expect(parseCliArgs(argv("migrate", "--rollback=false")).options).toEqual({
      rollback: "false",
    });
  });
});

/** Exposes the protected coercion pass and default application. */
class TestableManager extends CLICommandsManager {
  public resolve(command: CLICommand, argv: string[]) {
    return this.resolveCommandArgs(command, argv);
  }

  public applyDefaults(command: CLICommand, options: Record<string, string | boolean | number>) {
    return this.applyDefaultOptions(command, options);
  }
}

const migrateCommand = () => {
  const command = new CLICommand("migrate");
  command.commandOptions = migrateSchema;
  return command;
};

describe("CLICommandsManager — resolveCommandArgs (#21)", () => {
  it("hands the action a real boolean false for --rollback=false", () => {
    const parsed = new TestableManager().resolve(
      migrateCommand(),
      argv("migrate", "--rollback=false"),
    );

    expect(parsed.options.rollback).toBe(false);
  });

  it("hands the action rollback=true AND the file as a positional", () => {
    const parsed = new TestableManager().resolve(
      migrateCommand(),
      argv("migrate", "--rollback", "2024_users.ts"),
    );

    expect(parsed.options.rollback).toBe(true);
    expect(parsed.args).toEqual(["2024_users.ts"]);
  });

  it("prints a clear message and exits 1 on an unrecognised boolean value", () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);

    expect(() =>
      new TestableManager().resolve(migrateCommand(), argv("migrate", "--rollback=maybe")),
    ).toThrow("__exit__:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logs.join("\n")).toContain("--rollback");
    expect(logs.join("\n")).toContain("maybe");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("copies a false alias value onto the canonical option name", () => {
    // Truthiness in the alias-copy step used to drop `false` on the floor, so
    // `-r=false` never reached the handler as `rollback`.
    const result = new TestableManager().applyDefaults(migrateCommand(), { r: false });

    expect(result.rollback).toBe(false);
  });
});

import { toCamelCase } from "@mongez/reinforcements";

export type ParsedCliArgs = {
  name: string;
  args: string[];
  options: Record<string, string | boolean>;
};

/**
 * The slice of a declared command option this parser needs.
 *
 * `CLICommand.commandOptions` (`ResolvedCLICommandOption[]`) satisfies it, but
 * the parser stays independent of the command classes so it can be unit-tested
 * and reused with a hand-written schema.
 */
export type CliOptionSchema = {
  name?: string;
  alias?: string;
  type?: "string" | "boolean" | "number";
};

/**
 * Thrown when a declared boolean option is given a value that is neither
 * true-ish nor false-ish.
 *
 * We refuse to guess. Guessing is exactly what produced #21: `--rollback=false`
 * was kept as the truthy string `"false"` and dropped every table. An option
 * that gates a destructive action must fail loudly on input it cannot read.
 */
export class CliOptionValueError extends Error {
  public constructor(
    public readonly optionToken: string,
    public readonly value: string,
  ) {
    super(
      `Invalid value ${JSON.stringify(value)} for boolean option ${optionToken}. ` +
        `Expected one of: true, false, 1, 0, yes, no — or pass ${optionToken} on its own for true.`,
    );

    this.name = "CliOptionValueError";
  }
}

const TRUE_VALUES = new Set(["true", "1", "yes"]);
const FALSE_VALUES = new Set(["false", "0", "no"]);

/**
 * Collect the camelCased keys (names AND aliases) of every option the command
 * declared as `type: "boolean"`.
 *
 * Both sides are camelCased because declared names keep their raw kebab form
 * (`"pending-only"`) while the parser emits camelCase keys (`pendingOnly`).
 */
function collectBooleanKeys(schema: CliOptionSchema[]): Set<string> {
  const keys = new Set<string>();

  for (const option of schema) {
    if (option.type !== "boolean") continue;

    if (option.name) {
      keys.add(toCamelCase(option.name));
    }

    if (option.alias) {
      keys.add(toCamelCase(option.alias));
    }
  }

  return keys;
}

/**
 * Turn the value written after `=` into a real boolean, or throw.
 */
function toBoolean(optionToken: string, value: string): boolean {
  const normalized = value.toLowerCase();

  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;

  throw new CliOptionValueError(optionToken, value);
}

/**
 * Parse CLI arguments from process.argv
 *
 * Called with a `schema` (the resolved command's declared options), every
 * option declared `type: "boolean"` is resolved as a boolean:
 * `--flag` → true, `--flag=false|0|no` → false, `--flag=true|1|yes` → true,
 * and `--flag <token>` leaves `<token>` as a POSITIONAL instead of swallowing
 * it as the flag's value. Anything else throws {@link CliOptionValueError}.
 *
 * Called without a schema — which is how the command name is discovered,
 * before any command object exists — behaviour is unchanged: every value stays
 * a raw string and a bare `--flag` still consumes the following non-dash token.
 * Nothing is blanket-coerced here on purpose: `--name=false` on a string-typed
 * option must survive as the string `"false"`.
 *
 * Options the schema does not declare keep the schema-less behaviour.
 *
 * @example
 * parseCliArgs(["node", "warlock", "migrate", "--rollback", "file.ts"])
 * // Returns: { name: "migrate", args: [], options: { rollback: "file.ts" } }
 *
 * @example
 * // `rollback` declared as type: "boolean" — the file stays a positional
 * parseCliArgs(["node", "warlock", "migrate", "--rollback", "file.ts"], migrateOptions)
 * // Returns: { name: "migrate", args: ["file.ts"], options: { rollback: true } }
 *
 * @example
 * parseCliArgs(["node", "warlock", "dev", "--port=3000", "--fresh"])
 * // Returns: { name: "dev", args: [], options: { port: "3000", fresh: true } }
 */
export function parseCliArgs(argv: string[], schema: CliOptionSchema[] = []): ParsedCliArgs {
  // Command is at index 2 (after "node" and script path)
  // But if index 2 starts with "-", it's an option, not a command
  const potentialCommand = argv[2] || "";
  const isFirstArgOption = potentialCommand.startsWith("-");
  const command = isFirstArgOption ? "" : potentialCommand;
  const args: string[] = [];
  const options: Record<string, string | boolean> = {};
  const booleanKeys = collectBooleanKeys(schema);

  // Parse arguments starting from index 3 (or 2 if first arg was an option)
  const startIndex = isFirstArgOption ? 2 : 3;
  for (let i = startIndex; i < argv.length; i++) {
    const arg = argv[i];

    if (arg.startsWith("--")) {
      // Long option: --key or --key=value
      const withoutDashes = arg.slice(2);
      const equalIndex = withoutDashes.indexOf("=");

      if (equalIndex !== -1) {
        // --key=value format
        const key = toCamelCase(withoutDashes.slice(0, equalIndex));
        const value = withoutDashes.slice(equalIndex + 1);
        options[key] = booleanKeys.has(key)
          ? toBoolean(`--${withoutDashes.slice(0, equalIndex)}`, value)
          : value;
      } else {
        // --key format (check if next arg is a value)
        const key = toCamelCase(withoutDashes);
        const nextArg = argv[i + 1];

        // A declared boolean NEVER consumes the next token: `--rollback
        // users.ts` means "rollback, and here is a positional", not "rollback
        // the file users.ts". Swallowing it silently discarded the operator's
        // only stated scope and rolled back everything.
        if (booleanKeys.has(key)) {
          options[key] = true;
        } else if (nextArg && !nextArg.startsWith("-")) {
          // If next arg exists and doesn't start with -, treat it as value
          options[key] = nextArg;
          i++; // Skip next arg
        } else {
          options[key] = true;
        }
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      // Short option: -f, -t=value, or -abc (multiple flags)
      const flags = arg.slice(1);
      const equalIndex = flags.indexOf("=");

      if (equalIndex !== -1) {
        // -t=value format
        const rawKey = flags.slice(0, equalIndex);
        const key = toCamelCase(rawKey);
        const value = flags.slice(equalIndex + 1);
        options[key] = booleanKeys.has(key) ? toBoolean(`-${rawKey}`, value) : value;
      } else if (flags.length === 1) {
        // Single flag: -f
        const key = toCamelCase(flags);
        const nextArg = argv[i + 1];

        if (booleanKeys.has(key)) {
          options[key] = true;
        } else if (nextArg && !nextArg.startsWith("-")) {
          options[key] = nextArg;
          i++; // Skip next arg
        } else {
          options[key] = true;
        }
      } else {
        // Multiple flags: -abc becomes { a: true, b: true, c: true }
        // A bundle carries no value and never consumes the next token, so a
        // declared boolean already resolves to `true` here.
        for (const flag of flags) {
          options[toCamelCase(flag)] = true;
        }
      }
    } else {
      // Positional argument
      args.push(arg);
    }
  }

  return { name: command, args, options };
}

/**
 * What a generation request names, and the `warlock` argv it becomes.
 *
 * Validated strictly because the request usually comes from an agent over MCP:
 * only the generators and flags `warlock generate.*` / `warlock add` declare
 * are accepted, and no value can be read as another flag.
 */

/** The `warlock generate.<name>` scaffolders. */
export const MAKE_GENERATORS = [
  "module",
  "controller",
  "service",
  "use-case",
  "model",
  "repository",
  "resource",
  "migration",
] as const;

/** One `warlock generate.<name>` scaffolder. */
export type MakeGenerator = (typeof MAKE_GENERATORS)[number];

/**
 * The flags each generator declares (see `cli/commands/generate/generate.command.ts`),
 * minus `--dry-run`: the sandbox generates for real into a throwaway copy.
 */
export const MAKE_GENERATOR_FLAGS: Readonly<Record<MakeGenerator, readonly string[]>> = {
  module: ["minimal", "force", "overwrite"],
  controller: ["with-validation", "force"],
  service: ["force"],
  "use-case": ["force"],
  model: ["with-resource", "table", "force", "overwrite", "timestamps", "no-timestamps"],
  repository: ["force"],
  resource: ["force"],
  migration: ["force", "add", "drop", "rename", "timestamps", "no-timestamps"],
};

/**
 * A generation request.
 *
 * - `make`: `warlock generate.<generator> <name> [--flag…]`; `name` is what the
 *   command takes (`users`, `users/create-user`, a model path for `migration`).
 * - `add`: `warlock add <features…>`.
 */
export type GeneratorSpec =
  | {
      type: "make";
      generator: MakeGenerator;
      name: string;
      /** `true` → `--flag`, `false` → `--flag=false`, a string → `--flag=value`. */
      flags?: Record<string, string | boolean>;
    }
  | {
      type: "add";
      features: string[];
    };

/** Options of {@link buildGeneratorArgs}. */
export type GeneratorArgsOptions = {
  /**
   * For `add`: install the packages (`false` adds `--no-install`, which still
   * records them in package.json). Default `false`.
   */
  install?: boolean;
};

const FLAG_NAME = /^[a-z][a-z0-9-]*$/;
const FEATURE_NAME = /^[a-z0-9][a-z0-9-]*$/i;
const COMPONENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Whether a string names a `warlock generate.*` scaffolder. */
export function isMakeGenerator(value: string): value is MakeGenerator {
  return (MAKE_GENERATORS as readonly string[]).includes(value);
}

function assertComponentName(name: string): void {
  const segments = name.split("/");

  if (
    !COMPONENT_NAME.test(name) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(
      `Invalid name ${JSON.stringify(name)}: use letters, digits, ".", "_", "-" and "/" between segments (for example users/create-user).`,
    );
  }
}

function flagArgument(generator: MakeGenerator, name: string, value: string | boolean): string {
  const known = MAKE_GENERATOR_FLAGS[generator];

  if (!FLAG_NAME.test(name) || !known.includes(name)) {
    throw new Error(
      `Unknown flag --${name} for generate.${generator}. Known flags: ${known.map((flag) => `--${flag}`).join(", ") || "none"}.`,
    );
  }

  if (typeof value === "boolean") return value ? `--${name}` : `--${name}=false`;

  if (value.length === 0 || value.startsWith("-") || /[\0\r\n]/.test(value)) {
    throw new Error(
      `Invalid value for --${name}: it may not be empty, start with "-" or contain a line break.`,
    );
  }

  return `--${name}=${value}`;
}

/**
 * The `warlock` arguments (without the `warlock` itself) that run a spec.
 * Throws on an unknown generator, flag or feature, or an unsafe name or value.
 *
 * @example
 * buildGeneratorArgs({ type: "make", generator: "controller", name: "users/list-users", flags: { "with-validation": true } });
 * // ["generate.controller", "users/list-users", "--with-validation"]
 * buildGeneratorArgs({ type: "add", features: ["devtools"] });
 * // ["add", "devtools", "--no-install"]
 */
export function buildGeneratorArgs(
  spec: GeneratorSpec,
  options: GeneratorArgsOptions = {},
): string[] {
  if (spec.type === "add") {
    if (spec.features.length === 0) {
      throw new Error("Name at least one feature to add (warlock add --list shows them).");
    }

    for (const feature of spec.features) {
      if (!FEATURE_NAME.test(feature)) {
        throw new Error(`Invalid feature name ${JSON.stringify(feature)}.`);
      }
    }

    return ["add", ...spec.features, ...(options.install === true ? [] : ["--no-install"])];
  }

  if (!isMakeGenerator(spec.generator)) {
    throw new Error(
      `Unknown generator ${JSON.stringify(spec.generator)}. Generators: ${MAKE_GENERATORS.join(", ")}.`,
    );
  }

  assertComponentName(spec.name);

  const flags = Object.entries(spec.flags ?? {}).map(([name, value]) =>
    flagArgument(spec.generator, name, value),
  );

  return [`generate.${spec.generator}`, spec.name, ...flags];
}

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { command } from "../../commands/cli-command";
import type { CommandActionData } from "../../commands/types";

/** What `warlock test` was asked for. */
export type TestCommandOptions = {
  /** Positional filters: file paths or name fragments, passed to Vitest. */
  filters: string[];
  /** Only the tests affected by uncommitted changes (or by changes since `since`). */
  changed?: boolean;
  /** A git ref for `changed`: tests affected by changes since this commit or branch. */
  since?: string;
  /** Only the tests that import these source files, directly or not. */
  related?: string[];
  /** Keep running and re-run on change instead of running once. */
  watch?: boolean;
  /** Print Vitest's JSON report on stdout. */
  json?: boolean;
  /** Only tests whose name matches this pattern. */
  testNamePattern?: string;
};

/**
 * Translate `warlock test` options into Vitest arguments. Pure, so the mapping
 * is pinned by a test rather than discovered in CI.
 *
 * Flags used (verified against `vitest --help`, Vitest 4.1):
 * `run`, `related [...filters]`, `--changed [since]`, `--passWithNoTests`,
 * `--reporter <name>`, `--testNamePattern <pattern>`.
 */
export function buildVitestArguments(options: TestCommandOptions): string[] {
  const related = options.related ?? [];
  const args: string[] = [];

  if (related.length > 0) {
    // `vitest related` watches by default; `--run` makes it run once.
    args.push("related", ...related, ...options.filters);

    if (!options.watch) args.push("--run");
  } else {
    if (!options.watch) args.push("run");

    args.push(...options.filters);
  }

  if (options.changed || options.since) {
    args.push("--changed");

    if (options.since) args.push(options.since);
  }

  // "Run what my change affects" finding nothing to run is a pass, not an error.
  if (related.length > 0 || options.changed || options.since) args.push("--passWithNoTests");

  if (options.testNamePattern) args.push("--testNamePattern", options.testNamePattern);

  if (options.json) args.push("--reporter=json");

  return args;
}

/** Read `warlock test`'s parsed CLI input into {@link TestCommandOptions}. */
export function readTestCommandOptions(data: CommandActionData): TestCommandOptions {
  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  const relatedOption = text(data.options.related);

  return {
    filters: data.args,
    changed: data.options.changed === true,
    since: text(data.options.since),
    related: relatedOption
      ? relatedOption
          .split(",")
          .map((file) => file.trim())
          .filter(Boolean)
      : undefined,
    watch: data.options.watch === true,
    json: data.options.json === true,
    testNamePattern: text(data.options.testNamePattern) ?? text(data.options.t),
  };
}

/**
 * The project's own Vitest entry (`vitest.mjs`), resolved from the project
 * root — never a global or an `npx` download.
 */
export function resolveProjectVitest(
  projectRoot: string,
  resolve: (specifier: string) => string = createRequire(path.join(projectRoot, "package.json"))
    .resolve,
): string {
  let manifestPath: string;

  try {
    manifestPath = resolve("vitest/package.json");
  } catch {
    throw new Error(
      `Vitest is not installed in ${projectRoot}. Run \`warlock add test\` (or install vitest as a dev dependency) first.`,
    );
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.vitest;
  const entry = path.join(path.dirname(manifestPath), bin ?? "vitest.mjs");

  if (!existsSync(entry)) {
    throw new Error(`Vitest's entry point was not found at ${entry}. Reinstall vitest.`);
  }

  return entry;
}

async function testCommandAction(data: CommandActionData): Promise<void> {
  const options = readTestCommandOptions(data);
  const vitest = resolveProjectVitest(process.cwd());
  const args = buildVitestArguments(options);

  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [vitest, ...args], {
      cwd: process.cwd(),
      // Vitest only defaults NODE_ENV to "test" when it is unset; an exported
      // NODE_ENV=production would otherwise reach the test server and be refused.
      env: { ...process.env, NODE_ENV: "test" },
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });

  if (exitCode !== 0) process.exit(exitCode);
}

/**
 * `warlock test` — run the project's tests through its own Vitest.
 *
 * @example
 * warlock test                                  # everything, once
 * warlock test --changed                        # tests affected by uncommitted changes
 * warlock test --changed --since main           # ... by changes since main
 * warlock test --related src/app/posts/services/create-post.service.ts
 * warlock test src/app/posts --json             # one folder, JSON report on stdout
 */
export const testCommand = command({
  name: "test [filters...]",
  description:
    "Run the project's tests with Vitest; --changed / --related run only the tests your change affects",
  action: testCommandAction,
  options: [
    {
      text: "--changed",
      description: "Only run tests affected by uncommitted changes (git)",
      type: "boolean",
    },
    {
      text: "--since <ref>",
      description: "With --changed: tests affected by changes since this git ref (e.g. main)",
    },
    {
      text: "--related <files>",
      description: "Comma-separated source files: only run the tests that import them",
    },
    {
      text: "--watch, -w",
      description: "Re-run on change instead of running once",
      type: "boolean",
    },
    {
      text: "--test-name-pattern, -t",
      description: "Only run tests whose name matches this pattern",
    },
    {
      text: "--json",
      description: "Print Vitest's JSON report on stdout",
      type: "boolean",
    },
  ],
});

import { existsSync, readFileSync } from "node:fs";

/**
 * One `.env` key whose file value lost to an ambient `process.env` value that
 * was already set before the file was read.
 */
export type EnvironmentOverride = {
  key: string;
  effectiveValue: string;
  fileValue: string;
};

/**
 * Minimal `KEY=VALUE` line parser: `#` comments, blank lines, and one layer
 * of surrounding quotes.
 *
 * Deliberately NOT `@mongez/dotenv`'s own `parseLine` / `parseValue`: those
 * live in the same module as `loadEnv`, and `tests/unit/utils/load-environment.test.ts`
 * replaces that whole module with `vi.mock("@mongez/dotenv", () => ({ loadEnv:
 * ... }))`. Importing any other named export from `@mongez/dotenv` here would
 * resolve to `undefined` under that mock and crash detection during those
 * tests. Comments, blank lines and a surrounding quote pair are the entire
 * feature set this comparison needs — the actual load still goes through the
 * real `@mongez/dotenv` parser via `loadEnv()`.
 */
function parseEnvLine(line: string): [string, string] | undefined {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
    return undefined;
  }

  const separatorIndex = trimmed.indexOf("=");
  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();

  const quote = value[0];

  if (
    (quote === '"' || quote === "'" || quote === "`") &&
    value.length > 1 &&
    value.endsWith(quote)
  ) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

/**
 * Which of the given `.env` files' keys lost to a value the ambient process
 * environment already carried.
 *
 * `snapshot` must be captured BEFORE `loadEnv()` runs: the loader writes into
 * `process.env` for every key the file supplies, so a snapshot taken
 * afterwards can no longer tell an ambient override from a value the loader
 * itself just wrote.
 *
 * `files` should be given in the same order `loadEnv()` actually reads them
 * (`.env.shared` first, then the applicable `.env`/`.env.<NODE_ENV>`), so a
 * key declared in more than one file resolves to the value the real loader
 * would have used absent any ambient override.
 */
export function detectEnvironmentOverrides(
  files: string[],
  snapshot: NodeJS.ProcessEnv,
): EnvironmentOverride[] {
  const fileValues = new Map<string, string>();

  for (const file of files) {
    if (!existsSync(file)) {
      continue;
    }

    const lines = readFileSync(file, "utf8").split(/\r\n|\n/);

    for (const line of lines) {
      const parsed = parseEnvLine(line);

      if (!parsed) {
        continue;
      }

      fileValues.set(parsed[0], parsed[1]);
    }
  }

  const overrides: EnvironmentOverride[] = [];

  for (const [key, fileValue] of fileValues) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) {
      continue;
    }

    const effectiveValue = snapshot[key] as string;

    if (effectiveValue !== fileValue) {
      overrides.push({ key, effectiveValue, fileValue });
    }
  }

  return overrides;
}

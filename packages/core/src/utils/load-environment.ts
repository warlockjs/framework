import { loadEnv } from "@mongez/dotenv";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * The files `loadEnv()` will look for, in the order it considers them.
 *
 * Mirrors `@mongez/dotenv`'s own resolution — `.env.shared` first, then
 * `.env.<NODE_ENV>` if it exists, else plain `.env` — because the presence
 * check has to ask the same question the loader is about to ask.
 */
function candidateEnvFiles(directory: string): string[] {
  const files = [path.join(directory, ".env"), path.join(directory, ".env.shared")];

  if (process.env.NODE_ENV) {
    files.push(path.join(directory, `.env.${process.env.NODE_ENV}`));
  }

  return files;
}

/**
 * Whether this process has already loaded its env files.
 *
 * Two callers reach here on a bootstrapping command — the CLI preload phase and
 * `bootstrap()` — and `loadEnv()` defaults to `override: true`, so a second pass
 * re-parses the same files and re-writes `process.env`. Anything set in between
 * (a `warlock.config.ts` module body, a config file, an orchestrator) would be
 * silently clobbered by the later load. Same shape as the defect where a
 * caller's test-server port was overwritten by a re-read of `.env`.
 *
 * A deliberate reload is still possible and still used: the dev server calls
 * `loadEnv()` directly when an `.env` file changes on disk, which is a reload
 * the user asked for rather than an accidental second pass.
 */
let environmentLoaded = false;

/**
 * Load `.env` files when there are any, and do nothing when there are not.
 *
 * Loads at most **once per process** — see {@link environmentLoaded}.
 *
 * `@mongez/dotenv`'s `loadEnvFile` **throws** when the file is absent. That was
 * survivable while only `dev` loaded env; now that every command loads it —
 * because `warlock.config.ts` calls `env()` in its module body and had been
 * evaluated against an empty store under every command — an unguarded call
 * would turn "this project has no .env" from a non-event into a hard failure
 * of `warlock build`. A project without a `.env` is legitimate: config files
 * carry defaults, and containers inject their own variables.
 *
 * The guard lives here rather than waiting on a fix in `@mongez/dotenv`: core
 * decides its own env policy and must not depend on another package's release
 * schedule to avoid crashing a working build.
 */
export async function loadEnvironmentFiles(directory: string = process.cwd()): Promise<void> {
  if (environmentLoaded) {
    return;
  }

  const hasEnvFile = candidateEnvFiles(directory).some((file) => existsSync(file));

  if (!hasEnvFile) {
    // Not latched: a project may create its `.env` between a command's preload
    // and its bootstrap, and there is nothing to protect from a second override
    // when the first pass loaded nothing.
    return;
  }

  environmentLoaded = true;

  await loadEnv();
}

/**
 * Forget that env has been loaded, so the next call loads again.
 *
 * @internal For tests, which run many boots inside one process.
 */
export function resetLoadedEnvironment(): void {
  environmentLoaded = false;
}

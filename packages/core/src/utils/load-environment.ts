import { loadEnv, type EnvLoaderOptions } from "@mongez/dotenv";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Core's env precedence policy, in one place because two callers load env:
 * this module at boot, and the dev server when an `.env` file changes.
 *
 * `@mongez/dotenv` defaults to `precedence: "file-wins"`, which is backwards.
 * The `.env` file is a checked-in DEFAULT; a variable already exported into
 * `process.env` is the deliberate, situational override — a second instance on
 * another port, CI pointed at another database, a container's configuration.
 * Under the default, `PORT=6060 warlock dev` produced a server on the `.env`
 * file's 3000 and said nothing. A default that silently beats an explicit
 * instruction is the wrong way round, so core opts into `process-wins`:
 * the file supplies only the keys the environment does not already carry.
 *
 * EMPTY STRING — `FOO=` in the environment counts as SET, and wins, so the
 * file's value is discarded and `env("FOO")` returns `""`. Chosen over
 * "empty means absent" because the loader cannot tell a deliberate blanking
 * from an accident, and only one of the two readings is expressible: an
 * operator who wants the file's value can unset the variable, whereas under
 * "empty means absent" an operator who wants a blank value has no way to ask
 * for one. It also matches POSIX (an exported empty variable is set), dotenv,
 * dotenv-flow and Vite. Note the consequence: a blank export beats the second
 * argument too, so `env("FOO", "fallback")` yields `""`, not the fallback.
 *
 * Keys this loader itself wrote are tracked by the library and are NOT treated
 * as process-provided, so editing `.env` during a dev session still takes
 * effect on reload rather than being pinned by the previous load's own writes.
 */
export const environmentLoaderOptions: EnvLoaderOptions = {
  precedence: "process-wins",
};

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

  // `dir` has to be forwarded: `loadEnv()` defaults it to `process.cwd()`, so
  // without this the existence check above asks about `directory` while the
  // load itself reads somewhere else entirely. Identical in production, where
  // `directory` IS `process.cwd()`.
  await loadEnv(undefined, { ...environmentLoaderOptions, dir: directory });
}

/**
 * Forget that env has been loaded, so the next call loads again.
 *
 * @internal For tests, which run many boots inside one process.
 */
export function resetLoadedEnvironment(): void {
  environmentLoaded = false;
}

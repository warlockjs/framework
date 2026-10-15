/**
 * Standalone Cascade CLI entrypoint.
 *
 * Executed two ways:
 * - **Dev** — `tsx ./@warlock.js/cascade/src/cli.ts ...` via the root
 *   `cascade` / `cascade.migrate` scripts.
 * - **Production** — `bin/cascade.mjs` side-effect-imports the compiled
 *   `esm/cli.js`, which kicks off `runMain` on load.
 *
 * Nothing is exported on purpose. Importing this module IS the CLI.
 */

import { loadEnv } from "@mongez/dotenv";
import { runMain } from "citty";
import { main } from "./cli/index";
import { setLoggerConfig } from "./cli/setup-logger";

// Wire the framework logger to stdout. Without this the migration runner's
// log.* calls are silent no-ops in standalone mode.
setLoggerConfig();

// Auto-load `.env` (or `.env.<NODE_ENV>`) from cwd before any command runs so
// `connectFromEnv` sees the same vars an existing warlock project already
// declares. Absence of an env file is not an error — vars may come from the
// shell, CI, or `node --env-file=...`.
try {
  loadEnv();
} catch {
  // No .env file at the resolved path — proceed with whatever the shell set.
}

runMain(main);

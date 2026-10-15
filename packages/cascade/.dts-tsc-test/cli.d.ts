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
export {};
//# sourceMappingURL=cli.d.ts.map
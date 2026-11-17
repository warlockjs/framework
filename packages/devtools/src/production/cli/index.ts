import type { CLICommand } from "@warlock.js/core";

/**
 * `warlock devtools:enable` and `warlock devtools:reset-admin`, for
 * `warlock.config.ts > cli.commands`. Both connect to the database only
 * (no HTTP server) and write an audit entry with `ip: "cli"`.
 *
 * - `devtools:enable`: clears the disable flag and the global lock, and sets
 *   `failuresResetAt` so earlier failures stop counting.
 * - `devtools:reset-admin [--email <email>]` (default `DEVTOOLS_ADMIN_EMAIL`):
 *   creates or resets that account as an admin with a printed temporary
 *   password (must be changed at sign-in), clears its second factors and
 *   recovery codes, unlocks it, and signs out its sessions.
 *
 * Owner: WP-1.
 */
export function registerDevtoolsCommands(): CLICommand[] {
  throw new Error("not implemented");
}

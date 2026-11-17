import { command, type CLICommand, type CLICommandPreload } from "@warlock.js/core";
import { reportStoreError, runEnable, runResetAdmin, resolveAdminEmail } from "./actions";
import type { CliOutput } from "./actions";

/** The same boot as `warlock migrate`: the app's config and the database connection, no HTTP server. */
const PRELOAD: CLICommandPreload = {
  config: true,
  warlockConfig: true,
  bootstrap: true,
  connectors: ["database"],
};

/** Print with the stream's own write, so a boot that moves `console.log` never mixes into the answer. */
const io: CliOutput = {
  out: (line) => void process.stdout.write(`${line}\n`),
  err: (line) => void process.stderr.write(`${line}\n`),
};

/** Exit with `code` once stdout and stderr are flushed (a non-zero code only; 0 lets the CLI finish). */
async function exitWith(code: number): Promise<void> {
  if (code === 0) return;

  process.exitCode = code;

  await Promise.race([
    Promise.all(
      [process.stdout, process.stderr].map(
        (stream) => new Promise<void>((resolve) => stream.write("", () => resolve())),
      ),
    ),
    new Promise<void>((resolve) => setTimeout(resolve, 500).unref()),
  ]);

  process.exit(code);
}

/** The store of the app's database, or the exit code of the error that stopped it. */
async function openStore() {
  try {
    const { createCascadeStore } = await import("../store/cascade-store");

    return { store: await createCascadeStore() };
  } catch (error) {
    return { code: reportStoreError(io, error) };
  }
}

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
 */
export function registerDevtoolsCommands(): CLICommand[] {
  const enable = command({
    name: "devtools:enable",
    description:
      "Turn the production devtools dashboard back on: clears the disable switch, the global lock and the failure counters",
    preload: PRELOAD,
    action: async () => {
      const opened = await openStore();

      if (!opened.store) return exitWith(opened.code);

      await exitWith(await runEnable({ store: opened.store, now: Date.now, io }));
    },
  });

  const resetAdmin = command({
    name: "devtools:reset-admin",
    description:
      "Create or reset a devtools admin account with a printed temporary password (no second factor, signed out everywhere)",
    preload: PRELOAD,
    action: async ({ options }) => {
      const email = resolveAdminEmail(options.email, process.env);
      const opened = await openStore();

      if (!opened.store) return exitWith(opened.code);

      const [{ hashPassword }, { generateTemporaryPassword }] = await Promise.all([
        import("@warlock.js/core"),
        import("../auth"),
      ]);

      await exitWith(
        await runResetAdmin(
          {
            store: opened.store,
            now: Date.now,
            io,
            generatePassword: generateTemporaryPassword,
            hashPassword,
          },
          email,
        ),
      );
    },
    options: [
      {
        text: "--email, -e",
        description: "The admin email (default: DEVTOOLS_ADMIN_EMAIL)",
        type: "string",
      },
    ],
  });

  return [enable, resetAdmin];
}

import { command } from "../../commands/cli-command";
import { doctorCommandAction } from "./doctor/doctor-command.action";

/**
 * `warlock doctor` — run a set of diagnostic checks against the real app and
 * print a grouped pass/warn/fail report. Exits non-zero if any check fails.
 *
 * Preload plan: config + env + framework bootstrap, and NO connectors. The
 * `connectors` preloader would START them (open the database, dial the cache,
 * bind the port); doctor's own boot pass BOOTS them instead — the phase where
 * routes and endpoints register — which is what gives the checks a real app to
 * read without opening a single connection. See
 * `doctor/boot-for-diagnostics.ts` for that seam.
 *
 * `runtimeStrategy: "development"` is declared, not defaulted: connectors branch
 * on it (`web` serves pages from a manifest in production and from Vite in
 * development, `http` picks its router scan the same way), and a diagnostic
 * command that left the strategy unset would take the production branch by
 * accident — refusing to boot a perfectly healthy app because no build manifest
 * exists. Doctor reads a working tree, so it says so.
 */
export const doctorCommand = command({
  name: "doctor",
  description:
    "Boot the app read-only (no connections, no port) and report on its routes, config, connectors, drivers and health endpoints",
  action: doctorCommandAction,
  preload: {
    runtimeStrategy: "development",
    config: true,
    env: true,
    bootstrap: true,
  },
});

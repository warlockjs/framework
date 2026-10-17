import { command } from "../../commands/cli-command";
import { inspectCommandAction } from "./inspect/inspect-command.action";

/**
 * `warlock inspect` — print the app's facts from its booted registries:
 * routes (middleware, guard, rate limit, logging, request/response schemas),
 * models, resources, config keys, event listeners, pages, queue jobs,
 * scheduled tasks and installed `@warlock.js/*` versions. `--json` prints the
 * versioned report (`schemaVersion: 1`); `--section` limits it.
 *
 * Boots like `warlock doctor`: connectors boot (routes register) but none
 * starts, so no database, cache or socket connection opens and no port binds.
 * `runtimeStrategy: "development"` for the same reason doctor declares it.
 */
export const inspectCommand = command({
  name: "inspect",
  description:
    "Print the app's routes, models, resources, config keys, events, pages, jobs, schedules and package versions (read-only); --json for the versioned report",
  action: inspectCommandAction,
  preload: {
    runtimeStrategy: "development",
    config: true,
    env: true,
    bootstrap: true,
  },
  options: [
    {
      text: "--json, -j",
      description: "Print the report as JSON (schemaVersion 1)",
      type: "boolean",
    },
    {
      text: "--section, -s",
      description:
        "Comma-separated sections: routes, models, resources, config, events, pages, jobs, schedules, packages",
      type: "string",
    },
  ],
});

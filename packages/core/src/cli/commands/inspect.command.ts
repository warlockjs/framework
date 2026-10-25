import { parseInspectSections } from "../../tooling/inspect/inspect-app";
import { command } from "../../commands/cli-command";
import { inspectCommandAction } from "./inspect/inspect-command.action";

/**
 * `warlock inspect` — print the app's facts from its booted registries:
 * routes (middleware, guard, rate limit, logging, request/response schemas),
 * models, resources, config keys, event listeners, pages, queue jobs,
 * scheduled tasks, installed `@warlock.js/*` versions, and the wiring: every auto-loaded
 * file in boot order plus the capability slots (`--section wiring`). `--json` prints the
 * versioned report (`schemaVersion: 1`); `--section` limits it.
 *
 * Boots like `warlock doctor`: connectors boot (routes register) but none
 * starts, so no database, cache or socket connection opens and no port binds.
 * Files-only requests skip preload and boot and read source statically.
 * Other requests use `runtimeStrategy: "development"`, like doctor.
 */
export const inspectCommand = command({
  name: "inspect",
  description:
    "Print the app's routes, models, resources, config keys, events, pages, jobs, schedules, files, package versions and wiring (auto-loaded files in boot order, capability slots) (read-only); --json for the versioned report",
  action: inspectCommandAction,
  preAction: ({ options }) => {
    const sections = parseInspectSections(
      typeof options.section === "string" ? options.section : undefined,
    );
    inspectCommand.commandPreload = sections.every((section) => section === "files")
      ? undefined
      : { runtimeStrategy: "development", config: true, env: true, bootstrap: true };
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
        "Comma-separated sections: routes, models, resources, config, events, pages, jobs, schedules, packages, files, wiring",
      type: "string",
    },
  ],
});

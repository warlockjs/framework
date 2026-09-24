import { router } from "../../../router/router";
import type { CommandActionData } from "../../../commands/types";
import { bootForDiagnostics } from "../doctor/boot-for-diagnostics";
import { printRoutesTable } from "./format-routes-table";
import { filterRouteRows, sortRouteRows, toRouteRow } from "./route-row";

/**
 * Read the active option as a trimmed string, or `undefined` when it is absent
 * or not a string (a bare boolean flag).
 *
 * @param value - The parsed option value
 * @returns The string value, or `undefined`
 */
function stringOption(value: string | number | boolean | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Action behind `warlock routes`. Reads the registered routes from the router
 * singleton (populated by the `bootstrap` preload, with no connectors started),
 * applies the `--method` / `--path` / `--name` filters, sorts them, and either
 * prints a verb-colored table or — with `--json` — emits the normalized rows as
 * JSON for piping into scripts/CI.
 *
 * Read-only: it never opens a database/cache/socket connection and never
 * mutates the router.
 *
 * @param data - Parsed CLI args (`options.method` / `path` / `name` / `json`).
 */
export async function routesCommandAction({ options }: CommandActionData): Promise<void> {
  // The preload is config-only and imports no route modules; load them the same
  // way the server does at boot.
  const context = await bootForDiagnostics();

  for (const failure of context.moduleFailures) {
    console.error(`Failed to load ${failure.file}: ${failure.message}`);
  }

  const rows = sortRouteRows(
    filterRouteRows(router.list().map(toRouteRow), {
      method: stringOption(options.method),
      path: stringOption(options.path),
      name: stringOption(options.name),
    }),
  );

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  printRoutesTable(rows);
}

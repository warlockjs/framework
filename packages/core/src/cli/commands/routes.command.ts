import { command } from "../../commands/cli-command";
import { routesCommandAction } from "./routes/routes-command.action";
import { routesDiffCommandAction } from "./routes/routes-diff.action";

/**
 * `warlock routes` — list every registered HTTP route as a table (a read-only
 * sibling of `warlock doctor`). Filter with `--method` / `--path` / `--name`,
 * or emit the normalized rows as JSON with `--json`.
 *
 * The preload is config-only and imports no route modules; the action loads them
 * through `bootForDiagnostics()`, the same loader the server uses at boot. A
 * route file that throws on import is reported on stderr instead of being
 * silently omitted from the table.
 */
export const routesCommand = command({
  name: "routes",
  description:
    "List the registered HTTP routes as a table (read-only); filter with --method / --path / --name, or emit JSON with --json",
  action: routesCommandAction,
  preload: {
    config: true,
    env: true,
    bootstrap: true,
  },
  options: [
    {
      text: "--method, -m",
      description: "Filter by HTTP method (case-insensitive, e.g. GET, POST)",
      type: "string",
    },
    {
      text: "--path, -p",
      description: "Filter by a case-insensitive path substring",
      type: "string",
    },
    {
      text: "--name, -n",
      description: "Filter by a case-insensitive route-name substring",
      type: "string",
    },
    {
      text: "--json, -j",
      description: "Output the routes as JSON instead of a table",
      type: "boolean",
    },
  ],
});

/** Compare live development page routes with the last successful build. */
export const routesDiffCommand = command({
  name: "routes:diff",
  description: "Compare live page routes with the last successful production build",
  action: routesDiffCommandAction,
  preload: {
    runtimeStrategy: "development",
    warlockConfig: true,
    config: true,
    env: true,
    bootstrap: true,
  },
});

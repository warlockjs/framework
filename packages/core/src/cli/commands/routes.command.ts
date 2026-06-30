import { command } from "../cli-command";
import { routesCommandAction } from "./routes/routes-command.action";

/**
 * `warlock routes` — list every registered HTTP route as a table (a read-only
 * sibling of `warlock doctor`). Filter with `--method` / `--path` / `--name`,
 * or emit the normalized rows as JSON with `--json`.
 *
 * Preload plan: load config + bootstrap app code so route modules register on
 * the router singleton, but start NO connectors — listing routes must never
 * open a database/cache/socket connection. Because the route-module loader is
 * fail-loud, a route file that throws on import surfaces here instead of being
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

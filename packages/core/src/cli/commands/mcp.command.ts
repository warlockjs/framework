import { command } from "../../commands/cli-command";
import { mcpCommandAction, routeConsoleToStderr } from "./mcp/mcp-command.action";

/**
 * `warlock mcp` — serve the app to coding agents over the Model Context
 * Protocol: `inspect_*` (routes, models, config keys, events, pages, jobs…),
 * `db_schema`, `docs_search` / `docs_read` (installed skills and docs only,
 * offline), `explain`, `check_run`, `test_run`, `requests_recent` (from
 * devtools) and `generate_make` / `generate_add` (a diff by default).
 *
 * stdio by default; `--http` serves Streamable HTTP on loopback (a token is
 * required off loopback). Read-only unless `--allow-writes`. Needs
 * `@warlock.js/ai-tools` (optional peer). Boots like `warlock inspect` — no
 * database connection, no port bound for the app — on the first tool call.
 */
export const mcpCommand = command({
  name: "mcp",
  description:
    "Serve the app to coding agents over MCP (stdio, or --http): inspect, db schema, installed docs, check, tests, devtools requests, generator diffs; read-only unless --allow-writes",
  action: mcpCommandAction,
  persistent: true,
  preAction: async (data) => {
    // Before the preloaders: over stdio, anything printed while config loads
    // would corrupt the JSON-RPC stream on stdout.
    const http =
      data.options.http === true ||
      data.options.host !== undefined ||
      data.options.port !== undefined;

    if (!http) routeConsoleToStderr();
  },
  preload: {
    runtimeStrategy: "development",
    config: true,
    bootstrap: true,
  },
  options: [
    {
      text: "--http",
      description:
        "Serve MCP Streamable HTTP instead of stdio (loopback, a free port unless --port)",
      type: "boolean",
    },
    {
      text: "--host",
      description: "HTTP bind address (default 127.0.0.1); anything but loopback requires --token",
      type: "string",
    },
    {
      text: "--port",
      description: "HTTP port (default 0: a free port, printed on stderr)",
      type: "string",
    },
    {
      text: "--path",
      description: "HTTP endpoint path (default /mcp)",
      type: "string",
    },
    {
      text: "--token",
      description: "Bearer token HTTP clients must send (or WARLOCK_MCP_TOKEN)",
      type: "string",
    },
    {
      text: "--allow-writes",
      description: "Let generate_make / generate_add write into the project (default: diff only)",
      type: "boolean",
    },
    {
      text: "--url",
      description:
        "The dev server origin for requests_recent (default: read from .warlock/dev-server.json)",
      type: "string",
    },
    {
      text: "--devtools-path",
      description: "The devtools mount for requests_recent (default /__warlock)",
      type: "string",
    },
  ],
});

---
name: warlock-mcp
description: 'Serve the app to a coding agent over the Model Context Protocol: `warlock mcp` (stdio, or `--http` on loopback with a bearer token required off loopback) and `warlock dev --mcp` / `devServer.mcp` (live registries) expose `inspect_app` + `inspect_<section>` (routes, models, resources, config, events, pages, jobs, schedules, packages), `db_schema`, `docs_search` / `docs_read` (installed @warlock.js skills, READMEs and llms files only, offline), `explain`, `check_run`, `test_run`, `requests_recent` (devtools: timeline, queries with nPlusOne, logs) and `generate_make` / `generate_add` (a unified diff from a throw-away copy; writes only with `--allow-writes`). Read-only by default. Needs `@warlock.js/ai-tools` (optional peer). Triggers: `warlock mcp`, `--allow-writes`, `--http`, `WARLOCK_MCP_TOKEN`, `warlock dev --mcp`, `devServer.mcp`, `startWarlockMcpServer`, `createMcpContext`, `createWarlockMcpTools`, `runTests`, `sandboxBackend`, `WL7003`, `WL7004`, `WL7005`, `.mcp.json`; "connect Claude Code / Cursor to my Warlock app", "let the agent ask the app", "MCP server for this project", "preview what a generator writes". Skip: the JSON report itself — the `warlock-inspect` topic; serving YOUR OWN agent tools over MCP — the `expose-as-mcp-server` topic of @warlock.js/ai-tools; one request''s timeline from the terminal — the `warlock-trace` topic.'
---

# Warlock — `warlock mcp`

One MCP server per app that answers what the app actually has and does — from its registries, its installed docs and its devtools — so an agent asks instead of grepping.

```bash
npm install -D @warlock.js/ai-tools @warlock.js/ai   # once: the MCP transport (optional peers)

npx warlock mcp                       # stdio — what an MCP client spawns
npx warlock mcp --http                # Streamable HTTP on 127.0.0.1, a free port (printed on stderr)
npx warlock mcp --http --port 7333 --token "$WARLOCK_MCP_TOKEN"
npx warlock mcp --allow-writes        # generate tools may write files
npx warlock dev --mcp                 # inside the dev server: live registries after every reload
```

Register it with a client (Claude Code reads `.mcp.json` at the project root):

```json
{
  "mcpServers": {
    "warlock": { "command": "npx", "args": ["warlock", "mcp"] }
  }
}
```

## Tools

| Tool                                                                                                                                                | What it returns                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inspect_app`                                                                                                                                       | App name/version/Node, a count per section, inspect warnings. Start here.                                                                                                             |
| `inspect_routes`                                                                                                                                    | Routes with middleware, guard, CSRF, rate limit, logging, JSON Schemas. `filter`, `method`, `unguardedWrites`.                                                                        |
| `inspect_models`, `inspect_resources`, `inspect_config`, `inspect_events`, `inspect_pages`, `inspect_jobs`, `inspect_schedules`, `inspect_packages` | One `warlock inspect` section each, with `filter`.                                                                                                                                    |
| `db_schema`                                                                                                                                         | Tables from the models: columns with type, required, primary key, `belongsTo` foreign keys, relations, timestamps. No database connection.                                            |
| `docs_search` / `docs_read`                                                                                                                         | Ranked sections of `node_modules/@warlock.js/*/skills/**`, `README.md`, `llms*.txt` — the installed versions, offline.                                                                |
| `explain`                                                                                                                                           | A `WL` code: meaning, your code vs this machine, fix, skill, docs link.                                                                                                               |
| `check_run`                                                                                                                                         | The `warlock check` report (`changed`, `base`, `skip`). Exit code 2 = the machine, not the code.                                                                                      |
| `test_run`                                                                                                                                          | vitest for `files` (tests run directly, sources via `vitest related`), `changed`, or the suite.                                                                                       |
| `requests_recent`                                                                                                                                   | Recent requests from devtools: status, phases (each middleware, validation, handler), queries with `nPlusOne`, warnings, logs, timings. Needs `warlock dev` + `@warlock.js/devtools`. |
| `generate_make`                                                                                                                                     | `generate.<module\|controller\|service\|use-case\|model\|repository\|resource\|migration>` → a unified diff per file.                                                                 |
| `generate_add`                                                                                                                                      | `warlock add <features>` → the diff (package.json included; nothing installed).                                                                                                       |

Names use `_`, not `.`: model APIs only accept `^[a-zA-Z0-9_-]{1,128}$` as a tool name.

## Read-only by default

Without `--allow-writes`, `generate_make` / `generate_add` have no `write` argument: the generator runs in a temporary copy of the project (root files and `src/`, `.env*` never copied, `node_modules` linked) and the tool returns what it would create or change:

```json
{
  "ok": true,
  "command": ["warlock", "generate.service", "posts/publish-post"],
  "files": [
    {
      "path": "src/app/posts/services/publish-post.service.ts",
      "status": "created",
      "diff": "--- /dev/null\n+++ b/src/app/posts/services/publish-post.service.ts\n@@ -0,0 +1,5 @@\n+…"
    }
  ]
}
```

A `write: true` sent to a read-only server is refused with `WL7005`. With `--allow-writes`, `write: true` runs the generator in the project and returns the same diff.

## HTTP rules

- Binds `127.0.0.1` by default. Any other `--host` needs `--token` (or `WARLOCK_MCP_TOKEN`), otherwise `WL7004` before anything boots.
- Clients send `Authorization: Bearer <token>` when a token is set; foreign browser `Origin`s are refused (the `@warlock.js/ai-tools` HTTP transport).
- `warlock dev --mcp` serves HTTP on loopback only and records the endpoint in `.warlock/dev-server.json` (`mcp.url`). Options in `warlock.config.ts`:

```ts title="warlock.config.ts"
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  devServer: {
    mcp: { port: 7333, token: process.env.WARLOCK_MCP_TOKEN, allowWrites: false },
  },
});
```

## From code

```ts
import {
  createMcpContext,
  inspectApp,
  runTests,
  startWarlockMcpServer,
} from "@warlock.js/core/tooling";

// The app is already booted in this process.
const context = createMcpContext({ inspect: (sections) => inspectApp({ sections }) });
const server = await startWarlockMcpServer({ context, transport: { type: "http", port: 0 } });

console.error(`MCP at ${server.url} — ${server.tools.length} tools`);

const tests = await runTests({ files: ["src/app/posts/services/publish-post.service.ts"] });
console.error(
  tests.ok ? "tests pass" : tests.problems.map((problem) => problem.message).join("\n"),
);

await server.close();
```

## Gotchas

- `warlock mcp` boots like `warlock inspect` (connectors booted, none started — no database connection, no app port) on the first tool call, and keeps that snapshot. After changing routes or models, restart it — or use `warlock dev --mcp`, which reads the live registries.
- Over stdio, stdout is the JSON-RPC stream: `console.log` / `info` / `debug` are sent to stderr for the whole run.
- `requests_recent` fails with `WL8008` when no dev server is recorded or reachable, and `WL8009` when devtools is not installed (`npx warlock add devtools`).
- Missing `@warlock.js/ai-tools` / `@warlock.js/ai` → `WL7003` with the install line.

## See also

- The `warlock-inspect` topic — the report the `inspect_*` tools return.
- The `warlock-check` topic — what `check_run` and `test_run` report.
- The `warlock-trace` topic — send a request and read its timeline.
- The `expose-as-mcp-server` topic of @warlock.js/ai-tools — the transport underneath.

## Source file graph

Call `inspect_files` with `{ "filter": "service" }` for file paths, modules, convention roles, export names, resolved imports and reverse `importedBy` edges. This section scans `src/` without executing source modules; files-only requests skip the lazy app boot. `inspect_app` includes a `files` count. See `npx warlock explain src/app/posts/services/list.service.ts --json` for reaching routes and pages.

---
title: "warlock mcp"
description: Serve the app to coding agents over the Model Context Protocol — inspect tools from the app's registries, the database schema the models declare, offline search over the installed skills and docs, error-code explanations, warlock check, tests, recent requests from devtools, and generator previews as unified diffs. Read-only by default; stdio or loopback HTTP.
sidebar:
  order: 11
  label: "warlock mcp"
---

`warlock mcp` turns the app into an MCP server, so a coding agent (Claude Code, Cursor, any MCP client) asks the app what is true instead of reading source text and guessing. The answers come from the same places as [`warlock inspect`](./inspect.md), [`warlock check`](./check.md) and [`warlock trace`](./trace.md), plus the documentation of the `@warlock.js/*` versions installed in `node_modules`.

```bash
npm install -D @warlock.js/ai-tools @warlock.js/ai   # the MCP transport — optional peers of core

warlock mcp                       # stdio: what an MCP client spawns
warlock mcp --http                # Streamable HTTP on 127.0.0.1, a free port (printed on stderr)
warlock mcp --allow-writes        # let the generate tools write into the project
warlock dev --mcp                 # serve it from the dev server, over live registries
```

| Flag              | Type    | Description                                                                                 |
| ----------------- | ------- | ------------------------------------------------------------------------------------------- |
| `--http`          | boolean | Serve MCP Streamable HTTP instead of stdio.                                                 |
| `--host`          | string  | HTTP bind address. Default `127.0.0.1`. Anything but loopback requires `--token`.           |
| `--port`          | string  | HTTP port. Default `0` (a free port, printed on stderr).                                    |
| `--path`          | string  | HTTP endpoint path. Default `/mcp`.                                                         |
| `--token`         | string  | Bearer token HTTP clients must send. Falls back to `WARLOCK_MCP_TOKEN`.                     |
| `--allow-writes`  | boolean | Let `generate_make` / `generate_add` write files. Without it they only return a diff.       |
| `--url`           | string  | The dev server origin for `requests_recent`. Default: read from `.warlock/dev-server.json`. |
| `--devtools-path` | string  | The devtools mount for `requests_recent`. Default `/__warlock`.                             |

## Connect a client

An MCP client starts the stdio server itself. For Claude Code, put this in `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "warlock": { "command": "npx", "args": ["warlock", "mcp"] }
  }
}
```

For an HTTP client, run `warlock mcp --http --port 7333` (or `warlock dev --mcp`) and point the client at `http://127.0.0.1:7333/mcp`, with `Authorization: Bearer <token>` when a token is set.

## Tools

Tool names use underscores, not dots: model APIs only accept tool names matching `^[a-zA-Z0-9_-]{1,128}$` (the Anthropic Messages API documents exactly that pattern), even though the MCP specification also allows `.`.

| Tool                                                                                                                                                | Returns                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inspect_app`                                                                                                                                       | App name, version, Node, environment, a count per inspect section, and the inspect warnings.                                                                                                                                                                                                                                                                                                                                             |
| `inspect_routes`                                                                                                                                    | The `routes` section of [`warlock inspect`](./inspect.md). Arguments: `filter` (path, name, handler, file), `method`, `unguardedWrites` (POST/PUT/PATCH/DELETE API routes with no auth guard). Includes `components` so `$ref`s resolve.                                                                                                                                                                                                 |
| `inspect_models`, `inspect_resources`, `inspect_config`, `inspect_events`, `inspect_pages`, `inspect_jobs`, `inspect_schedules`, `inspect_packages` | One inspect section each, with a `filter`. `inspect_config` lists key types, never values.                                                                                                                                                                                                                                                                                                                                               |
| `db_schema`                                                                                                                                         | One entry per table the models declare: columns (type, required, primary key, the target of a `belongsTo` foreign key), relations, timestamp columns, delete strategy. Built from the models' Seal schemas; no database connection is opened, so columns that exist only in a migration are not listed.                                                                                                                                  |
| `docs_search`                                                                                                                                       | Ranked sections of `node_modules/@warlock.js/*/skills/**/*.md`, `README.md`, `llms.txt` and `llms-full.txt` — file, heading, line, excerpt. Offline, so the answer matches the installed versions. `query`, `limit`, `package`.                                                                                                                                                                                                          |
| `docs_read`                                                                                                                                         | One file of that corpus (whole, or one section by `heading`). Nothing outside the corpus can be read.                                                                                                                                                                                                                                                                                                                                    |
| `explain`                                                                                                                                           | An [error code](./error-codes.md): meaning, your code or this machine, the fix, the skill, the docs link. Without `code`, every code.                                                                                                                                                                                                                                                                                                    |
| `check_run`                                                                                                                                         | The [`warlock check`](./check.md) report. `changed`, `base`, `skip`. The typecheck runs in a child process.                                                                                                                                                                                                                                                                                                                              |
| `test_run`                                                                                                                                          | A vitest run: `files` (test files run as they are, source files run the tests that import them), `changed` (the tests related to the git changes), or the whole suite. Totals plus one `WL7301` / `WL7302` problem per failure, or an environment code.                                                                                                                                                                                  |
| `requests_recent`                                                                                                                                   | The newest requests [devtools](../../devtools/) recorded: method, path, route, status, duration and — with `details` (default) — the phases (route match, each middleware, validation, handler), every query with an `nPlusOne` flag, warnings, logs, cache operations, mails, and timings. Filter by `method`, `path`, `status`. Request and response bodies are not recorded by devtools; [`warlock trace`](./trace.md) captures them. |
| `request_log`                                                                                                                                       | The persisted [request log](../digging-deeper/request-log.md) (`storage/logs/requests`), which survives restarts and needs no dev server: without `id` it lists requests newest first, filtered by `status` (`404`, `5xx`), `route`, `method`, `since` (`30m`, `1h`, ISO date), `q` and `limit`; with `id` it returns the full record (redacted input, response, phases, log entries, query summary, error with stack). Read-only.       |
| `generate_make`                                                                                                                                     | Runs `warlock generate.<generator>` (`module`, `controller`, `service`, `use-case`, `model`, `repository`, `resource`, `migration`) with its flags and returns a unified diff per file.                                                                                                                                                                                                                                                  |
| `generate_add`                                                                                                                                      | Runs `warlock add <features…>` and returns the diff, `package.json` included. Dependencies are recorded, never installed, in the preview.                                                                                                                                                                                                                                                                                                |

A failing tool answers with `isError: true` and a text that starts with the code and ends with its fix, for example `WL8009: The dev server at http://localhost:2030 answered 404 … Fix: Install it with warlock add devtools …`. Invalid arguments are answered the same way, listing every problem.

## Read-only by default

Nothing the server does writes project files unless it was started with `--allow-writes`:

- **Generator previews.** `generate_make` and `generate_add` copy the project's root files and `src/` into a temporary directory (`.env` files are never copied; `node_modules` is linked, not copied), run the generator there, diff the result against the project and delete the copy. The response lists each file as `created`, `modified` or `deleted` with a unified diff.
- **Writes.** With `--allow-writes`, those two tools accept `write: true`, run the generator in the project itself and return the same diff. Without it the argument is not advertised, and a `write: true` sent anyway is refused with `WL7005`.
- `check_run` and `test_run` run your linters and tests, which may write their own caches; they do not change source files.

## Add tools from a package or the app

The server serves its built-in tools, then the tools `warlock.config.ts` registers. `warlock mcp` and `warlock dev --mcp` read them from two places:

- **A command in `cli.commands`.** A package attaches tools to the command its register function returns with `withMcpTools()`. The app lists the command once, and both the command and its tools appear.
- **`mcp.tools`.** Tools the app defines itself.

```ts title="register-report-commands.ts"
import { command, inputSchema, withMcpTools } from "@warlock.js/core";

export function registerReportCommands() {
  return withMcpTools(
    command({ name: "report", description: "Print the report", action: () => undefined }),
    [
      // A function receives the server context: cwd, allowWrites, inspect(), docs()…
      (context) => ({
        name: "report_routes",
        description: "How many routes the app has, per HTTP method. Read-only.",
        input: inputSchema({ method: { type: "string", description: "Only this method." } }),
        writes: false,
        run: async (input) => {
          const { routes = [] } = await context.inspect(["routes"]);

          return routes.filter((route) => !input.method || route.method === input.method).length;
        },
      }),
    ],
  );
}
```

```ts title="warlock.config.ts"
import { defineConfig, inputSchema } from "@warlock.js/core";
import { registerReportCommands } from "./register-report-commands";

export default defineConfig({
  // One line: the `report` command and its `report_routes` tool.
  cli: { commands: [registerReportCommands()] },
  mcp: {
    tools: [
      {
        name: "app_ping",
        description: "Answer pong. Read-only.",
        input: inputSchema({}),
        writes: false,
        run: async () => "pong",
      },
    ],
  },
});
```

A registered tool follows the same rules as a built-in one:

- **Name.** 1 to 128 letters, digits, `_` or `-` (no dots). Prefix it with your package, e.g. `report_routes`. A name that a built-in tool or another registered tool already has stops the server with a message naming the tool.
- **Input.** Build it with `inputSchema()`: a closed object of strings (with an optional `enum`), integers (with `minimum` / `maximum`), booleans and arrays of strings, each with a description. The server checks the schema when it starts, and checks every call's arguments against it; invalid arguments are answered with `isError: true` and every problem.
- **Writes.** Set `writes: true` when a call changes project files. Without `--allow-writes` the tool is still listed, its description says the server is read-only, and every call is refused with `WL7005` before `run` is called.
- **Errors.** A tool that throws answers with `isError: true` and the message; a `WarlockError` adds its code and fix.

`withMcpTools()` returns the same command, and calling it again adds more tools. Keep the imports of a register function light: `warlock.config.ts` is part of the production build, so load heavy modules inside `run`.

## HTTP transport

`--http` uses the Streamable HTTP transport of `@warlock.js/ai-tools`:

- It binds `127.0.0.1` unless `--host` says otherwise. A non-loopback host without `--token` / `WARLOCK_MCP_TOKEN` fails with `WL7004` before the app boots.
- With a token, every request needs `Authorization: Bearer <token>` (compared in constant time); without it the answer is `401`.
- Browser `Origin`s other than loopback and unexpected `Host` headers are refused (`403`), which blocks DNS rebinding from a web page.

## `warlock dev --mcp`

`warlock dev --mcp` (or `devServer.mcp` in `warlock.config.ts`) serves the same tools from the dev server process, over HTTP on loopback, so `inspect_*` reads the registries as they are after the last hot reload:

```ts title="warlock.config.ts"
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  devServer: {
    // true for the defaults: a free port, no token, read-only
    mcp: { port: 7333, token: process.env.WARLOCK_MCP_TOKEN, allowWrites: false },
  },
});
```

The endpoint is printed when the server is ready and recorded in `.warlock/dev-server.json` next to the server's own address (`url`), which is also how `warlock trace` and `requests_recent` find the server. A missing `@warlock.js/ai-tools` only prints a warning; the dev server keeps running.

## How it boots

`warlock mcp` boots the app the way `warlock inspect` does — every connector booted, none started: no database, cache or socket connection, no app port — on the first tool call that needs the app, so the server answers `initialize` immediately. The snapshot is kept for the life of the process: restart it after changing routes or models, or use `warlock dev --mcp`.

Over stdio, stdout carries only JSON-RPC: `console.log`, `console.info` and `console.debug` (and so the framework logger's console channel) go to stderr for the whole run. The process exits when stdin closes or on SIGINT/SIGTERM.

## From code

Everything is on `@warlock.js/core/tooling`:

```ts
import {
  createMcpContext,
  createWarlockMcpTools,
  inspectApp,
  startWarlockMcpServer,
} from "@warlock.js/core/tooling";

const context = createMcpContext({
  inspect: (sections) => inspectApp({ sections }),
  allowWrites: false,
});

// The tool definitions (name, description, JSON Schema input, run) without a transport:
const tools = createWarlockMcpTools(context);

// Or served, with extra tools after the built-in ones:
const server = await startWarlockMcpServer({
  context,
  tools: [],
  transport: { type: "http", port: 0, token: "a-long-random-token" },
});

console.error(
  server.url,
  tools.map((tool) => tool.name),
);
await server.close();
```

`resolveWarlockMcpTools(context, tools)` returns the full list the server would serve (and throws on an invalid or clashing tool); `mcpToolsFromConfig(config)` returns the tools a Warlock config registers; `mcpToolsOf(command)` returns the tools attached to one command. `runTests({ files | changed | base })` (what `test_run` calls), `sandboxBackend()` / `applyGeneration()` (the generator previews), `loadDocsCorpus()` / `searchDocs()` and `buildDbSchema()` are exported too.

## Error codes

| Code     | When                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| `WL7003` | `@warlock.js/ai-tools` or `@warlock.js/ai` is not installed; the message has the install line.             |
| `WL7004` | `--host` is not loopback and no token was given.                                                           |
| `WL7005` | A generate tool was asked to write, or a registered `writes: true` tool was called, on a read-only server. |
| `WL8008` | `requests_recent`: no dev server recorded, or it does not answer.                                          |
| `WL8009` | `requests_recent`: the dev server answers but devtools is not mounted.                                     |

## Source file graph

Call `inspect_files` with `{ "filter": "service" }` for file paths, modules, convention roles, export names, resolved imports and reverse `importedBy` edges. This section scans `src/` without executing source modules; files-only requests skip the lazy app boot. `inspect_app` includes a `files` count. See `npx warlock explain src/app/posts/services/list.service.ts --json` for reaching routes and pages.

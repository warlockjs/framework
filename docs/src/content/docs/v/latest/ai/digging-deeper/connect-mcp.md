---
title: "Connect MCP"
description: ai.mcp from @warlock.js/ai-tools — consume any MCP server's tools as agent tools, and expose a Warlock agent AS an MCP server.
sidebar:
  order: 10
  label: "Connect MCP"
---

The Model Context Protocol (MCP) surface ships in `@warlock.js/ai-tools` and registers as `ai.mcp` the moment you import the package. It runs in **both directions**:

- **`ai.mcp(server)`** — connect to any external MCP server and adapt its tools as native agent tools (consume).
- **`ai.mcp.serve(source, options)`** — expose a local Warlock agent / supervisor / orchestrator (or a raw `ToolContract[]`) AS an MCP server other clients call (publish).

```ts
import "@warlock.js/ai-tools";
import { ai } from "@warlock.js/ai";
```

`ai.mcp` is a callable factory with a `.serve` member attached — one object, both directions.

## Direction A — consume an external MCP server

`ai.mcp(server, options?)` opens a connection, lists the server's tools, and adapts each into a native `ToolContract` — so a remote MCP tool is indistinguishable from a local one and drops straight into `ai.agent({ tools: [...] })`.

```ts
const github = ai.mcp(
  { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
  { namePrefix: "github." },
);

const dev = ai.agent({
  model,
  systemPrompt: "Use the GitHub tools to triage issues.",
  tools: [...(await github.tools())], // handshake + tools/list, run once and cached
  maxTrips: 20,
});

await dev.execute("Find the oldest open 'bug' issue and propose a fix.");

await github.close(); // on teardown — kills the child / ends the HTTP session
```

### The transport — `stdio` or `http`

The `server` argument is discriminated by `type`:

```ts
// Spawn a child process and speak JSON-RPC over its stdin/stdout.
// Uses node:child_process + node:readline — NO dependency.
{ type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "…" } }

// Streamable HTTP against an endpoint.
{ type: "http", url: "https://mcp.example.com/rpc", headers: { authorization: "Bearer …" } }
```

> **stdio env is not inherited.** When you pass `env`, only those keys reach the child — pass what the server needs (e.g. its API token) explicitly. Omit `env` to inherit nothing.

### Client options

```ts
ai.mcp(server, {
  namePrefix: "github.",                        // prepended to every remote tool name
  filter: (name) => name.startsWith("issues_"), // only adapt tools whose name passes
  timeoutMs: 30_000,                            // per tools/call deadline (default 30s)
});
```

- **`namePrefix`** is the collision mitigation — there is **no runtime tool-name collision guard** (the agent resolves a tool by first name match), so the author owns uniqueness. Prefix remote tools to keep them distinct from local ones.
- **`filter`** receives each tool's *unprefixed* name; return `false` to drop it.

### What `tools()` does

`client.tools()` is lazy and cached: the **first** call runs the `initialize` handshake, sends `notifications/initialized`, then `tools/list`, and maps each descriptor into a `ToolContract`. Repeat calls return the cached array without re-handshaking. For each remote tool:

1. its JSON-Schema `inputSchema` is wrapped as a Standard Schema via `jsonSchemaToStandard` (see below);
2. `execute` issues `tools/call` honoring `ctx.signal` (cooperative abort) and the configured `timeoutMs`, then unwraps the result content (a single JSON text block is parsed back into an object);
3. an MCP `isError` result is thrown so the surrounding `tool()` wraps it as a `ToolExecutionError` — the agent reads it as `{ error }` data and self-corrects.

### Errors

Connection / handshake failures surface **at agent-construction time** because the example `await`s `github.tools()` — you see them then, not mid-run. A `tools/call` failure raised mid-run is wrapped by `tool()` and reaches the model as data. Branch on `McpTransportError.type`:

```ts
import { McpTransportError } from "@warlock.js/ai-tools";

try {
  await github.tools();
} catch (error) {
  if (error instanceof McpTransportError && error.type === "connect") {
    // the child failed to spawn, the endpoint was unreachable, or the handshake failed
  }
}
```

`McpTransportError.type`: `"connect"` | `"protocol"` | `"timeout"` | `"closed"` (plus an optional `.method` naming the in-flight JSON-RPC method).

## Direction B — expose a Warlock primitive AS an MCP server

`ai.mcp.serve(source, options)` turns a local set of `ToolContract`s into a Model Context Protocol server — so Cursor, Claude Desktop, or any MCP client can call your Warlock tools / agent over the wire.

```ts
const server = ai.mcp.serve(
  [ai.tools.calculator(), ai.tools.dateTime()],
  { name: "warlock-utils", transport: { type: "stdio" } },
);

await server.start();
// ...later, on teardown:
await server.stop();
```

### The `source` — array or anything with `tools()`

```ts
// A literal array of contracts:
ai.mcp.serve([calc, dt], { name: "utils" });

// Anything that can enumerate its ToolContracts — e.g. a workspace:
ai.mcp.serve({ tools: () => ws.tools.all() }, { name: "acme-workspace" });
```

The tools are snapshotted at construction (`source.tools()` is called once), so a stable surface is advertised for the life of the server.

### Serve options

```ts
ai.mcp.serve(source, {
  name: "warlock-utils",          // advertised in the initialize response (required)
  version: "1.0.0",               // default: the package version
  transport: { type: "stdio" },   // default: stdio
  schemaTarget: "draft-2020-12",  // JSON-Schema dialect for each tool's inputSchema
});
```

- **`schemaTarget`** defaults to `"draft-2020-12"` — a neutral MCP draft, deliberately overriding `extractJsonSchema`'s own `"openai-strict"` default. Set it to match a consuming client's expectation.

### How the protocol maps

- **`initialize`** → advertises `{ name, version }` and `capabilities: { tools: {} }`.
- **`tools/list`** → one descriptor per contract; each tool's `inputSchema` is produced by `extractJsonSchema(contract.input, { target: schemaTarget })`.
- **`tools/call`** → routes to the named contract's `invoke()` and maps the **never-throwing** result: `data` becomes a `{ type: "text" }` content block (a string is sent verbatim, anything else is JSON-stringified), and `error` becomes an `isError: true` result. So a failing tool surfaces as a normal MCP tool error — the server never crashes on it. An unknown tool name answers with a JSON-RPC error.

### Transport — stdio is auto-pumped; HTTP is host-owned

```ts
{ type: "stdio" }            // default — reads JSON-RPC lines from process.stdin, writes to stdout
{ type: "http", port: 8080 } // accepted in options, but start() does NOT bind a socket
```

`start()` over `stdio` wires a `node:readline` line reader on `process.stdin` and writes one-line JSON-RPC responses to `process.stdout` (notifications without an `id` are ignored). **Serving over HTTP is left to a server you own** — `start()` rejects an `http` transport. For that path, drive the pure protocol core yourself with `createServeHandler`:

```ts
import { createServeHandler } from "@warlock.js/ai-tools";

const handler = createServeHandler([calc, dt], { name: "warlock-utils" });

// In your own HTTP handler:
const response = await handler.handle(jsonRpcRequest); // request → response, no I/O
```

`createServeHandler` is also the cleanest seam for unit tests: feed it a JSON-RPC request, assert the response — no real transport needed.

## The JSON-Schema ↔ Standard-Schema bridge

MCP describes a tool's arguments with a **JSON Schema**, but Warlock's `ToolContract` validates input with a **Standard Schema**. `jsonSchemaToStandard` bridges the two and runs at both boundaries:

- **Consuming (A)** — each remote tool's JSON-Schema `inputSchema` is wrapped into a Standard Schema so the adapted contract validates calls locally.
- **Publishing (B)** — each contract's Standard Schema is projected to JSON Schema via `extractJsonSchema(contract.input, { target: schemaTarget })` for `tools/list`.

```ts
import { jsonSchemaToStandard } from "@warlock.js/ai-tools";

const schema = jsonSchemaToStandard({
  type: "object",
  properties: { query: { type: "string" } },
  required: ["query"],
});
```

The conversion is **Ajv-backed** — `ajv` is an optional peer needed only on the consuming side.

## `type`, never `kind`

MCP's wire vocabulary uses `kind` in some content / capability descriptors. The client translates any inbound `kind` to `type` when normalizing content blocks, and the server only ever emits `type` — so every discriminator the agent (or a consuming client) sees is `type`.

## Optional peers

The MCP client lazily imports `@modelcontextprotocol/sdk` (the protocol SDK) and `ajv` (runtime JSON-Schema validation) — both optional peers. A missing one surfaces a curated `npm install` string at first use, never a raw module-resolution crash at import time. The stdio transport itself needs no dependency.

## See also

- [Use AI tools](../the-basics/use-ai-tools) — the built-in web / HTTP / calculator / date-time belt you can consume or expose.
- [Use a workspace](./use-workspace) — a workspace whose `tools.all()` is a natural `serve` source.
- [Run agent](../the-basics/run-agent) — running the agent that consumes the adapted tools.

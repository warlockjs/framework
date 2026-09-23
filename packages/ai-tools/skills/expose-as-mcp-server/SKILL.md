---
name: expose-as-mcp-server
description: "Expose tools AS an MCP server (Direction B) in @warlock.js/ai-tools; use when you need to expose as mcp server."
---

# Expose tools AS an MCP server (Direction B)

`ai.mcp.serve(source, options)` turns a local set of `ToolContract`s into a Model Context Protocol server — so Cursor, Claude Desktop, or any MCP client can call your warlock tools / agent over the wire.

```ts
import "@warlock.js/ai-tools";
import { ai } from "@warlock.js/ai";

const server = ai.mcp.serve(
  [ai.tools.calculator(), ai.tools.dateTime()],
  { name: "warlock-utils", transport: { type: "stdio" } },
);

await server.start();
// ...later, on teardown:
await server.stop();
```

## The `source` — array or anything with `tools()`

```ts
// A literal array of contracts:
ai.mcp.serve([calc, dt], { name: "utils" });

// Anything that can enumerate its ToolContracts — e.g. a workspace:
ai.mcp.serve({ tools: () => ws.tools.all() }, { name: "acme-workspace" });
```

The tools are snapshotted at construction (`source.tools()` is called once), so a stable surface is advertised for the life of the server.

## Serve options

```ts
ai.mcp.serve(source, {
  name: "warlock-utils",          // advertised in the initialize response (required)
  version: "1.0.0",               // default: the package version
  transport: { type: "stdio" },   // default: stdio
  schemaTarget: "draft-2020-12",  // JSON-Schema dialect for each tool's inputSchema
});
```

- **`schemaTarget`** defaults to `"draft-2020-12"` — a neutral MCP draft, deliberately overriding `extractJsonSchema`'s own `"openai-strict"` default. Set it to match a consuming client's expectation.

## How the protocol maps

- **`initialize`** → advertises `{ name, version }` and `capabilities: { tools: {} }`.
- **`tools/list`** → one descriptor per contract; each tool's `inputSchema` is produced by `extractJsonSchema(contract.input, { target: schemaTarget })`.
- **`tools/call`** → routes to the named contract's `invoke()` and maps the **never-throwing** result: `data` becomes a `{ type: "text" }` content block (a string is sent verbatim, anything else is JSON-stringified), and `error` becomes an `isError: true` result. So a failing tool surfaces as a normal MCP tool error — the server never crashes on it. An unknown tool name answers with a JSON-RPC error.

Everything the server emits uses `type`, never `kind`.

## Transport — stdio is auto-pumped; HTTP is host-owned

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

## Errors

`McpTransportError` covers serve-side failures (`type: "connect"` when `start()` is asked to bind an unsupported transport; `type: "protocol"` for a malformed `tools/call` or an unknown tool name). Tool-level failures are *not* errors here — they come back as `isError: true` results, exactly as MCP expects.

## See also

- [`@warlock.js/ai-tools/connect-mcp-server/SKILL.md`](@warlock.js/ai-tools/connect-mcp-server/SKILL.md) — the reverse direction: consume an external MCP server's tools.
- [`@warlock.js/ai-tools/use-web-and-http-tools/SKILL.md`](@warlock.js/ai-tools/use-web-and-http-tools/SKILL.md) — the built-in tools you might expose.
- [`@warlock.js/ai-workspace/use-a-workspace/SKILL.md`](@warlock.js/ai-workspace/use-a-workspace/SKILL.md) — a workspace whose `tools.all()` is a natural `serve` source.

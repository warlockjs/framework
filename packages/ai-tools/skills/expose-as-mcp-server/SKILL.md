---
name: expose-as-mcp-server
description: 'Expose a @warlock.js/ai agent / supervisor / orchestrator (or a raw ToolContract[], or named tool groups) AS a Model Context Protocol (MCP) server other clients consume (Direction B) with `ai.mcp.serve(source, options)` — over stdio or authenticated Streamable HTTP. Triggers: `ai.mcp.serve(`, `serve(`, `createServeHandler`, `McpServer`, `McpServeOptions`, `McpServeSource`, `McpServeTransport`, `McpHttpServeTransport`, `McpHttpAuth`, `McpServeError`, `server.start()`, `server.stop()`, `{ url, close }`, `{ type: "http", host, port, path, auth }`, `bearer`, `authorize`, `allowedOrigins`, `maxBodyBytes`, `prefixToolNames`, `groups`, `resources`, `prompts`, `ctx.request.headers`, `schemaTarget`, `tools/list`, `tools/call`, `{ type: "stdio" }`; ''expose my agent as an MCP server'', ''serve my tools over HTTP'', ''give each agent session its own MCP endpoint'', ''protect my MCP server with a token'', ''publish my tools to Cursor/Claude Desktop'', ''serve MCP resources or prompts'', ''tool name collision''; typical import `import "@warlock.js/ai-tools"; import { ai } from "@warlock.js/ai"`. Skip: CONSUMING an external MCP server (the reverse direction) — the `connect-mcp-server` topic; the built-in web/HTTP/calc/date tools — the `use-web-and-http-tools` topic.'
---

# Expose tools AS an MCP server (Direction B)

`ai.mcp.serve(source, options)` turns a local set of `ToolContract`s into a Model Context Protocol server — so Cursor, Claude Desktop, a coding CLI, or any MCP client can call your warlock tools / agent. Transports: **stdio** (default) and MCP **Streamable HTTP**.

## Serve over HTTP with a per-session token

```ts
import { randomBytes } from "node:crypto";
import "@warlock.js/ai-tools";
import { ai } from "@warlock.js/ai";

const token = randomBytes(32).toString("hex");

const server = ai.mcp.serve([ai.tools.calculator(), ai.tools.dateTime()], {
  name: "session-tools",
  transport: { type: "http", auth: { bearer: token } },
});

const { url, close } = await server.start();
// url → "http://127.0.0.1:<free port>/mcp" — hand url + token to the MCP client

await close(); // drains in-flight calls, then frees the port
```

Defaults: `host: "127.0.0.1"`, `port: 0` (free ephemeral port), `path: "/mcp"`. `start()` resolves `{ url, close }` once bound.

## Serve over stdio

```ts
import "@warlock.js/ai-tools";
import { ai } from "@warlock.js/ai";

const server = ai.mcp.serve([ai.tools.calculator()], {
  name: "warlock-utils",
  transport: { type: "stdio" },
});

await server.start(); // reads JSON-RPC lines from stdin, answers on stdout
// on teardown:
await server.stop();
```

## HTTP options and security rules

```ts
transport: {
  type: "http",
  host: "127.0.0.1",           // non-loopback (e.g. "0.0.0.0") REQUIRES auth — start() throws otherwise
  port: 0,
  path: "/mcp",
  auth: {
    bearer: ["current-token", "previous-token"], // constant-time compare; several = rotation
    authorize: async (request) => sessions.has(request.headers["x-session-id"] ?? ""), // optional hook
  },
  allowedOrigins: ["https://app.example.com"], // besides loopback origins
  allowedHosts: ["mcp.internal"],              // extra Host names while on loopback
  maxBodyBytes: 1_048_576,                     // larger → 413
  drainTimeoutMs: 5_000,                       // close() then aborts ctx.signal
}
```

- With `bearer` and `authorize` both set, a request must pass both. A throwing hook denies. Failures → `401`.
- A foreign or `null` `Origin` → `403` (DNS-rebinding guard from the MCP spec). Requests without `Origin` pass.
- On loopback, a `Host` other than `localhost` / `127.0.0.1` / `[::1]` (or `allowedHosts`) → `403`.
- Stateless: no session id; `GET` / `DELETE` → `405`; batches → `400`; unsupported `MCP-Protocol-Version` → `400`.
- Plain HTTP: put TLS in front before exposing beyond the machine.

## Tools read request headers from `ctx.request`

```ts
import "@warlock.js/ai-tools";
import { ai, type ToolContract } from "@warlock.js/ai";

const whoami: ToolContract = ai.tool({
  name: "whoami",
  description: "Report the calling tenant",
  execute: async (_input: unknown, ctx) => ({
    tenant: ctx?.request?.headers["x-tenant-id"] ?? "unknown",
  }),
});

const { url, close } = await ai.mcp
  .serve([whoami], { name: "tenant-tools", transport: { type: "http" } })
  .start();
```

Header names are lower-cased; every client header is present (including `authorization`). Over stdio `ctx.request` is absent. Nothing on `ctx.request` reaches the model.

## Sources and tool-name collisions

```ts
ai.mcp.serve([calc, dt], { name: "utils" }); // literal array
ai.mcp.serve({ tools: () => ws.tools.all() }, { name: "workspace" }); // anything with tools()
ai.mcp.serve(
  { groups: { prod: [search], staging: [search] } },
  {
    name: "search",
    prefixToolNames: true, // → prod_search, staging_search; or (group, name) => `${group}.${name}`
  },
);
```

Duplicate exposed names throw `McpServeError` (`type: "collision"`) **when `serve()` is called**. `prefixToolNames` on an ungrouped source throws `type: "config"`.

## Resources and prompts (optional)

```ts
ai.mcp.serve(tools, {
  name: "handbook",
  resources: [
    {
      uri: "docs://handbook",
      name: "handbook",
      mimeType: "text/markdown",
      read: () => "# Handbook",
    },
  ],
  prompts: [
    {
      name: "review",
      arguments: [{ name: "diff", required: true }],
      get: (args) => `Review this diff:\n${args.diff ?? ""}`, // string → one user message
    },
  ],
});
```

`read()` returns a string (text) or `Uint8Array` (base64 blob). `get()` returns a string or `McpPromptMessage[]`. Unknown resource → `-32002`; unknown prompt / missing required argument → `-32602`.

## How the protocol maps

- **`initialize`** → `{ name, version }`, capabilities `tools` (+ `resources` / `prompts` when configured); protocol version negotiated from `SUPPORTED_PROTOCOL_VERSIONS` (`2025-11-25`, `2025-06-18`, `2025-03-26`).
- **`tools/list`** → `inputSchema` via `extractJsonSchema(contract.input, { target: schemaTarget })` (default `"draft-2020-12"`).
- **`tools/call`** → `invoke()`; `data` → text block (JSON-stringified unless a string), `error` → `isError: true`. Unknown tool → JSON-RPC error.
- **`ping`** → `{}`.

## Drive the protocol yourself (tests, custom servers)

```ts
import { createServeHandler } from "@warlock.js/ai-tools";
import { ai } from "@warlock.js/ai";

const handler = createServeHandler([ai.tools.calculator()], { name: "utils" });

const response = await handler.handle(
  { jsonrpc: "2.0", id: 1, method: "tools/list" },
  { request: { method: "POST", path: "/mcp", headers: { "x-tenant-id": "acme" } } },
);
```

Mounting it in your own server means you own Origin validation, auth and body limits.

## Errors

`McpServeError.type`: `"collision"` (from `serve()`), `"config"` (unsafe/invalid options, from `start()`), `"listen"` (bind failed). Bad requests never throw — they get an HTTP status or JSON-RPC error; failing tools return `isError: true`.

## See also

- The `connect-mcp-server` topic — the reverse direction: consume an external MCP server's tools.
- The `use-web-and-http-tools` topic — the built-in tools you might expose.
- The `use-a-workspace` topic of the `warlock-js-ai-workspace` skill — a workspace whose `tools.all()` is a natural `serve` source.

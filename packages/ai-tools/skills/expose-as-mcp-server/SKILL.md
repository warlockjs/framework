---
name: expose-as-mcp-server
description: 'Expose a @warlock.js/ai agent / supervisor / orchestrator (or a raw ToolContract[], or named tool groups) AS a Model Context Protocol (MCP) server other clients consume (Direction B) with `ai.mcp.serve(source, options)` — over stdio or authenticated Streamable HTTP. Triggers: `ai.mcp.serve(`, `serve(`, `createServeHandler`, `McpServer`, `McpServeOptions`, `McpServeSource`, `McpServeTransport`, `McpHttpServeTransport`, `McpHttpAuth`, `McpServeError`, `server.start()`, `server.stop()`, `{ url, close }`, `{ type: "http", host, port, path, auth }`, `bearer`, `authorize`, `authenticate`, `beforeCall`, `requestId`, `principal`, `notifications/cancelled`, `allowedOrigins`, `maxBodyBytes`, `prefixToolNames`, `groups`, `resources`, `prompts`, `ctx.request.headers`, `schemaTarget`, `tools/list`, `tools/call`, `{ type: "stdio" }`; ''expose my agent as an MCP server'', ''serve my tools over HTTP'', ''give each agent session its own MCP endpoint'', ''protect my MCP server with a token'', ''publish my tools to Cursor/Claude Desktop'', ''serve MCP resources or prompts'', ''tool name collision''; typical import `import "@warlock.js/ai-tools"; import { ai } from "@warlock.js/ai"`. Skip: CONSUMING an external MCP server (the reverse direction) — the `connect-mcp-server` topic; the built-in web/HTTP/calc/date tools — the `use-web-and-http-tools` topic.'
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

- Checks run in order: `bearer`, `authorize`, `authenticate`; every configured check must pass. A failed check skips later hooks. `authenticate` alone satisfies the non-loopback auth requirement. Host/Origin checks run first. A throwing authentication hook denies. Failures → `401`; bearer or authenticate failures include a Bearer `WWW-Authenticate` challenge.
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

## Authenticated context, policy and cancellation

```ts
import { ai } from "@warlock.js/ai";
import "@warlock.js/ai-tools";
import type { McpHttpRequestInfo, McpCallRefusal } from "@warlock.js/ai-tools";

declare function findMember(
  request: McpHttpRequestInfo,
): Promise<{ id: string; canCall: boolean } | undefined>;
const denied: McpCallRefusal = {
  isError: true,
  content: [{ type: "text", text: "Member cannot call tools" }],
  _meta: { policy: "membership" },
};
const identity = ai.tool({
  name: "identity",
  description: "Report the authenticated caller and request id",
  execute: async (_input: unknown, ctx) => {
    ctx?.signal?.throwIfAborted();
    return { requestId: ctx?.requestId, principal: ctx?.principal };
  },
});

const server = ai.mcp.serve([identity], {
  name: "member-tools",
  transport: { type: "http", auth: { authenticate: findMember } },
  beforeCall: async (context, tool, input) => {
    const member = context.principal; // unknown — narrow before use
    if (
      typeof member !== "object" ||
      member === null ||
      !("canCall" in member) ||
      member.canCall !== true
    ) {
      return denied;
    }
    // context.requestId: JSON-RPC id; tool: original ToolContract;
    // input: validated data, treated as read-only.
  },
});
```

- `authenticate(request)` may be synchronous or async. `undefined` or a thrown error → `401` with `WWW-Authenticate: Bearer realm="mcp"`; every other value becomes `context.principal` and `ctx.principal`. Secrets in thrown auth errors are not exposed.
- `beforeCall(context, tool, input)` runs after schema validation. Return nothing to allow; return `McpCallRefusal` (`isError: true`) to send native content/metadata unchanged, independent of result mode. Throw → JSON-RPC `-32602`. Invalid refusals → `-32603`. Invalid input skips policy. The boundary validates before policy and `invoke` keeps its own validation, so schemas must be deterministic and policy input read-only.
- Stdio identity: `transport: { type: "stdio", principal: { id: "local" } }` or `transport: { type: "stdio", principalProvider: async (context) => ({ id: "local", requestId: context.requestId }) }`. The provider runs per request, takes precedence over static principal, and receives the request id and abort signal. A provider throw → JSON-RPC internal error. No HTTP request metadata exists over stdio.
- Public types: `McpBeforeCall`, `McpCallRefusal`, `McpServeToolContext`, `McpStdioServeTransport`; `ToolContext` in `@warlock.js/ai` adds optional `requestId` and `principal`.

[Cancellation (MCP 2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation): send `{ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 42, reason: "Caller cancelled" } }`. The matching signal aborts; no JSON-RPC response is sent even if the tool later returns or throws. Unknown/completed/malformed ids are ignored; `initialize` cannot be cancelled. String and numeric ids are distinct; calls sharing an in-flight id still execute, but ambiguous cancellation in one scope is ignored.

HTTP cancellation POSTs must repeat caller credentials and application headers (`Authorization`, `Cookie`, tenant/custom auth headers), from the same remote address. Transport headers such as content length, accept, protocol version and connection may differ. Different credentials can reuse ids safely. Clients sharing credential/application headers must use unique in-flight ids for cancellation to identify a call. Notifications get `202`; a cancelled HTTP call ends with `202`, no JSON-RPC body, when its handler settles. Stdio scopes cancellation to the connection. HTTP disconnect, stdio EOF/close/stop, or HTTP shutdown after the drain timeout also abort tools. Pass `ctx.signal` into cancellable work.

## Return native MCP results

Default results become one text block, even when an object resembles an MCP result. Return the exported `mcpResult(...)` helper to preserve native content blocks, `isError`, `structuredContent` and `_meta` over stdio or HTTP:

```ts
import { mcpResult } from "@warlock.js/ai-tools";
import { ai } from "@warlock.js/ai";

const count = ai.tool({
  name: "count",
  description: "Return a structured count",
  meta: {
    outputSchema: {
      type: "object",
      properties: { count: { type: "number" } },
      required: ["count"],
    },
  },
  execute: async (_input: unknown, ctx) =>
    mcpResult({
      content: [{ type: "text", text: '{"count":2}' }],
      structuredContent: { count: 2 },
      _meta: { tenant: ctx?.request?.headers["x-tenant-id"] ?? "unknown" },
    }),
});

ai.mcp.serve([count], { name: "counts" });
```

The helper returns a branded `McpNativeResult` wrapper. The serving boundary validates and unwraps it without altering its payload. `isError: true` is sent as-is; thrown tool errors retain the existing mapping.

For tools that already return native objects, opt in at the server or tool level:

```ts
const nativeTool = ai.tool({
  name: "native-result",
  description: "Return a native result",
  meta: { mcpResults: "native" }, // this tool opts in even on a default server
  execute: async () => ({ content: [{ type: "text", text: "fixture" }], isError: true }),
});

ai.mcp.serve([nativeTool], { name: "native-tools", results: "native" });
// On a native-mode server, meta: { mcpResults: "text" } disables detection for a tool.
// Explicit mcpResult(...) returns always opt in, regardless of the detection setting.
```

Native mode detects objects containing any of `content`, `isError`, `structuredContent` or `_meta`; other values keep text serialization. `content` must be an array of valid MCP text/image/audio/resource-link/embedded-resource blocks. Optional `isError` must be boolean; `structuredContent` and `_meta` must be JSON objects. Invalid or non-JSON native payloads answer a JSON-RPC internal error (`-32603`), including malformed helper payloads.

`meta.outputSchema` is emitted as `outputSchema` in `tools/list`; `structuredContent` passes through unchanged. Tool authors own schema conformity. Follow the [MCP 2025-11-25 tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content): also include serialized structured output in a text block for compatibility.

Request identity is unchanged: native tools receive each HTTP call's headers and remote address on `ctx.request`, plus `ctx.signal`. Over stdio, `ctx.request` is absent. Returning a native result does not automatically expose request metadata; the tool controls its response.

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
- **`tools/call`** → `invoke()`; default `data` → text block (JSON-stringified unless a string), opted-in native results → validated passthrough, `error` → `isError: true`. Unknown tool → JSON-RPC error.
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

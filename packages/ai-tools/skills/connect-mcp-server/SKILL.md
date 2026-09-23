---
name: connect-mcp-server
description: "Connect to an external MCP server (Direction A) in @warlock.js/ai-tools; use when you need to connect mcp server."
---

# Connect to an external MCP server (Direction A)

`ai.mcp(server, options?)` opens a connection to any Model Context Protocol server, lists its tools, and adapts each one into a native `ToolContract` — so a remote MCP tool is indistinguishable from a local one and drops straight into `ai.agent({ tools: [...] })`.

```ts
import "@warlock.js/ai-tools";
import { ai } from "@warlock.js/ai";

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

## The transport — `stdio` or `http`

The `server` argument is discriminated by `type`:

```ts
// Spawn a child process and speak JSON-RPC over its stdin/stdout.
// Uses node:child_process + node:readline — NO dependency.
{ type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "…" } }

// Streamable HTTP against an endpoint.
{ type: "http", url: "https://mcp.example.com/rpc", headers: { authorization: "Bearer …" } }
```

> **stdio env is not inherited.** When you pass `env`, only those keys reach the child — pass what the server needs (e.g. its API token) explicitly.

## Client options

```ts
ai.mcp(server, {
  namePrefix: "github.",                       // prepended to every remote tool name
  filter: (name) => name.startsWith("issues_"),// only adapt tools whose name passes
  timeoutMs: 30_000,                           // per tools/call deadline (default 30s)
});
```

- **`namePrefix`** is the collision mitigation — there is **no runtime tool-name collision guard** (the agent resolves a tool by first name match), so the author owns uniqueness. Prefix remote tools to keep them distinct from local ones.
- **`filter`** receives each tool's *unprefixed* name; return `false` to drop it.

## What `tools()` does

`client.tools()` is lazy and cached: the **first** call runs the `initialize` handshake, sends `notifications/initialized`, then `tools/list`, and maps each descriptor into a `ToolContract`. Repeat calls return the cached array without re-handshaking.

For each remote tool:
1. its JSON-Schema `inputSchema` is wrapped as a Standard Schema via `jsonSchemaToStandard` (Ajv-backed — `ajv` is an optional peer needed only for the client);
2. `execute` issues `tools/call` honoring `ctx.signal` (cooperative abort) and the configured `timeoutMs`, then unwraps the result content (a single JSON text block is parsed back into an object);
3. an MCP `isError` result is thrown so the surrounding `tool()` wraps it as a `ToolExecutionError` — the agent reads it as `{ error }` data and self-corrects.

## `type`, never `kind`

MCP's wire vocabulary uses `kind` in some content/capability descriptors. The client translates any inbound `kind` to `type` when normalizing content blocks, so a value a tool returns never carries MCP's `kind` — every discriminator the agent sees is `type`.

## Errors

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

## Optional peers

The MCP client lazily imports `@modelcontextprotocol/sdk` (the protocol SDK) and `ajv` (runtime JSON-Schema validation) — both optional peers. A missing one surfaces a curated `npm install` string at first use, never a raw module-resolution crash at import time. The stdio transport itself needs no dependency.

## See also

- [`@warlock.js/ai-tools/expose-as-mcp-server/SKILL.md`](@warlock.js/ai-tools/expose-as-mcp-server/SKILL.md) — the reverse direction: publish a local primitive AS an MCP server.
- [`@warlock.js/ai-tools/use-web-and-http-tools/SKILL.md`](@warlock.js/ai-tools/use-web-and-http-tools/SKILL.md) — the built-in web / HTTP / calculator / date-time belt.
- [`@warlock.js/ai/run-ai-agent/SKILL.md`](@warlock.js/ai/run-ai-agent/SKILL.md) — running the agent that consumes the adapted tools.

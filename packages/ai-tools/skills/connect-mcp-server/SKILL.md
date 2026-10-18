---
name: connect-mcp-server
description: 'Connect a @warlock.js/ai agent to an external Model Context Protocol (MCP) server and adapt its tools as native agent tools (Direction A) with `ai.mcp(server)`. Triggers: `signal`, `ai.mcp(`, `ai.mcp.serve` (the other direction), `mcp(`, `McpClient`, `McpClientOptions`, `McpTransport`, `client.tools()`, `client.close()`, `namePrefix`, `filter`, `McpTransportError`, `{ type: "stdio" }`, `{ type: "http" }`, `tools/list`, `tools/call`, `jsonSchemaToStandard`, `@modelcontextprotocol/sdk`, `ajv`; ''consume an MCP server'', ''use an external MCP server''s tools in my agent'', ''connect to the GitHub/Slack/Filesystem MCP server'', ''adapt MCP tools as agent tools'', ''bridge my agent to the MCP ecosystem'', ''run an MCP server over stdio/http''; typical import `import "@warlock.js/ai-tools"; import { ai } from "@warlock.js/ai"`. Skip: exposing YOUR agent/tools AS an MCP server (the reverse direction) — the `expose-as-mcp-server` topic; the built-in web/HTTP/calc/date tools — the `use-web-and-http-tools` topic.'
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
  namePrefix: "github.", // prepended to every remote tool name
  filter: (name) => name.startsWith("issues_"), // only adapt tools whose name passes
  timeoutMs: 30_000, // per tools/call deadline (default 30s)
  signal: controller.signal, // optional: close the client when this aborts
});
```

- **`signal`** binds the client's lifetime to a run: on abort the client closes its transport (kills the stdio child / ends the HTTP session), in-flight requests reject, and later `tools()` / tool calls fail with `McpTransportError` type `"closed"` without sending anything. Each `tools/call` honors it together with the per-call `ctx.signal` — whichever aborts first. `close()` stays idempotent.

```ts
import "@warlock.js/ai-tools";
import { ai, type ModelContract } from "@warlock.js/ai";

export async function triage(model: ModelContract): Promise<void> {
  const controller = new AbortController();
  const github = ai.mcp(
    { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
    { namePrefix: "github.", signal: controller.signal },
  );

  const agent = ai.agent({ model, tools: [...(await github.tools())] });
  await agent.execute("Triage the open issues", { signal: controller.signal });

  controller.abort(); // ends the run AND shuts the MCP server down
}
```

- **`namePrefix`** is the collision mitigation — there is **no runtime tool-name collision guard** (the agent resolves a tool by first name match), so the author owns uniqueness. Prefix remote tools to keep them distinct from local ones.
- **`filter`** receives each tool's _unprefixed_ name; return `false` to drop it.

## What `tools()` does

`client.tools()` is lazy and cached: the **first** call runs the `initialize` handshake, sends `notifications/initialized`, then `tools/list`, and maps each descriptor into a `ToolContract`. Repeat calls return the cached array without re-handshaking.

For each remote tool:

1. its JSON-Schema `inputSchema` is wrapped as a Standard Schema via `jsonSchemaToStandard` (Ajv-backed — `ajv` is an optional peer needed only for the client);
2. `execute` issues `tools/call` honoring `ctx.signal` (cooperative abort) and the configured `timeoutMs`, then unwraps the result content (a single JSON text block is parsed back into an object);
3. an MCP `isError` result is thrown so the surrounding `tool()` wraps it as a `ToolExecutionError` — the agent reads it as `{ error }` data and self-corrects.

### Selecting one discovered tool

When selecting one discovered tool, guard the array result before invoking it.
A server may advertise no tools, and `noUncheckedIndexedAccess` reflects that:

```ts
import type { McpClient } from "@warlock.js/ai-tools";

export async function invokeFirst(client: McpClient, input: unknown) {
  const [contract] = await client.tools();
  if (!contract) throw new Error("The MCP server advertised no tools");
  return contract.invoke(input);
}
```

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

The MCP client does not use `@modelcontextprotocol/sdk`: it speaks MCP's JSON-RPC itself, over a spawned child process (`node:child_process`) for `{ type: "stdio" }` and the global `fetch` for `{ type: "http" }`, so neither transport needs a dependency. Its only optional peer is `ajv`, which validates tool-call input against each MCP tool's `inputSchema`. It is imported lazily the first time a schema is checked; when it is missing, the call fails validation with a curated `npm install ajv` message instead of crashing at import time. A tool with no `inputSchema` needs no validator.

## See also

- The `expose-as-mcp-server` topic — the reverse direction: publish a local primitive AS an MCP server.
- The `use-web-and-http-tools` topic — the built-in web / HTTP / calculator / date-time belt.
- The `run-ai-agent` topic of the `warlock-js-ai` skill — running the agent that consumes the adapted tools.

# @warlock.js/ai-tools

> Ready-made agent tools (web search, fetch, HTTP, calculator, date-time) + an MCP client/server for `@warlock.js/ai`.

A batteries-included **tool belt** for [`@warlock.js/ai`](https://github.com/warlockjs) agents plus a
Model Context Protocol (MCP) client and server — built entirely on the framework's vendor-neutral
`ai.tool()` seam, so every tool returns a `ToolContract` that drops straight into
`ai.agent({ tools: [...] })`. Importing the package registers the tools on the shared `ai` object,
so they are reached as `ai.tools.*` and `ai.mcp` per the `ai.`-namespace convention.

## What's in the belt

All five tools attach onto the shared `ai` object at import time under the `ai.tools.*` namespace
(via a `declare module "@warlock.js/ai"` augmentation), so a bare `import "@warlock.js/ai-tools"`
makes them available and statically typed.

| Tool                            | LLM-visible name | What it does                                                                                       |
| ------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| `ai.tools.webSearch(options)`   | `web_search`     | Web search via a chosen provider (`tavily` / `brave` / `serpapi`) — ranked title/URL/snippet hits. |
| `ai.tools.fetchUrl(options?)`   | `fetch_url`      | Fetch a URL → readability `text` (default), raw `html`, or `markdown`; host allowlist + byte cap.  |
| `ai.tools.http(options?)`       | `http_request`   | A guarded HTTP/REST client — method + host allowlists, `baseUrl` join, byte/timeout caps.          |
| `ai.tools.calculator(options?)` | `calculator`     | A SAFE arithmetic evaluator (shunting-yard; never `eval`/`Function`).                              |
| `ai.tools.dateTime(options?)`   | `date_time`      | `now` / `add` / `diff` / `format` over ISO-8601 instants, IANA time zones.                         |

## MCP — both directions

- **`ai.mcp(server, options?)`** — connect to an external MCP server and adapt each of its tools into
  a native `ToolContract` (Direction A: server → agent tools).
- **`ai.mcp.serve(source, options)`** — expose a warlock agent / supervisor / orchestrator (or a raw
  `ToolContract[]`) **as** an MCP server other clients consume (Direction B: primitive → server).

> There is **no SQL tool.** An LLM-driven SQL surface is sensitive and must be audited per app, so it
> is deliberately not part of this belt.

## Install

```bash
npm install @warlock.js/ai-tools
```

`@warlock.js/ai` is the only required runtime peer. Everything heavy — a search provider, the
readability scraper, the MCP SDK, and a JSON-Schema validator — is an **optional peer**, lazily
`import()`ed only when the relevant path runs; a missing one surfaces a curated `npm install` string
rather than crashing at import time. Beyond `@warlock.js/ai` the package uses only Node built-ins and
the global `fetch` (Node 18+). Import the package once for its side effect so the surface is
registered:

```ts
import "@warlock.js/ai-tools";
```

## Usage

### 1. An agent with web search + HTTP

Hand an agent the web tools and let it research, then hit an API — both bounded by a host allowlist.
A failing tool call comes back as `{ error }` _data_, so the agent self-corrects instead of crashing.

```ts
import "@warlock.js/ai-tools"; // registers ai.tools.* + ai.mcp on import
import { ai } from "@warlock.js/ai";

const agent = ai.agent({
  model: ai.openai.model({ name: "gpt-4o" }),
  systemPrompt: "Research with web_search, then call the API with http_request.",
  tools: [
    ai.tools.webSearch({ provider: "tavily" }), // TAVILY_API_KEY from env, or pass { apiKey }
    ai.tools.http({
      baseUrl: "https://api.github.com",
      allowHosts: ["api.github.com"],
      allowMethods: ["GET"],
      headers: { "user-agent": "warlock-agent" },
    }),
  ],
  maxTrips: 12,
});

await agent.execute("Find the latest @warlock.js release and summarize its notes.");
```

### 2. Consume an external MCP server

`ai.mcp(server)` connects to any MCP server, lists its tools, and adapts each into a `ToolContract`.
`await client.tools()` runs the handshake once and is cached; spread the result into `tools: [...]`.

```ts
import "@warlock.js/ai-tools";
import { ai } from "@warlock.js/ai";

const github = ai.mcp(
  { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
  { namePrefix: "github." }, // avoid colliding with local tool names
);

const dev = ai.agent({
  model: ai.openai.model({ name: "gpt-4o" }),
  systemPrompt: "Use the GitHub tools to triage issues.",
  tools: [...(await github.tools())],
  maxTrips: 20,
});

await dev.execute("List the open issues labeled 'bug' and propose a fix for the oldest.");

// On teardown:
await github.close();
```

### 3. Expose an agent's tools AS an MCP server

`ai.mcp.serve(source, options)` turns a local `ToolContract[]` (or anything with a `tools()` method)
into an MCP server. The default `stdio` transport is auto-pumped over `process.stdin`/`process.stdout`,
so Cursor / Claude Desktop / any MCP client can call these tools.

```ts
import "@warlock.js/ai-tools";

const server = ai.mcp.serve([ai.tools.calculator(), ai.tools.dateTime()], {
  name: "warlock-utils",
  transport: { type: "stdio" },
});

await server.start();
// ...later:
await server.stop();
```

## Errors flow as data, not throws

Every tool follows the framework's errors-as-data contract: a guardrail rejection or a failed call is
thrown inside the tool handler, caught by `tool()`, and surfaced in the returned `{ error }` field —
`invoke()` never throws. Each error class extends the `@warlock.js/ai` `AIError` base and carries a
`type` discriminator you can branch on:

```ts
import { HttpPolicyError } from "@warlock.js/ai-tools";

const http = ai.tools.http({ allowHosts: ["api.github.com"] });
const { error } = await http.invoke({ url: "https://evil.test" });

if (error instanceof HttpPolicyError && error.type === "host-not-allowed") {
  // rejected before any network call — an SSRF guardrail
}
```

- `WebToolError.type`: `"missing-peer"` | `"missing-key"` | `"denied-host"` | `"invalid-url"` | `"request-failed"`
- `HttpPolicyError.type`: `"method-not-allowed"` | `"host-not-allowed"` | `"invalid-url"`
- `CalculatorError.type`: `"syntax"` | `"divide-by-zero"` | `"overflow"`
- `DateTimeError.type`: `"invalid-input"` | `"invalid-unit"` | `"invalid-time-zone"` | `"unsupported-op"`
- `McpTransportError.type`: `"connect"` | `"protocol"` | `"timeout"` | `"closed"`

## Skills

Progressive-disclosure, per-task docs live under [`skills/`](./skills/README.md):

- [`use-web-and-http-tools/`](./skills/use-web-and-http-tools/SKILL.md) — wire `web_search`, `fetch_url`,
  `http_request`, `calculator`, and `date_time` into an agent under their guardrails.
- [`connect-mcp-server/`](./skills/connect-mcp-server/SKILL.md) — adapt an external MCP server's tools
  with `ai.mcp(server)` (Direction A).
- [`expose-as-mcp-server/`](./skills/expose-as-mcp-server/SKILL.md) — publish a local primitive AS an
  MCP server with `ai.mcp.serve(source)` (Direction B).

## License

MIT © Hassan Zohdy

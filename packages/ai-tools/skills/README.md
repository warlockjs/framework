# `@warlock.js/ai-tools` — skills index

Per-task skills. Cross-references name the topic ("the `<topic>` topic"), and for another package add its skill ("the `<topic>` topic of the `warlock-js-<pkg>` skill").

## Skills

### `use-web-and-http-tools`

Wire the five ready-made tools — `ai.tools.webSearch` (`web_search`), `ai.tools.fetchUrl` (`fetch_url`), `ai.tools.http` (`http_request`), `ai.tools.calculator` (`calculator`), and `ai.tools.dateTime` (`date_time`) — into an agent under their construction-time rails: a search provider + API-key fallback, readability extract modes, the host/method allowlists and byte/timeout caps (the SSRF guardrails), the safe shunting-yard calculator, and the millisecond-unit date-time ops. Covers the option vs per-call-input split, the typed `WebToolError` / `HttpPolicyError` / `CalculatorError` / `DateTimeError`, and the errors-as-data contract. Load when giving an agent web search, fetch/scrape, REST, calculator, or date tools.

### `connect-mcp-server`

Connect an agent to an external Model Context Protocol server with `ai.mcp(server, options?)` and adapt each of its tools into a native `ToolContract` (Direction A). Covers the stdio (`node:child_process`, no dep) vs Streamable HTTP transport, `namePrefix` / `filter` / `timeoutMs`, the lazy-and-cached `client.tools()` handshake + `tools/list`, the JSON-Schema→Standard-Schema adaptation (Ajv optional peer), the `kind`→`type` translation, and the `McpTransportError` surface. Load when consuming an MCP server's tools inside a warlock agent.

### `expose-as-mcp-server`

Expose a warlock agent / supervisor / orchestrator (or a raw `ToolContract[]`) AS an MCP server with `ai.mcp.serve(source, options)` (Direction B). Covers the `source` shapes (array or `tools()`), the `name` / `version` / `transport` / `schemaTarget` options, how `initialize` / `tools/list` / `tools/call` map (via `extractJsonSchema` and the never-throwing `invoke()`), the auto-pumped stdio transport vs host-owned HTTP, and the `createServeHandler` pure-protocol seam for HTTP wiring and tests. Load when publishing local tools to Cursor / Claude Desktop / any MCP client.

# Changelog — @warlock.js/ai-tools

All notable changes to `@warlock.js/ai-tools` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.5.0 - 2026-06-21

Initial release — a batteries-included tool belt + a Model Context Protocol client and server for `@warlock.js/ai`, built entirely on the framework's vendor-neutral `ai.tool()` seam.

### Added

- **Five ready-made agent tools, attached to the shared `ai` object under `ai.tools.*`** via a `declare module "@warlock.js/ai"` augmentation, so a bare `import "@warlock.js/ai-tools"` makes them available and statically typed. Each returns a `ToolContract` that drops straight into `ai.agent({ tools: [...] })`:
  - **`ai.tools.webSearch(options)`** (`web_search`) — web search via a chosen provider (`tavily` / `brave` / `serpapi`) over the global `fetch`; the API key falls back to `TAVILY_API_KEY` / `BRAVE_API_KEY` / `SERPAPI_API_KEY`; `maxResults` is clamped per call.
  - **`ai.tools.fetchUrl(options?)`** (`fetch_url`) — fetch a URL and return its content as readability-extracted `text` (default), raw `html`, or `markdown`, with a host allowlist (SSRF guardrail), a byte cap (`truncated` flag), and a request timeout.
  - **`ai.tools.http(options?)`** (`http_request`) — a guarded HTTP/REST client: method + host allowlists enforced before the network call, optional `baseUrl` join, static-header merge, byte cap, and timeout; JSON-parses a JSON response body.
  - **`ai.tools.calculator(options?)`** (`calculator`) — a SAFE arithmetic evaluator (`+ - * / % ^`, unary signs, parentheses, decimal/scientific literals) implemented with a shunting-yard pass — it never calls `eval`/`Function`.
  - **`ai.tools.dateTime(options?)`** (`date_time`) — clock/calendar operations: `now` / `add` / `diff` / `format` over ISO-8601 instants, with millisecond-based units and IANA time-zone rendering.
- **MCP client — `ai.mcp(server, options?)` (Direction A).** Connects to an external MCP server over a stdio (`node:child_process` + `node:readline`, no dependency) or Streamable HTTP transport, runs the `initialize` handshake + `tools/list`, and adapts each remote tool into a native `ToolContract` (its JSON Schema wrapped as a Standard Schema, `tools/call` as `execute`). Supports `namePrefix`, `filter`, and a per-call `timeoutMs`; an `isError` result surfaces as `{ error }` data.
- **MCP server — `ai.mcp.serve(source, options)` (Direction B).** Exposes a built agent / supervisor / orchestrator (or a raw `ToolContract[]`) AS an MCP server: `tools/list` emits each tool's `inputSchema` via `extractJsonSchema` at the configured `schemaTarget` (default `draft-2020-12`), and `tools/call` routes to `contract.invoke()`, mapping `data` to a text content block and `error` to an `isError: true` result. The stdio transport is auto-pumped over `process.stdin` / `process.stdout`; the pure protocol core is also exported as `createServeHandler` for a host's own HTTP wiring.
- **Typed error classes** — `WebToolError`, `HttpPolicyError`, `CalculatorError`, `DateTimeError`, and `McpTransportError`, each extending the `@warlock.js/ai` `AIError` base with a `type` discriminator. Every tool follows the errors-as-data contract: failures are thrown inside `execute`, wrapped by `tool()`, and reach the model as `{ error }` so the agent self-corrects instead of crashing the run.
- **Optional peers, lazily imported.** Heavy dependencies — a search provider (`@tavily/core`), the readability scraper (`@mozilla/readability` + `jsdom`), the MCP SDK (`@modelcontextprotocol/sdk`), and the JSON-Schema validator (`ajv`) — are optional peers, `import()`ed only when the relevant path runs, surfacing a curated `npm install` string when absent rather than crashing at import time. The only required runtime peer is `@warlock.js/ai`; everything else is Node built-ins + the global `fetch` (Node 18+).

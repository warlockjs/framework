# Changelog — @warlock.js/ai-tools

All notable changes to `@warlock.js/ai-tools` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.37.1

### Changed

- Peer and runtime dependencies on other `@warlock.js/*` packages are now published as the same-major range `^5.37.1` instead of the exact version. npm 10 could not step the family in an existing `package-lock.json` (`ERESOLVE` on the exact, cyclic peer pins). Every package still ships at the same version; `warlock check` (`WL8010`) reports an installed set that has drifted apart.

## 5.34.3 - 2026-10-20

### Changed

- Condensed the package agent skill description to at most 450 characters, with API names and package routing guidance.

## 5.34.2 - 2026-10-19

### Fixed

- Qualify custom-tool guidance as a topic of @warlock.js/ai, remove the redundant loose skill catalog, and include package orientation in LLM projections.

## 5.34.1 - 2026-10-19

### Added

- HTTP `transport.onAuthRefusal` customizes denied authentication responses for the MCP endpoint and side routes using typed safe context, 4xx/5xx statuses, allowlisted headers and JSON bodies. Host/Origin guards retain precedence, invalid or throwing hooks retain the default refusal, and handlers never run after a denial.

### Fixed

- Tools adapted from a remote MCP server now show the model their real input schema. `jsonSchemaToStandard` implements Standard JSON Schema (`~standard.jsonSchema`), so `extractJsonSchema` and every provider adapter read the server's `inputSchema` instead of falling back to a parameterless `{ type: "object" }`, which made models guess argument names and retry. Adapters receive copies of the schema; a tool without one advertises `{ type: "object", properties: {} }`.

## 5.34.0 - 2026-10-19

### Added

- `ai.mcp.serve` supports async `listFilter(context, tools)` for per-request discovery independent of callability, and `validateCallParams(context, params)` for application envelope policy before lookup, schema validation and call policy, over HTTP and stdio. Default handling of unknown fields and unsupported task metadata is unchanged.
- HTTP `transport.routes` adds exact method/path application routes beneath the MCP URL with shared authentication, principal/context, Host/Origin guards, body limits, disconnect signals and shutdown draining. Conflicting or invalid route configuration fails before binding.
- Export `McpError(code, message, data?)` and the new discovery, envelope and HTTP route contracts.

### Fixed

- `beforeCall` and envelope policy preserve a thrown `McpError`'s integer code, message and optional data, including official SDK errors, without a runtime SDK dependency. Other throws retain the existing invalid-params mapping.
- Extend the core `ai.tools` namespace on registration, preserving `catalogue` and `measure` while adding the ready-made factories. `AiToolsNamespace` remains re-exported for consumers.

## 5.33.0 - 2026-10-19

### Fixed

- Keep HTTP and MCP fixtures valid under strict indexed access, accept string JSON-RPC request IDs in serving tests, and replace stdin through its descriptor without pretending a stream is a terminal.

### Added

- MCP serving now exposes per-call `requestId`, authenticated `principal` and cancellation-aware signals over HTTP and stdio. HTTP `auth.authenticate` resolves principals alongside bearer/authorize checks; stdio accepts static or provider principals. `beforeCall` validates policy after input validation and can return a native error refusal or throw a JSON-RPC error. `notifications/cancelled` aborts only the matching caller/request and suppresses its response. New hook/context/refusal and stdio transport types are exported.

## 5.32.0 - 2026-10-18

### Changed

- Pin the package development compiler to TypeScript 7.0.2 and use explicit Node types and source roots with supported module resolution.

### Fixed

- Opted-in native MCP tool results preserve content blocks, `isError`, `structuredContent` and `_meta` over stdio and HTTP, including tools with an advertised output schema. Per-request headers and abort signals remain available to tools; default result serialization and thrown-tool error handling are unchanged.
- Malformed native results produce a JSON-RPC internal error instead of sending invalid MCP payloads.

### Added

- `mcpResult(...)` and its `McpNativeResult` type explicitly mark native tool results. `serve(..., { results: "native" })` enables detection for existing native-returning tools; `meta.mcpResults: "native" | "text"` overrides detection per tool.
- `meta.outputSchema` advertises structured tool output in `tools/list`; `McpToolCallResult` now includes `structuredContent` and `_meta`.

## 5.31.0 - 2026-10-18

### Added

- `ai.mcp(server, { signal })` binds the client to a run: when the signal aborts the client closes its transport, and later handshakes and tool calls fail with an `McpTransportError` of type `"closed"`. Every `tools/call` honors both the client signal and the per-call `ctx.signal`.
- `ai.tools.measure(tools, { model, mode })` — the `measureTools` helper from `@warlock.js/ai` — measures the input tokens a tool list costs per call.
- `ai.mcp.serve(source, { transport: { type: "http" } })` serves the MCP Streamable HTTP transport on `node:http` (no extra dependency). It binds `127.0.0.1` on a free port at `/mcp` by default (`host`, `port`, `path` override them), and `start()` resolves `{ url, close }`. `close()` stops accepting connections, waits up to `drainTimeoutMs` (default 5 s) for in-flight calls, then aborts their `ctx.signal` and frees the port. The endpoint is stateless: JSON responses, `202` for notifications, `405` for `GET` / `DELETE`, `400` for batches or an unsupported `MCP-Protocol-Version`.
- HTTP auth: `auth: { bearer }` accepts one token or a rotation list; `auth: { authorize(request) }` runs a custom check; with both set, a request must pass both. Failures get `401` before the body is read.
- Tools served over HTTP receive the inbound request on `ctx.request` (`headers`, `remoteAddress`), for per-user tokens, tenant headers or trace ids.
- Grouped sources: `serve({ groups: { name: tools } }, { prefixToolNames: true })` exposes `<group>_<tool>`; a function builds custom names.
- Optional MCP resources (`resources: [{ uri, name, read }]`) and prompts (`prompts: [{ name, arguments, get }]`), with their capabilities advertised only when configured. The server also answers `ping`.
- `McpServeError` (`type`: `"collision"`, `"config"`, `"listen"`), `SUPPORTED_PROTOCOL_VERSIONS`, and the `McpHttpServeTransport`, `McpHttpAuth`, `McpHttpRequestInfo`, `McpServeHandle`, `McpHttpServeHandle`, `McpServeResource`, `McpServePrompt`, `McpServeCallContext`, `McpToolSource`, `McpGroupedToolSource` types. `createServeHandler(...).handle(request, context?)` takes an optional call context.

### Changed

- `initialize` negotiates the protocol version: a client's requested version is echoed when supported (`2025-11-25`, `2025-06-18`, `2025-03-26`), otherwise the newest is offered. It previously always answered `2025-06-18`.
- `McpServer.start()` resolves a handle (`{ url?, close }`) instead of `void`. The http transport's `port` is optional.
- `@modelcontextprotocol/sdk` is no longer listed as an optional peer dependency. The MCP client never imported it: it speaks MCP's JSON-RPC itself over a child process (stdio) and `fetch` (http). The SDK is now a development dependency, used only by the interoperability test against the official client. The MCP docs, README and `connect-mcp-server` skill now say so, and name `ajv` as the client's only optional peer.

### Fixed

- The stdio transport of `ai.mcp.serve()` no longer crashes the process when a line is JSON but not a request object (`null`, a number, an array): it answers a JSON-RPC "Invalid Request" error (`-32600`, `id: null`). A failure while answering a line is answered as an internal error and can no longer become an unhandled rejection.

### Security

- The HTTP transport binds loopback by default and refuses to start on any non-loopback host without `auth` (`McpServeError`, `type: "config"`).
- Bearer tokens are compared with `crypto.timingSafeEqual` over SHA-256 digests, so neither content nor length leaks through timing; every configured token is checked. Empty tokens are refused, and an `authorize` hook that throws denies the request.
- `Origin` is validated on every request, per the MCP transport's DNS-rebinding guidance: loopback origins and `allowedOrigins` pass, others (including `null`) get `403`. While bound to loopback, a `Host` header other than `localhost`, `127.0.0.1`, `[::1]` or `allowedHosts` also gets `403`.
- Request bodies over `maxBodyBytes` (default 1 MiB) get `413` and the connection is closed.

### Upgrading

- **BREAKING:** `ai.mcp.serve()` throws `McpServeError` (`type: "collision"`) when two exposed tools share a name, and for duplicate resource URIs or prompt names. Previously both tools were listed and every call reached the last one. Rename one tool, or serve a grouped source with `prefixToolNames: true`.
- `serve(..., { transport: { type: "http" } }).start()` no longer rejects: it binds a real endpoint. Code that implemented `McpServer` itself must return a handle from `start()`.

## 5.29.0 - 2026-10-01

### Changed

- Skills refer to other topics by name instead of file paths, so cross-references keep working after `agent-kit` copies them into an app.

## 5.28.0 - 2026-10-01

### Changed

- `llms.txt` now lists every skill topic with its description (frontmatter in CRLF files was skipped).

## 5.22.0 - 2026-09-25

### Security

- Stdio MCP children receive only a minimal execution environment plus explicitly supplied variables.

## 5.20.0 - 2026-09-24

### Changed

- Added a package-level skill index and clearer discovery descriptions for grouped agent guidance.

## 5.19.0 - 2026-09-23

### Changed

- Refined package skill-discovery descriptions and regenerated the llms projections.

## 5.2.2

### Maintenance

- Restored the Warlock family to one exact, installable lockstep version.

## 4.16.0 - 2026-08-18

### Security

- **`fetch_url` and `http_request` now deny private-network targets by default and route through `@warlock.js/ai`'s hardened `guardedFetch` instead of a local host check.** Previously `allowHosts` was the _only_ SSRF guardrail and it was opt-in — a bare `ai.tools.fetchUrl()` / `ai.tools.http()` would fetch any `http(s)` URL the model supplied, including `http://169.254.169.254/latest/meta-data/...`, `localhost`, and RFC1918 addresses, and neither tool re-validated redirect targets, so even a configured allowlist could be 302'd into an internal endpoint. Both tools now issue every request through the core outbound policy, which by default refuses private / loopback / link-local / CGNAT / cloud-metadata addresses — resolving hostnames through DNS and checking every returned address, failing closed on resolution failure — and re-validates every redirect `Location` (scheme, allowlist, private-IP deny) before following it, with a hop cap and cross-origin credential-header stripping. Blocks surface as the existing typed errors (`WebToolError` `type: "denied-host"`, `HttpPolicyError` `type: "host-not-allowed"`), so agents still read them as `{ error }` data
- **New `allowPrivateNetwork` option (default `false`) on both tools** for the deliberate case of a tool that must call an internal service (e.g. a local dev server); `allowHosts` still works and now also constrains redirect targets

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.5.0 - 2026-07-01

Initial release — a batteries-included tool belt + a Model Context Protocol client and server for `@warlock.js/ai`, built entirely on the framework's vendor-neutral `ai.tool()` seam.

### Added

- **Five ready-made agent tools, attached to the shared `ai` object under `ai.tools.*`** via a `declare module "@warlock.js/ai"` augmentation, so a bare `import "@warlock.js/ai-tools"` makes them available and statically typed. Each returns a `ToolContract` that drops straight into `ai.agent({ tools: [...] })`:
  - **`ai.tools.webSearch(options)`** (`web_search`) — web search via a chosen provider (`tavily` / `brave` / `serpapi`) over the global `fetch`; the API key falls back to `TAVILY_API_KEY` / `BRAVE_API_KEY` / `SERPAPI_API_KEY`; `maxResults` is clamped per call.
  - **`ai.tools.fetchUrl(options?)`** (`fetch_url`) — fetch a URL and return its content as readability-extracted `text` (default), raw `html`, or `markdown`, with a host allowlist (SSRF guardrail), a byte cap (`truncated` flag), and a request timeout.
  - **`ai.tools.http(options?)`** (`http_request`) — a guarded HTTP/REST client: method + host allowlists enforced before the network call, optional `baseUrl` join, static-header merge, byte cap, and timeout; JSON-parses a JSON response body.
  - **`ai.tools.calculator(options?)`** (`calculator`) — a SAFE arithmetic evaluator (`+ - * / % ^`, unary signs, parentheses, decimal/scientific literals) implemented with a shunting-yard pass — it never calls `eval`/`Function`.
  - **`ai.tools.dateTime(options?)`** (`date_time`) — clock/calendar operations: `now` / `add` / `diff` / `format` over ISO-8601 instants, with millisecond-based units and IANA time-zone rendering. `diff` accepts `from` as an alias for the start instant (`iso` wins when both are set).
- **MCP client — `ai.mcp(server, options?)` (Direction A).** Connects to an external MCP server over a stdio (`node:child_process` + `node:readline`, no dependency) or Streamable HTTP transport, runs the `initialize` handshake + `tools/list`, and adapts each remote tool into a native `ToolContract` (its JSON Schema wrapped as a Standard Schema, `tools/call` as `execute`). Supports `namePrefix`, `filter`, and a per-call `timeoutMs`; an `isError` result surfaces as `{ error }` data.
- **MCP server — `ai.mcp.serve(source, options)` (Direction B).** Exposes a built agent / supervisor / orchestrator (or a raw `ToolContract[]`) AS an MCP server: `tools/list` emits each tool's `inputSchema` via `extractJsonSchema` at the configured `schemaTarget` (default `draft-2020-12`), and `tools/call` routes to `contract.invoke()`, mapping `data` to a text content block and `error` to an `isError: true` result. The stdio transport is auto-pumped over `process.stdin` / `process.stdout`; the pure protocol core is also exported as `createServeHandler` for a host's own HTTP wiring.
- **Typed error classes** — `WebToolError`, `HttpPolicyError`, `CalculatorError`, `DateTimeError`, and `McpTransportError`, each extending the `@warlock.js/ai` `AIError` base with a `type` discriminator. Every tool follows the errors-as-data contract: failures are thrown inside `execute`, wrapped by `tool()`, and reach the model as `{ error }` so the agent self-corrects instead of crashing the run.
- **Optional peers, lazily imported.** Heavy dependencies — a search provider (`@tavily/core`), the readability scraper (`@mozilla/readability` + `jsdom`), the MCP SDK (`@modelcontextprotocol/sdk`), and the JSON-Schema validator (`ajv`) — are optional peers, `import()`ed only when the relevant path runs, surfacing a curated `npm install` string when absent rather than crashing at import time. The only required runtime peer is `@warlock.js/ai`; everything else is Node built-ins + the global `fetch` (Node 18+).

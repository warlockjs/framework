---
title: "Use AI tools"
description: The ai.tools.* belt from @warlock.js/ai-tools — webSearch, fetchUrl, http, calculator, dateTime — and how they surface on ai under their guardrails.
sidebar:
  order: 8
  label: "Use AI tools"
---

`@warlock.js/ai-tools` ships five ready-made agent tools. Import the package once for its side effect and they register on the shared `ai` object under `ai.tools.*`. Each is a factory returning a `ToolContract` you drop straight into `ai.agent({ tools: [...] })`.

```ts
import "@warlock.js/ai-tools";
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const agent = ai.agent({
  model: openai.model({ name: "gpt-4o" }),
  systemPrompt: "Research, then call the API. Read tool errors and adjust.",
  tools: [
    ai.tools.webSearch({ provider: "tavily" }),
    ai.tools.fetchUrl({ extract: "text", allowHosts: ["docs.stripe.com"] }),
    ai.tools.http({ baseUrl: "https://api.stripe.com", allowHosts: ["api.stripe.com"] }),
    ai.tools.calculator(),
    ai.tools.dateTime({ defaultTimeZone: "UTC" }),
  ],
  maxTrips: 15,
});
```

The construction `options` are the **rails** — they bound what the model may do; the model supplies the per-call inputs *within* those rails. Least-privilege is just array composition: hand an agent only the tools (and only the methods/hosts) it needs.

## How they surface on `ai`

The bare `import "@warlock.js/ai-tools"` runs the package's `register` side effect, which (a) assigns the five factories onto `ai.tools` and `ai.mcp`, and (b) widens the `Ai` interface through a single `declare module "@warlock.js/ai"` augmentation. So after the import, `ai.tools.webSearch(...)`, `ai.tools.http(...)`, and the rest are fully typed — no view or cast needed. The same import also lights up `ai.mcp(...)` / `ai.mcp.serve(...)` (see [Connect MCP](../digging-deeper/connect-mcp)).

The factories are also exported as named values if you prefer not to go through the namespace:

```ts
import { webSearchTool, fetchUrlTool, httpRequestTool, calculatorTool, dateTimeTool } from "@warlock.js/ai-tools";
```

## The five tools

| Factory | LLM tool name | Model input | Returns |
|---|---|---|---|
| `ai.tools.webSearch(options)` | `web_search` | `{ query, maxResults? }` | `{ results: { title, url, snippet, score? }[] }` |
| `ai.tools.fetchUrl(options?)` | `fetch_url` | `{ url }` | `{ url, status, content, truncated }` |
| `ai.tools.http(options?)` | `http_request` | `{ method?, url, headers?, body? }` | `{ status, headers, body, truncated }` |
| `ai.tools.calculator(options?)` | `calculator` | `{ expression }` | `{ result }` |
| `ai.tools.dateTime(options?)` | `date_time` | `{ op, iso?, from?, to?, amount?, unit?, timeZone?, format? }` | `{ value }` |

> **There is no `sql` tool — by design.** This belt is the network/utility belt; filesystem and shell access live in a separate, policy-jailed package ([Use a workspace](../digging-deeper/use-workspace)). Database access is intentionally not vended as a generic tool — wire your own with `ai.tool(...)` so you own the query surface and its guardrails.

## `web_search` — pick a provider, supply a key

```ts
ai.tools.webSearch({ provider: "tavily", apiKey: process.env.TAVILY_API_KEY, maxResults: 8 });
```

- `provider`: `"tavily"` (LLM-ready snippets plus a relevance `score`), `"brave"`, or `"serpapi"`. Each is called over the global `fetch` — **no provider SDK is required**.
- `apiKey` falls back to a per-provider env var: `TAVILY_API_KEY` / `BRAVE_API_KEY` / `SERPAPI_API_KEY`. A missing key is a `WebToolError` of type `"missing-key"`.
- The model's `maxResults` is clamped into `[1, options.maxResults]` (default `5`).

## `fetch_url` — read a page you have the URL for

```ts
ai.tools.fetchUrl({ extract: "text", allowHosts: ["docs.stripe.com"], maxBytes: 500_000, timeoutMs: 10_000 });
```

- `extract`: `"text"` (default — readability-extracted main text), `"html"` (raw body), or `"markdown"`.
- `allowHosts` (when set) rejects any other host **before the fetch** (an SSRF guardrail) → `WebToolError` of type `"denied-host"`.
- `maxBytes` caps the body and flags `truncated`; `timeoutMs` aborts via `AbortSignal.timeout`.

> **Heavy deps are lazy optional peers.** `"text"` / `"markdown"` lazily import `@mozilla/readability` + `jsdom` only when used — a missing peer surfaces a `WebToolError` of type `"missing-peer"` carrying the exact `npm install @mozilla/readability jsdom` string, never a raw import-time crash. `"html"` needs nothing.

## `http_request` — a guarded REST client

```ts
ai.tools.http({
  baseUrl: "https://api.stripe.com",
  allowHosts: ["api.stripe.com"],
  allowMethods: ["GET", "POST"],            // default ["GET"] — mutating methods are opt-in
  headers: { authorization: `Bearer ${process.env.STRIPE_KEY}` },
  timeoutMs: 15_000,
  maxBytes: 1_000_000,
});
```

All guardrails are enforced **before the network call** and surface as a typed `HttpPolicyError`:

- a method outside `allowMethods` → `"method-not-allowed"`;
- a host outside `allowHosts` → `"host-not-allowed"` (SSRF guardrail);
- an unresolvable URL → `"invalid-url"`.

When `baseUrl` is set the model passes a **path** joined against it; otherwise it must pass an absolute `http(s)` URL. Static `headers` merge **under** the per-call headers (per-call wins). An object `body` is JSON-serialized (with a default `content-type: application/json`); a string `body` is sent verbatim; `body` is dropped for `GET`. The response body is JSON-parsed when the `content-type` is JSON, else returned as text.

## `calculator` — safe arithmetic (never `eval`)

```ts
const { data } = await ai.tools.calculator().invoke({ expression: "(3 + 4) * 2 ^ 3" });
data?.result; // 56
```

Supports `+ - * / % ^`, unary signs, parentheses, and decimal/scientific literals, with the usual precedence (`^` highest and right-associative). The expression is tokenized and evaluated with a shunting-yard pass — there is no path to an identifier, function call, or property access, so nothing code-like can be smuggled in. Failures are a `CalculatorError`: `"syntax"`, `"divide-by-zero"`, or `"overflow"`.

## `date_time` — clock + calendar

```ts
await ai.tools.dateTime().invoke({ op: "now", format: "iso" });
await ai.tools.dateTime().invoke({ op: "add", iso: "2026-06-22T00:00:00Z", amount: 3, unit: "days" });
await ai.tools.dateTime().invoke({ op: "diff", iso: "2026-06-22T00:00:00Z", to: "2026-06-25T00:00:00Z", unit: "days" }); // "3"
await ai.tools.dateTime({ defaultTimeZone: "Africa/Cairo" }).invoke({ op: "format", iso: "2026-06-22T12:00:00Z", format: "datetime" });
```

- `op`: `"now"` / `"add"` / `"diff"` / `"format"`. `format`: `"iso"` (default), `"date"`, `"time"`, `"datetime"`.
- For `diff`, pass the start instant as `iso` **or** `from` (an alias models reach for naturally with `from` / `to`); `iso` wins when both are set. The end instant is always `to`.
- Units are millisecond-based: `milliseconds`, `seconds`, `minutes`, `hours`, `days`, `weeks` (plus singular/short aliases like `day` / `d`). Calendar-relative `month` / `year` are intentionally **unsupported** — they have no fixed length. An unknown unit → `DateTimeError` `"invalid-unit"`; an unknown IANA zone → `"invalid-time-zone"`.
- For deterministic tests, inject a clock by calling the factory directly: `dateTimeTool({}, { clock: () => Date.parse("2026-06-22T00:00:00Z") })`.

## Errors flow as data, not throws

Every failure above is thrown inside the tool handler, caught by the framework's `tool()` wrapper, and surfaced in the returned `{ error }` field — `invoke()` never throws, so the agent reads the failure as a `role: "tool"` message and self-corrects on the next trip. Each error class extends the `@warlock.js/ai` `AIError` base; branch on `.type`:

```ts
import { WebToolError } from "@warlock.js/ai-tools";

const { error } = await ai.tools.fetchUrl({ allowHosts: ["docs.stripe.com"] }).invoke({ url: "http://evil.test" });
if (error instanceof WebToolError && error.type === "denied-host") {
  // rejected before any network call
}
```

## See also

- [Connect MCP](../digging-deeper/connect-mcp) — `ai.mcp(...)` consumes an external MCP server's tools, and `ai.mcp.serve(...)` exposes these tools AS an MCP server. Both ship in `@warlock.js/ai-tools`.
- [Use a workspace](../digging-deeper/use-workspace) — the filesystem + shell tool belt (jailed `read_file` / `edit_file` / `run_shell` / …).
- [Define tools](./define-tools) — the `tool()` / `ToolContract` seam every tool here is built on, for when you need a custom one.
- [Run agent](./run-agent) — running the agent that consumes these tools.

---
name: use-web-and-http-tools
description: 'Wire the @warlock.js/ai-tools belt — web search, fetch/scrape, HTTP/REST, calculator, date-time — into an agent under their guardrails. Triggers: `ai.tools.measure`, `measureTools`, `ai.tools.webSearch`, `ai.tools.fetchUrl`, `ai.tools.http`, `ai.tools.calculator`, `ai.tools.dateTime`, `webSearchTool`, `fetchUrlTool`, `httpRequestTool`, `calculatorTool`, `dateTimeTool`, `web_search`, `fetch_url`, `http_request`, `calculator`, `date_time`, `WebToolError`, `HttpPolicyError`, `CalculatorError`, `DateTimeError`, `allowHosts`, `allowMethods`, `allowPrivateNetwork`, `baseUrl`, `maxBytes`, `guardedFetch`, `SearchProvider`, `TAVILY_API_KEY`; ''give an agent web search'', ''let an agent fetch/scrape a page'', ''let an agent call a REST API'', ''restrict which hosts/methods an agent can hit'', ''add a calculator/date tool to an agent'', ''SSRF guardrail for an agent tool'', ''let a tool reach an internal/dev service''; typical import `import "@warlock.js/ai-tools"; import { ai } from "@warlock.js/ai"`. Skip: connecting to an external MCP server — the `connect-mcp-server` topic; exposing tools AS an MCP server — the `expose-as-mcp-server` topic; filesystem/shell tools — the `use-a-workspace` topic of the `warlock-js-ai-workspace` skill; defining your own custom tool — the `define-ai-tool` topic of the `warlock-js-ai` skill.'
---

# Use the web + HTTP tool belt

`@warlock.js/ai-tools` ships five ready-made tools. Import the package once for its side effect and they register on the shared `ai` object under `ai.tools.*` — each is a factory returning a `ToolContract` you spread into `ai.agent({ tools: [...] })`.

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

The construction `options` are the **rails** — they bound what the model may do; the model supplies the per-call inputs _within_ those rails. Least-privilege is just array composition: hand an agent only the tools (and only the methods/hosts) it needs.

## The five tools

| Factory                         | Name           | Model input                                                    | Returns                                          |
| ------------------------------- | -------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `ai.tools.webSearch(options)`   | `web_search`   | `{ query, maxResults? }`                                       | `{ results: { title, url, snippet, score? }[] }` |
| `ai.tools.fetchUrl(options?)`   | `fetch_url`    | `{ url }`                                                      | `{ url, status, content, truncated }`            |
| `ai.tools.http(options?)`       | `http_request` | `{ method?, url, headers?, body? }`                            | `{ status, headers, body, truncated }`           |
| `ai.tools.calculator(options?)` | `calculator`   | `{ expression }`                                               | `{ result }`                                     |
| `ai.tools.dateTime(options?)`   | `date_time`    | `{ op, iso?, from?, to?, amount?, unit?, timeZone?, format? }` | `{ value }`                                      |

## `web_search` — pick a provider, supply a key

```ts
ai.tools.webSearch({ provider: "tavily", apiKey: process.env.TAVILY_API_KEY, maxResults: 8 });
```

- `provider`: `"tavily"` (LLM-ready snippets + a relevance `score`), `"brave"`, or `"serpapi"`. Each is called over the global `fetch` — **no provider SDK is required**.
- `apiKey` falls back to a per-provider env var: `TAVILY_API_KEY` / `BRAVE_API_KEY` / `SERPAPI_API_KEY`. A missing key is a `WebToolError` of type `"missing-key"`.
- The model's `maxResults` is clamped into `[1, options.maxResults]` (default `5`).

## `fetch_url` — read a page you have the URL for

```ts
ai.tools.fetchUrl({
  extract: "text",
  allowHosts: ["docs.stripe.com"],
  maxBytes: 500_000,
  timeoutMs: 10_000,
});
```

- `extract`: `"text"` (default — readability-extracted main text), `"html"` (raw body), or `"markdown"`. **`"text"`/`"markdown"` lazily import the `@mozilla/readability` + `jsdom` optional peers** — a missing peer is a `WebToolError` of type `"missing-peer"` carrying the `npm install @mozilla/readability jsdom` string. `"html"` needs nothing.
- `allowHosts` (when set) rejects any other host **before the fetch** (an SSRF guardrail) → `"denied-host"`, and redirect targets are held to the same allowlist.
- **Private-network deny by default.** Every request — and every redirect hop — now routes through `@warlock.js/ai`'s hardened `guardedFetch` outbound policy instead of a local host check. It refuses private / loopback / link-local / CGNAT / cloud-metadata addresses (`169.254.169.254`, RFC1918, `localhost`, …) by resolving the hostname via DNS and checking every returned address, failing closed on resolution failure — and re-validates every redirect `Location` (scheme, allowlist, private-IP deny) before following it. This applies even with no `allowHosts` set, so a bare `ai.tools.fetchUrl()` is no longer an SSRF primitive; blocks surface as `WebToolError` `type: "denied-host"`.
- `allowPrivateNetwork` (default `false`) — set `true` to deliberately permit a private/internal target, e.g. a tool that must call a local dev server. Pair with `allowHosts` to scope it rather than opening the whole private range.
- `maxBytes` caps the body and flags `truncated`; `timeoutMs` aborts via `AbortSignal.timeout`.

## `http_request` — a guarded REST client

```ts
ai.tools.http({
  baseUrl: "https://api.stripe.com",
  allowHosts: ["api.stripe.com"],
  allowMethods: ["GET", "POST"], // default ["GET"] — mutating methods are opt-in
  headers: { authorization: `Bearer ${process.env.STRIPE_KEY}` },
  timeoutMs: 15_000,
  maxBytes: 1_000_000,
  // allowPrivateNetwork: true,             // only for a deliberate internal/dev target
});
```

All guardrails are enforced **before the network call** and surface as a typed `HttpPolicyError`:

- a method outside `allowMethods` → `"method-not-allowed"`;
- a host outside `allowHosts` → `"host-not-allowed"` (SSRF guardrail);
- an unresolvable URL → `"invalid-url"`.
- **Private-network deny by default** — like `fetch_url`, every request and redirect hop routes through `guardedFetch`, refusing private/loopback/link-local/CGNAT/cloud-metadata addresses (DNS-resolved and re-checked per redirect hop) even when `allowHosts` isn't set → `"host-not-allowed"`. Set `allowPrivateNetwork: true` (default `false`) to permit a deliberate internal target.

When `baseUrl` is set the model passes a **path** joined against it; otherwise it must pass an absolute `http(s)` URL. Static `headers` merge **under** the per-call headers (per-call wins). An object `body` is JSON-serialized (with a default `content-type: application/json`); a string `body` is sent verbatim; `body` is dropped for `GET`. The response body is JSON-parsed when the `content-type` is JSON, else returned as text.

## `calculator` — SAFE arithmetic (never `eval`)

```ts
const { data } = await ai.tools.calculator().invoke({ expression: "(3 + 4) * 2 ^ 3" });
data?.result; // 56
```

Supports `+ - * / % ^`, unary signs, parentheses, and decimal/scientific literals, with the usual precedence (`^` highest and right-associative). The expression is tokenized and evaluated with a shunting-yard pass — there is no path to an identifier, function call, or property access, so nothing code-like can be smuggled in. Failures are a `CalculatorError`: `"syntax"`, `"divide-by-zero"`, or `"overflow"`.

## `date_time` — clock + calendar

```ts
await ai.tools.dateTime().invoke({ op: "now", format: "iso" });
await ai.tools
  .dateTime()
  .invoke({ op: "add", iso: "2026-06-22T00:00:00Z", amount: 3, unit: "days" });
await ai.tools
  .dateTime()
  .invoke({ op: "diff", iso: "2026-06-22T00:00:00Z", to: "2026-06-25T00:00:00Z", unit: "days" }); // "3"
await ai.tools
  .dateTime({ defaultTimeZone: "Africa/Cairo" })
  .invoke({ op: "format", iso: "2026-06-22T12:00:00Z", format: "datetime" });
```

- `op`: `"now"` / `"add"` / `"diff"` / `"format"`. `format`: `"iso"` (default), `"date"`, `"time"`, `"datetime"`.
- For `diff`, pass the start instant as `iso` **or** `from` (an alias models reach for naturally with `from`/`to`); `iso` wins when both are set. The end instant is always `to`.
- Units are millisecond-based: `milliseconds`, `seconds`, `minutes`, `hours`, `days`, `weeks` (plus singular/short aliases like `day`/`d`). Calendar-relative `month`/`year` are intentionally **unsupported** — they have no fixed length. An unknown unit → `DateTimeError` `"invalid-unit"`; an unknown IANA zone → `"invalid-time-zone"`.
- For deterministic tests, inject a clock by calling the factory directly: `import { dateTimeTool } from "@warlock.js/ai-tools"; dateTimeTool({}, { clock: () => Date.parse("2026-06-22T00:00:00Z") })`.

## `ai.tools.measure` — what the belt costs per model call

`ai.tools.measure(tools, options?)` is `measureTools` from `@warlock.js/ai`: the input tokens a tool list adds to every call, per tool and in total. Native and exact when the model has `countTokens` (`source: "native"`, `tools.length + 2` count calls, `overhead` = the provider's once-per-request tool preamble); estimated from the schema JSON otherwise (`source: "estimate"`).

```ts
import "@warlock.js/ai-tools";
import { ai, type ModelContract } from "@warlock.js/ai";

export async function reportBeltCost(model: ModelContract): Promise<void> {
  const belt = [ai.tools.calculator(), ai.tools.dateTime()];

  const full = await ai.tools.measure(belt, { model });
  const compact = await ai.tools.measure(belt, { model, mode: "compact" });

  console.log(full.source, full.tokens, "→", compact.tokens, full.perTool);
}
```

If compact saves enough, run the agent with `toolSchemas: "compact"` (the `define-ai-tool` topic of the `warlock-js-ai` skill).

## Errors flow as data, not throws

Every failure above is thrown inside the tool handler, caught by the framework's `tool()` wrapper, and surfaced in the returned `{ error }` field — `invoke()` never throws, so the agent reads the failure as a `role: "tool"` message and self-corrects on the next trip. Each error class extends the `@warlock.js/ai` `AIError` base; branch on `.type`:

```ts
import { WebToolError } from "@warlock.js/ai-tools";

const { error } = await ai.tools
  .fetchUrl({ allowHosts: ["docs.stripe.com"] })
  .invoke({ url: "http://evil.test" });
if (error instanceof WebToolError && error.type === "denied-host") {
  // rejected before any network call
}
```

## See also

- The `connect-mcp-server` topic — adapt an external MCP server's tools as agent tools.
- The `expose-as-mcp-server` topic — publish these tools AS an MCP server.
- The `use-a-workspace` topic of the `warlock-js-ai-workspace` skill — the filesystem + shell tool belt (jailed `read_file` / `edit_file` / `run_shell` / …).
- The `define-ai-tool` topic of the `warlock-js-ai` skill — the `tool()` / `ToolContract` seam every tool here is built on.
- The `run-ai-agent` topic of the `warlock-js-ai` skill — running the agent that consumes these tools.

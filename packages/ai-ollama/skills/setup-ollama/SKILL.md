---
name: setup-ollama
description: 'Wire @warlock.js/ai-ollama — new OllamaSDK({host?, headers?}) for local / self-hosted Ollama via the official ollama client (not OpenAI-compat). chat + embed, daemon-down error handling. .model({name, vision?, reasoning?}) with cost-truth capabilities — reasoning inferred from thinking-model tags (deepseek-r1/qwq/qwen3/gpt-oss…), promptCaching/audio/pdf honestly false; options.reasoning → Ollama native `think` flag; usage reasoningTokens/cachedTokens stay undefined (none reported). Triggers: `OllamaSDK`, `ollama.model`, `ollama.embedder`, `embedder.embedMany`, `ollama.count`, `host`, `headers`, `reasoning`, `think`, thinking models, `deepseek-r1`, `qwq`, `qwen3`, `gpt-oss`; "use ollama with warlock", "run llama3 locally", "self-hosted llama", "ollama reasoning / thinking models", "deepseek-r1 with warlock"; typical import `import { OllamaSDK } from "@warlock.js/ai-ollama"`. Skip: agent loop — `@warlock.js/ai/run-ai-agent/SKILL.md`; provider choice — `@warlock.js/ai/pick-ai-provider/SKILL.md`; embeddings core — `@warlock.js/ai/embed-text/SKILL.md`; siblings `@warlock.js/ai-openai`, `@warlock.js/ai-anthropic`, `@warlock.js/ai-google`; raw `ollama` npm, Vercel `@ai-sdk/ollama`; OpenAI-compat gateway via `@warlock.js/ai-openai` `baseURL`.'
---

# `@warlock.js/ai-ollama`

Provider adapter that turns a local (or self-hosted) Ollama server into a vendor-neutral `ModelContract`, plus an Ollama embedder. Uses the **official `ollama` npm package** (not OpenAI-compat). Mirrors the openai / anthropic / bedrock / google adapters.

## Construction

```ts
import { OllamaSDK } from "@warlock.js/ai-ollama";

const ollama = new OllamaSDK();                                  // local default host
const remote = new OllamaSDK({ host: "http://gpu-box.internal:11434" });
const gated  = new OllamaSDK({
  host: "https://ollama.internal",
  headers: { Authorization: `Bearer ${process.env.OLLAMA_TOKEN}` },
});
```

`OllamaSDK` is a class with a long-lived `Ollama` client. Config is `Partial<Config>` (host defaults to `http://127.0.0.1:11434`) + `provider` (default `"ollama"`) + optional `pricing` (local is free; kept for parity/chargeback).

## Producing a model

```ts
ollama.model({ name: "llama3.1" })
ollama.model({ name: "qwen2.5:14b", temperature: 0.2 })
ollama.model({ name: "llama3.2-vision", maxTokens: 1024 })
```

## Capabilities — what's auto-set

| Flag | Default |
| --- | --- |
| `structuredOutput` | `true` (via Ollama's native `format` JSON-schema field) |
| `vision` | Inferred from model tag substring. `true` for `llava`, `bakllava`, `*-vision`, `moondream`, `minicpm-v`, `qwen2-vl`, `qwen2.5-vl`, `llama4`, `gemma3`; `false` otherwise. |
| `reasoning` | Inferred from model tag substring. `true` for `deepseek-r1`, `qwq`, `qwen3`, `magistral`, `phi4-reasoning`, `phi4-mini-reasoning`, `cogito`, `smallthinker`, `exaone-deep`, `gpt-oss`; `false` otherwise. |
| `promptCaching` | `false` — Ollama has no provider-side prompt cache. |
| `audio` / `pdf` | `false` — the Ollama chat API takes no audio / PDF content parts. |

Explicit config always wins (`vision`, `structuredOutput`, `reasoning` overrides on `ollama.model({ … })`).

## Reasoning / thinking

For thinking-capable families the adapter maps `ModelCallOptions.reasoning` onto Ollama's `think` request flag (`boolean | 'low' | 'medium' | 'high'`):

```ts
ollama.model({ name: "deepseek-r1:7b" })
await model.complete(messages, { reasoning: { effort: "high" } });   // → chat({ think: "high" })
await model.complete(messages, { reasoning: { maxTokens: 2048 } });  // → chat({ think: true })
```

- `reasoning.effort` (`low` / `medium` / `high`) passes straight through to `think`.
- `reasoning.maxTokens` (the thinking-budget hint) has **no Ollama equivalent** — the daemon takes no thinking-token cap, so it only acts as the on/off signal (`think: true`) and is otherwise ignored.
- The `think` flag is sent **only** to a `reasoning`-capable model; on a plain instruct model `reasoning` options are a no-op (no `think` is sent).
- Set `ollama.model({ name, reasoning: false })` to force it off, or `reasoning: true` to force it on for a tag the substring list doesn't recognize.

`ModelCallOptions.cacheControl` is a **no-op** — Ollama has no prompt cache, so there is no breakpoint to place.

## System prompt & roles

Unlike Anthropic/Gemini/Bedrock, **Ollama keeps a first-class `system` role inside `messages`** — no hoisting. Neutral roles (`system`/`user`/`assistant`/`tool`) pass straight through.

## Tool calls

- Outgoing: neutral tools → `{ type: "function", function: { name, description, parameters } }`.
- Assistant tool calls → `tool_calls: [{ function: { name, arguments } }]` (Ollama has **no tool-call id**).
- Tool results (`role: "tool"`) → a `tool` message with `tool_name` set from `toolCallId` (Ollama matches a result to its call by name).

**Synthesized ids.** Because Ollama tool calls carry no id, the adapter sets neutral `id` = tool name. **Parallel calls to the same tool in one turn share an id** — a documented v1 limitation. Ollama reports `done_reason: "stop"` even when it called a tool; the adapter derives `finishReason: "tool_calls"` from tool-call presence.

## Structured output

Object-root `responseSchema` + `structuredOutput`-capable → `chat({ format: <schema> })` (Ollama's `format` accepts a JSON Schema object).

## Multipart messages (vision)

A multipart user message collapses to a single `content` string + an `images` array of **base64 strings**. `{ type: "image", source: { url } }` → **throws `InvalidRequestError`** (Ollama cannot fetch remote URLs). Resolve images to base64 first.

## Streaming

`model.stream()` drains `chat({ stream: true })` (an `AbortableAsyncIterator`). Each chunk's `message.content` → `{ type: "delta" }`; `message.tool_calls` are emitted as `{ type: "tool-call" }` **fully formed**. Terminal `{ type: "done", finishReason, usage }` — usage from the final (`done: true`) chunk's `prompt_eval_count` / `eval_count`.

**`options.signal` is honored** by calling the iterator's `abort()` (stream path; non-stream `complete()` ignores it — the agent still honors the signal at trip boundaries).

## Finish-reason mapping

`stop` → `stop` · `length` → `length` · `load` / unknown / null → `error`. `tool_calls` derived from tool-call presence.

## Embeddings

```ts
const embedder = ollama.embedder({ name: "nomic-embed-text" });
const { vector } = await embedder.embed("Hello world");
const { vectors } = await embedder.embedMany(["a", "b"]);   // single batched call
const truncated = ollama.embedder({ name: "mxbai-embed-large", dimensions: 512 });
```

`client.embed` accepts a string array natively, so `embedMany` is **one request** (like the Gemini adapter). Usage comes from `prompt_eval_count` (reported as both `promptTokens` and `totalTokens`). Local Ollama runs without a prompt cache, so model usage has no `cachedTokens`.

`dimensions` is optional. When set it's forwarded as Ollama's `dimensions` truncation field (newer embedding models) and seeds `embedder.dimensions`; when omitted, `embedder.dimensions` starts at `0` and is resolved lazily from the first response's vector length, then cached.

## Errors

Wrapped into the typed `@warlock.js/ai` `AIError` hierarchy. The `ollama` client throws an internal `ResponseError` (`status_code` + message); transport failures surface as `fetch` `TypeError` with `ECONNREFUSED` cause:

- **Daemon-down (`ECONNREFUSED` / "fetch failed") → `ProviderError`** (operational "is Ollama running?", not a request defect)
- Timeouts → `ProviderTimeoutError`
- 401/403 → `ProviderAuthError`
- 429 → `ProviderRateLimitError`
- 4xx with context phrasing → `ContextLengthExceededError`, else `InvalidRequestError`
- 5xx → `ProviderError`

## Token counting & usage (cost-truth)

```ts
await ollama.count("some text")  // approximate heuristic, offline
```

Per-call `Usage` comes from the chat response's `prompt_eval_count` (→ `input`) and `eval_count` (→ `output`); `total` is their sum. The adapter reports usage **truthfully** — it never fabricates a field Ollama doesn't return:

- `cachedTokens` / `cacheWriteTokens` — **always undefined**. Ollama has no provider prompt cache, so there is no cache-hit or cache-write accounting (honest absence, not a false `0`).
- `reasoningTokens` — **always undefined**. Reasoning models emit their thinking as the `message.thinking` *string*, but the wire format carries **no separate reasoning-token count** — those tokens are already folded into `eval_count`. The adapter does not estimate a count from the thinking text.
- `cost` — populated only when a `ModelPricing` is configured (local Ollama is free, so usually undefined).

## When NOT to use this skill

- Direct `ollama` client calls without going through `@warlock.js/ai` agents.
- OpenAI / Anthropic / Bedrock / Google models — those have their own adapter packages.
- An OpenAI-compatible Ollama gateway you specifically want to drive through the OpenAI protocol — use `@warlock.js/ai-openai` with `baseURL` instead.

## See also

- [`@warlock.js/ai/run-ai-agent/SKILL.md`](@warlock.js/ai/run-ai-agent/SKILL.md)
- [`@warlock.js/ai/pick-ai-provider/SKILL.md`](@warlock.js/ai/pick-ai-provider/SKILL.md)
- [`@warlock.js/ai/embed-text/SKILL.md`](@warlock.js/ai/embed-text/SKILL.md)

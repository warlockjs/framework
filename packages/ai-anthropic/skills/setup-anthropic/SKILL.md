---
name: setup-anthropic
description: 'Wire @warlock.js/ai-anthropic — new AnthropicSDK({apiKey, baseURL?, provider?}) for Claude, .model({name, vision?, structuredOutput?, reasoning?, thinkingMode?, promptCaching?, maxTokens?, maxOutputTokens?}). System-prompt hoisting, max_tokens required (default: model max output when streaming, 16384 non-streaming; maxOutputTokens for gateway ids), extended thinking via options.reasoning → adaptive thinking + output_config.effort (current/unknown models) or budget_tokens (Haiku 4.5, 4.6 and older; override with thinkingMode), prompt caching via promptCaching + options.cacheControl (per-call ttl), provider blocks (thinking/compaction) replayed verbatim via ModelResponse.blocks / Message.blocks, providerOptions.anthropic (betas, body fields such as context_management / fallbacks, thinkingDisplay), model.countTokens(), distinct finish reasons (pause_turn, refusal, context_exceeded), built-in Claude list prices (ANTHROPIC_MODEL_PRICING, anthropicPricingFor, withAnthropicCacheWriteRates), cost-truth usage (inputIncludesCache: false, cachedTokens/cacheWriteTokens/cacheWrite1hTokens, usage.cost on complete()), ProviderOverloadedError for 529, no first-party embeddings. Triggers: `AnthropicSDK`, `anthropic.model`, `anthropic.count`, `maxTokens`, `maxOutputTokens`, `max_tokens`, `reasoning`, `thinking`, `budget_tokens`, `thinkingMode`, `adaptive`, `cacheControl`, `providerOptions`, `blocks`, `countTokens`, `pause_turn`, `refusal`, `context_management`, `contextManagement`, `serverCompaction`, `clear_tool_uses`, `clear_thinking`, `thinkingBlockBinding`, `block_binding`, `preservedThinking`, `ai.providerTool`, `web_search_20250305`, `bash_20250124`, `text_editor_20250728`, `streamChunks`, `thinking_delta`, `compaction`, `promptCaching`, `cachedTokens`, `cacheWriteTokens`, `cacheWrite1hTokens`, `inputIncludesCache`, `ANTHROPIC_MODEL_PRICING`, `ProviderOverloadedError`, `claude-sonnet-4-6`, `claude-haiku-4-5`, `claude-opus-4-7`; "wire claude into warlock agent", "configure anthropic provider", "use claude sonnet", "anthropic gateway baseURL", "claude extended thinking", "anthropic prompt caching cost"; typical import `import { AnthropicSDK } from "@warlock.js/ai-anthropic"`. Skip: embeddings — the `setup-openai` topic of the `warlock-js-ai-openai` skill; sibling adapters `@warlock.js/ai-openai`, `@warlock.js/ai-bedrock`, `@warlock.js/ai-google`, `@warlock.js/ai-ollama`; raw `@anthropic-ai/sdk`; Vercel `@ai-sdk/anthropic`.'
---

# `@warlock.js/ai-anthropic`

Provider adapter that turns Anthropic's Messages API into a vendor-neutral `ModelContract`. Mirrors `@warlock.js/ai-openai` — same shape, Claude-specific wire mapping.

## Construction

```ts
import { AnthropicSDK } from "@warlock.js/ai-anthropic";

const anthropic = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Proxied / gateway endpoints speaking the Anthropic protocol:
const proxied = new AnthropicSDK({
  apiKey: process.env.GATEWAY_KEY!,
  baseURL: "https://gateway.internal/anthropic",
  provider: "anthropic-proxy",
});
```

`AnthropicSDK` is a class with a long-lived `Anthropic` client. `provider` defaults to `"anthropic"`.

## Producing a model

```ts
anthropic.model({ name: "claude-sonnet-4-6" }); // common case
anthropic.model({ name: "claude-haiku-4-5", temperature: 0.2 }); // sampling controls
anthropic.model({ name: "claude-opus-4-7", maxTokens: 8192 }); // raise the cap
```

## Capabilities — what's auto-set

| Flag               | Default                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `structuredOutput` | `true` (via Anthropic's native `output_config.format`)                                                                                                                                                   |
| `vision`           | Inferred from model name. `true` for Claude 3 / 3.5 / 3.7 / 4 and Claude 5-series (`claude-opus-5*`, `claude-sonnet-5*`, `claude-fable-5*`, `claude-mythos-5*`); `false` for pre-3 and unknown ids.      |
| `reasoning`        | `true` — forwarded in the shape the model accepts (see [Extended thinking](#extended-thinking-reasoning)). Override with `reasoning: false` for legacy/proxied targets that reject the `thinking` param. |
| `promptCaching`    | `true` — the adapter places `cache_control` breakpoints and reports both cache reads (`Usage.cachedTokens`) and writes (`Usage.cacheWriteTokens`).                                                       |
| `pdf`              | `true` — the Messages API accepts PDF/document content blocks on vision-capable models.                                                                                                                  |
| `audio`            | absent (`false`) — Anthropic has no audio-input block, so the agent rejects audio attachments upfront.                                                                                                   |

Explicit config always wins (`structuredOutput`, `vision`, `reasoning`, `thinkingMode`).

## Pricing & cost

Every model is priced out of the box from the built-in Claude list prices; supply your own rates to override them. Pricing reaches `Usage.cost` on every agent report **and** on the `usage` of a direct `model.complete()` / the streaming `done` chunk, so side calls outside an agent are costed too. Unknown ids stay unpriced (`cost` is `undefined` — honest absence, never a false zero).

Resolution at `model()` time: per-model `pricing` > SDK registry entry for that name > built-in `ANTHROPIC_MODEL_PRICING` (alias or dated snapshot id) > `undefined`.

```ts
import {
  ANTHROPIC_MODEL_PRICING,
  AnthropicSDK,
  anthropicPricingFor,
  withAnthropicCacheWriteRates,
} from "@warlock.js/ai-anthropic";

const anthropic = new AnthropicSDK({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
  // SDK-level registry — wins over the built-in table, keyed by model name.
  pricing: { "claude-sonnet-4-6": { input: 3, output: 15, cachedInput: 0.3 } },
});

anthropic.model({ name: "claude-opus-5-5" }).pricing; // built-in: { input: 4, output: 20, cachedInput: 0.2, cacheWrite: 5, cacheWrite1h: 8 }
anthropic.model({ name: "claude-sonnet-4-6" }).pricing; // registry entry + write rates filled: cacheWrite 3.75, cacheWrite1h 6
anthropic.model({ name: "claude-haiku-4-5", pricing: { input: 1, output: 5 } }); // per-model override

anthropicPricingFor("claude-haiku-4-5-20251001"); // dated snapshot → the alias entry
withAnthropicCacheWriteRates({ input: 2, output: 10 }); // { input: 2, output: 10, cacheWrite: 2.5, cacheWrite1h: 4 }
Object.keys(ANTHROPIC_MODEL_PRICING); // the priced ids
```

- **Source.** `ANTHROPIC_MODEL_PRICING` holds the "Model pricing" table of https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-10-17): input, output, cache read (`cachedInput`), 5-minute write (`cacheWrite`) and 1-hour write (`cacheWrite1h`), USD per 1M tokens, standard global routing.
- **Write rates are filled for you.** Anthropic charges 1.25x input for a 5-minute cache write and 2x for a 1-hour write on every Claude model, so any entry without `cacheWrite` / `cacheWrite1h` (your own `{ input, output }` included) gets them from those multipliers (`withAnthropicCacheWriteRates`, exported with `ANTHROPIC_CACHE_WRITE_MULTIPLIER` / `ANTHROPIC_CACHE_WRITE_1H_MULTIPLIER`). The read rate differs per model (0.1x, 0.05x on Opus 5.5 / Sonnet 5.5, 0.025x on Fable 5.1), so it is never derived — set `cachedInput` yourself when you supply pricing, or cache reads bill at the full input rate.
- **Deliberately unpriced** (pass `pricing` yourself): Claude Haiku 5.5 (priced by prompt length — higher rates above 100,000 prompt tokens, which a flat rate cannot express), US-only inference (`inference_geo: "us"`, 1.1x), fast mode, the Batch API, limited-availability and retired models, and Claude on Bedrock / Vertex (partner-priced — see `@warlock.js/ai-bedrock`).

## Tokens & usage accounting

Every `ModelResponse.usage` (and the streaming terminal `done`) is normalized to the neutral `Usage` shape. Anthropic's `input_tokens` is the **uncached remainder only** — cache reads and writes come on top of it — so the adapter marks the usage `inputIncludesCache: false` and `computeCost` bills each channel exactly once. `total` is computed (`input + output`); the full prompt size is `input + cachedTokens + cacheWriteTokens`.

| Neutral field              | Anthropic source                           | Meaning / billing                                                                                                                                         |
| -------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `usage.input`              | `input_tokens`                             | Uncached input. Bills at `input`.                                                                                                                         |
| `usage.inputIncludesCache` | — (always `false`)                         | Tells `computeCost` not to subtract cache tokens from `input`.                                                                                            |
| `usage.cachedTokens`       | `cache_read_input_tokens`                  | Tokens read from the prompt cache. Bills at `cachedInput` (falls back to `input` when unset).                                                             |
| `usage.cacheWriteTokens`   | `cache_creation_input_tokens`              | Tokens **written** to the cache. Bills at `cacheWrite` (5-minute, 1.25x input).                                                                           |
| `usage.cacheWrite1hTokens` | `cache_creation.ephemeral_1h_input_tokens` | The 1-hour share of the writes. Bills at `cacheWrite1h` (2x input). Without the breakdown, all writes count as 1-hour when every marker asked for `"1h"`. |
| `usage.reasoningTokens`    | `output_tokens_details.thinking_tokens`    | The thinking subset of `output_tokens`, informational; billed inside `output`.                                                                            |
| `usage.cost`               | computed                                   | Per-channel USD (`input`, `output`, `cachedInput`, `cacheWrite`) when the model is priced. Sum with `totalCost(usage.cost)` from `@warlock.js/ai`.        |

```ts
import { totalCost } from "@warlock.js/ai";
import { AnthropicSDK } from "@warlock.js/ai-anthropic";

const model = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" }).model({
  name: "claude-sonnet-4-6",
});

const { usage } = await model.complete([{ role: "user", content: "Summarise this thread." }]);

// 100 uncached + 50,000 read + 20,000 written + 500 output is billed as
// 100×3 + 50,000×0.3 + 20,000×3.75 + 500×15 (USD per 1M tokens).
console.log(
  usage.inputIncludesCache,
  usage.cachedTokens,
  usage.cacheWriteTokens,
  totalCost(usage.cost),
);
```

With server-side compaction (`serverCompaction`), the `compaction` entries of `usage.iterations` are added to `input` / `output` / the cache counts, since the top-level counts leave the compaction step out.

In streaming, the cache counters are seeded from `message_start` (including the 1-hour breakdown) and then **overwritten by the cumulative counts on `message_delta`** when present and non-zero, so the terminal `done` carries the final tally and its `cost`.

## `max_tokens` is required

Unlike OpenAI, Anthropic **requires** `max_tokens` on every request. Resolution: per-call `options.maxTokens` (or the agent's per-run / configured `modelOptions.maxTokens`) > `config.maxTokens` > a default sized for agent work:

| Request                      | Default `max_tokens`                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Streaming (`stream()`)       | the model's documented max output: 128K (Claude 5 family, Opus 4.6–4.8, Sonnet 4.6), 64K (Opus / Sonnet / Haiku 4.5) |
| Non-streaming (`complete()`) | `16384`, capped by the model's max output                                                                            |
| Unknown id                   | `16384`; set `maxOutputTokens` on the model for gateway / proxy ids                                                  |

The non-streaming default stays at 16384 because `@anthropic-ai/sdk` refuses a non-streaming request whose `max_tokens` implies more than ten minutes (above ~21K tokens) unless the client sets a `timeout`. Limits come from Anthropic's model pages (checked 2026-10-17).

```ts
anthropic.model({ name: "claude-haiku-4-5" }); // stream 64000, complete 16384
anthropic.model({ name: "my-gateway/opus", maxOutputTokens: 128_000 });
```

With extended thinking enabled and no explicit cap, the default keeps room for the thinking budget plus 4096 answer tokens (never above the model's max output). In budget mode an explicit `maxTokens` must be greater than `budget_tokens` or the call throws before it reaches Anthropic.

A response that still hits the cap (`finishReason: "length"`) ends an agent run as incomplete (`AgentIncompleteError`) unless the agent sets `continueOnOutputLimit`.

**Tiny caps + adaptive thinking:** thinking tokens count inside `max_tokens`, so a very small cap can be spent entirely on thinking. Live check: Sonnet 5.5 with `maxTokens: 60` returned `finishReason: "length"` and empty content. For tiny outputs give thinking room (raise `maxTokens`) or turn reasoning off (`reasoning: false` on the model, or no `options.reasoning`).

## System prompt

Anthropic has no `"system"` role inside `messages`. The adapter hoists every neutral `role: "system"` message into the top-level `system` parameter (multiple system messages join with a blank line). Transparent to the agent.

## Tool calls

- Outgoing: vendor-neutral tools → Anthropic `tools` with `input_schema` (non-object schemas degrade to a parameterless object so registration never fails).
- Assistant tool calls in history → `assistant` message with an optional leading `text` block + one `tool_use` block per call.
- Tool results (`role: "tool"`) → `tool_result` blocks keyed by `tool_use_id`. Consecutive tool messages (the results of one parallel tool-use turn) are grouped into **one** `user` turn, as Anthropic expects.
- Response `tool_use` blocks → neutral `toolCalls`; `stop_reason: "tool_use"` → `finishReason: "tool_calls"`.

## Structured output

When the agent passes `responseSchema` and the model is `structuredOutput`-capable, an **object-root** schema is forwarded as `output_config: { format: { type: "json_schema", schema } }` (Anthropic native). Non-object schemas or `structuredOutput: false` omit it; the agent's soft system-prompt hint + client-side `validate()` still enforce shape.

## Extended thinking (reasoning)

When the model is `reasoning`-capable (default `true`) and the agent passes `options.reasoning`, the adapter forwards Anthropic thinking in one of two shapes, chosen per model (`thinkingMode`):

| Mode         | Models (inferred from the name)                                                                                                 | Wire shape                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `"adaptive"` | Current Claude models — Opus 4.7 / 4.8 / 5 / 5.5, Sonnet 5 / 5.5, Fable 5 / 5.1 — **and any id the adapter does not recognise** | `thinking: { type: "adaptive" }` + `output_config.effort` |
| `"budget"`   | Haiku 4.5, Opus 4.6, Sonnet 4.6, and every older model (Claude 3.x, 4.0 / 4.1 / 4.5, 2, instant)                                | `thinking: { type: "enabled", budget_tokens }`            |

Adaptive models reject `budget_tokens` with a 400, so the shape matters.

- **Adaptive:** `reasoning.effort` (`"low" | "medium" | "high"`) → `output_config.effort` of the same name. With only `reasoning.maxTokens` set, effort is `"medium"`; `maxTokens` then only sizes the reserved `max_tokens` room, it is not sent as a budget.
- **Budget:** `reasoning.maxTokens` → `budget_tokens` verbatim; `reasoning.effort` → a tiered budget (`1024` / `4096` / `12000`) when no `maxTokens` is given. Any resolved budget is floored at Anthropic's `1024` minimum.
- `reasoning` with neither `effort` nor `maxTokens` emits nothing. `effort: "none"` emits nothing either, except on the Claude 5 models listed below (Sonnet 5.5, Sonnet 5, Haiku 5.5, Opus 5), which each get their own form.

### `thinkingMode` override

`anthropic.model({ name, thinkingMode: "adaptive" | "budget" })` beats the name-based detection. Use it when the id does not look like an Anthropic id: region-prefixed / Bedrock-style ids (`us.anthropic.claude-…`) and custom or gateway ids are _unrecognised_, so they default to adaptive. If they front an older model (Haiku 4.5, 4.6 or earlier) set `thinkingMode: "budget"`. It can also move Opus/Sonnet 4.6 onto adaptive. The `AnthropicThinkingMode` type is exported.

```ts
import { AnthropicSDK, type AnthropicThinkingMode } from "@warlock.js/ai-anthropic";

const anthropic = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY! });

const mode: AnthropicThinkingMode = "budget";

anthropic.model({ name: "claude-opus-5-5" }); // adaptive (detected)
anthropic.model({ name: "claude-haiku-4-5" }); // budget (detected)
anthropic.model({ name: "us.anthropic.claude-haiku-4-5", thinkingMode: mode }); // region-prefixed id of an older model
anthropic.model({ name: "claude-sonnet-4-6", thinkingMode: "adaptive" }); // opt 4.6 into adaptive
```

### Temperature

`temperature` is **not sent** to models after Opus 4.6 (adaptive mode) — they reject any non-default value with a 400. It is also dropped on any request that enables thinking, since Anthropic 400s on thinking plus an explicit temperature. So it is forwarded only in budget mode on requests without thinking; `thinkingMode` decides this too. Set `reasoning: false` on the model config to suppress the thinking param entirely for proxied/legacy targets.

```ts
await agent.execute("Prove it.", { modelOptions: { reasoning: { effort: "high" } } });
// adaptive model: thinking { type: "adaptive" }, output_config.effort "high"
// budget model:   thinking { type: "enabled", budget_tokens: 12000 }
await model.complete(messages, { reasoning: { maxTokens: 8000 } });
// adaptive model: effort "medium"; budget model: budget_tokens 8000
```

**Claude 5 family:** adaptive thinking runs by default and `budget_tokens` is a 400, so `reasoning.maxTokens` only sizes `max_tokens`. `effort: "none"` is mapped per model:

| Model                   | `effort: "none"` sends                                                                 | Result                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Sonnet 5.5              | `thinking: { type: "between_tools" }`, alone (no `output_config.effort`, no `display`) | Thinking off. `between_tools` takes no other field and needs effort `high` or below; the model default, `high`, applies.               |
| Sonnet 5, Haiku 5.5     | `thinking: { type: "disabled" }`, alone (no `output_config.effort`, no `display`)      | Thinking off. Haiku 5.5 accepts `disabled` only at effort `high` or below; its default, `medium`, applies.                             |
| Opus 5                  | `thinking: { type: "adaptive" }` + `output_config.effort: "low"`                       | Thinking stays on at the lowest effort: with `disabled`, Opus 5 can emit a tool call as plain text (never run) and leak thinking tags. |
| Opus 5.5, Fable 5 / 5.1 | no `thinking` field                                                                    | No thinking-off form exists, so the model still thinks at its default effort (Opus 5.5: `medium`). Pass `effort: "low"` to think less. |

`thinkingDisplay` is applied only to adaptive thinking, never beside `between_tools` or `disabled`.

```ts
import { AnthropicSDK } from "@warlock.js/ai-anthropic";

const anthropic = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY! });
const messages = [{ role: "user" as const, content: "Classify: great product!" }];

// Sonnet 5 / Haiku 5.5 → thinking: { type: "disabled" }
await anthropic.model({ name: "claude-haiku-5-5" }).complete(messages, {
  reasoning: { effort: "none" },
});

// Opus 5 → thinking: { type: "adaptive" }, output_config: { effort: "low" }
await anthropic.model({ name: "claude-opus-5" }).complete(messages, {
  reasoning: { effort: "none" },
});
```

`thinking.display` is set with `providerOptions.anthropic.thinkingDisplay` (`"summarized"` for readable summaries; the 5-family default is `"omitted"`, empty thinking text). It is applied whenever the adapter sends `thinking` to an adaptive model, so pair it with a `reasoning` option.

When a thinking-enabled response also makes tool calls, its signed `thinking` and `redacted_thinking` blocks are retained in each call's `providerMetadata.anthropic.thinkingBlocks` and replayed on the next assistant turn. The full turn is also returned as `ModelResponse.blocks` — see [Provider blocks](#provider-blocks-thinking-compaction-server-tools).

## Provider blocks (thinking, compaction, server tools)

When a response contains a block the neutral `content` / `toolCalls` cannot carry (thinking, redacted thinking, `compaction`, server-tool use/results, cited text), the adapter returns the whole ordered turn as `ModelResponse.blocks` (and on the streaming `done` chunk): `{ provider: "anthropic", type, data }` per block. Plain text / tool-use turns have no `blocks`.

The agent copies them onto the assistant `Message.blocks` (tool-call trips, `pause_turn` trips, repair turns) and onto `LLMTrip.blocks`; `AgentResult.blocks` is set only for a single-trip run. On the next request the adapter replays an assistant message **verbatim** from its `blocks` — required for preserved thinking and server-side compaction. It falls back to rebuilding from `content` + `toolCalls` when the blocks come from another provider, a block's `data.type` differs from its `type` or is not an assistant-turn type, or their `tool_use` ids no longer match `toolCalls`.

A replayed thinking block requires every earlier turn unchanged, including the run's tool-call turns and tool results. Never store just `{ content: result.text, blocks }` after a multi-trip run. Keep the run's turns:

```ts
// agent created with `captureMessages: true`
const result = await agent.execute(input, { history });
const finalTrip = result.report.trips.at(-1);

history = [
  ...(result.report.messages ?? []).filter((message) => message.role !== "system"),
  { role: "assistant", content: finalTrip?.output ?? "", blocks: finalTrip?.blocks },
];
```

Or let `ai.session({ id, store, agent })` store the turns for you (the `keep-agent-conversations` topic of the `warlock-js-ai` skill).

## Provider options (`providerOptions.anthropic`)

Anthropic-only request options, per call or in the agent's `modelOptions`. Other adapters ignore the key. Type: `AnthropicCallOptions`.

| Field                  | Effect                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `betas`                | Beta flags. When non-empty the request goes through `client.beta.messages` (needed for beta body fields and beta blocks such as `compaction`).                                                                                                                                                          |
| `body`                 | Extra body fields merged **last** (caller wins): `context_management`, `fallbacks`, `inference_geo`, `tool_choice`, … Not validated, except that `model`, `messages`, `system`, `tools`, `mcp_servers` and `stream` are refused (`InvalidRequestError`).                                                |
| `thinkingDisplay`      | `thinking.display` on adaptive models: `"summarized"`, `"omitted"`, `"updates"` (the last needs its beta).                                                                                                                                                                                              |
| `contextManagement`    | Typed context editing: `clearToolUses` (`trigger: { inputTokens } \| { toolUses }`, `keep`, `clearAtLeast`, `excludeTools`, `clearToolInputs`) → `clear_tool_uses_20250919`; `clearThinking` (`keep: n \| "all"`) → `clear_thinking_20251015`, listed first. Adds beta `context-management-2025-06-27`. |
| `serverCompaction`     | `true` or `{ triggerTokens (≥ 50,000; API default 150,000), instructions }` → `compact_20260112`, beta `compact-2026-01-12`. Can't be combined with `body.context_management` (`InvalidRequestError`).                                                                                                  |
| `thinkingBlockBinding` | `"error"` \| `"drop_block"` → `thinking.block_binding.prefix_mismatch_behavior` + beta `thinking-binding-controls-2026-08-01`; adaptive or budget thinking only (skipped with a debug log on `between_tools`).                                                                                          |

```ts
const agent = ai.agent({
  model: anthropic.model({ name: "claude-opus-5-5" }),
  tools,
  modelOptions: {
    providerOptions: {
      anthropic: {
        contextManagement: { clearToolUses: { trigger: { inputTokens: 100_000 }, keep: 5 } },
        serverCompaction: { triggerTokens: 200_000 },
      },
    },
  },
});
```

The response then starts with a `compaction` block, kept on `blocks` and replayed (the API ignores everything before it). Compaction tokens are billed outside the top-level `input_tokens` / `output_tokens`; the adapter adds the `compaction` entries of `usage.iterations` into `usage`. Leave `pause_after_compaction` off inside an agent: a paused response reads as a final stop.

### Preserved thinking after client-side compaction

Claude Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5 accept a replayed thinking block only while everything before it is unchanged. The agent's own compaction marks turns it kept after a summary `compaction: "retained"`; on those models (inferred, or `anthropic.model({ name, preservedThinking: true })`) the adapter replays them **without** `thinking` / `redacted_thinking` blocks. Other models (Opus 5, Sonnet 5, Fable 5, Mythos 5.1, 4.x, budget mode) keep them. Setting `thinkingBlockBinding` disables the stripping and lets the API drop (`"drop_block"`) or reject (`"error"`) instead — also the way to recover a stored conversation someone edited:

```ts
const recovering = ai.agent({
  model: anthropic.model({ name: "claude-opus-5-5" }),
  modelOptions: { providerOptions: { anthropic: { thinkingBlockBinding: "drop_block" } } },
});
await recovering.execute(question, { history });

inferPreservedThinking("claude-opus-5-5"); // true (exported helper)
```

Cache TTL per call: `options.cacheControl.ttl` (`"5m"` | `"1h"`) overrides the model's `promptCacheTtl` for that call.

## Prompt caching (`cache_control`)

Caching is opt-in: `model({ promptCaching: true })` sends request-level
`cache_control: { type: "ephemeral" }` when a call has no explicit
`options.cacheControl.breakpoints`. Anthropic then marks the last cacheable
block itself, caching the longest reusable request prefix (including growing
message history). A caller-supplied breakpoint remains authoritative, so its
request has no top-level automatic marker.

Set `promptCacheTtl: "1h"` on the model to apply a one-hour TTL to automatic
caching and emitted explicit markers. Omit it (or use `"5m"`) for Anthropic's
default five-minute TTL; the one-hour cache has a higher write cost.

Two independent breakpoint sites, both reported back via `usage.cachedTokens` / `usage.cacheWriteTokens`:

- **Tools** — set `model({ promptCaching: true })` to mark the _last_ tool definition with `cache_control: ephemeral`. One breakpoint caches the whole tool prefix; off by default since a write costs ~1.25x and only pays off across multiple trips.
- **System prompt** — a per-call `options.cacheControl.breakpoints >= 1` emits the system prompt as a `TextBlockParam` carrying `cache_control: ephemeral` (the longest stable prefix on a turn). Without the hint the system prompt stays a plain string with no marker of its own, but with `promptCaching: true` the automatic request-level marker still caches the longest reusable prefix, system prompt included (a live check read back 10,090 cached tokens of a large system prompt on the second call). With `promptCaching` off and no hint, nothing is cached, so a one-shot call never pays the write surcharge. A system prompt with per-turn placeholders changes the prefix each turn: write surcharge, no reads. No system prompt → no block.

```ts
await agent.execute("…", { cacheControl: { breakpoints: 1 } }); // cache the system prefix
```

## Multipart messages (vision)

`ContentPart[]` user content maps to Anthropic content blocks:

- `{ type: "text", text }` → `{ type: "text", text }`
- `{ type: "image", source: { url } }` → `{ type: "image", source: { type: "url", url } }`
- `{ type: "image", source: { base64, mediaType } }` → `{ type: "image", source: { type: "base64", media_type, data } }`

## Streaming

`model.stream()` drains `messages.create({ stream: true })`:

- `content_block_delta` text → `{ type: "delta", content }`
- `tool_use` blocks accumulate `input_json_delta` fragments and emit one consolidated `{ type: "tool-call", ... }` at `content_block_stop` (no partial-arg `{}` artifact — input is parsed once, whole)
- every content block is also assembled by index (text, thinking + signature, server-tool input, beta `compaction_delta`) and returned as `done.blocks` when the turn has a non-neutral block
- terminal `{ type: "done", finishReason, usage, blocks? }` — `usage.input` from `message_start`, `usage.output` from `message_delta`, `total` computed; `cachedTokens` / `cacheWriteTokens` from `message_start` then the cumulative `message_delta` counts (see [Tokens & usage accounting](#tokens--usage-accounting))
- opt-in (`options.streamChunks`, set by `agent.stream()`): `{ type: "reasoning", delta }` per non-empty `thinking_delta`, `{ type: "tool-args", callId, name, delta }` per `input_json_delta` of a client `tool_use` block (never for `server_tool_use`), `{ type: "usage", usage }` after `message_start` and each `message_delta` (running totals). Claude 5 models stream thinking text only with `providerOptions.anthropic.thinkingDisplay: "summarized"`.

```ts
for await (const chunk of model.stream(messages, { streamChunks: true, reasoning: { effort: "high" } })) {
  if (chunk.type === "reasoning") process.stderr.write(chunk.delta);
}
```

## Provider-defined tools

`ai.providerTool({ provider: "anthropic", definition })` entries are sent verbatim, before the function tools (the prompt-cache breakpoint stays on the last function tool). Server tools (`web_search_20250305`, `web_fetch_20250910`, `code_execution_20250825`) run inside the response and their `server_tool_use` / `*_tool_result` blocks round-trip via `blocks`. Client tools (`bash_20250124`, `text_editor_20250728` named `str_replace_based_edit_tool`, `memory_20250818`) come back as `tool_use` and dispatch to the provider tool's `execute`. Other providers' tools are skipped with a `providerTool.skipped` warning. `providerOptions.anthropic.body` still cannot set `tools`.

```ts
const webSearch = ai.providerTool({
  provider: "anthropic",
  definition: { type: "web_search_20250305", name: "web_search", max_uses: 5 },
});
const editor = ai.providerTool({
  provider: "anthropic",
  definition: { type: "text_editor_20250728", name: "str_replace_based_edit_tool" },
  execute: async (input: { command: string; path: string }) => files.edit(input),
});
ai.agent({ model: anthropic.model({ name: "claude-sonnet-4-6" }), tools: [webSearch, editor] });
```

## Finish-reason mapping

`end_turn` / `stop_sequence` / beta `compaction` → `stop` · `max_tokens` → `length` · `model_context_window_exceeded` → `context_exceeded` · `pause_turn` → `pause_turn` · `refusal` → `refusal` · `tool_use` → `tool_calls` · unknown / null → `error`.

The agent resumes `pause_turn` automatically (it replays the paused turn and calls again, within `maxTrips`). `refusal` and `context_exceeded` end the run like `stop`; check `report.trips.at(-1).finishReason` to fall back to another model or compact the history.

## Errors

Raw SDK errors are wrapped into the typed `@warlock.js/ai` `AIError` hierarchy. Dispatch keys on `error.type` (Anthropic has no per-error machine `code`), falling back to HTTP status:

- `authentication_error` / `permission_error` / 401 / 403 → `ProviderAuthError`
- `rate_limit_error` / 429 → `ProviderRateLimitError` (+`retryAfter` from `retry-after`)
- `billing_error` → `QuotaExceededError`
- `invalid_request_error` with "prompt is too long" → `ContextLengthExceededError`, else `InvalidRequestError`
- `overloaded_error` / 529 → `ProviderOverloadedError` (`code: "PROVIDER_OVERLOADED"`, `retryable: true`, `retryAfter` from `retry-after`). Also raised for an `overloaded_error` delivered mid-stream as an SSE `error` event, which has no `status`.
- other 5xx → `ProviderError` (`retryable: true`)
- Connection timeouts → `ProviderTimeoutError`

Every wrapped error carries `status` (the HTTP status, when there was one), `retryable`, and `billed`: `false` for 401 / 402 / 403 (the request never reached a billable account), `"unknown"` otherwise — Anthropic publishes no rule for failed requests, so treat them as possibly billed when you settle a budget. `fallbackModel` fails over on `PROVIDER_OVERLOADED` by default.

```ts
import { ai, ProviderOverloadedError } from "@warlock.js/ai";
import { AnthropicSDK } from "@warlock.js/ai-anthropic";

const anthropic = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
const agent = ai.agent({ model: anthropic.model({ name: "claude-sonnet-4-6" }) });

const result = await agent.execute("hi");

if (result.error instanceof ProviderOverloadedError) {
  console.log(
    result.error.status,
    result.error.retryable,
    result.error.billed,
    result.error.retryAfter,
  );
}
```

## Build and send an audited request

`model.buildRequest(messages, options?)` is synchronous and makes no network call.
It returns a detached `{ endpoint, body, betas }` snapshot, including thinking,
cache markers, provider body options and merged tool results. `body.stream` is
`false` by default; pass `{ ...options, stream: true }` to build a streaming request.
`betas` identifies the beta header flags; the SDK receives these separately from
its serialized Messages body.

```ts
const request = model.buildRequest(messages, options);
const bodyJSON = JSON.stringify(request.body);
// Hash or reserve spend against bodyJSON before sending.
const response = await model.send(request, { signal });

const streamingRequest = model.buildRequest(messages, { ...options, stream: true });
for await (const chunk of model.send(streamingRequest, { signal })) {
  // Consume the same neutral chunks as model.stream().
}
```

`send()` uses the built endpoint, body and beta flags without rebuilding the
conversation or applying new defaults. It passes `betas` only when `endpoint` is
`"beta.messages"`: a request whose `endpoint` is `"messages"` is sent without
them, even if `betas` was edited by hand. Transport cancellation stays separate
from the audited body. `complete()`, `stream()` and `countTokens()` use this same
build path and always select their respective request modes. `buildRequest()`
throws build failures raw (an `InvalidRequestError` for a reserved `body` key, a
`DataCloneError` for a `body` value `structuredClone` cannot copy, such as a
function); `complete()`, `stream()` and `countTokens()` log them like send
failures and reject with an `AIError`, wrapping anything else in an
`InvalidRequestError`.
Treat the snapshot as read-only after hashing it; SDK JSON serialization and beta
header handling still apply.

Hosts with their own transport can import `toAnthropicMessages`,
`toAnthropicTools`, `toProviderBlocks`, `fromProviderBlocks`,
`ANTHROPIC_BLOCK_FORMAT` and the `AnthropicMessages` type from the package root.
`fromProviderBlocks(blocks, toolCalls)` retains the adapter's assistant-block
allowlist and tool-id validation.

## Token counting

```ts
await anthropic.count("some text"); // approximate heuristic, offline

const model = anthropic.model({ name: "claude-opus-5-5" }); // an AnthropicModel
await model.countTokens(messages, { tools }); // exact, via messages.countTokens (network)
```

`countTokens` sends the same system prompt, tools, thinking and `providerOptions.anthropic.betas` a real call would, keeping only the fields the endpoint accepts.

## No embeddings

Anthropic ships no first-party embeddings API, so `AnthropicSDK` intentionally does **not** implement `embedder()` (the `SDKAdapterContract.embedder` slot is optional). Use `@warlock.js/ai-openai` (or another embeddings-capable adapter; see the `setup-openai` topic of the `warlock-js-ai-openai` skill) for vectors.

## When NOT to use this skill

- Direct calls to `@anthropic-ai/sdk` without going through `@warlock.js/ai` agents.
- OpenAI / Bedrock / Gemini / Ollama models — those have their own adapter packages.

## See also

- The `run-ai-agent` topic of the `warlock-js-ai` skill
- The `pick-ai-provider` topic of the `warlock-js-ai` skill
- The `handle-ai-errors` topic of the `warlock-js-ai` skill

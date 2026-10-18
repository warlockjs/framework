---
title: "Provider-defined tools"
description: ai.providerTool() — enable a provider's built-in tools (web search, code execution, bash, text editor, search grounding) next to your own tools.
sidebar:
  order: 6
  label: "Provider-defined tools"
---

Providers ship tools of their own: Anthropic `web_search`, `web_fetch`, `code_execution`, `bash`, `text_editor` and `memory`; the OpenAI Responses API `web_search`, `file_search`, `code_interpreter`; Gemini `googleSearch`, `codeExecution` and `urlContext`; Bedrock system tools such as Nova web grounding. Their definitions are the provider's own JSON, not a name plus a schema, so `ai.tool()` cannot describe them. `ai.providerTool()` does:

```ts
import { ai } from "@warlock.js/ai";

const webSearch = ai.providerTool({
  provider: "anthropic",
  definition: { type: "web_search_20250305", name: "web_search", max_uses: 5 },
});

const assistant = ai.agent({
  model: anthropic.model({ name: "claude-sonnet-4-6" }),
  tools: [webSearch, lookupOrder], // provider tools and ai.tool() tools side by side
});
```

- `provider` — who receives the definition: an adapter's wire format (`"anthropic"`, `"openai"`, `"google"`, `"bedrock"`, `"ollama"`) or a model's provider label (`"groq"`, `"xai"`, `"deepseek"`, `"mistral"` for the OpenAI-compatible adapters).
- `definition` — the tool entry exactly as that provider's API documents it. It is sent **verbatim**; the framework does not validate or rewrite it.

## Other providers skip it, with a warning

A provider tool only reaches the provider it names. Every other adapter leaves it out of the request and logs one `warn` line (module `ai.<adapter>`, action `providerTool.skipped`) per tool and model. One tool list can therefore serve a [fallback chain](/v/latest/ai/agents/run-agent/) across providers:

```ts
const assistant = ai.agent({
  model: ai.fallbackModel([claude, gemini]),
  tools: [
    ai.providerTool({
      provider: "anthropic",
      definition: { type: "web_search_20250305", name: "web_search" },
    }),
    ai.providerTool({ provider: "google", definition: { googleSearch: {} } }),
  ],
});
```

Claude receives only the Anthropic search tool, Gemini only `googleSearch`.

## Server-run vs client-run tools

**Server-run** tools (web search, web fetch, code execution, search grounding) run inside the provider. The model calls them and reads the results in the same response; your code never sees a tool call, and `execute` is not needed.

**Client-run** tools have a provider-defined schema but are executed by you: Anthropic `bash`, `text_editor` and `memory`, for example. The model calls them like any tool, so give the provider tool an `execute`; the agent dispatches the call to it by name:

```ts
const bash = ai.providerTool({
  provider: "anthropic",
  definition: { type: "bash_20250124", name: "bash" },
  execute: async (input: { command?: string; restart?: boolean }) => sandbox.run(input),
});

const editor = ai.providerTool({
  provider: "anthropic",
  definition: { type: "text_editor_20250728", name: "str_replace_based_edit_tool" },
  execute: async (input: { command: string; path: string }) => files.edit(input),
});
```

The tool's `name` defaults to `definition.name`, then `definition.type`, then the single key of the definition (`{ googleSearch: {} }` → `"googleSearch"`, `{ systemTool: { name: "nova_grounding" } }` → `"nova_grounding"`); pass `name` when the provider calls the tool by something else. `input`, `action`, `mode`, `meta` and `version` work as on `ai.tool()`. A server-run tool called locally (no `execute`) fails that tool call with a clear error.

## Per provider

| Provider                 | `provider`                 | Example definition                                                    | Results in history                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | -------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anthropic                | `"anthropic"`              | `{ type: "web_search_20250305", name: "web_search", max_uses: 5 }`    | `server_tool_use` and `*_tool_result` blocks are kept on the assistant message's `blocks` and replayed verbatim on the next call (with their citations and encrypted content). A long server-tool turn that ends with `pause_turn` is resumed automatically.                                                                                                                                                                                                       |
| OpenAI Responses         | `"openai"`                 | `{ type: "web_search" }`                                              | Requests use `store: false`, so the next turn re-sends the answer text; the hosted call items (`web_search_call`, …) are not replayed. An encrypted reasoning item that led into a hosted call is not replayed either, because the API rejects a reasoning item without the item that followed it. Built-ins your code must run (`shell`, `apply_patch`, `computer`, `custom`) are not supported: the adapter throws `InvalidRequestError` if the model emits one. |
| OpenAI Chat + compatible | the model's provider label | Groq: `{ type: "browser_search" }`                                    | Sent verbatim when `provider` equals the model's provider label. OpenAI itself accepts only `function` and `custom` tools on Chat Completions; its hosted tools need `api: "responses"`.                                                                                                                                                                                                                                                                           |
| Google Gemini            | `"google"`                 | `{ googleSearch: {} }`, `{ codeExecution: {} }`, `{ urlContext: {} }` | The next turn re-sends the answer text (and function-call thought signatures); grounding metadata and code-execution parts are not sent back.                                                                                                                                                                                                                                                                                                                      |
| Bedrock Converse         | `"bedrock"`                | `{ systemTool: { name: "nova_grounding" } }`                          | `server_tool_use` blocks are never dispatched as tool calls, and the next turn re-sends the answer text only. AWS asks you to display the returned citations to your users.                                                                                                                                                                                                                                                                                        |
| Ollama                   | `"ollama"`                 | —                                                                     | Ollama's chat API has no built-in tools.                                                                                                                                                                                                                                                                                                                                                                                                                           |

Definitions that need a beta flag (some Anthropic tool versions) still need it: pass it through `providerOptions.anthropic.betas`.

## Calling a model directly

The agent turns provider tools into `ModelCallOptions.providerTools`. When you call a model yourself, pass them there (or leave `ai.providerTool()` entries in `tools`; the adapters pick them out):

```ts
await model.complete(messages, {
  providerTools: [{ provider: "openai", definition: { type: "web_search" } }],
});
```

`providerOptions.<adapter>.body` still cannot set `tools`: the reserved body keys are unchanged, and `ai.providerTool()` is the supported way to add a provider's tools.

## Related

- [Define tools](/v/latest/ai/tools/define-tools/) — `ai.tool()` for your own functions.
- [Stream reasoning and tool arguments](/v/latest/ai/agents/stream-reasoning-and-tool-args/) — server-run tool inputs are not streamed as tool arguments.
- [Anthropic provider](/v/latest/ai/providers/anthropic/) — provider blocks and `providerOptions`.

## Hosted usage and metadata

Hosted tools never go through application function dispatch. Read
`usage.serverToolUse.webSearchRequests`, `webFetchRequests` and
`codeExecutionRequests` when an adapter reports them. Missing means unreported;
zero means the provider reported zero. Counts come from structured provider
counters or hosted output, never the answer text. `mergeUsage` sums them across
trips and providers. No adapter currently reports a verified code-execution
request counter; content blocks alone do not establish billable requests.

| Adapter          | Count source                                                                                                     | Raw data retained on the response and streaming `done`                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic        | `usage.server_tool_use.web_search_requests` / `web_fetch_requests`; stream snapshots replace cumulative counts   | Ordered `blocks`, including `server_tool_use` and `web_search_tool_result`, replayed in history                                                |
| Google           | Unique nonempty `groundingMetadata.webSearchQueries`; `googleWebSearchQueries` also records the raw array length | `providerMetadata.google.groundingMetadata`: indexed candidate metadata with queries, chunks and supports                                      |
| OpenAI Responses | Number of `web_search_call` output items, counted once across stream events and terminal output                  | `providerMetadata.openai.output`: hosted output items, including actions and sources; sources are requested automatically for web-search tools |
| Bedrock Converse | No hosted request counter in its `TokenUsage` schema                                                             | Existing adapter behavior; no search count inferred from system-tool blocks                                                                    |
| Qwen / Kimi      | No verified billing counter mapped                                                                               | No synthetic search count from flags or echoed calls                                                                                           |

Agent reports retain `providerMetadata` on each `report.trips` entry. Metadata
is for inspection and display; it is not sent to function dispatch. Anthropic
blocks continue to be replayed; OpenAI and Google metadata is not replayed.
See [cost tracking](/v/latest/ai/recipes/cost-tracking/) for request-fee pricing
and [OpenAI-compatible native search](/v/latest/ai/providers/openai-compatible/)
for Qwen and Kimi. xAI native search requires its Responses API; the current
`XaiSDK` rejects native `web_search` / `x_search` tools on Chat Completions.

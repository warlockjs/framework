---
title: "API reference"
description: Public exports of @warlock.js/ai grouped by primitive — agents, workflows, supervisors, tools, embeddings, middleware.
sidebar:
  order: 1
  label: "API reference"
---

Every public export of `@warlock.js/ai`, grouped by primitive. This page is the lookup table — for the "why" and "how to use it well" angle, follow the cross-links to the concept and basics pages.

All exports come from the same entry:

```ts
import { ai, /* types, errors */ } from "@warlock.js/ai";
```

## The `ai` namespace

| Export | Shape | See |
| --- | --- | --- |
| `ai.agent(config)` | `(config: AgentConfig) => AgentContract<T>` | [Run agent](../the-basics/run-agent) |
| `ai.tool(config)` | `(config: ToolConfig) => ToolContract<TIn, TOut>` | [Define tools](../the-basics/define-tools) |
| `ai.systemPrompt(input?)` | `() / (string) / (block[]) => SystemPrompt` | [Write system prompts](../the-basics/write-system-prompts) |
| `ai.persona(text)` | `(text: string) => PersonaContract` | [Write system prompts](../the-basics/write-system-prompts) |
| `ai.instruction(text)` | `(text: string) => InstructionContract` | [Write system prompts](../the-basics/write-system-prompts) |
| `ai.workflow(config)` | `<TIn, TOut, TState>(config) => WorkflowInstance` | [Run workflow](../digging-deeper/run-workflow) |
| `ai.step(config)` | `<TIn, TState>(config) => StepDefinition` | [Run workflow](../digging-deeper/run-workflow) |
| `ai.supervisor(config)` | `<TOutput>(config) => SupervisorContract` | [Run supervisor](../digging-deeper/run-supervisor) |
| `ai.config(partial)` | `(partial: Partial<AIConfig>) => AIConfig` | [Persist AI data](../digging-deeper/persist-ai-data) |
| `ai.middleware.budget(opts)` | budget cap middleware | [Attach middleware](../digging-deeper/attach-middleware) |
| `ai.middleware.guardrail(opts)` | pre/post check middleware | [Attach middleware](../digging-deeper/attach-middleware) |
| `ai.middleware.semanticCache(opts)` | two-tier cache middleware | [Attach middleware](../digging-deeper/attach-middleware) |
| `ai.middleware.compose(...sources)` | flatten middleware sources | [Attach middleware](../digging-deeper/attach-middleware) |
| `ai.middleware.forTool(name, mw)` | scope tool hooks to a tool name | [Attach middleware](../digging-deeper/attach-middleware) |

## Agents

| Export | What it is |
| --- | --- |
| `AgentContract<T>` | The shape returned by `ai.agent`. Has `.execute()`, `.stream()`, `.on()`, `.off()`, `.name`, `.isAnonymous`, `.description`. |
| `AgentConfig` | Config object accepted by `ai.agent`. |
| `AgentExecuteOptions` | Per-call options for `execute` / `stream`. |
| `AgentResult<T>` | Result envelope — `{ type, data?, text?, report, usage, error? }`. |
| `AgentReport` | Trace tree — `{ status, startedAt, endedAt, duration, model, trips, toolCalls }`. |
| `AgentEventHandlers` | Typed event handler map for `on` (factory / per-call). |
| `AgentEventMap` | Map of event name → payload, keyed by `agent.*` event. |
| `StreamingToolGuardConfig` | Config for `streamingToolGuard`. |
| `Message` | History message — `{ role, content, ... }`. |
| `Attachment` | Image attachment — string or tagged object. |

## Workflows

| Export | What it is |
| --- | --- |
| `WorkflowInstance<TIn, TOut, TState, TContext>` | Returned by `ai.workflow`. `.execute()`, `.resume()`, `.asTool()`, `.signature`. |
| `WorkflowDefinition<TIn, TOut, TState, TContext>` | Config for `ai.workflow`. |
| `StepDefinition<TIn, TState, TContext>` | Returned by `ai.step`. |
| `WorkflowContext<TIn, TState, TContext>` | The `ctx` argument step bodies receive. |
| `WorkflowResult<TOut>` | Result envelope. |
| `WorkflowReport` | Trace tree — `{ runId, signature, status, timings, steps }`. |
| `StepSnapshot` | One step's recorded outcome — `{ output, status, attempts, attemptHistory, timings, steps? }`. |
| `WorkflowRunOptions` | Per-call options for `execute` / `resume`. |
| `WorkflowSnapshot` | Persisted shape — see [Persist AI data](../digging-deeper/persist-ai-data). |

## Supervisors

| Export | What it is |
| --- | --- |
| `SupervisorContract<TOutput>` | Returned by `ai.supervisor`. `.execute()`, `.stream()`, `.resume()`, `.asTool()`, `.signature`. |
| `SupervisorConfig<TOutput>` | Config for `ai.supervisor`. |
| `SupervisorContext<TOutput>` | `ctx` argument intent bodies and routers receive. |
| `SupervisorResult<TOutput>` | Result envelope. |
| `SupervisorReport` | Trace tree — iterations, intent dispatches. |
| `SupervisorSnapshot` | Persisted shape. |
| `END` | Sentinel value to terminate routing. |

## Tools

| Export | What it is |
| --- | --- |
| `ToolContract<TIn, TOut>` | Returned by `ai.tool`. Has `.name`, `.description`, `.invoke()`. |
| `ToolConfig<TIn, TOut>` | Config for `ai.tool`. |
| `ToolContext<TArtifacts>` | Second argument to `execute` — `{ artifacts, signal, ... }`. |
| `ToolCall` | One recorded tool call — `{ name, input, output, error?, tripIndex, duration, startedAt, endedAt }`. |
| `ToolMode` | `"feedback" | "silent"`. |

## System prompts

| Export | What it is |
| --- | --- |
| `SystemPrompt` | Immutable builder returned by `ai.systemPrompt`. `.persona(t)`, `.instruction(t)`, `.resolve(placeholders)`. |
| `SystemPromptContract` | Interface implemented by `SystemPrompt`. |
| `SystemPromptBlockContract` | Discriminated union — `PersonaContract | InstructionContract`. |
| `PersonaContract` | `{ type: "persona", text, resolve }`. |
| `InstructionContract` | `{ type: "instruction", text, resolve }`. |

## Embeddings

| Export | What it is |
| --- | --- |
| `EmbedderContract` | Sibling of `ModelContract` on `SDKAdapterContract`. `.embed()`, `.embedMany()`, `.dimensions`. |
| `EmbeddingResult` | `{ vector: number[], usage: Usage, dimensions: number }`. |
| `EmbeddingBatchResult` | `{ vectors: number[][], usage: Usage, dimensions: number }`. |

## SDK / model contracts

| Export | What it is |
| --- | --- |
| `SDKAdapterContract` | Interface every provider adapter implements — `model()`, `embedder?()`. |
| `ModelContract` | Returned by `sdk.model({...})`. Owns `complete`, `stream`, `capabilities`, `pricing`. |
| `ModelCallOptions` | Per-call options forwarded to the model (`temperature`, `maxTokens`, etc.). |
| `ModelResponse` | Shape returned by `model.complete`. |
| `ModelPricing` | `{ input, output, cachedInput?, cachedOutput? }` — USD per 1M tokens. |
| `Usage` | `{ input, output, total, cost? }`. |
| `CostBreakdown` | `{ input, output, cachedInput?, cachedOutput? }` — USD. |

## Middleware

| Export | What it is |
| --- | --- |
| `AgentMiddleware` | Shape — `{ name, execute?, trip?, tool?, log? }`. |
| `MiddlewareExecuteContext` | `ctx` for `execute` hooks. |
| `MiddlewareTripContext` | `ctx` for `trip` hooks. |
| `MiddlewareToolContext` | `ctx` for `tool` hooks. |

## Errors

All extend `AIError`. Stable `code` strings listed in [Handle errors](../digging-deeper/handle-errors).

| Class | Code | Category |
| --- | --- | --- |
| `AIError` | (base) | varies |
| `AgentExecutionError` | `AGENT_EXEC_FAILED` | varies |
| `SchemaValidationError` | `SCHEMA_VALIDATION_FAILED` | `schema` |
| `ToolExecutionError` | `TOOL_EXEC_FAILED` | `tool` |
| `WorkflowError` | (base) | varies |
| `StepFailedError` | `STEP_FAILED` | `provider` |
| `WorkflowDriftError` | `WORKFLOW_DRIFT` | `drift` |
| `WorkflowCancelledError` | `WORKFLOW_CANCELLED` | `cancelled` |
| `MaxStepsExceededError` | `WORKFLOW_MAX_STEPS` | `max-steps` |
| `RoutingError` | `WORKFLOW_INVALID_GOTO` | `routing` |
| `ProviderError` | `PROVIDER_ERROR` | `provider` |
| `ProviderRateLimitError` | `PROVIDER_RATE_LIMIT` | `rate-limit` |
| `QuotaExceededError` | `PROVIDER_QUOTA_EXCEEDED` | `quota` |
| `ProviderTimeoutError` | `PROVIDER_TIMEOUT` | `timeout` |
| `ContextLengthExceededError` | `CONTEXT_LENGTH_EXCEEDED` | `context-length` |
| `ContentFilterError` | `CONTENT_FILTER` | `content-filter` |
| `InvalidRequestError` | `PROVIDER_INVALID_REQUEST` | `validation` |
| `ProviderAuthError` | `PROVIDER_AUTH` | `auth` |
| `BudgetExceededError` | `BUDGET_EXCEEDED` | `budget` |
| `GuardrailViolationError` | `GUARDRAIL_VIOLATION` | `guardrail` |
| `SupervisorDriftError` | `SUPERVISOR_DRIFT` | `drift` |
| `MaxIterationsError` | `SUPERVISOR_MAX_ITERATIONS` | `max-iterations` |

## Configuration

| Export | What it is |
| --- | --- |
| `AIConfig` | `{ defaultStore? }` — process-wide config. |
| `ai.config(partial)` | Merge into the process-wide config. |

## Reports — shared shapes

| Export | What it is |
| --- | --- |
| `BaseReport` | Common report shape — `runId`, `rootRunId`, `parentRunId?`, `reportSchemaVersion`, `version?`, `sessionId?`. |
| `LLMTrip` | One round-trip — `{ index, finishReason, usage, startedAt, endedAt, duration, ... }`. |
| `FinishReason` | `"stop" | "tool_calls" | "length" | "content_filter" | "error"`. |

## Mock SDK

| Export | What it is |
| --- | --- |
| `MockSDK` | Test double for any `SDKAdapterContract`. Use in tests instead of hitting real providers. |
| `MockModel` | Backing model with scripted responses. |
| `MockEmbedder` | Backing embedder with scripted vectors. |

## Related

- [Pick a provider](../getting-started/03-pick-a-provider) — adapter contract.
- [The basics](../the-basics/run-agent) — must-know surface in narrative form.
- [Handle errors](../digging-deeper/handle-errors) — full error semantics.

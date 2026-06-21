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
| `ai.orchestrator(config)` | `<TOutput, TState>(config) => OrchestratorContract` | [Run orchestrator](../digging-deeper/run-orchestrator) |
| `ai.planner(config)` | `<TOutput>(config) => PlannerContract` | [Planner](../architecture-concepts/planner) |
| `ai.spawnSubAgent(spec)` | `<TOutput>(spec) => Promise<AgentResult<T>>` | [Spawn sub-agent](../the-basics/spawn-sub-agent) |
| `ai.memory(config)` | `(config) => MemoryContract` | [Memory](../architecture-concepts/memory) |
| `ai.router(config)` | `(config) => AgentContract` (generated routing agent) | [Run supervisor](../digging-deeper/run-supervisor) |
| `ai.fanOut(unit, n, opts?)` | spread one unit into N keyed intents | [Run supervisor](../digging-deeper/run-supervisor) |
| `ai.batch(exec, items, opts?)` | run an executable over a dataset, bounded concurrency | [Run agent](../the-basics/run-agent) |
| `ai.fallbackModel(models, opts?)` | ordered model list with failover | [Run agent](../the-basics/run-agent) |
| `ai.eval.{exact,contains,predicate,judge}` | built-in `agent.eval()` scorers | [Run agent](../the-basics/run-agent) |
| `ai.mockRouter(decisions, opts?)` | canned routing decisions for tests | [Run supervisor](../digging-deeper/run-supervisor) |
| `ai.config(partial)` | `(partial: Partial<AIConfig>) => AIConfig` | [Persist AI data](../digging-deeper/persist-ai-data) |
| `ai.checkpoint.{memory,pg,redis}()` | orchestrator session checkpoint stores | [Run orchestrator](../digging-deeper/run-orchestrator) |
| `ai.snapshot.{memory,pg,redis}()` | workflow / supervisor / orchestrator snapshot stores | [Persist AI data](../digging-deeper/persist-ai-data) |
| `ai.systemPrompt.fromFile(path)` | seed a system prompt from a file | [Run agent](../the-basics/run-agent) |
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

## Orchestrators

| Export | What it is |
| --- | --- |
| `OrchestratorContract<TOutput, TState>` | Returned by `ai.orchestrator`. `.execute()`, `.stream()`, `.resume()`, `.command()`, `.asTool()`, `.on()`, `.off()`, `.name`, `.signature`, `.version`. |
| `OrchestratorConfig<TOutput, TState, TIntents>` | Config for `ai.orchestrator` — supervisor surface + session lifecycle. |
| `OrchestratorResult<TOutput>` | Per-turn envelope — `{ type, data?, sessionId, turnIndex, compaction?, report, usage, error? }`. |
| `OrchestratorReport` | Session-scoped turn report — `turns[]`, `turnIndex`, `signature`, `status` (incl. `"awaiting-input"`). |
| `OrchestratorExecuteOptions<TState>` | Per-call options — `sessionId` (required), `history` (required), `state?`, `context?`, `signal?`, `on?`, `force?`. |
| `OrchestratorResumeOptions` | Options for `resume()` — `context?`, `signal?`, `on?`, `force?`. |
| `OrchestratorCommands` | Typed command map for `command()`; ships `compact`, open for module augmentation. |
| `OrchestratorAsToolOptions<TToolInput>` | `asTool()` options — adds `sessionScope: "fresh" | "shared"`. |
| `OrchestratorEvent` / `OrchestratorEventMap` / `OrchestratorEventHandlers` | The `orchestrator.*` event surface (3-tier). |
| `CompactionResult` | `{ summary, replacesFromIndex, replacesToIndex }`. |
| `SummarizeConfig` / `SummarizeCallback` | `summarize` policy shapes. |
| `OrchestratorMemoryConfig` | The orchestrator's `memory` object form. |

## Planner

| Export | What it is |
| --- | --- |
| `PlannerContract<TOutput>` | Returned by `ai.planner`. Implements `ExecutableContract`. `.execute(goal, opts?)`, `.name`, `.signature`. |
| `PlannerConfig<TOutput>` | Config — `model` XOR `planner`, `capabilities`, `maxSteps?`, `output?`. |
| `PlannerCapability` | `{ name, description, executable }` — a unit the plan may reference. |
| `PlannerResult<TOutput>` | Envelope — `{ type: "planner", data?, report, usage, error? }`. |
| `PlannerReport` | `{ type, signature, plan?, executedSteps[], children[] }`. |
| `PlannerStep` / `PlannerPlan` / `PlannerStepSnapshot` | Plan + per-step records. |
| `PlannerExecuteOptions<TOutput>` | Per-call — `runId?`, `placeholders?`, `output?`, `signal?`, `sessionId?`. |
| `SpawnSubAgentSpec<TOutput>` | Spec for `ai.spawnSubAgent` — `{ name, model, task, systemPrompt?, tools?, maxTrips?, budget?, output?, ... }`. |

## Memory

| Export | What it is |
| --- | --- |
| `MemoryContract` | Returned by `ai.memory`. `.remember()`, `.recall()`, `.clear()`, `.name`. |
| `MemoryConfig` | Config — `working?`, `semantic?`, `defaultTier?`, `k?`, `threshold?`. |
| `SemanticMemoryConfig` | `{ embedder, store?, namespace? }`. |
| `MemoryItem` | `{ text, tier?, id?, metadata? }`. |
| `MemoryTier` | `"working" | "semantic"` (episodic/procedural deferred to 4.4). |
| `RecalledMemory` | `{ id, text, tier, score, metadata? }`. |
| `RecallOptions` | `{ k?, tier?, threshold? }`. |

## Batch + eval

| Export | What it is |
| --- | --- |
| `BatchResult<TResult>` | `{ type: "batch", data[], items[], usage, report }`. |
| `BatchItemResult<TResult>` | `{ index, status, result?, error?, attempts }`. |
| `BatchOptions<TResult>` | `{ concurrency?, retry?, onItem?, signal?, sessionId?, name? }`. |
| `BatchReport` | Per-item rollup — `{ total, succeeded, failed, cancelled }`. |
| `EvalReport<T>` / `EvalCase` / `EvalScore` / `EvalScorer` / `EvalJudge` / `EvalOptions` / `EvalCaseResult` | `agent.eval()` surface. |
| `registerAiMatchers()` | Vitest matchers `toRouteTo` / `toConverge` / `toPassStep` / `toOutputShape`. |
| `matchRouteTo` / `matchConverge` / `matchPassStep` / `matchOutputShape` | Library-agnostic verdict functions; `MatcherVerdict`, `AiMatchers` types. |

## Persistence stores

| Export | What it is |
| --- | --- |
| `CheckpointStore` / `CheckpointRecord` | Orchestrator session-state store + row shape. `ai.checkpoint.{memory,pg,redis}()`. |
| `SnapshotStore<TSnapshot>` | Workflow / supervisor / orchestrator run-snapshot store. `ai.snapshot.{memory,pg,redis}()`. `load` / `save` / `delete` / `list?` / `schema`. |
| `PgClientLike` / `RedisClientLike` | Minimal `pg` / `redis` client surfaces the stores depend on (you pass the client in). |
| `PgCheckpointOptions` / `RedisCheckpointOptions` | `ai.checkpoint.pg` / `.redis` options. |
| `PgSnapshotStoreOptions` / `RedisSnapshotStoreOptions` | `ai.snapshot.pg` / `.redis` options. |
| `FallbackModelContract` | Returned by `ai.fallbackModel(models, opts?)`. |

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
| `ModelCapabilities` | `{ structuredOutput?, vision?, reasoning?, promptCaching?, audio?, ... }` — feature flags the agent reads before forwarding options. |
| `ModelCallOptions` | Per-call options forwarded to the model — `temperature`, `maxTokens`, plus `reasoning?: { effort?, maxTokens? }` and `cacheControl?: { breakpoints? }`. |
| `ReasoningEffort` | `"low" | "medium" | "high"`. |
| `ModelResponse` | Shape returned by `model.complete`. |
| `ModelPricing` | `{ input, output, cachedInput?, cachedOutput?, reasoning? }` — USD per 1M tokens, per channel. |
| `Usage` | `{ input, output, total, cachedTokens?, cacheWriteTokens?, reasoningTokens?, cost? }`. |
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
| `OrchestratorFailedError` | `ORCHESTRATOR_FAILED` | varies |
| `OrchestratorDriftError` | `ORCHESTRATOR_DRIFT` | `drift` |
| `OrchestratorConfigError` | `ORCHESTRATOR_CONFIG` | `validation` |
| `OrchestratorCancelledError` | `ORCHESTRATOR_CANCELLED` | `cancelled` |
| `PlannerFailedError` | `PLANNER_FAILED` | varies |
| `PlannerPlanInvalidError` | `PLANNER_PLAN_INVALID` | `schema` |
| `PlannerCancelledError` | `PLANNER_CANCELLED` | `cancelled` |

## Configuration

| Export | What it is |
| --- | --- |
| `AIConfig` | `{ defaultStore?, defaultCheckpointStore?, defaultSnapshotStore? }` — process-wide config. `defaultStore` is the **cache** driver (semanticCache + memory vector store); `defaultSnapshotStore` / `defaultCheckpointStore` are the snapshot / checkpoint stores. |
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

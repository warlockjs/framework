---
title: "API reference"
description: Public exports of @warlock.js/ai grouped by primitive — agents, workflows, supervisors, teams, RAG, skills, prompts, evals, guardrails, tools, embeddings, middleware.
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
| `ai.team(config)` | `<TOutput, TState, TMembers>(config) => SupervisorContract` (manager + members + gate sugar) | [Run supervisor](../digging-deeper/run-supervisor) |
| `ai.orchestrator(config)` | `<TOutput, TState>(config) => OrchestratorContract` | [Run orchestrator](../digging-deeper/run-orchestrator) |
| `ai.planner(config)` | `<TOutput>(config) => PlannerContract` | [Planner](../architecture-concepts/planner) |
| `ai.spawnSubAgent(spec)` | `<TOutput>(spec) => Promise<AgentResult<T>>` | [Spawn sub-agent](../the-basics/spawn-sub-agent) |
| `ai.image(params)` | `(params: ImageParams) => Promise<ImageResult>` — text-to-image output verb (`GeneratedImage[]`) | [OpenAI](../providers/openai) / [Google](../providers/google) |
| `ai.speech(params)` | `(params: SpeechParams) => Promise<SpeechResult>` — text-to-speech output verb (`GeneratedAudio`) | [OpenAI](../providers/openai) |
| `ai.transcribe(params)` | `(params: TranscribeParams) => Promise<TranscriptionResult>` — speech-to-text input verb | [OpenAI](../providers/openai) |
| `ai.audioFromFile(path, opts?)` | `(path, { mediaType? }) => Promise<AudioInput>` — read + package an audio file (non-AI plumbing for `ai.transcribe`) | [OpenAI](../providers/openai) |
| `ai.audioFromBuffer(bytes, mediaType, filename?)` | `(...) => AudioInput` — package raw audio bytes (no I/O, no AI) | [OpenAI](../providers/openai) |
| `ai.memory(config)` | `(config) => MemoryContract` | [Memory](../architecture-concepts/memory) |
| `ai.skills(config)` | `(config: SkillsConfig) => SkillsContract` (progressive-disclosure skills library) | [Memory](../architecture-concepts/memory) |
| `ai.rag(config)` | `(config: RagConfig) => Rag` (chunk → embed → retrieve → cite) | [Memory](../architecture-concepts/memory) |
| `ai.rag.keywordReranker(opts?)` / `ai.rag.llmReranker(opts)` | built-in rerankers for the `reranker` slot | [Memory](../architecture-concepts/memory) |
| `ai.router(config)` | `(config) => AgentContract` (generated routing agent) | [Run supervisor](../digging-deeper/run-supervisor) |
| `ai.fanOut(unit, n, opts?)` | spread one unit into N keyed intents | [Run supervisor](../digging-deeper/run-supervisor) |
| `ai.batch(exec, items, opts?)` | run an executable over a dataset, bounded concurrency | [Run agent](../the-basics/run-agent) |
| `ai.fallbackModel(models, opts?)` | ordered model list with failover | [Run agent](../the-basics/run-agent) |
| `ai.prompts` | `PromptsManagerContract` — the process-wide `name@version` prompt registry (resolve / merge / validate / diff / export by name) | [Prompt registry](../the-basics/prompt-registry) |
| `ai.prompt(options?)` | thin facade over `ai.prompts`; the options form returns an isolated legacy `PromptRegistryContract` | [Prompt registry](../the-basics/prompt-registry) |
| `ai.dataset(options)` | `<TOutput>(options: DatasetOptions) => DatasetContract` (filterable / shardable eval cases) | [Run agent](../the-basics/run-agent) |
| `ai.vcr(model, options)` | `(model: ModelContract, options: VcrOptions) => VcrModel` (record / replay decorator) | [Run agent](../the-basics/run-agent) |
| `ai.eval.{exact,contains,predicate,judge}` | built-in `agent.eval()` scorers | [Run agent](../the-basics/run-agent) |
| `ai.eval.{toJUnit,toJSON,fromJSON}` | CI reporters / round-trip serialization over a finished `EvalReport` | [Run agent](../the-basics/run-agent) |
| `ai.mockRouter(decisions, opts?)` | canned routing decisions for tests | [Run supervisor](../digging-deeper/run-supervisor) |
| `ai.config(partial)` | `(partial: Partial<AIConfig>) => AIConfig` | [Persist AI data](../digging-deeper/persist-ai-data) |
| `ai.checkpoint.{memory,pg,redis}()` | orchestrator session checkpoint stores | [Run orchestrator](../digging-deeper/run-orchestrator) |
| `ai.snapshot.{memory,pg,redis}()` | workflow / supervisor / orchestrator snapshot stores | [Persist AI data](../digging-deeper/persist-ai-data) |
| `ai.systemPrompt.fromFile(path)` | seed a system prompt from a file | [Run agent](../the-basics/run-agent) |
| `ai.human.approval(opts)` | `(opts: HumanApprovalOptions) => AgentMiddleware` — the `tool.before` approval gate | [Attach middleware](../digging-deeper/attach-middleware) |
| `ai.human.resume(id, decision, opts)` | `<TOutput>(...) => Promise<ResumeResult>` — out-of-process durable resume | [Attach middleware](../digging-deeper/attach-middleware) |
| `ai.human.interrupt.{memory,pg,redis}()` | durable `InterruptStore` factories | [Attach middleware](../digging-deeper/attach-middleware) |
| `ai.guardrail(opts)` | `(opts: GuardOptions) => AgentMiddleware` — content-intelligence guardrail suite | [Attach middleware](../digging-deeper/attach-middleware) |
| `ai.guardrail.{pii,topic,injection,moderation}(opts?)` | built-in detector factories for the `input` / `output` / `tool` arrays | [Attach middleware](../digging-deeper/attach-middleware) |
| `ai.middleware.budget(opts)` | budget cap middleware | [Attach middleware](../digging-deeper/attach-middleware) |
| `ai.middleware.guardrail(opts)` | pre/post check middleware (the legacy guardrail seed) | [Attach middleware](../digging-deeper/attach-middleware) |
| `ai.middleware.semanticCache(opts)` | two-tier cache middleware | [Attach middleware](../digging-deeper/attach-middleware) |
| `ai.middleware.compose(...sources)` | flatten middleware sources | [Attach middleware](../digging-deeper/attach-middleware) |
| `ai.middleware.forTool(name, mw)` | scope tool hooks to a tool name | [Attach middleware](../digging-deeper/attach-middleware) |

## Agents

| Export | What it is |
| --- | --- |
| `AgentContract<T>` | The shape returned by `ai.agent`. Has `.execute()`, `.stream()`, `.resume()`, `.on()`, `.off()`, `.name`, `.isAnonymous`, `.description`. |
| `AgentConfig` | Config object accepted by `ai.agent`. Includes `captureMessages?` — opt-in full-history capture onto `AgentReport.messages` (off by default; large + sensitive) — and `durable?` (below). |
| `agent.resume(runId, opts?)` | Durable mid-run crash-resume. Re-hydrates completed trips + tool calls + usage from the snapshot and continues from the next trip — never re-issuing a completed trip's model call. Throws `AgentDriftError` on a structural mismatch unless `{ force: true }`. |
| `AgentConfig.durable` | `{ store?: SnapshotStore<AgentSnapshot>; deleteOnComplete? }` — opt-in checkpointing after every settled trip. `store` falls back to `ai.config({ defaultSnapshotStore })`; when neither is set, writes skip and `resume()` throws. |
| `AgentSnapshot` / `AgentSnapshotStatus` / `AgentResumeOptions<T>` | The persisted agent state, its status, and `resume()` options (`{ force?, ... }`). |
| `AgentExecuteOptions` | Per-call options for `execute` / `stream`. |
| `AgentResult<T>` | Result envelope — `{ type, data?, text?, report, usage, error? }`. |
| `AgentReport` | Trace tree — `BaseReport` plus `model`, `trips`, `systemPrompt?` (the resolved `role: "system"` message), and `messages?` (the full `CapturedMessage[]`, present only when `captureMessages` is on). Tool dispatches live under `children` filtered by `type === "tool"`. |
| `CapturedMessage` | One normalized conversation turn — `{ role, content, toolCalls?, toolCallId? }`. Populates `AgentReport.messages` when `captureMessages` is enabled. |
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

## Teams

`ai.team` is transparent sugar over `ai.supervisor` — the manager becomes `route`/`router`, members become `intents`, and the gate becomes `evaluate`. It returns the unchanged `SupervisorContract<TOutput>`.

| Export | What it is |
| --- | --- |
| `TeamConfig<TOutput, TState, TMembers>` | Config for `ai.team` — `name`, `manager`, `members`, `gate`, plus pass-throughs (`goal`, `output`, `state`, `maxIterations`, `snapshotStore`, `on`, `observe`). |
| `TeamGate` | `"quality"` (review-then-fix) `| "verify"` (test-then-fix) — built-in gate strategies. |
| `TeamGateFn<TState>` | Fully custom gate — same shape as `SupervisorConfig.evaluate`. |
| `TeamMemberValue` | A role member — `AgentContract<unknown> | WorkflowInstance<unknown, unknown>`. |

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
| `PlannerContract<TOutput>` | Returned by `ai.planner`. Implements `ExecutableContract`. `.execute(goal, opts?)`, `.resume(runId, opts?)`, `.name`, `.signature`. |
| `PlannerConfig<TOutput>` | Config — `model` XOR `planner`, `capabilities`, `maxSteps?`, `output?`, `durable?` (below). |
| `planner.resume(runId, opts?)` | Durable crash-resume. Re-hydrates the plan + executed steps from the snapshot and continues; throws `PlannerDriftError` on a structural mismatch unless `{ force: true }`. |
| `PlannerConfig.durable` | `{ store?: SnapshotStore<PlannerSnapshot>; deleteOnComplete? }` — opt-in checkpointing; `store` falls back to `ai.config({ defaultSnapshotStore })`. |
| `PlannerSnapshot` / `PlannerSnapshotStatus` / `PlannerResumeOptions<TOutput>` | The persisted planner state, its status, and `resume()` options. |
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
| `MemoryTier` | `"working" | "semantic" | "episodic" | "procedural"` — all four tiers shipped in 4.3.0. |
| `RecalledMemory` | `{ id, text, tier, score, metadata? }`. |
| `RecallOptions` | `{ k?, tier?, threshold? }`. |

## Skills

`ai.skills` builds a runtime skills library — an always-injected metadata catalog plus an on-demand `loadSkill` tool (progressive disclosure), backed by directory / url / store sources.

| Export | What it is |
| --- | --- |
| `SkillsContract` | Returned by `ai.skills`. The mechanism the agent `skills` option drives. |
| `SkillsConfig` | Config — `sources`, `inject?`, `scope?`, `review?`, `store?`. |
| `SkillRecord` | `{ name, description, version, body, tags?, type, metadata? }` — `type: "authored" | "promoted" | "candidate"`. |
| `SkillCatalogEntry` | Cheap catalog entry — `Pick<SkillRecord, "name" | "description" | "version" | "tags" | "type">` (no `body`). |
| `SkillSource` / `SkillInjectMode` / `SkillReviewGate` / `SkillAnalyticsEvent` | Source descriptors, injection policy, review gate, analytics hook. |
| `LoadSkillInput` | `{ name, version? }` — validated input of the `loadSkill` tool. |
| `SkillsStoreContract` | Pluggable store backing a `store` source. `MockSkillsStore` / `proceduralSkillStore()` ship as implementations. |
| `loadSkillTool(deps)` | Factory that builds the per-run `loadSkill` `ToolContract<LoadSkillInput, LoadSkillResult>` (progressive-disclosure body loader with a per-run load budget). `ai.skills` wires this for you. |
| `LoadSkillResult` / `LoadSkillToolDeps` | Result fed back to the model — `{ body, name, version } \| { error }` — and the deps the tool closes over (`load`, `maxLoadsPerRun`, `onLoaded?`). |
| `saveSkillTool(deps)` / `SaveSkillToolDeps` | Factory for the Phase-2 `saveSkill` tool (writes an inert `type: "candidate"`); auto-registered only when a `review` gate is set. |
| `SaveSkillInput` / `SaveSkillResult` | `saveSkill` input `{ name, description, body, tags? }` and result `{ saved: true; name; status: "candidate" } \| { error }`. |
| `runReviewGate(candidate, gate, emit?)` | Run a candidate skill through the default-DENY Phase-2 review gate; promotes on `{ approve: true }`, else denies (fail-closed). Resolves a `ReviewOutcome`; never throws. |
| `ReviewOutcome` | `{ promoted: true; record; reason? }` \| `{ promoted: false; reason? }`. |

## RAG

`ai.rag` is a native core verb — chunk → embed → vector store → retrieve → rerank → cite. It reuses the `EmbedderContract` and a `@warlock.js/cache` driver as the vector store, with zero new dependencies.

| Export | What it is |
| --- | --- |
| `Rag` | Returned by `ai.rag`. `.index()`, `.retrieve()`, `.clear()`, `.asTool()`, `.name`. |
| `RagConfig` | Config — `embedder` (required), `store?`, `name?`, `namespace?`, `chunk?`, `reranker?`, `retrieve?`. |
| `RagAsToolOptions` | `asTool()` options — `name?`, `description?`, `retrieve?`. |
| `RagDocument` | A source document handed to `index()`. |
| `Chunk` / `ChunkOptions` / `ChunkType` | The chunker surface; `ai.rag` ships fixed / sentence / markdown / recursive splitters via `chunk`. |
| `RetrievedChunk` | A single retrieval hit — `{ text, score, citation }`. |
| `Citation` | `{ sourceId, chunkIndex, span, score, metadata? }` — provenance for grounding. |
| `RetrieveOptions` | `{ topK?, threshold?, candidates?, tags? }`. |
| `RetrieveResult` | `{ query, chunks: RetrievedChunk[] }`. |
| `RagReranker` | Reranker contract. `ai.rag.keywordReranker(opts?)` / `ai.rag.llmReranker(opts)` ship as built-ins; `KeywordRerankerOptions` / `LlmRerankerOptions` are their option shapes. |
| `VectorStore` | Vector-store adapter. `ai.rag.cacheVectorStore` wraps a `@warlock.js/cache` driver; `ai.rag.pgVectorStore` is a native pgvector-backed store. |
| `ai.rag.pgVectorStore(options)` | Postgres + `pgvector` `VectorStore` — `{ client \| connectionString, dimensions, table?, ... }`. Emits reference DDL via `.schema()` / `.ensureSchema()` for a migration. |
| `ai.rag.vectorLiteral(vector)` | Serialize a `number[]` to a pgvector literal (`"[1,0.5,-2]"`); throws on non-finite components. |
| `PgVectorStoreOptions` / `PgVectorStoreInstance` | The `pgVectorStore` option shape and the returned store (adds `schema` / `ensureSchema`). |
| `ai.rag.loadText(input, opts?)` | Turn a string (or strings) into `RagDocument`(s) — zero-dependency; the loader every other loader funnels into. |
| `ai.rag.loadHtml(html, opts?)` | Strip raw HTML → text `RagDocument` (regex + entity decode, no DOM parser); lifts `<title>` into metadata. |
| `ai.rag.loadWeb(url, opts?)` | Fetch + strip a URL → `RagDocument`. SSRF-safe — routes through `guardedFetch` / `OutboundPolicy` (scheme + host allowlist, post-DNS private-IP guard, byte cap), never a raw `fetch`. |
| `ai.rag.loadPdf(bytes, opts?)` | PDF bytes → `RagDocument`(s) (`perPage?`). Lazy optional peer — dynamic-imports `pdf-parse` on first use; throws curated install instructions when absent. |
| `RagLoaderResult` / `RagLoaderMetadata` / `RagLoaderType` / `RagLoaderOptions` | Shared loader output, derived metadata (`source`, `loader`, `title`), type tag, and base options. |
| `LoadTextOptions` / `LoadHtmlOptions` / `LoadWebOptions` / `LoadPdfOptions` / `TextInput` | Per-loader option shapes + the `loadText` input type. |
| `PDF_PARSE_INSTALL_INSTRUCTIONS` | The curated install string `loadPdf` throws when the `pdf-parse` peer is missing (exported for tests / callers that match it). |
| `bm25Rank(query, docs)` | BM25 lexical ranking over a candidate set (`k1 = 1.5`, `b = 0.75`; zero-score docs dropped). Pure; no global index. See [Hybrid retrieval](../the-basics/hybrid-retrieval). |
| `reciprocalRankFusion(rankedLists, k?)` | Fuse several ranked id lists into one consensus ranking via RRF (`k` default `60`) — no score calibration needed. |
| `hybridRank(params)` | Convenience wrapper — runs `bm25Rank` over `candidates` and fuses it with your `dense` ranking via RRF. |
| `multiQuery(model, query, opts?)` | Ask a model for `opts.n` (default 3) alternative phrasings of a query; de-duped, original prepended (unless `includeOriginal: false`). Widens retrieval over vocabulary the original missed. |

## Batch + eval

| Export | What it is |
| --- | --- |
| `BatchResult<TResult>` | `{ type: "batch", data[], items[], usage, report }`. |
| `BatchItemResult<TResult>` | `{ index, status, result?, error?, attempts }`. |
| `BatchOptions<TResult>` | `{ concurrency?, retry?, onItem?, signal?, sessionId?, name? }`. |
| `BatchReport` | Per-item rollup — `{ total, succeeded, failed, cancelled }`. |
| `EvalReport<T>` / `EvalCase` / `EvalScore` / `EvalScorer` / `EvalJudge` / `EvalOptions` / `EvalCaseResult` | `agent.eval()` surface. |
| `DatasetContract<TOutput>` | Returned by `ai.dataset`. Immutable, `.filter()` / `.shard()`-able cases that feed `agent.eval({ cases })`. `.name`, `.cases`. |
| `DatasetEntry<TOutput>` / `DatasetOptions<TOutput>` | A dataset row (a superset of `EvalCase` plus `tags?`); factory options (`name`, `cases?`, `fromFile?` JSONL). |
| `EvalRegression` | Regression verdict attached when `agent.eval` gets a `baseline` — `{ regressed[], removed, added, passed }`. |
| `ai.eval.toJUnit(report)` | JUnit-XML artifact for CI ingestion. |
| `ai.eval.toJSON(report)` / `ai.eval.fromJSON(serialized)` | Round-trippable `EvalReport` snapshot — today's report becomes tomorrow's `baseline`. |
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
| `ExecutableTool<TIn, TOut>` | Structural shape of an executable (agent / workflow / supervisor) dropped into `tools: []` without `.asTool()` — `{ name, description?, inputSchema?, execute() }`, no `invoke`. |
| `AgentToolEntry<TIn, TOut>` | An entry accepted in `tools: []` — a `ToolContract` or a raw `ExecutableTool` the framework auto-adapts. |
| `executableToTool(executable)` | Adapt one raw `ExecutableTool` into a `ToolContract` (manifest derived from its `name` / `description` / `inputSchema`); throws `AgentExecutionError` when it has no `name`. |
| `normalizeAgentTools(tools?)` | Normalize an agent's `tools: []` to `ToolContract[]` — built tools pass through, raw executables auto-adapt. |
| `isExecutableTool(entry)` | Type guard — `true` when `entry` has `execute()` but no `invoke()`. |
| `ToolConfig<TIn, TOut>` | Config for `ai.tool`. |
| `ToolContext<TArtifacts>` | Second argument to `execute` — `{ artifacts, signal, ... }`. |
| `ToolCall` | One recorded tool call — `{ name, input, output, error?, tripIndex, duration, startedAt, endedAt }`. |
| `ToolMode` | `"feedback" | "silent"`. |

## Streaming structured output

`ai.streamObject` streams token deltas, progressively-parsed partial snapshots, and a final strictly-validated object. See [Stream structured output](../the-basics/stream-structured-output).

| Export | What it is |
| --- | --- |
| `ai.streamObject(params)` | `<T>(params: StreamObjectParams<T>) => AsyncIterable<ObjectStreamEvent<T>>` — the structured-output streaming verb. |
| `collectStreamObject(stream)` | Drain a `streamObject` stream down to just its terminal `done` event. |
| `StreamObjectParams<T>` | Config — `{ model, messages, schema, options? }`; `schema` validates the final object. |
| `ObjectStreamEvent<T>` | `{ type: "text-delta"; delta }` \| `{ type: "partial"; value: unknown }` \| `{ type: "done"; valid: true; value: T; usage }` \| `{ type: "done"; valid: false; error: AIError; usage }`. |
| `parsePartialJson(text)` | Tolerant best-effort parser turning an incomplete streaming JSON prefix into a partial snapshot (`undefined` until parseable). Powers `streamObject`'s `partial` events. |

## Media modality verbs

The output/input-modality track — image, speech, and transcription verbs that share the uniform never-throws `{ data, error, usage, report }` envelope with cost-truth and `observe` routing. Models come from an adapter's `image()` / `speech()` / `transcribe()` factory. See [OpenAI](../providers/openai) and [Google](../providers/google).

| Export | What it is |
| --- | --- |
| `ai.image(params)` | Text-to-image verb. `data.images` is `GeneratedImage[]`. |
| `ImageParams` / `ImageData` / `ImageResult` / `ImageReport` | Verb config (`{ model, prompt, count?, size?, quality?, aspectRatio?, negativePrompt?, ... }`), data, envelope, and report node. |
| `ImageModelContract` | Returned by `sdk.image({ name })`. Peer of `EmbedderContract` on the adapter. |
| `GeneratedImage` | `{ type: "base64"; base64; mediaType; revisedPrompt? } \| { type: "url"; url; mediaType?; revisedPrompt? }`. |
| `ImageModelPricing` | `{ input?, output?, perImage?, perImageBySize? }` — token-metered (gpt-image) or per-image (DALL·E / Imagen). |
| `computeImageCost` | Cost helper folding image spend into the shared `Usage.cost`. |
| `ai.speech(params)` | Text-to-speech verb. `data.audio` is `GeneratedAudio`. |
| `SpeechParams` / `SpeechData` / `SpeechResult` / `SpeechReport` | Verb config (`{ model, text, voice?, format?, speed?, instructions?, ... }`), data, envelope, and report node (`report.characters`). |
| `SpeechModelContract` | Returned by `sdk.speech({ name, voice? })`. |
| `GeneratedAudio` | `{ type: "base64"; base64; mediaType }` — discriminated, leaving room for a future `url` variant. |
| `SpeechModelPricing` | `{ input?, output?, perMillionCharacters? }` — per-token (gpt-4o-mini-tts) or per-character (tts-1). |
| `ai.transcribe(params)` | Speech-to-text verb. `data.text` + optional `data.segments`. |
| `TranscribeParams` / `TranscriptionData` / `TranscriptionResult` / `TranscriptionReport` | Verb config (`{ model, audio, language?, prompt?, format?, ... }`), data, envelope, and report node (`report.durationSeconds`). |
| `TranscriptionModelContract` | Returned by `sdk.transcribe({ name })`. |
| `TranscriptionSegment` | `{ text; start?; end? }` — timestamped segment (whisper `verbose_json`). |
| `TranscriptionModelPricing` | `{ input?, output?, perMinute? }` — per-token (gpt-4o-transcribe) or per-minute (whisper-1). |
| `ai.audioFromFile(path, opts?)` | Read a file → `AudioInput`; infers media type (`.ogg` / `.opus` / `.m4a` recognized), override with `{ mediaType }`. |
| `ai.audioFromBuffer(bytes, mediaType, filename?)` | Package raw bytes → `AudioInput`. No I/O, no AI. |
| `AudioInput` | `{ base64; mediaType; filename? }` — provider-neutral, serializable audio payload for `ai.transcribe`. |
| `MockImageModel` / `MockSpeechModel` / `MockTranscriptionModel` | Deterministic HTTP-free doubles; also wired via `MockSDK({ imageResponses, speechResponses, transcriptionResponses, ... })`. |

> **Live rich-media add-on — `@warlock.js/ai-live`.** A side-effect `import "@warlock.js/ai-live"` mounts two heavyweight modalities onto the shared `ai.*` facade: `ai.video({ model, prompt })` — text-to-video (async submit→poll hidden behind the same uniform envelope, per-second cost-truth), and `ai.realtime({ transport, model })` — a stateful duplex voice **session** over a pluggable `RealtimeTransport` (`sendAudio` / `sendText` / `events()` / `close() → RealtimeReport`). Exports include `VideoModelContract`, `GeneratedVideo`, `VideoModelPricing`, `RealtimeSession`, `RealtimeEvent`, `RealtimeReport`, plus `MockVideoModel` / `MockRealtimeTransport`. Shipped from its own package so the core stays dependency-light.

## System prompts

| Export | What it is |
| --- | --- |
| `SystemPrompt` | Immutable builder returned by `ai.systemPrompt`. `.persona(t)`, `.instruction(t)`, `.merge(...)`, `.meta(...)`, `.validate(...)`, `.resolve(placeholders)`. |
| `SystemPrompt.merge(...)` | Fold blocks (`...blocks`), a whole prompt (`merge(contract)` — persona replaces, instructions append, `composedFrom` provenance recorded), or a registered name (`merge(name, { fromVersion })`) into a new builder. Immutable. |
| `SystemPrompt.meta(meta?)` | No-arg reads the `{ name, version, description, required, composedFrom }` snapshot (or `undefined`); the updater form returns a new builder — giving it a `name` auto-registers it in `ai.prompts`. |
| `SystemPrompt.validate(options?)` | Sugar over `ai.prompts.validate(this, options)` — deterministic missing-placeholder check + optional Nova-safe judge. |
| `SystemPromptMeta` | `{ name?, version?, description?, composedFrom?, required? }`. |
| `SystemPromptContract` | Interface implemented by `SystemPrompt`. |
| `SystemPromptBlockContract` | Discriminated union — `PersonaContract | InstructionContract`. |
| `PersonaContract` | `{ type: "persona", text, resolve }`. |
| `InstructionContract` | `{ type: "instruction", text, resolve }`. |

### Prompt registry — `ai.prompts`

`ai.prompts` is the process-wide registry of named, versioned `systemPrompt(...)` builders keyed by `name@version`. A named prompt auto-registers; resolve / merge / validate / diff by name. `prompts(options?)` builds an isolated registry. See [Prompt registry](../the-basics/prompt-registry).

| Export | What it is |
| --- | --- |
| `ai.prompts` | The default `PromptsManagerContract`. `.register()`, `.create()`, `.get()`, `.has()`, `.list()`, `.versions()`, `.resolve()`, `.define()`, `.tag()`, `.validate()`, `.diff()`, `.export()`, `.import()`. |
| `prompts(options?)` | Factory for an isolated manager — options `{ judgeCache? }`. |
| `PromptsManagerContract` | The manager interface above. |
| `PromptsManagerEntry` | One registered entry — `{ name, version, addedAt, contract, tags? }`. |
| `PromptTemplateVersion` | A `define` entry — `{ version, template: string | block[] }`. |
| `PromptsValidateOptions` | `validate` options — `{ placeholders?, declare?, judge?, judgeCache? }`. |
| `PromptValidationResult` | `validate` outcome — `{ ok, missing, score?, issues? }` (`ok` is the deterministic verdict; the judge never flips it). |
| `PromptValidateTarget` | What `validate` accepts — a name, a `SystemPromptContract`, or a raw string. |
| `PromptDiff` / `PromptDiffBlock` | `diff(name, from, to)` outcome — `{ added, removed, changed, identical }`. |
| `ExportedRegistry` / `ExportedPrompt` / `ExportedPromptVersion` | The portable `export()` / `import()` snapshot shapes. |

> ⚠ **Breaking:** `ai.prompt` is now a thin facade over `ai.prompts`. The isolated `ai.prompt({ … })` options form (`PromptRegistryContract` with `.register()` / `.add()` / `.resolve()` / `.validate()` / `.sync()`, Langfuse sync) is unchanged; a bare `ai.prompt()` no longer mints a private registry — use `ai.prompts` or build one with `prompts(...)`.

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

## Guardrails

`ai.guardrail` is the content-intelligence suite — a composed input / output / tool middleware built from detector factories. (The older `ai.middleware.guardrail` is the legacy pre/post-check seed; both ship.)

| Export | What it is |
| --- | --- |
| `ai.guardrail(options)` | Build the composed guardrail `AgentMiddleware`. `GuardrailFactory` typed. |
| `ai.guardrail.pii(opts?)` | PII detector (regex + dictionary, zero runtime dep). |
| `ai.guardrail.topic(opts)` | Topic filter (allow / deny string `|` RegExp lists). |
| `ai.guardrail.injection(opts?)` | Jailbreak / prompt-injection marker detector. |
| `ai.guardrail.moderation(opts?)` | Optional OpenAI-backed moderation (lazy `openai` peer). |
| `GuardOptions` | Factory options — `input` / `output` / `tool` detector arrays plus escalation. |
| `GuardrailVerdict` | Discriminated union — `allow` / `redact` / `block` / `flag`, one shape per action. |
| `GuardrailAction` | `"allow" | "redact" | "block" | "flag"`. |
| `GuardrailPhase` | `"input" | "output" | "tool"`. |
| `GuardrailMatch` | One detector match — `{ rule, span?, label? }`. |
| `GuardrailDetector` / `GuardrailDetectorContext` / `GuardrailEscalation` / `GuardrailBlockEvent` | Detector contract, per-check context, escalation hook, emitted block event. |
| `PiiDetectorOptions` / `PiiCategory` / `TopicFilterOptions` / `InjectionDetectorOptions` / `OpenAiModerationOptions` | Per-detector option shapes. |
| `guard` | The standalone factory `ai.guardrail` wraps; `FlagRecord` is its flagged-match record. |

## Human-in-the-loop

`ai.human.*` adds interrupt / resume tool approval — a `tool.before` gate plus durable interrupt stores and out-of-process resume.

| Export | What it is |
| --- | --- |
| `ai.human.approval(options)` | The `tool.before` approval-gate `AgentMiddleware`. `humanApproval` standalone. |
| `ai.human.resume(id, decision, options)` | Out-of-process durable resume — replays a decision against a persisted interrupt. |
| `ai.human.interrupt.{memory,pg,redis}()` | Durable `InterruptStore` factories (memory ships real; pg / redis are lazy optional peers). |
| `HumanApprovalOptions` / `ApprovalHandler` / `ApprovalRequest` / `ApprovalRequestContext` | Gate config, handler, and the request a reviewer sees. |
| `ApprovalDecision` / `ApprovalDecisionType` | A reviewer's decision — `approve` / `reject` / `edit`. |
| `InterruptStore` / `InterruptPolicy` / `PendingInterrupt` / `PendingInterruptStatus` | Durable-store contract, gating policy, and the persisted interrupt row. |
| `ResumeOptions` / `ResumeResult` | `resume()` options and outcome. |
| `PolicyContext` / `PolicyVerdict` / `evaluatePolicy` | Policy seam used to decide whether a call needs approval. |
| `PgInterruptOptions` / `RedisInterruptOptions` | `interrupt.pg` / `.redis` options. |

## VCR (record / replay)

`ai.vcr` decorates any `ModelContract` to record and replay model calls — deterministic, offline tests with no live provider hit.

| Export | What it is |
| --- | --- |
| `VcrModel` | The decorated model returned by `ai.vcr`. Adds `.save()` and a readonly `.cassette`. |
| `VcrOptions` | `{ path, mode?, hashOptions? }`. |
| `VcrMode` | `"record" | "replay" | "auto"` (default `"auto"` — replay on hit, record on miss). |
| `Cassette` | On-disk format — `{ version, model, provider, entries }`. |
| `CassetteEntry` | One recorded request → response pair (`response` / `chunks` / `error`). |
| `hashRequest` / `DEFAULT_HASH_OPTIONS` | Request-hashing helper + the default hashed `ModelCallOptions` fields. |

## Observe

A generic, panoptic-agnostic observability seam. Observability tools (panoptic, OTel, …) implement `Observer` and register themselves; flows route their completed reports through the registry with no core import.

| Export | What it is |
| --- | --- |
| `registerObserver(observer)` | Register an `Observer` into the process-wide registry. |
| `getObservers()` | The currently registered observers. |
| `setObserveAll(value)` / `isObserveAll()` | Toggle / read the "observe every flow by default" flag. |
| `clearObservers()` | Drop all registered observers (test teardown). |
| `resolveObservers(option)` | Resolve a flow's `FlowObserveOption` against the registry. |
| `onConfigApplied(listener)` | Subscribe to `ai.config(...)` application so a tool can pick up its opaque config slot. |
| `Observer` | The structural observer contract a tool implements. |
| `FlowObserveOption` | A flow's `observe` value — `true` / `false` / a flow-local `Observer`. |

## Serve over SSE

Turn any streaming primitive (agent / supervisor / orchestrator) into a `node:http` handler that streams its run to the client as Server-Sent Events. See [Serve over SSE](../digging-deeper/serve-over-sse).

| Export | What it is |
| --- | --- |
| `ai.serve(executable, options?)` | Turn a `ServableExecutable` into a `(req, res) => void` `node:http` handler. POST `{ input, sessionId?, history? }`; responds `text/event-stream` — one frame per event, then a `result` frame, then `[DONE]`. Honors `authToken` (Bearer → `401`) and `nosniff` / `DENY` security headers. |
| `ServeOptions<TInput>` | `serve` options — `authToken?` (Bearer gate), `toInput?` (map body → input, default `body.input`), `toOptions?` (map body → per-call stream options, default passes `sessionId` / `history`). |
| `ServableExecutable<TInput>` | What `serve` can expose — anything whose `stream(input, options?)` returns a `StreamLike`. Agents, supervisors, and orchestrators satisfy it. |
| `streamToSSE(stream)` | Async generator that converts a `StreamLike` into SSE frame strings — one frame per event, then a `result` (or `error`) frame, then `[DONE]`. Transport-agnostic. |
| `encodeSSE(frame)` | Encode one SSE frame from `{ event?, data, id? }`; multi-line `data` is split into multiple `data:` lines per the spec. |
| `SSE_DONE` | The terminal `data: [DONE]` frame a client watches for. |
| `StreamLike<TEvent, TResult>` | `AsyncIterable<TEvent> & { result?: Promise<TResult> }` — the shape every primitive's `stream()` returns. |

## Errors

All extend `AIError`. Stable `code` strings listed in [Handle errors](../digging-deeper/handle-errors).

| Class | Code | Category |
| --- | --- | --- |
| `AIError` | (base) | varies |
| `AgentExecutionError` | `AGENT_EXEC_FAILED` | varies |
| `AgentDriftError` | `AGENT_DRIFT` | `drift` |
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
| `PlannerDriftError` | `PLANNER_DRIFT` | `drift` |
| `PlannerCancelledError` | `PLANNER_CANCELLED` | `cancelled` |
| `PromptNotFoundError` | `PROVIDER_INVALID_REQUEST` | `validation` |
| `PromptValidationError` | `SCHEMA_VALIDATION_FAILED` | `validation` |
| `VcrCassetteMissError` | `VCR_CASSETTE_MISS` | `unknown` |
| `ApprovalRejectedError` | `APPROVAL_REJECTED` | `unknown` |
| `InterruptSuspendedError` | `INTERRUPT_SUSPENDED` | `unknown` |
| `OutboundPolicyError` | `OUTBOUND_POLICY_BLOCKED` | `unknown` |

## Configuration

| Export | What it is |
| --- | --- |
| `AIConfig` | `{ defaultStore?, defaultCheckpointStore?, defaultSnapshotStore? }` — process-wide config. `defaultStore` is the **cache** driver (semanticCache + memory vector store); `defaultSnapshotStore` / `defaultCheckpointStore` are the snapshot / checkpoint stores. |
| `ai.config(partial)` | Merge into the process-wide config. |

## Security

A shared trust-boundary foundation used by every server-side outbound request (attachment fetches, URL skill sources, RAG loaders) plus secret-scrubbing for logs / errors. See [Outbound policy](../digging-deeper/outbound-policy) and [Redact secrets](../digging-deeper/redact-secrets).

| Export | What it is |
| --- | --- |
| `OutboundPolicy` / `ResolvedOutboundPolicy` | Outbound-request controls — `allowedSchemes?` (default `["https"]`), `hostAllowlist?`, `denyPrivateIPsAfterDNS?` (default `true`), `maxBytes?` (5 MiB), `timeoutMs?` (10s), `signal?`, `fetch?`. The resolved form has every default filled. |
| `resolveOutboundPolicy(policy?)` | Fill a partial policy with the strict defaults (idempotent). |
| `assertUrlAllowed(url, policy)` | Validate scheme + host allowlist + post-DNS private-IP guard before any fetch. Returns the parsed `URL`; throws `OutboundPolicyError`. |
| `guardedFetch(url, policy, init?)` | `assertUrlAllowed` + timeout-merged `fetch` → raw `Response`. Read it with `readTextCapped`. |
| `fetchTextWithPolicy(url, policy, init?)` | `guardedFetch` + `readTextCapped` → `{ ok, status, statusText, text }`. |
| `readTextCapped(response, maxBytes)` | Read a body as UTF-8 with a hard byte cap. |
| `isPrivateOrReservedIp(ip)` | `true` for private / loopback / link-local / unique-local / cloud-metadata addresses — the post-DNS SSRF predicate. |
| `redact(value, options?)` | Deep-copy with sensitive-keyed properties replaced by a placeholder (key-driven). |
| `scrubSecrets(text)` | Scrub known secret shapes (Bearer tokens, `sk-…`, `xox…`, `ghp_…`, `AKIA…`) from free-form text. |
| `redactError(error, options?)` | Serialize an error secret-free (`RedactedError`) — `stack` omitted unless `includeStack: true`; `cause` deep-redacted. |
| `redactHeaders` / `DEFAULT_SENSITIVE_KEYS` / `SENSITIVE_HEADERS` / `RedactOptions` / `RedactedError` | Header scrubbing + the built-in sensitive-key/header sets + option / result types. |

## Reports — shared shapes

| Export | What it is |
| --- | --- |
| `BaseReport` | Common report shape — `runId`, `rootRunId`, `parentRunId?`, `reportSchemaVersion`, `version?`, `sessionId?`. |
| `LLMTrip` | One round-trip — `{ index, finishReason, usage, startedAt, endedAt, duration, ... }`. |
| `FinishReason` | `"stop" | "tool_calls" | "length" | "content_filter" | "error"`. |

## Mocks & test doubles

| Export | What it is |
| --- | --- |
| `MockSDK` | Test double for any `SDKAdapterContract`. Use in tests instead of hitting real providers. |
| `MockModel` | Backing model with scripted responses. |
| `mockAgent` | Wires `MockSDK` → mock model → `agent()` in one call — a scripted agent without the boilerplate. |
| `mockRouter` | Deterministic supervisor router double — script the per-iteration routing decisions (or a predicate over `RouteContext`). |
| `registerAiMatchers` | Register the Vitest matchers (`matchConverge`, `matchOutputShape`, `matchPassStep`, `matchRouteTo`). |

## Related

- [Pick a provider](../getting-started/03-pick-a-provider) — adapter contract.
- [The basics](../the-basics/run-agent) — must-know surface in narrative form.
- [Handle errors](../digging-deeper/handle-errors) — full error semantics.

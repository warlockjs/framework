---
name: handle-ai-errors
description: 'Typed AIError hierarchy with stable code strings + coarse category for retry-policy dispatch. execute() never throws — errors surface via result.error (the sole exception: OrchestratorConfigError throws at construction). Triggers: `ProviderOverloadedError`, `PROVIDER_OVERLOADED`, `error.billed`, `error.retryable`, `error.status`, `AIError`, `ProviderRateLimitError`, `ProviderAuthError`, `ContextLengthExceededError`, `ContentFilterError`, `SchemaValidationError`, `ToolExecutionError`, `WorkflowDriftError`, `SupervisorDriftError`, `SupervisorFailedError`, `SupervisorRoutingError`, `OrchestratorFailedError`, `OrchestratorDriftError`, `OrchestratorConfigError`, `OrchestratorCancelledError`, `PlannerFailedError`, `PlannerPlanInvalidError`, `PlannerCancelledError`, `BudgetExceededError`, `GuardrailViolationError`, `error.code`, `error.category`; ''handle ai error'', ''retry on rate limit'', ''branch on error code'', ''ORCHESTRATOR_DRIFT'', ''PLANNER_PLAN_INVALID'', ''build fallback ladder''; typical import `import { AIError } from "@warlock.js/ai"`. Skip: log surfacing — the `log-ai-calls` topic; native `try / catch` on raw `openai`.'
---

# Typed errors — `AIError` hierarchy

Every error surfaced by `@warlock.js/ai` and every adapter package is an `AIError` subclass with a stable `code`. The base extends platform `Error`; it does NOT extend `HttpError`. Plain `Error` never leaks.

## Two invariants

1. **`execute()` never throws.** Every `agent.execute()` / `workflow.execute()` resolves with a well-formed result. Failures funnel into `result.error`. Same for `stream.result`.
2. **Every error is an `AIError`.** Both core and adapter packages funnel everything through `AIError` subclasses. Branch on `error.code` (stable string) or `instanceof`.

## Dispatch pattern

```ts
import {
  AIError,
  ProviderRateLimitError,
  ProviderAuthError,
  ContextLengthExceededError,
  ContentFilterError,
  SchemaValidationError,
  ToolExecutionError,
  WorkflowDriftError,
  // ...
} from "@warlock.js/ai";
import type { AgentContract } from "@warlock.js/ai";

declare const agent: AgentContract;
declare function sleep(ms: number): Promise<void>;
declare function retry(): Promise<unknown>;
declare function truncateAndRetry(error: ContextLengthExceededError): Promise<unknown>;

async function answer(input: string) {
  const result = await agent.execute(input);

  if (!result.error) return result.data;

  if (result.error instanceof ProviderRateLimitError) {
    await sleep(result.error.retryAfter ?? 1000);
    return retry();
  }

  if (result.error instanceof ContextLengthExceededError) {
    return truncateAndRetry(result.error);
  }

  // Or branch on stable code string (good for persisted logs / metrics)
  switch (result.error.code) {
    case "PROVIDER_RATE_LIMIT":
      /* ... */ break;
    case "CONTENT_FILTER":
      /* ... */ break;
    case "WORKFLOW_DRIFT":
      /* ... */ break;
  }
}
```

Codes are the public contract — class names may evolve; codes stay.

## Coarse dispatch via `error.category`

Too granular to dashboard on `code` — every `AIError` carries a coarser `category`:

```ts
type ErrorCategory =
  | "auth"
  | "rate-limit"
  | "timeout"
  | "validation"
  | "content-filter"
  | "provider"
  | "tool"
  | "cancelled"
  | "max-trips"
  | "incomplete"
  | "max-iterations"
  | "max-steps"
  | "schema"
  | "drift"
  | "routing"
  | "guardrail"
  | "budget"
  | "quota"
  | "context-length"
  | "unknown";

switch (result.error.category) {
  case "rate-limit":
    return retryWithBackoff();
  case "timeout":
    return retryOnce();
  case "auth":
    return escalate(); // not retryable
  case "content-filter":
    return policyMessage(); // not retryable
  case "schema":
    return repair(); // use agent `repair`
  case "incomplete":
    return retryBigger(); // answer cut off — see AgentIncompleteError below
}

metrics.increment("ai.error", { category: result.error.category });
```

Each typed subclass declares its `static defaultCategory`. The 4th-arg category override exists only on the base `AIError` for direct `new AIError(...)` usage.

## Cut-off answers — `AgentIncompleteError`

When the final model response is cut off by the output token cap (`finishReason: "length"`) or the context window (`"context_exceeded"`), the run ends with `report.status: "incomplete"` and `result.error` an `AgentIncompleteError` — never a silent success with empty text. A tool call that was cut off mid-input is never executed. Let the agent recover from the output cap with `continueOnOutputLimit`:

```ts
import { AgentIncompleteError, ai } from "@warlock.js/ai";
import type { ModelContract, ToolContract } from "@warlock.js/ai";

declare const model: ModelContract;
declare const writeFile: ToolContract; // a file-writing tool
declare const task: string;

const worker = ai.agent({ model, tools: [writeFile], continueOnOutputLimit: 2 });
const result = await worker.execute(task);

if (result.error instanceof AgentIncompleteError) {
  // reason: "output_limit" → raise maxTokens / split the task
  // reason: "context_window" → compact or trim the history (never continued)
  console.warn("agent answer cut off", {
    reason: result.error.reason,
    tripIndex: result.error.tripIndex,
    continuations: result.error.continuations,
    partial: result.text,
  });
}
```

## Hierarchy

```
AIError  (base — code, category, message, cause?, context?)
├── AgentExecutionError          AGENT_EXEC_FAILED
│   ├── AgentCancelledError      AGENT_CANCELLED            { cancelledAt?, reason? } — caller pulled the plug
│   ├── AgentMaxTripsError       AGENT_MAX_TRIPS            { maxTrips } — runaway tool loop hit the cap
│   └── AgentIncompleteError     AGENT_INCOMPLETE           { reason, tripIndex, continuations } — final response cut off
├── SchemaValidationError        SCHEMA_VALIDATION_FAILED   { issues? }
├── ToolExecutionError           TOOL_EXEC_FAILED           { toolName, tripIndex? }
├── WorkflowError                WORKFLOW_ERROR  (base)
│   ├── StepFailedError          STEP_FAILED                { stepName, attempts }
│   ├── WorkflowDriftError       WORKFLOW_DRIFT             { savedSignature, currentSignature, runId }
│   ├── WorkflowCancelledError   WORKFLOW_CANCELLED         { cancelledAt, reason }
│   ├── MaxStepsExceededError    WORKFLOW_MAX_STEPS         { maxSteps }
│   └── RoutingError             WORKFLOW_INVALID_GOTO      { stepName, targetName }
├── SupervisorFailedError        SUPERVISOR_FAILED  (base + authoring/runtime)
│   ├── MaxIterationsError       SUPERVISOR_MAX_ITERATIONS  { maxIterations }
│   ├── SupervisorRoutingError   SUPERVISOR_INVALID_ROUTE   { returned, availableKeys }
│   ├── SupervisorCancelledError SUPERVISOR_CANCELLED       { cancelledAt, reason }
│   └── SupervisorDriftError     SUPERVISOR_DRIFT           { savedSignature, currentSignature, runId }
├── OrchestratorFailedError      ORCHESTRATOR_FAILED  (base — durable-session turn)
│   ├── OrchestratorConfigError    ORCHESTRATOR_CONFIG     authoring-time, THROWS  (validation) — bad ai.orchestrator(config)
│   ├── OrchestratorDriftError     ORCHESTRATOR_DRIFT      { savedSignature, currentSignature, sessionId } (drift) — checkpoint ≠ definition
│   └── OrchestratorCancelledError ORCHESTRATOR_CANCELLED  { cancelledAt, sessionId, reason } (cancelled) — mid-turn abort
├── PlannerFailedError           PLANNER_FAILED  (base — plan generation/execution)
│   ├── PlannerPlanInvalidError    PLANNER_PLAN_INVALID    (schema) — LLM plan unparseable or names an unregistered capability
│   └── PlannerCancelledError      PLANNER_CANCELLED       { cancelledAt, reason } (cancelled) — mid-plan abort
├── ProviderError                PROVIDER_ERROR  (base + catch-all)
│   ├── ProviderRateLimitError   PROVIDER_RATE_LIMIT        { retryAfter? } — transient
│   ├── ProviderOverloadedError  PROVIDER_OVERLOADED        { retryAfter? } — provider busy (529 / 503), retryable
│   ├── QuotaExceededError       PROVIDER_QUOTA_EXCEEDED    — NOT retryable (billing cap)
│   ├── ProviderTimeoutError     PROVIDER_TIMEOUT
│   ├── ContextLengthExceededError CONTEXT_LENGTH_EXCEEDED  { limit?, actual?, modelName? }
│   ├── ContentFilterError       CONTENT_FILTER             { reason?, categories? }
│   ├── InvalidRequestError      PROVIDER_INVALID_REQUEST
│   └── ProviderAuthError        PROVIDER_AUTH
├── BudgetExceededError          BUDGET_EXCEEDED            { limit, actual, unit } — from ai.middleware.budget
└── GuardrailViolationError      GUARDRAIL_VIOLATION        { phase, reason } — from ai.middleware.guardrail
```

> `SupervisorFailedError` doubles as the base for the supervisor family **and** the authoring-time error for bad config (e.g. `route` + `router` both set). It carries extra `SUPERVISOR_INTENT_*` / `SUPERVISOR_DISPATCH_CYCLE` codes for specific intent-validation failures (`SUPERVISOR_INTENT_DESCRIPTION_REQUIRED`, `SUPERVISOR_INTENT_MIXED_DISPATCH`, `SUPERVISOR_INTENT_STREAM_AND_OUTPUT`, `SUPERVISOR_INTENT_STREAM_TO_REQUIRED`, `SUPERVISOR_INTENT_STREAM_ON_WORKFLOW`, `SUPERVISOR_DISPATCH_CYCLE`).

> **Orchestrator + planner families** anchor on `OrchestratorFailedError` / `PlannerFailedError` (the `ORCHESTRATOR_*` / `PLANNER_*` code families). Both follow the never-throw rule: `orchestrator.execute()` / `resume()` / `command()` and `planner.execute()` surface failures on `result.error` with `report.status` `"failed"` / `"cancelled"`. The **one exception** is `OrchestratorConfigError` (`ORCHESTRATOR_CONFIG`) — an authoring-time misconfiguration (`iterate: true` with no resolvable `snapshotStore`, no `checkpointStore`, both `route` and `router` set, `initialAgent` absent from `intents`) that **throws synchronously at construction** so a bad definition fails fast at boot. Child-execution errors (agent / tool / provider / supervisor / workflow) flow through both primitives **unchanged** — captured on the step / turn report and surfaced on `result.error` directly, never re-wrapped into a `PLANNER_*` / `ORCHESTRATOR_*` code. On an `iterate: true` mid-turn cancel the underlying `SupervisorCancelledError` rides on `OrchestratorCancelledError.cause`.

## Error fields

- `code` — stable `AIErrorCode` string.
- `category` — coarse `ErrorCategory`.
- `message` — human-readable.
- `cause?` — root error (often a provider SDK error).
- `context?` — `Record<string, unknown>` for provider-raw diagnostics (`status`, `requestId`, `headers`).

Typed fields (`retryAfter`, `toolName`, `issues`, `stepName`, …) are first-class consumer surface.

Every `ProviderError` (and subclass) also carries:

- `status?: number` — HTTP status of the failed response (`undefined` for transport / mid-stream failures).
- `billed: true | false | "unknown"` — did the failed call cost money? Fails closed: `false` only for 401 / 402 / 403 and for Gemini 400 / 500 (documented free by Google); everything else is `"unknown"` — treat as possibly billed.
- `retryable: boolean` — `true` for rate limit / overload / timeout / 5xx / 408 / 409 / 429; `false` for auth / quota / invalid request / context length / content filter.

`ProviderOverloadedError` maps Anthropic 529 `overloaded_error` (also mid-stream), OpenAI 503 `server_is_overloaded` (and the 503 of the OpenAI-compatible wrappers), Gemini 503 `UNAVAILABLE`, and Bedrock `ServiceUnavailableException`. `ai.fallbackModel` fails over on it by default.

```ts
import { ProviderError, ProviderOverloadedError } from "@warlock.js/ai";

async function settle(error: unknown, retry: () => Promise<void>): Promise<void> {
  if (!(error instanceof ProviderError)) return;

  if (error.billed !== false) {
    console.warn(`call may have been billed (status ${error.status ?? "none"})`);
  }

  if (error instanceof ProviderOverloadedError) {
    await new Promise((resolve) => setTimeout(resolve, error.retryAfter ?? 2_000));
    return retry();
  }

  if (error.retryable) return retry();
}
```

## Retry strategy

| Error family                                                                                                   | Retryable?                                                                              |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `ProviderRateLimitError`                                                                                       | Yes — back off by `retryAfter` ms                                                       |
| `ProviderOverloadedError`                                                                                      | Yes — back off (`retryAfter` when sent) or fail over                                    |
| `ProviderTimeoutError`                                                                                         | Yes — short delay                                                                       |
| `ProviderError` (generic)                                                                                      | Read `error.retryable` (true for 5xx / 408 / 409)                                       |
| `QuotaExceededError`                                                                                           | **No** — needs human intervention                                                       |
| `ProviderAuthError`                                                                                            | **No** — fix config / rotate key                                                        |
| `ContextLengthExceededError`                                                                                   | Only after truncating input                                                             |
| `ContentFilterError`                                                                                           | Usually **no** — the prompt itself is the issue                                         |
| `SchemaValidationError`                                                                                        | Use agent `repair: { maxAttempts }` instead                                             |
| `ToolExecutionError`                                                                                           | Depends on `cause`                                                                      |
| `WorkflowDriftError` / `SupervisorDriftError` / `OrchestratorDriftError`                                       | **No** — manual migration or `force: true`                                              |
| `WorkflowCancelledError` / `SupervisorCancelledError` / `OrchestratorCancelledError` / `PlannerCancelledError` | **No** — caller-driven cancel                                                           |
| `MaxStepsExceededError` / `RoutingError` / `SupervisorRoutingError`                                            | **No** — programmer error                                                               |
| `OrchestratorConfigError`                                                                                      | **No** — authoring-time config bug; thrown at construction                              |
| `PlannerPlanInvalidError`                                                                                      | **No** — bad LLM plan / unregistered capability; re-prompt or fix the capability roster |
| `BudgetExceededError`                                                                                          | **No** — raise the cap, split the workload                                              |
| `GuardrailViolationError` (`phase: "input"`)                                                                   | **No** — block / sanitize at product layer                                              |
| `GuardrailViolationError` (`phase: "output"`)                                                                  | Sometimes — re-prompt with adjusted system message                                      |

## Why extend `Error`, not `HttpError`

- `@warlock.js/ai` is a standalone product — used from CLIs / workers / scripts as often as HTTP handlers.
- Coupling to a web framework pulls HTTP into every consumer.
- AI errors aren't HTTP errors anyway — "rate limit" is a 429 the _upstream provider_ returned, not one the server returns.

The **consumer app** layer (`src/app/ai/`) wraps framework errors with its own `AIError` subclass that extends `HttpError`. See `domains/ai/conventions/errors.md`.

## OpenAI adapter — status + code dispatch

The OpenAI wrapper categorizes via `APIError.status + code` combined:

- `APIError.code` is semantically stable (`context_length_exceeded`, `content_filter`, `invalid_api_key`, etc.) across SDK versions; message strings are not.
- Status alone collapses three distinct failure modes into one bucket (`400` = context-length OR content-filter OR bad-model-name).
- When `code` is missing (proxied deployments), fall back to `status`.
- Name-based detection catches `APIConnectionTimeoutError` and Node-level `ETIMEDOUT` / `ECONNABORTED`.

## Pattern — full fallback ladder

```ts
async function runWithFallbacks(input: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await myAgent.execute(input);

    if (!error) return data;

    if (error instanceof ProviderRateLimitError) {
      await sleep(error.retryAfter ?? 2000);
      continue;
    }

    if (error instanceof ContextLengthExceededError) {
      input = truncate(input, error.limit ?? 4000);
      continue;
    }

    if (error instanceof QuotaExceededError || error instanceof ProviderAuthError) {
      throw error; // not retryable
    }

    throw error; // unknown — give up
  }

  throw new Error("exhausted retries");
}
```

## See also

- The `run-ai-agent` topic — `AgentResult.error`
- The `run-ai-workflow` topic — `WorkflowError` subclasses
- The `run-supervisor` topic — `SupervisorFailedError` family + intent-validation codes
- The `run-orchestrator` topic — `OrchestratorFailedError` family + `ORCHESTRATOR_CONFIG` boot-time throw
- The `run-planner` topic — `PlannerFailedError` family + `PLANNER_PLAN_INVALID`
- The `define-ai-tool` topic — `ToolExecutionError` wrapping
- The `log-ai-calls` topic — error logging
- `domains/ai/conventions/errors.md` — framework vs app error convention

---
title: "Handle errors"
description: The typed AIError hierarchy — stable codes, coarse categories, retry strategy per family.
sidebar:
  order: 6
  label: "Handle errors"
---

Every error surfaced by `@warlock.js/ai` and every adapter package is an `AIError` subclass with a stable `code`. The base extends platform `Error`; it does NOT extend `HttpError`. Plain `Error` never leaks.

## Two invariants

1. **`execute()` never throws.** Every `agent.execute()` / `workflow.execute()` / `supervisor.execute()` resolves with a well-formed result. Failures funnel into `result.error`. Same for `stream.result`.
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
} from "@warlock.js/ai";

const result = await agent.execute(input);

if (!result.error) return result.data;

if (result.error instanceof ProviderRateLimitError) {
  await sleep(result.error.retryAfter ?? 1000);
  return retry();
}

if (result.error instanceof ContextLengthExceededError) {
  return truncateAndRetry(result.error);
}

// Or branch on the stable code string (good for persisted logs / metrics)
switch (result.error.code) {
  case "PROVIDER_RATE_LIMIT": /* ... */ break;
  case "CONTENT_FILTER":      /* ... */ break;
  case "WORKFLOW_DRIFT":      /* ... */ break;
}
```

Codes are the public contract. Class names may evolve; codes stay.

## Coarse dispatch via `error.category`

Too granular to dashboard on `code` — every `AIError` carries a coarser `category`:

```ts
type ErrorCategory =
  | "auth" | "rate-limit" | "timeout" | "validation" | "content-filter"
  | "provider" | "tool" | "cancelled" | "max-trips" | "max-iterations"
  | "max-steps" | "schema" | "drift" | "routing" | "guardrail"
  | "budget" | "quota" | "context-length" | "unknown";

switch (result.error.category) {
  case "rate-limit":     return retryWithBackoff();
  case "timeout":        return retryOnce();
  case "auth":           return escalate();              // not retryable
  case "content-filter": return policyMessage();          // not retryable
  case "schema":         return repair();                 // use agent `repair`
}

metrics.increment("ai.error", { category: result.error.category });
```

Each typed subclass declares a `static defaultCategory`. The 4th-arg override exists only on the base `AIError` for direct `new AIError(...)` usage.

## Hierarchy

```text
AIError  (base — code, category, message, cause?, context?)
├── AgentExecutionError          AGENT_EXEC_FAILED
├── SchemaValidationError        SCHEMA_VALIDATION_FAILED   { issues? }
├── ToolExecutionError           TOOL_EXEC_FAILED           { toolName, tripIndex? }
├── WorkflowError (base)
│   ├── StepFailedError          STEP_FAILED                { stepName, attempts }
│   ├── WorkflowDriftError       WORKFLOW_DRIFT             { savedSignature, currentSignature, runId }
│   ├── WorkflowCancelledError   WORKFLOW_CANCELLED         { cancelledAt, reason }
│   ├── MaxStepsExceededError    WORKFLOW_MAX_STEPS         { maxSteps }
│   └── RoutingError             WORKFLOW_INVALID_GOTO      { stepName, targetName }
├── ProviderError                PROVIDER_ERROR  (base + catch-all)
│   ├── ProviderRateLimitError   PROVIDER_RATE_LIMIT        { retryAfter? } — transient
│   ├── QuotaExceededError       PROVIDER_QUOTA_EXCEEDED    — NOT retryable (billing cap)
│   ├── ProviderTimeoutError     PROVIDER_TIMEOUT
│   ├── ContextLengthExceededError CONTEXT_LENGTH_EXCEEDED  { limit?, actual?, modelName? }
│   ├── ContentFilterError       CONTENT_FILTER             { reason?, categories? }
│   ├── InvalidRequestError      PROVIDER_INVALID_REQUEST
│   └── ProviderAuthError        PROVIDER_AUTH
├── BudgetExceededError          BUDGET_EXCEEDED            { limit, actual, unit } — from ai.middleware.budget
└── GuardrailViolationError      GUARDRAIL_VIOLATION        { phase, reason } — from ai.middleware.guardrail
```

## Error fields

- `code` — stable `AIErrorCode` string.
- `category` — coarse `ErrorCategory`.
- `message` — human-readable.
- `cause?` — root error (often a provider SDK error).
- `context?` — `Record<string, unknown>` for provider-raw diagnostics (`status`, `requestId`, `headers`).

Typed fields (`retryAfter`, `toolName`, `issues`, `stepName`, etc.) are first-class consumer surface.

## Retry strategy

| Error family | Retryable? |
| --- | --- |
| `ProviderRateLimitError` | Yes — back off by `retryAfter` ms |
| `ProviderTimeoutError` | Yes — short delay |
| `ProviderError` (generic) | Maybe — depends on `cause` |
| `QuotaExceededError` | **No** — needs human intervention |
| `ProviderAuthError` | **No** — fix config / rotate key |
| `ContextLengthExceededError` | Only after truncating input |
| `ContentFilterError` | Usually **no** — the prompt is the issue |
| `SchemaValidationError` | Use agent `repair: { maxAttempts }` instead |
| `ToolExecutionError` | Depends on `cause` |
| `WorkflowDriftError` | **No** — manual migration or `force: true` |
| `WorkflowCancelledError` | **No** — caller-driven cancel |
| `MaxStepsExceededError` / `RoutingError` | **No** — programmer error |
| `BudgetExceededError` | **No** — raise the cap, split the workload |
| `GuardrailViolationError` (`phase: "input"`) | **No** — block / sanitize at the product layer |
| `GuardrailViolationError` (`phase: "output"`) | Sometimes — re-prompt with adjusted system message |

## Why extend `Error`, not `HttpError`

- `@warlock.js/ai` is a standalone product — used from CLIs, workers, and scripts as often as HTTP handlers.
- Coupling to a web framework would pull HTTP into every consumer.
- AI errors aren't HTTP errors anyway. "Rate limit" is a 429 the **upstream provider** returned, not one the server returns.

The consumer-app layer (`src/app/ai/`) can wrap framework errors with its own `AIError` subclass that extends `HttpError` if it needs to surface them through HTTP. The framework stays neutral.

## OpenAI adapter — status + code dispatch

The OpenAI wrapper categorizes via `APIError.status + code` combined:

- `APIError.code` is semantically stable (`context_length_exceeded`, `content_filter`, `invalid_api_key`) across SDK versions; message strings are not.
- Status alone collapses three distinct failure modes into one bucket (`400` = context-length OR content-filter OR bad model name).
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
      throw error;   // not retryable
    }

    throw error;     // unknown — give up
  }

  throw new Error("exhausted retries");
}
```

## Related

- [Run agent](../the-basics/run-agent) — `AgentResult.error`.
- [Run workflow](./run-workflow) — `WorkflowError` subclasses.
- [Define tools](../the-basics/define-tools) — `ToolExecutionError` wrapping.
- [Log AI calls](./log-ai-calls) — error logging.

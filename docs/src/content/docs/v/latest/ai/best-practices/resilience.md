---
title: "Best Practices — Resilience and error handling"
sidebar:
  label: "Resilience and error handling"
description: Keep an AI feature standing when a provider rate-limits, a step flakes, or a user cancels — provider failover with ai.fallbackModel, workflow step retry with backoff, branching on the typed AIError taxonomy instead of string-matching, always checking result.error, capping spend with budget middleware, and honoring AbortSignal.
---

The pillar this page answers: **when a provider rate-limits, a step flakes, a budget blows, or a user closes the tab — does your AI feature degrade gracefully, or does it fail the request and burn credit on the way down?**

LLM calls fail in ways ordinary function calls don't: a 429 mid-incident, a slow upstream that never returns, a runaway tool loop that quietly spends two dollars per request. Resilience here is not one feature — it's a small set of disciplines, each matched to a specific failure mode. The throughline: `execute()` never throws, every failure is a *typed* `AIError`, and you react to the type, not a substring of the message.

## The running scenario

A document-ingestion feature for a SaaS product. A user uploads a contract; the system OCRs it (a flaky third-party call), then runs an LLM extraction pass to pull structured fields, and writes the result back. It runs on OpenAI with an Anthropic account on standby. The user can cancel from the UI, and finance has capped what one extraction is allowed to cost. Every recommendation below is about keeping *that* feature standing when one of its moving parts fails.

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { AnthropicSDK } from "@warlock.js/ai-anthropic";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });
const anthropic = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY! });
```

## Always check `result.error` — `execute()` never throws

This is the foundation every other practice sits on. `agent.execute()`, `workflow.execute()`, `supervisor.execute()`, `orchestrator.execute()`, and `stream.result` **never throw** — a failure resolves normally with the error placed on `result.error`. A `try/catch` around `execute()` catches nothing the framework raises, so if you forget to read `result.error` you sail straight past a failed run with `result.data` undefined and no idea why.

**Do this — branch on `result.error` before you touch `result.data`.** A truthy `error` is the run's verdict; treat the absence of it as the only proof the data is real.

```ts
const result = await extractor.execute(`Extract fields from:\n\n${ocrText}`);

if (result.error) {
  logger.error("extraction failed", {
    code: result.error.code,         // stable AIErrorCode string
    category: result.error.category, // coarse ErrorCategory for dashboards
  });

  return { status: "failed" };
}

// Only reachable when error is absent — data is trustworthy here.
return persist(result.data);
```

**Avoid this — wrapping `execute()` in a `try/catch` and trusting `data`.** The `catch` never fires for a provider failure, so the code reads `result.data` on a failed run and silently persists `undefined`.

```ts
// Anti-pattern: the catch is dead code; the failure flows through as success.
try {
  const result = await extractor.execute(input);
  await persist(result.data); // undefined on a failed run — no error ever thrown
} catch (error) {
  // Never reached for framework errors — execute() resolves, it doesn't reject.
}
```

> The single documented exception is `OrchestratorConfigError`, which throws *synchronously at construction* (not from `execute()`) so a misconfigured `ai.orchestrator(...)` fails fast at boot rather than at the first request. Every *runtime* failure — provider, tool, schema, budget, cancellation — surfaces on `result.error`. See the [handle-ai-errors skill](../digging-deeper/handle-errors) for the full never-throw contract.

## Branch on the typed `AIError` taxonomy — never string-match the message

Every error the framework surfaces is an `AIError` subclass with a stable `code` and a coarse `category`. Message *text* is for humans and changes between SDK versions; `code` and `category` are the public contract. Matching `error.message.includes("rate limit")` is a latent bug — it breaks the day a provider rewords its 429, and it can't tell a rate-limit apart from an auth failure that happens to mention "limit." Branch on the type and the retry decision falls out of it.

**Do this — dispatch on `instanceof` (or `error.code`) and let the type carry the typed fields.** A rate-limit knows its own `retryAfter`; a context-length error knows the model's `limit`. The taxonomy hands you the data you need to react.

```ts
import {
  ProviderRateLimitError,
  ContextLengthExceededError,
  ContentFilterError,
  ProviderAuthError,
  QuotaExceededError,
} from "@warlock.js/ai";

const result = await extractor.execute(input);

if (result.error instanceof ProviderRateLimitError) {
  // The server's own Retry-After hint, in ms — no header parsing.
  await sleep(result.error.retryAfter ?? 1000);
  return retry();
}

if (result.error instanceof ContextLengthExceededError) {
  // The error carries the model's limit so you can trim to fit.
  return extractor.execute(truncateToFit(input, result.error.limit));
}

if (
  result.error instanceof ProviderAuthError ||
  result.error instanceof QuotaExceededError ||
  result.error instanceof ContentFilterError
) {
  // None of these get better on retry — escalate or return a policy message.
  return escalate(result.error);
}
```

For dashboards and metrics, the coarser `category` is the right grain — `code` is too granular to chart on:

```ts
metrics.increment("ai.error", { category: result.error.category });

switch (result.error.category) {
  case "rate-limit": return retryWithBackoff();
  case "timeout":    return retryOnce();
  case "auth":       return escalate();        // not retryable
  case "budget":     return degradeToCheaper();
}
```

**Avoid this — string-matching the message to decide retry policy.** It silently misclassifies the moment a provider rewords an error, and it can't reach the typed fields (`retryAfter`, `limit`) that the subclass already parsed for you.

```ts
// Anti-pattern: brittle, version-coupled, and blind to the typed fields.
if (result.error?.message.toLowerCase().includes("rate limit")) {
  await sleep(1000); // no access to error.retryAfter — guessing the backoff
  return retry();
}
```

> The retryability of each code is part of the taxonomy, not a judgement call: `rate-limit` and `timeout` are transient (retry with backoff); `auth`, `quota`, `content-filter`, and the various `drift` / `config` / `cancelled` codes are *not* retryable — retrying only delays the inevitable. The [handle-ai-errors skill](../digging-deeper/handle-errors) has the full code → retryable table.

## Wrap the model in `ai.fallbackModel` for provider failover — it's a failover, not a default

When OpenAI has a regional incident and starts returning 429s and timeouts, every extraction fails for the duration. `ai.fallbackModel` wraps an ordered model list and advances to the next model only on a *transient* provider error, so a provider blip degrades to the backup instead of failing the user. The trap is reaching for it as a cost or quality lever — it does nothing on the happy path, where the primary always answers.

**Do this — order it primary-first, and let the default transient set decide failover.** The first model serves every healthy request; the backup exists for the minutes the primary is down. With no `retryOn`, the chain advances only on rate-limit, timeout, and generic 5xx — exactly the failures a different provider can plausibly absorb.

```ts
// Tries OpenAI first; on a transient provider error, fails over to Anthropic.
const resilientModel = ai.fallbackModel([
  openai.model({ name: "gpt-4o" }),
  anthropic.model({ name: "claude-sonnet-4-6" }),
]);

const extractor = ai.agent({ name: "extract", model: resilientModel });

const result = await extractor.execute(input);

if (result.error) {
  // Every model in the chain failed; the error is the LAST model's,
  // with its original code preserved.
  throw result.error;
}

// Which providers were burned before we got an answer? Empty when the
// primary answered outright; one entry per failed-over model otherwise.
for (const attempt of resilientModel.lastAttempts) {
  metrics.increment("ai.provider.failover", { from: attempt.provider });
}
```

**Avoid this — failing over on non-transient errors, or leaning on the fallback as a normal model.** A bad API key, an oversized prompt, or a content-filter block fails *identically* on every downstream model, so failing over on them only burns the backup's budget on input that can't succeed. The default already excludes them — don't widen `retryOn` to catch them.

```ts
// Anti-pattern: retrying everything sends a bad key / oversized prompt down
// the whole chain, paying every provider to fail the same way.
const greedy = ai.fallbackModel(
  [openai.model({ name: "gpt-4o" }), anthropic.model({ name: "claude-sonnet-4-6" })],
  { retryOn: () => true }, // also fails over on auth, context-length, content-filter
);
```

> `fallbackModel` advances *instantly* with no backoff of its own — it owns "try a different provider," not "wait and retry this one." For a rate-limit you usually want both: a backoff (retry the same provider after `error.retryAfter`) layered around the agent, and a fallback for when the provider stays down. And a *quality* complaint ("answers are weak") is never a fallback problem — the backup only fires on transient failures, so fix the primary model or prompt instead. See the [provider-fallback recipe](../recipes/cost-provider-fallback) for narrowing `retryOn` and the streaming caveat (failover only before the first chunk).

## Retry transient step failures with backoff — keep the predicate narrow

The OCR call is flaky: an occasional `ETIMEDOUT` or `ECONNRESET` that succeeds on the next try. Failing the whole run on the first network blip is the wrong reflex. A workflow step's `retry` block retries with bounded backoff, and `retryOn` keeps the retries pointed at *transient* failures only — a permanent 4xx-style error should fail immediately instead of burning every attempt waiting out a backoff that can't help.

**Do this — bound the retries and gate them with a transient-only predicate.** Exponential backoff spreads the attempts (500ms, 1s, 2s, …, capped at 30s); `retryOn` returning `false` short-circuits the remaining attempts the instant the error is permanent.

```ts
const processDoc = ai.workflow<{ documentId: string; fileUrl: string }>({
  name: "doc-ingestion",
  steps: [
    ai.step({
      name: "ocr",
      retry: {
        attempts: 4,
        backoff: "exponential",
        // Only retry transient network failures; bail fast on the rest.
        retryOn: error => isTransient(error),
        onRetry: (attempt, error) => {
          logger.warn(`ocr retry #${attempt}`, { message: (error as Error).message });
        },
      },
      run: async ctx => {
        ctx.state.text = await ocrService.read(ctx.input.fileUrl);
      },
    }),
    ai.step({
      name: "extract",
      agent: extractor,
      input: ctx => ({ prompt: `Extract fields from:\n\n${ctx.state.text}` }),
    }),
  ],
});

function isTransient(error: unknown): boolean {
  const code = (error as { code?: string }).code;

  return code === "ETIMEDOUT" || code === "ECONNRESET" || code === "EAI_AGAIN";
}
```

**Avoid this — retrying everything, with no backoff.** Retrying a permanent error (bad input, auth failure, malformed request) just delays the failure while burning all four attempts; `backoff: "none"` then hammers the upstream with no breathing room. Both turn a fast, clear failure into a slow, noisy one.

```ts
// Anti-pattern: retries a permanent error four times back-to-back.
ai.step({
  name: "ocr",
  retry: { attempts: 4, backoff: "none" }, // no retryOn → retries bad input too
  run: async ctx => {
    ctx.state.text = await ocrService.read(ctx.input.fileUrl);
  },
});
```

> `retry` wraps the step's whole `before → run | agent → output → after` block, so every phase must be idempotent — a throw in `after` re-runs `before` and `run` on the next attempt. If a step reserves an external resource, acquire it in `before` and release it in `after` so a retried attempt re-acquires cleanly. The resolution precedence is `step.retry` → the workflow's `defaultRetry` → `{ attempts: 1 }` (no retry). See the [workflow retry + cancel recipe](../recipes/workflow-with-retry-cancel) for the full backoff and idempotency rules.

## Cap spend with budget middleware — a runaway loop must not burn credit

The one failure mode that costs *real money* is a tool loop that keeps re-asking the model — it spends dollars and seconds before anyone notices, and you find out from the invoice, not an alert. `ai.middleware.budget` caps cumulative usage per execution and aborts with a typed `BudgetExceededError` the instant a cap is breached, so the worst case is bounded no matter how the model misbehaves.

**Do this — put a hard cap on every agent that has tools, and read the breach numerically.** The error exposes `actual` / `limit` / `unit` as typed fields, so there's no message to parse when you alert.

```ts
import { BudgetExceededError } from "@warlock.js/ai";

const guardedExtractor = ai.agent({
  name: "extract",
  model: openai.model({ name: "gpt-4o" }),
  middleware: [
    ai.middleware.budget({
      maxTokens: 40_000,
      maxCostUSD: 0.05,
      // BudgetPricing is USD per 1K tokens — the per-1K shape, NOT per-1M.
      pricing: {
        "gpt-4o": { inputPer1K: 0.0025, outputPer1K: 0.01 },
      },
      onExceeded: "abort", // default; "warn" logs once and lets the run finish
    }),
  ],
});

const result = await guardedExtractor.execute(input);

if (result.error instanceof BudgetExceededError) {
  // Numeric breach detail — no string parsing.
  metrics.increment("ai.budget.breach", { unit: result.error.unit });
  console.warn(`budget breach: ${result.error.actual} ${result.error.unit} (cap ${result.error.limit})`);
}
```

**Avoid this — shipping a tool-using agent with no ceiling.** With no budget, a tool loop has no upper bound on cost; the first runaway in production is discovered on the bill.

```ts
// Anti-pattern: tools, but nothing stops a re-asking loop from spending freely.
const extractor = ai.agent({
  name: "extract",
  model: openai.model({ name: "gpt-4o" }),
  tools: [lookupClause, fetchTemplate], // a loop here has no cost ceiling
});
```

> Roll a budget out in `warn` mode first (`onExceeded: "warn"` logs once on the first breach and lets the run finish) so you can measure real traffic against a proposed cap before flipping to `"abort"`. For graceful degradation instead of a hard stop, the declarative `contract` clause with `onViolation: "fallback"` records a typed signal an outer middleware reads back to route the *next* turn to a cheaper agent. The budget is per-*execution*, not per-session — for a daily or session-wide cap, read your ledger before the next call and short-circuit at the application layer. See the [budgets-and-slo recipe](../recipes/cost-budgets-and-slo) for the SLO contract and the soft-fallback path.

## Honor `AbortSignal` for user-cancel and deadlines

A user who closes the tab, or a request that blows its deadline, should stop the run — not keep paying for an extraction nobody is waiting for. Pass an `AbortSignal` to `execute` and the run terminates at the next trip (or step) boundary; the agent surfaces an `AgentCancelledError` (category `"cancelled"`), the workflow a `WorkflowCancelledError`. Both are *caller-driven* and explicitly **not** retryable — a cancel is a decision, not a failure to recover from.

**Do this — thread one signal through, and distinguish a cancel from a genuine failure.** Wire the same controller to a UI "Cancel" button and a deadline timer; on the result, branch the cancellation class away from real errors so you don't retry a stop the user asked for.

```ts
import { WorkflowCancelledError } from "@warlock.js/ai";

const controller = new AbortController();

// Hard deadline: abort after 30s. Also wire controller.abort("user cancelled")
// to the UI's Cancel button.
const deadline = setTimeout(() => controller.abort("deadline exceeded"), 30_000);

try {
  const result = await processDoc.execute(
    { documentId: "doc-918", fileUrl },
    { signal: controller.signal },
  );

  if (result.error instanceof WorkflowCancelledError) {
    // Caller pulled the plug — surface a "stopped" state, do NOT retry.
    return { status: "cancelled", reason: result.error.reason };
  }

  if (result.error) {
    return { status: "failed" }; // a genuine failure after retries were exhausted
  }

  return { status: "done", data: result.data };
} finally {
  clearTimeout(deadline);
}
```

**Avoid this — retrying on cancellation, or never wiring a deadline.** Retrying a cancelled run re-runs work the caller explicitly stopped; running with no signal at all means a closed tab keeps an expensive extraction alive to completion, paying for output no one will read.

```ts
// Anti-pattern: a cancel is treated like any other error and retried.
if (result.error) {
  return retry(); // re-runs the work the user just cancelled
}
```

> Cancellation is checked at trip / step boundaries; a mid-trip abort is best-effort and depends on the provider adapter threading the signal into its HTTP client. For workflows, a step's `onCancel` hook fires on abort so it can release whatever that in-flight step reserved — best-effort cleanup whose errors are swallowed, never a place for logic that must succeed. The workflow engine forwards its own signal into agent steps automatically, so one controller cancels the whole pipeline. See the [workflow retry + cancel recipe](../recipes/workflow-with-retry-cancel) for `onCancel` and the cancelled-report shape.

## Avoid list

The short version — the resilience mistakes that turn a recoverable blip into a failed request or a surprise bill:

- **Don't `try/catch` `execute()` and trust `result.data`.** The framework never throws from `execute()`; the `catch` is dead code and an unchecked failure flows through as success. Branch on `result.error` first.
- **Don't string-match `error.message` to decide retry policy.** It breaks when a provider rewords an error and can't reach typed fields like `retryAfter` / `limit`. Branch on `instanceof` or `error.code`; chart on `error.category`.
- **Don't treat `ai.fallbackModel` as a default or a quality fix.** It only fires on transient provider failures and does nothing on the happy path. Order it primary-first and leave the default `retryOn` (transient-only) in place.
- **Don't fail over on non-transient errors.** A bad key, oversized prompt, or content-filter block fails identically downstream — widening `retryOn` just burns the backup's budget.
- **Don't retry every step error with no backoff.** Retrying a permanent failure delays the inevitable and hammers the upstream. Keep `retryOn` to transient signals; use exponential backoff.
- **Don't ship a tool-using agent with no budget.** A runaway tool loop is the one failure mode that costs real money — cap it with `ai.middleware.budget`.
- **Don't retry on cancellation, and don't run without a signal.** A cancel is a decision, not a transient failure; re-running it wastes the work the caller stopped. Thread an `AbortSignal` and branch the cancellation class away from real errors.

## See also

- [Handle AI errors](../digging-deeper/handle-errors) — the full `AIError` taxonomy, the never-throw contract, and the code → retryable table.
- [Recipe — Provider fallback](../recipes/cost-provider-fallback) — `ai.fallbackModel`, narrowing `retryOn`, `lastAttempts`, and the streaming caveat.
- [Recipe — Budget caps and SLO contracts](../recipes/cost-budgets-and-slo) — hard caps, the SLO contract, and the soft-fallback signal.
- [Recipe — Workflow with retry + cancel](../recipes/workflow-with-retry-cancel) — step `retry` with backoff, `AbortSignal`, and the `onCancel` cleanup hook.
- [Best Practices — Cost and efficiency](./cost-and-efficiency) — where the budget and fallback levers sit in the cost picture.
- [Architecture — Middleware](../architecture-concepts/middleware) — the onion model and where the budget built-in runs.
- [Architecture — Workflows](../architecture-concepts/workflows) — the step lifecycle that `retry` and cancellation bound.

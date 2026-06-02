---
title: "Introduction"
description: The agent / workflow / supervisor model and when to reach for which primitive.
sidebar:
  order: 1
  label: "Introduction"
---

`@warlock.js/ai` is the orchestration core. It does not talk to any LLM directly — that's the adapter's job. What it owns is the layer between your code and the model: tool loops, structured output, retries, streaming, snapshot resume, middleware, typed errors, cost tracking.

You'll work with three primitives in production today, plus a fourth on the roadmap.

## The four primitives

```text
ai.agent()        →  one LLM turn, optional tool loop, optional structured output
ai.workflow()     →  ordered steps with deterministic shape, resumable
ai.supervisor()   →  classifier + router + specialists, can iterate to a goal
ai.orchestrator() →  long-lived stateful session (v2 — not shipped)
```

Each rung handles a job the rung below can't do cleanly. Each one is built on the rung below — workflows can dispatch agents, supervisors can dispatch agents and workflows, every primitive exposes `.asTool()` so the model can call into it.

## When to reach for what

- **One model call** with maybe a tool loop → `ai.agent({...})`. Stateless. Lowest overhead.
- **A pipeline with a fixed shape** — fetch, extract, classify, save — and you want it to survive a crash mid-run → `ai.workflow({...})`. Resumable, deterministic.
- **One input, multiple specialists, decided at runtime** — billing vs shipping vs returns — possibly iterated to a satisfactory answer → `ai.supervisor({...})`.

If you find yourself reaching for an orchestrator-style "session that remembers everything across calls" — that's v2 territory. For now, model the session as input + history fed into an agent or supervisor on every call.

## The shape every primitive returns

```ts
type ExecuteResult<T> = {
  type: "agent" | "workflow" | "supervisor";
  data?: T;        // structured output when a schema was supplied
  text?: string;   // raw final LLM text (agent only)
  report: BaseReport;
  usage: Usage;
  error?: AIError;
};
```

`data` carries the typed structured output. `report` carries the trace — trips, tool calls, step snapshots, iteration history — whatever applies to that primitive. `usage` carries tokens plus a per-channel cost breakdown when pricing is configured. `error` is `undefined` on success and a typed `AIError` subclass on failure. Plain `Error` never leaks.

## Two invariants you can count on

1. **`execute()` never throws.** It always resolves with a well-formed result envelope. Branch on `result.error`.
2. **Every error is an `AIError`.** Adapter errors get wrapped (`ProviderRateLimitError`, `ContextLengthExceededError`, `ProviderAuthError`). Middleware errors get wrapped (`BudgetExceededError`, `GuardrailViolationError`). Workflow errors get wrapped (`WorkflowDriftError`, `StepFailedError`). All carry a stable `code` string and a coarse `category` for dispatch.

These two invariants are the reason you can build real systems on top of this — instead of wrapping every call in `try/catch` and inventing your own error taxonomy.

## What lives outside this package

- **The model client.** OpenAI's SDK, Anthropic's, Bedrock's — each lives in a sibling adapter package. See [Pick a provider](./03-pick-a-provider).
- **Persistence.** Snapshot resume and semantic cache delegate to `@warlock.js/cache`. Memory, file, Redis, Postgres (with pgvector for similarity) — all interchangeable.
- **Logging.** `@warlock.js/logger`'s `log` singleton. Configure channels once at boot.
- **Schemas.** Anything implementing `StandardSchemaV1<T>` works — `@warlock.js/seal` (recommended), Zod, Valibot, hand-rolled.

That's the whole picture. Next: install the package and pick an adapter.

## Related

- [Installation](./02-installation) — the install steps for standalone and Warlock.js contexts.
- [Pick a provider](./03-pick-a-provider) — comparison across the five adapters.
- [Your first agent](./04-your-first-agent) — runnable five-minute walkthrough.

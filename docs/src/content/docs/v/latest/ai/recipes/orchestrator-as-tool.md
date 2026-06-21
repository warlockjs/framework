---
title: "Recipe — Orchestrator as a tool"
description: Nest a stateful refund orchestrator inside a concierge agent with asTool and sessionScope — fresh per-call sessions versus a shared multi-turn session threaded through the tool payload.
sidebar:
  order: 22
  label: "Orchestrator as a tool"
---

You have a polished refund orchestrator — multi-turn, stateful, durable. Now product wants a single "concierge" agent the customer talks to for *everything*: order status, returns, account questions, and refunds. The concierge shouldn't reimplement refund logic; it should *delegate* to the orchestrator you already built.

`orchestrator.asTool()` wraps an orchestrator as a `ToolContract` so an outer agent can invoke it from its tool-call loop. This recipe nests the refund orchestrator inside a concierge agent two ways: with a brand-new session per call (`sessionScope: "fresh"`), and with a session the concierge threads across turns (`sessionScope: "shared"`).

## The boundary is opaque

Before the code, the one rule that governs everything here: **the tool boundary is opaque.** The parent agent's `signal`, request `context`, and events do **not** auto-forward across it. Anything the wrapped orchestrator needs per call must ride on the tool's `inputSchema` payload. With `sessionScope: "shared"` that includes the `sessionId` (and optionally `history`) the orchestrator participates in.

### What crosses the boundary, and what doesn't

When the concierge fires `handle_refund`, the agent runtime invokes the wrapped tool with exactly **one** argument: the model-generated `input`, already validated against your `inputSchema`. That's the entire channel. The agent also threads its own `toolCtx` (the iteration's shared artifacts bag) into `invoke()`, but the composite wrapper **deliberately ignores it** — a wrapped orchestrator runs in its own scope and never reads the parent's artifacts bag.

Inside the wrapper, the orchestrator is then called as `orchestrator.execute(executeInput, { sessionId, history })`. Note what is — and isn't — in that options object:

| Parent-side input to `concierge.execute(...)` | Reaches the wrapped orchestrator? | How |
| --- | --- | --- |
| The `inputSchema` payload (model's tool-call args) | **Yes** | Validated, then forwarded as the orchestrator's `execute(input)` argument (minus `sessionId` / `history` under `"shared"`). |
| `sessionId` / `history` | **Only under `"shared"`** | Pulled out of the validated payload — *not* the parent's observability `sessionId`. |
| `signal` (`AbortSignal`) | **No** | The wrapper never constructs an options `signal`; a parent timeout/cancel does not propagate. |
| `context` (request-scoped bag) | **No** | Not forwarded. Pass any request data (user id, db handle, deadline) as fields on `inputSchema`. |
| `on` (event handlers) | **No** | The orchestrator's own definition/instance handlers fire; the parent's per-call `on` does not. |
| Parent's observability `sessionId` | **No** | The orchestrator owns its session id — `"fresh"` generates one, `"shared"` reads it from the payload. The wrapper never substitutes the parent agent's `sessionId` into the orchestrator's own `execute({ sessionId, history })` call. |

The practical rule: **design `inputSchema` as the orchestrator's complete per-call API.** If the orchestrator needs it, it goes on the schema — there is no implicit side channel.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
```

## The wrapped orchestrator

This is the refund orchestrator from the [stateful support bot recipe](./orchestrator-stateful-support-bot), trimmed to the essentials. Its `name` is required — `asTool()` throws without one.

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";
import { END } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { pgPool } from "./db";
import { refundIntents } from "./intents";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

type RefundState = { order?: { id: string }; reply?: string };

const refundBot = ai.orchestrator<RefundState>({
  name: "refund-support",
  intents: refundIntents,
  route: (ctx) => (ctx.iteration === 0 ? "classify" : END),
  checkpointStore: ai.checkpoint.pg({ client: pgPool }),
  // iterate is false here — single dispatch per turn, so no snapshotStore needed.
});
```

## Fresh sessions — `sessionScope: "fresh"`

The default. Each tool invocation gets a brand-new generated `sessionId` (an internal `generateRunId("session")`) and an **empty** `history`; the session lives only for that one call. Use it when the orchestrator handles a self-contained request the concierge has already gathered all the inputs for. The **whole** validated payload is forwarded as the orchestrator's `execute(input)` argument — nothing is stripped, because there is no `sessionId` / `history` to peel off.

Concretely, under `"fresh"` the wrapper resolves the call as:

- `sessionId` = a freshly generated id (you never see it and can't pin it).
- `history` = `[]`.
- `execute(input)` = the entire validated `inputSchema` payload.

Because every call opens a never-before-seen session, an in-memory checkpoint store is fine here — there is nothing to carry across calls, so durability buys you nothing. Two consecutive `handle_refund` calls share no state; the second one cannot "remember" the first.

```ts
const refundTool = refundBot.asTool({
  name: "handle_refund",
  description:
    "Handle a refund request end-to-end. Provide the customer's full refund message including the order id.",
  inputSchema: v.object({ message: v.string() }),
  sessionScope: "fresh", // default — shown for clarity
});

const concierge = ai.agent({
  name: "concierge",
  model: openai.model({ name: "gpt-4o" }),
  systemPrompt: ai
    .systemPrompt()
    .persona("You are Acme's customer concierge. You answer order, account, and refund questions.")
    .instruction("For any refund request, call `handle_refund` with the customer's full message. Do not reason about refund eligibility yourself."),
  tools: [refundTool],
});

const { text, report } = await concierge.execute(
  "Hi — I'd like a refund for order A-7711, it arrived damaged.",
);

console.log(text);
// The concierge calls handle_refund, the orchestrator runs a one-shot
// refund session, and the concierge narrates the result back to the customer.
```

## Shared sessions — `sessionScope: "shared"`

When the concierge itself runs a multi-turn conversation and the refund flow must persist *across those turns*, switch to `"shared"`. Now the concierge threads a `sessionId` (and optionally prior `history`) through the validated payload. The orchestrator participates in that session, checkpointing its state under that id. A missing or blank `sessionId` throws `SupervisorFailedError`.

Under `"shared"`, the wrapper resolves the call differently from `"fresh"`:

- `sessionId` = `payload.sessionId` — it **must** be a non-empty string, or the wrapper throws `SupervisorFailedError` *before* the orchestrator runs.
- `history` = `payload.history` when it's an array, otherwise `[]`.
- `execute(input)` = the **rest** of the payload, with `sessionId` and `history` removed. So in the schema below, only `message` reaches the orchestrator's `execute(input)`.

That last point is the easy one to miss: `sessionId` and `history` are *control* fields consumed by the wrapper — they are not part of the orchestrator's business input. Everything else on the schema is.

```ts
const refundTool = refundBot.asTool({
  name: "handle_refund",
  description:
    "Continue a refund conversation. Always pass the same sessionId for the same customer chat so the refund context persists across turns.",
  inputSchema: v.object({
    sessionId: v.string(), // the orchestrator session the parent threads through
    message: v.string(), // everything else becomes the orchestrator's execute(input)
  }),
  sessionScope: "shared",
});
```

Because the boundary is opaque, the concierge must put the `sessionId` into the tool call. The cleanest way is to bind it into the concierge's instructions per request, so the model always echoes the right id:

```ts
function makeConcierge(chatSessionId: string) {
  return ai.agent({
    name: "concierge",
    model: openai.model({ name: "gpt-4o" }),
    systemPrompt: ai
      .systemPrompt()
      .persona("You are Acme's customer concierge.")
      .instruction(
        `For any refund request, call \`handle_refund\` with sessionId "${chatSessionId}" and the customer's message. Reuse that exact sessionId on every refund call in this chat.`,
      ),
    tools: [refundTool],
  });
}

// One concierge per chat — the chat id IS the orchestrator session id.
const concierge = makeConcierge("chat_92f1");

await concierge.execute("I want to return order A-7711.");
// later in the same chat — same sessionId, so the refund context carries over:
await concierge.execute("Actually, can you make that a store credit instead?");
```

Inside `handle_refund`, the orchestrator pulls `sessionId` (and `history`, if present) out of the payload and forwards the remaining fields (`message`) as its `execute(input)` argument — so its checkpoint accumulates across both concierge turns.

## Errors cross the boundary as one class

If a refund turn fails, the orchestrator's typed error is re-thrown inside the tool wrapper, which surfaces it to the concierge as a `ToolExecutionError` with the original error preserved on `cause`. The concierge sees one uniform error class and can retry or apologize — it never has to know the orchestrator's internal error taxonomy.

Tool dispatches are reported as child nodes on the agent report (`report.children`, filtered by `type === "tool"`); a failed call shows up with `status === "failed"`. The typed error itself rides the result envelope, not the report node, so the place to read the cause is the top-level `error`:

```ts
const { error, report } = await concierge.execute(message);

if (error) {
  logger.warn("concierge turn failed", {
    code: error.code,
    // The orchestrator's typed error is preserved as the ToolExecutionError cause.
    cause: (error as { cause?: unknown }).cause,
  });
}

// Isolate which tool failed by walking the report tree:
const failedTools = report.children.filter(
  (child) => child.type === "tool" && child.status === "failed",
);

for (const call of failedTools) {
  logger.warn("refund tool failed", { tool: call.name, duration: call.duration });
}
```

## Nest it, or keep it top-level?

An orchestrator is already a complete, top-level executable: you call `refundBot.execute(message, { sessionId, history })`, `refundBot.stream(...)`, `refundBot.resume(sessionId)`, and `refundBot.command("compact", ...)` directly. Wrapping it `asTool()` is an *additional* surface, not the primary one — reach for it only when an outer agent genuinely needs to *choose* the refund flow against other options.

**Keep the orchestrator top-level when** the refund flow is the whole interaction. If a request that hits your refund endpoint is always a refund, there is no routing decision to delegate — you call `refundBot.execute(...)` and skip the wrapper entirely. Nesting it under an agent only to immediately call it adds a model round-trip, a tool-call hop, and the opaque boundary (lost `signal` / `context`) for no benefit. You also keep direct access to `resume()` and `command()`, which the `asTool` surface does not expose — once an orchestrator is a tool, the parent can only `execute` it.

**Nest it inside an agent when** the agent must decide *whether* to use the orchestrator among other capabilities — order status, account questions, FAQ — and refunds are one branch. That decision is exactly what an LLM tool-call loop is for: the concierge reads each tool's `description`, picks `handle_refund` when (and only when) the customer wants a refund, and narrates the result. This is the concierge in this recipe.

A useful tie-breaker:

- **One flow, deterministic entry → top-level.** A webhook, a job, or a route that is *defined* as "run the refund orchestrator" should call `execute()` directly.
- **Many flows, model picks → nest under an agent.** A single conversational surface that fields mixed intents should expose each flow as a tool and let the agent route.

When you do nest, pick `sessionScope` to match the parent's lifetime: a stateless one-shot agent turn pairs with `"fresh"`; a multi-turn chat agent that must carry refund context across turns pairs with `"shared"` (and a durable checkpoint store).

## Production notes

:::caution[The opaque boundary drops the parent's signal and context]
A timeout `AbortSignal` or request-scoped `context` you pass to `concierge.execute(...)` does **not** reach the wrapped orchestrator. If the orchestrator needs a per-call deadline or request data (a user id, a db handle), it must come through the `inputSchema` payload — there is no implicit forwarding. Design the schema with that in mind.
:::

:::note[Choose the scope deliberately]
`"fresh"` is right when the orchestrator's work is one self-contained transaction per tool call — no memory of prior calls is wanted (or safe). `"shared"` is right when the orchestrator's session must line up with the parent conversation. Defaulting to `"shared"` without threading a stable `sessionId` is a bug: the orchestrator will throw on the missing id rather than silently opening a fresh session.
:::

- **Give the wrapped orchestrator a checkpoint store under `"shared"`.** Cross-turn continuity only works if the session is actually persisted. With `"fresh"`, an in-memory store is fine because the session lives for one call.
- **Keep the tool `description` model-facing and explicit.** It is the only thing the concierge reads to decide when to delegate; spell out that a refund message (and, under `"shared"`, the session id) must be passed.
- **Don't nest an `iterate: true` orchestrator without its `snapshotStore`** — the wrapped orchestrator still validates its own config at construction, tool or not.

## Related

- [Stateful refund support bot](./orchestrator-stateful-support-bot) — the orchestrator wrapped here, in full.
- [Production stores](./orchestrator-production-stores) — durable checkpoint/snapshot wiring for the shared-session case.

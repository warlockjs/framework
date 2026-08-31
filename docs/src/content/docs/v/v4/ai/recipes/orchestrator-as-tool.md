---
banner:
  content: "This page documents Warlock v4. <a href='/v/latest'>View the latest docs.</a>"
title: "Recipe — Orchestrator as a tool"
description: Nest a stateful refund orchestrator inside a concierge agent with asTool and sessionScope — fresh per-call sessions versus a shared multi-turn session bound by the developer, never by the model.
sidebar:
  order: 22
  label: "Orchestrator as a tool"
---

You have a polished refund orchestrator — multi-turn, stateful, durable. Now product wants a single "concierge" agent the customer talks to for *everything*: order status, returns, account questions, and refunds. The concierge shouldn't reimplement refund logic; it should *delegate* to the orchestrator you already built.

`orchestrator.asTool()` wraps an orchestrator as a `ToolContract` so an outer agent can invoke it from its tool-call loop. This recipe nests the refund orchestrator inside a concierge agent two ways: with a brand-new session per call (`sessionScope: "fresh"`), and with a session the concierge continues across turns (`sessionScope: "shared"`).

## The boundary is opaque — and the session id is deliberately NOT on it

Before the code, the two rules that govern everything here: **the tool boundary is opaque**, and (as of 4.15.0) **the session id is the one thing that never rides the model-visible payload.**

The parent agent's `signal`, request `context`, and events do **not** auto-forward across the tool boundary. Anything the wrapped orchestrator needs per call must ride on the tool's `inputSchema` payload — with one deliberate exception: under `sessionScope: "shared"`, the session id is bound by the developer through `OrchestratorAsToolOptions.session`, never through `inputSchema`.

That exception exists because a `sessionId` is **bearer-equivalent** to full read/write access on that session's persisted state and history. `inputSchema` is filled in by the calling *model*, and anything able to influence that model's output — a summarized document, a poisoned tool result, a web page it fetched — can write text into the call. If the session id lived on the schema, that text could say "continue session `<victim-id>`" and the nested orchestrator would load, mutate, and echo back a **stranger's** conversation. So `session` reads from the invocation's `ToolContext` instead (`ctx.artifacts`, the same out-of-band bag `signal` travels on) or is fixed as a literal at `asTool()` construction — both channels the model cannot write to.

### What crosses the boundary, and what doesn't

When the concierge fires `handle_refund`, the agent runtime invokes the wrapped tool with exactly **one** model-authored argument: the validated `input`. The agent also threads its own `ctx` (`ToolContext` — `artifacts` + `signal`) into the tool, which the `session` resolver (below) reads.

Inside the wrapper, the orchestrator is then called as `orchestrator.execute(executeInput, { sessionId, history })`. Note what is — and isn't — in that options object:

| Parent-side input to `concierge.execute(...)` | Reaches the wrapped orchestrator? | How |
| --- | --- | --- |
| The `inputSchema` payload (model's tool-call args) | **Yes, minus session control fields** | Validated, then forwarded as the orchestrator's `execute(input)` argument. A `sessionId` / `history` field on the payload is stripped before forwarding under `"shared"` — even if the model writes one, it never reaches `session`. |
| `sessionId` / `history` under `"shared"` | **From `options.session`, never the payload** | A literal id fixed at `asTool()` construction, or a `(ctx) => sessionId \| { sessionId, history }` resolver reading `ctx.artifacts` — the developer-controlled, model-invisible channel. |
| `signal` (`AbortSignal`) | **No** | The wrapper never constructs an options `signal`; a parent timeout/cancel does not propagate. |
| `context` (request-scoped bag) | **No** | Not forwarded. Pass any request data (user id, db handle, deadline) as fields on `inputSchema`, or via the `session` resolver's `ctx.artifacts`. |
| `on` (event handlers) | **No** | The orchestrator's own definition/instance handlers fire; the parent's per-call `on` does not. |
| Parent's observability `sessionId` | **No** | The orchestrator owns its session id — `"fresh"` generates one, `"shared"` resolves one from `options.session`. The wrapper never substitutes the parent agent's `sessionId`. |

The practical rule: **design `inputSchema` as the orchestrator's complete per-call *business* API — and design `session` as its complete per-call identity binding.** The two are deliberately separate channels; nothing that decides *which session* runs should ever be a field a model fills in.

## Setup

```bash
pnpm add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
```

## The wrapped orchestrator

This is the refund orchestrator from the [stateful support bot recipe](/v/v4/ai/recipes/orchestrator-stateful-support-bot/), trimmed to the essentials. Its `name` is required — `asTool()` throws without one.

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

When the concierge itself runs a multi-turn conversation and the refund flow must persist *across those turns*, switch to `"shared"`. The orchestrator now joins an **existing** session and checkpoints its state under that id — but the id itself is bound by your application code through `options.session`, not read from anything the model wrote. Building a `"shared"` tool without `session` throws `SupervisorFailedError` at construction, before any call can hit the missing-binding path.

```ts
const refundTool = refundBot.asTool({
  name: "handle_refund",
  description:
    "Continue a refund conversation for the current chat. The refund session is bound automatically — just pass the customer's message.",
  inputSchema: v.object({ message: v.string() }), // NOT a place for sessionId
  sessionScope: "shared",
  session: (ctx) => String(ctx?.artifacts?.refundSessionId ?? ""),
});
```

`session` here is a resolver reading `ctx.artifacts` — the tool invocation's out-of-band context bag, the same channel `signal` travels on, which the model has no way to write to. Your application code is what puts `refundSessionId` there, before the concierge ever runs, tying it to something *you* authenticated (the logged-in customer's chat, not a string the model produced):

```ts
function makeConcierge(chatSessionId: string) {
  return ai.agent({
    name: "concierge",
    model: openai.model({ name: "gpt-4o" }),
    systemPrompt: ai
      .systemPrompt()
      .persona("You are Acme's customer concierge.")
      .instruction("For any refund request, call `handle_refund` with the customer's message."),
    tools: [refundTool],
  });
}

// One concierge per chat — the chat id maps to the orchestrator session id
// entirely in your own code, never inside the model's tool call.
const concierge = makeConcierge("chat_92f1");

await concierge.execute("I want to return order A-7711.");
// later in the same chat — same bound session, so the refund context carries over:
await concierge.execute("Actually, can you make that a store credit instead?");
```

A simpler equivalent for this recipe — since the session id (`chatSessionId`) is already known when you build the tool, not just at call time — is to bind it as a **literal** instead of a resolver:

```ts
function makeConcierge(chatSessionId: string) {
  const refundTool = refundBot.asTool({
    name: "handle_refund",
    inputSchema: v.object({ message: v.string() }),
    sessionScope: "shared",
    session: chatSessionId, // fixed at construction — one tool instance per chat
  });

  return ai.agent({ name: "concierge", model: openai.model({ name: "gpt-4o" }), tools: [refundTool] });
}
```

Reach for the `(ctx) => ...` resolver form instead when the session id is only knowable per invocation — e.g. a shared, long-lived tool instance where an earlier step in the same run (an auth/identify tool, a supervisor's seeded artifacts) resolves the caller and stamps their session id onto `ctx.artifacts` before `handle_refund` fires.

:::danger[Never put `sessionId` back on `inputSchema`]
A `sessionId` is bearer-equivalent to full read/write on that session. If it's a field the model fills in, then anything able to influence the model's output — a summarized document, a poisoned tool result — can write "continue session `<victim-id>`" and the nested orchestrator will load, mutate, and echo back a stranger's conversation. `orchestrator.asTool()` strips `sessionId` / `history` from the validated payload before forwarding it under `"shared"`, precisely so a model-authored field of that name can't smuggle its way in. The pre-4.15.0 payload-driven behavior is still reachable behind `unsafeAllowModelSessionId: true` — only for a fully trusted outer context where you independently verify the model-chosen session belongs to the current caller.
:::

Either way, `handle_refund` forwards only `message` (the rest of the schema) as the orchestrator's `execute(input)` argument — so its checkpoint accumulates across both concierge turns, keyed by the session your code chose.

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
`"fresh"` is right when the orchestrator's work is one self-contained transaction per tool call — no memory of prior calls is wanted (or safe). `"shared"` is right when the orchestrator's session must line up with the parent conversation. Building a `"shared"` tool without a `session` binding is a bug the framework catches for you: `asTool()` throws `SupervisorFailedError` at construction rather than silently falling back to a model-supplied id.
:::

- **Give the wrapped orchestrator a checkpoint store under `"shared"`.** Cross-turn continuity only works if the session is actually persisted. With `"fresh"`, an in-memory store is fine because the session lives for one call.
- **Keep the tool `description` model-facing and explicit about the business input only.** It's the only thing the concierge reads to decide when to delegate — describe the refund message, never the session id; the session is not the model's concern under `"shared"`.
- **Don't nest an `iterate: true` orchestrator without its `snapshotStore`** — the wrapped orchestrator still validates its own config at construction, tool or not.
- **Never set `unsafeAllowModelSessionId: true` on a tool an untrusted or prompt-injectable outer agent can reach.** It restores the pre-4.15.0 behavior of trusting a model-authored `sessionId`.

## Related

- [Stateful refund support bot](/v/v4/ai/recipes/orchestrator-stateful-support-bot/) — the orchestrator wrapped here, in full.
- [Production stores](/v/v4/ai/recipes/orchestrator-production-stores/) — durable checkpoint/snapshot wiring for the shared-session case.

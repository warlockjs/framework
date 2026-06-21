---
title: "Best Practices — Tools"
sidebar:
  label: "Tools"
description: How to design tools the model can call without breaking your system — make the Seal schema the contract so garbage can't pass, keep each tool single-purpose, use silent mode for fire-and-forget side effects, pass system-only data through ctx.artifacts, make execute idempotent, surface errors so the agent can recover, and lazily import heavy SDKs.
---

The pillar this page answers: **how do you design a tool so a non-deterministic model can call it safely — without passing garbage, double-executing, or wedging the agent when something fails?**

A tool is the one place where the model reaches into your system and *does* something. The model decides *when* to call it and *what* to pass — and the model is wrong sometimes. Your job is to make the tool impossible to misuse: a schema tight enough that bad arguments never reach `execute`, a body narrow enough to reason about, side effects that survive a retry, and errors the agent can read and recover from. This page is the opinionated version of those levers, every example grounded in the real `ai.tool` surface.

Everything below is one running example: a small set of tools for a storefront support agent — searching a catalog, applying a discount, and notifying ops.

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";
```

## Make the schema the contract — constrain the input so garbage can't pass

`ai.tool` validates the model's arguments against your `input` schema **before** `execute` ever runs. A loose schema (`v.string()` for everything, an open `v.object({})`) means the model can hand you an empty query, a negative quantity, or a status you've never heard of, and your `execute` is the first thing that notices — at runtime, in production. A tight schema turns every one of those into a validation failure that the agent sees and can correct on the next trip, inside the bounded `maxTrips` loop. The schema is not paperwork; it is the actual boundary between a non-deterministic model and your code.

**Do this — constrain every field with the real shape of the value.** Enumerate the legal set, floor and cap the numbers, mark genuinely optional fields `.optional()`, and use `.describe()` so the field's meaning rides into the JSON Schema the model reads.

```ts
const applyDiscount = ai.tool({
  name: "apply_discount",
  description: "Apply a percentage discount to an open order line.",
  input: v.object({
    orderId: v.string().describe("The order's opaque public id, e.g. 'ord_8h2k'."),
    // An enum, not a free string: the model can only pick a reason you handle.
    reason: v.enum(["late_delivery", "damaged_item", "goodwill"]),
    // Floored and capped: no negative, no 500% discount slips through.
    percent: v.int().min(1).max(40).describe("Whole-number percent, 1–40."),
  }),
  execute: async ({ orderId, reason, percent }) => {
    return applyOrderDiscount(orderId, reason, percent);
  },
});
```

**Avoid this — a permissive schema that defers validation to your code.** `percent: v.number()` lets the model pass `-10` or `9999`; `reason: v.string()` lets it invent a category your switch doesn't handle. Now the bad value is inside `execute`, and you're hand-rolling the checks the schema should have made — usually by throwing, which costs a full extra trip to tell the model what a tighter schema would have told it for free.

```ts
// Anti-pattern: the schema validates nothing meaningful.
const applyDiscount = ai.tool({
  name: "apply_discount",
  input: v.object({
    orderId: v.string(),
    reason: v.string(),   // model invents "because_i_said_so"
    percent: v.number(),  // model passes -10, or 9999
  }),
  execute: async ({ orderId, reason, percent }) => {
    // You now re-implement the schema by hand, and throw on failure —
    // an extra round-trip for a check Seal does before execute() runs.
    if (percent < 1 || percent > 40) throw new Error("bad percent");
    return applyOrderDiscount(orderId, reason, percent);
  },
});
```

> When a schema field rejects the model's argument, the agent records a `SchemaValidationError` on that trip's `ToolCall.error` and feeds it back to the model as a tool error — the model gets a turn to fix its own arguments and retry. A precise schema is therefore *also* a cheaper one: the correction loop is the model's job, not yours, and the model only learns the rule once you've written it into the schema. See [Define tools](../the-basics/define-tools) for the full `name` / `description` / `input` / `execute` contract.

## Keep each tool single-purpose — one verb, one job

A tool's `name` and `description` are how the model decides whether to call it. A tool that does three things ("search, and also update state, and also email ops") gives the model one fuzzy choice where it needed three sharp ones — so it calls the tool at the wrong time, or passes a `mode` flag to pick a sub-behavior, and the schema balloons to cover every branch. One tool per verb keeps each `description` crisp, each schema tight, and each `execute` short enough to reason about.

**Do this — one tool per action, each with a schema that fits exactly that action.** The model composes them — it can call `search_catalog` then `apply_discount` in sequence — and each one is independently testable and independently safe.

```ts
const searchCatalog = ai.tool({
  name: "search_catalog",
  description: "Search the product catalog. Returns matching products with SKU and price.",
  input: v.object({
    query: v.string().min(2),
    limit: v.int().min(1).max(20).optional(),
  }),
  execute: async ({ query, limit }) => searchProducts(query, limit ?? 10),
});

// A separate tool — separate verb, separate schema, separate failure mode.
const applyDiscount = ai.tool({
  name: "apply_discount",
  description: "Apply a percentage discount to an open order line.",
  input: v.object({
    orderId: v.string(),
    reason: v.enum(["late_delivery", "damaged_item", "goodwill"]),
    percent: v.int().min(1).max(40),
  }),
  execute: async ({ orderId, reason, percent }) => applyOrderDiscount(orderId, reason, percent),
});
```

**Avoid this — a god-tool with a mode switch and an everything-schema.** A single `manage_order` that branches on an `action` field forces every field to be optional (because each is required only for *some* actions), which defeats the precise-schema rule above and hands the model a tool it routinely calls with the wrong shape.

```ts
// Anti-pattern: one tool, many jobs, a schema that can't constrain anything.
const manageOrder = ai.tool({
  name: "manage_order",
  description: "Search, discount, refund, cancel, or email about an order.",
  input: v.object({
    action: v.enum(["search", "discount", "refund", "cancel", "notify"]),
    query: v.string().optional(),     // only for search
    orderId: v.string().optional(),   // only for the order actions
    percent: v.int().optional(),      // only for discount — now unbounded again
  }),
  execute: async (input) => {
    switch (input.action) { /* five unrelated jobs in one body */ }
  },
});
```

> The cost of the god-tool is paid twice: the model picks the wrong branch more often (its `description` has to be vague to cover everything), and you lose the schema's guarantees (every field optional, so nothing is actually validated for a given action). Split by verb. The agent's trip loop is built to chain several small tools — that's the design, not a workaround.

## Use silent mode for fire-and-forget side effects — don't pay for a follow-up generation

By default a tool runs in `mode: "feedback"`: the agent dispatches it, appends the result as a `role: "tool"` message, and runs **another** LLM trip so the model can read the result and reply. That second trip is exactly what you want when the reply depends on the result (a search, a lookup). It is pure waste when the tool is a side effect the model's reply doesn't depend on — persisting a slot-fill, pinning a locale, firing telemetry. `mode: "silent"` closes the feedback leg: when *every* tool call in a generation is silent, the loop terminates after dispatch instead of paying for a trip whose only input is `{ ok: true }`.

**Do this — mark pure side-effect tools `silent`.** The model already knows what to say; the tool just records something on the side.

```ts
const recordResolution = ai.tool({
  name: "record_resolution",
  description: "Persist how this ticket was resolved for the analytics pipeline.",
  mode: "silent", // result is never fed back — no follow-up trip when it's the only call
  input: v.object({
    ticketId: v.string(),
    outcome: v.enum(["refunded", "discounted", "escalated", "no_action"]),
  }),
  execute: async ({ ticketId, outcome }) => {
    await ticketStore.recordOutcome(ticketId, outcome);
    return { ok: true }; // the model never sees this
  },
});
```

**Avoid this — feedback mode for a tool whose output the model ignores.** Leaving the default on a write-and-forget tool buys a second LLM trip on every call so the model can read `{ ok: true }` and say nothing new about it. On a high-traffic agent that is a measurable, recurring token cost for zero behavioral change.

```ts
// Anti-pattern: default feedback mode on a pure side effect.
const recordResolution = ai.tool({
  name: "record_resolution",
  // mode defaults to "feedback": every call costs an extra trip to read { ok: true }.
  input: v.object({ ticketId: v.string(), outcome: v.string() }),
  execute: async ({ ticketId, outcome }) => {
    await ticketStore.recordOutcome(ticketId, outcome);
    return { ok: true };
  },
});
```

> Silent is strictly the *LLM-feedback* channel — the tool still runs to completion through middleware (logging, cost tracking), so observability isn't lost. Two constraints make a tool a good silent candidate: it must be **cheap and fast** (the HTTP request stays open until it resolves) and **idempotent** (silent tools have no channel to report failure back to the model). And mind the provider split: when a silent tool is the *only* call in a turn, OpenAI models often emit no prose alongside it, so the user sees nothing — pair it with a feedback tool, or skip silent mode, when the user needs a visible reply. The full rule set and the per-provider behavior table live in the [silent tools recipe](../recipes/silent-tools).

## Pass system-only data through `ctx.artifacts` — don't round-trip IDs through the model

A tool's *return value* is what the model reads and reasons over. Some of what a tool produces is not for the model at all — renderable UI blocks, citation records, file handles, the raw rows behind a summary. Stuffing that into the return value forces the model to read it, pay tokens for it, and (worse) round-trip identifiers back to you on the next call so you can re-hydrate them — a brittle loop where the model copies an ID it should never have seen. `execute` takes an optional second argument, a `ToolContext` with a mutable `artifacts` bag. Write system-only data there; it reaches your system, never the LLM.

**Do this — return the minimal summary for the model, push the rest to `ctx.artifacts`.** The model reasons over a small, clean payload; your UI layer reads the full records off the artifacts bag after the run.

```ts
const searchCatalog = ai.tool({
  name: "search_catalog",
  description: "Search the catalog. Returns how many matches were found.",
  input: v.object({ query: v.string().min(2) }),
  execute: async ({ query }, ctx) => {
    const items = await searchProducts(query);

    // System-only: full records for the UI to render — never reaches the model.
    ctx.artifacts.blocks ??= [];
    ctx.artifacts.blocks.push({ type: "products", items });

    // Model-visible: just enough to reason about the next step.
    return { total: items.length };
  },
});
```

**Avoid this — returning full records and trusting the model to carry IDs.** When the whole result goes back to the model, the model pays to read every field, and any follow-up tool that needs an ID depends on the model copying it correctly out of a blob it half-read. That's a correctness bug waiting for the first time the model truncates or transposes an identifier.

```ts
// Anti-pattern: the model becomes a courier for data it shouldn't see.
const searchCatalog = ai.tool({
  name: "search_catalog",
  input: v.object({ query: v.string() }),
  execute: async ({ query }) => {
    const items = await searchProducts(query);
    // Every field of every row is now in the prompt, and the next tool call
    // depends on the model echoing an id back verbatim.
    return { items };
  },
});
```

> The artifacts bag is the supported side-channel by design (decisions §35). Under a supervisor it starts empty per iteration, accumulates writes from every tool call, and merges into supervisor state via `artifactsSchema` at iteration end — so the bag's shape is *typed* when a supervisor declares the schema. Standalone, the framework supplies `{ artifacts: {} }` and your writes are harmless. Either way the rule is the same: the return value is the model's, `ctx.artifacts` is the system's, and the two channels never cross.

## Make `execute` idempotent — the model may call it twice

The model can retry. A transient provider error, a re-plan, a duplicate tool call in one generation — any of these can run your `execute` twice with the same arguments. If the tool charges a card, sends an email, or inserts a row, "twice" means a double charge, a duplicate notice, a duplicate record. The fix is the same one you'd apply to any unreliable caller: make the side effect idempotent, keyed by something stable in the input.

**Do this — derive an idempotency key from the input and dedupe at the boundary.** A second call with the same arguments returns the stored result instead of repeating the effect.

```ts
const notifyOps = ai.tool({
  name: "notify_ops",
  description: "Send a one-time ops alert about an order.",
  input: v.object({
    orderId: v.string(),
    severity: v.enum(["info", "warning", "critical"]),
  }),
  execute: async ({ orderId, severity }) => {
    // Stable key from the input — a retry with the same args is a no-op.
    const idempotencyKey = `ops-alert:${orderId}:${severity}`;

    const existing = await alertLog.find(idempotencyKey);
    if (existing) {
      return existing.result;
    }

    const result = await opsChannel.send({ orderId, severity });
    await alertLog.store(idempotencyKey, result);

    return result;
  },
});
```

**Avoid this — a raw side effect with no dedupe.** If the agent loop re-dispatches this tool (and it can), ops gets paged twice for one order. The tool looks correct in isolation and is wrong the first time the model retries.

```ts
// Anti-pattern: every call sends — a retry pages ops a second time.
const notifyOps = ai.tool({
  name: "notify_ops",
  input: v.object({ orderId: v.string(), severity: v.enum(["info", "warning", "critical"]) }),
  execute: async ({ orderId, severity }) => opsChannel.send({ orderId, severity }),
});
```

> This matters most for silent tools, which have *no* way to report a failure back to the model — so a partial failure can never be corrected by the agent and must be safe to re-run. Treat any tool with an external side effect (a charge, an email, a webhook) as something that will be called more than once, and key its effect on the input. The mechanics are the same idempotency-key discipline you'd use for any retryable external call.

## Surface errors so the agent can recover — throw a clear message, don't swallow

`invoke()` never throws — when your `execute` rejects, the agent wraps the cause in a `ToolExecutionError`, records it on the trip's `ToolCall.error`, and feeds the message back to the model as a tool error. That is the recovery channel: a clear, actionable message lets the model try a different argument, a different tool, or tell the user what went wrong. Swallowing the error — returning `{ ok: true }` on failure, or catching and returning an empty result — breaks that channel: the model believes the tool succeeded and confidently builds a wrong answer on top of nothing.

**Do this — throw a specific, model-readable message on failure.** The thrown value lands on `error.cause`, the message reaches the model, and the agent gets a real chance to recover within the trip loop.

```ts
const applyDiscount = ai.tool({
  name: "apply_discount",
  description: "Apply a percentage discount to an open order line.",
  input: v.object({
    orderId: v.string(),
    percent: v.int().min(1).max(40),
  }),
  execute: async ({ orderId, percent }) => {
    const order = await orders.find(orderId);

    if (!order) {
      // Specific and actionable — the model can ask the user for the right id.
      throw new Error(`No open order found for id "${orderId}".`);
    }

    if (order.status === "shipped") {
      throw new Error(`Order "${orderId}" already shipped; a discount can't be applied.`);
    }

    return applyOrderDiscount(orderId, percent);
  },
});
```

The agent surfaces the failure on the result, typed and queryable — no message parsing:

```ts
import { ToolExecutionError } from "@warlock.js/ai";

const result = await supportAgent.execute("Give order ord_8h2k 30% off.");

const failedCall = result.report.children.find(
  (child) => child.type === "tool" && child.status === "failed",
);

if (result.error instanceof ToolExecutionError) {
  metrics.increment("tool.failure", { tool: result.error.toolName });
}
```

**Avoid this — catching the error and returning a fake success.** The model is now told the discount applied when it didn't. It tells the customer "done!" and the order is unchanged — the worst failure mode, because nothing surfaces it.

```ts
// Anti-pattern: swallow the failure, lie to the model.
execute: async ({ orderId, percent }) => {
  try {
    return await applyOrderDiscount(orderId, percent);
  } catch {
    return { ok: true }; // the model believes it worked — and so does the customer
  }
},
```

> Let the error propagate — `execute` should throw, not catch-and-mask. The agent's job is to wrap it as a `ToolExecutionError` (carrying `toolName`, and `tripIndex` stamped by the dispatching agent) and give the model the message. Reserve `try / catch` inside a tool for *enriching* the error with context before re-throwing, never for hiding it. See [Define tools](../the-basics/define-tools) for the full error taxonomy — `SchemaValidationError` for bad arguments, `ToolExecutionError` for a crashed body.

## Lazily import heavy SDKs — keep the dependency off the boot path

A tool that talks to S3, a payment provider, or a vector database pulls in a heavy SDK. Importing that SDK at the top of the file makes it a hard load-time dependency: every process that imports your tools module pays the import cost, and a deployment that never calls that tool still has to have the package installed or it crashes on boot. Import the SDK *inside* `execute`, on first use, and the cost moves to the call that actually needs it — the tool that's never called never loads its SDK.

**Do this — `await import(...)` the heavy dependency inside `execute`.** The module loads lazily, on the first call, and only in processes that actually invoke the tool.

```ts
const archiveInvoice = ai.tool({
  name: "archive_invoice",
  description: "Upload a generated invoice PDF to long-term storage.",
  input: v.object({
    invoiceId: v.string(),
    pdfBase64: v.string(),
  }),
  execute: async ({ invoiceId, pdfBase64 }) => {
    // Heavy SDK loaded on first call, not at module import time.
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");

    const client = new S3Client({ region: process.env.AWS_REGION });
    await client.send(
      new PutObjectCommand({
        Bucket: "invoices",
        Key: `${invoiceId}.pdf`,
        Body: Buffer.from(pdfBase64, "base64"),
      }),
    );

    return { archived: true, key: `${invoiceId}.pdf` };
  },
});
```

**Avoid this — a top-level import that loads on every boot.** The SDK is now resolved the moment anything imports this module, whether or not the tool is ever called — slower cold starts, and a hard dependency a lean deployment can't drop.

```ts
// Anti-pattern: heavy SDK on the boot path of every process that imports this file.
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const archiveInvoice = ai.tool({
  name: "archive_invoice",
  input: v.object({ invoiceId: v.string(), pdfBase64: v.string() }),
  execute: async ({ invoiceId, pdfBase64 }) => {
    const client = new S3Client({ region: process.env.AWS_REGION });
    /* ... */
  },
});
```

> This is the same lazy-peer discipline the framework's own drivers use for optional SDKs. Cache the client across calls (hoist it to a module-scoped `let`, initialized on first use) so you pay the construction cost once, not per call — but keep the `import()` itself inside `execute` so the dependency stays off the boot path. The payoff is a tools module you can import anywhere without dragging every provider SDK along with it.

## Avoid list

The short version of everything above — the tool-design mistakes that let a non-deterministic model break your system:

- **Don't accept a loose schema.** `v.string()` and unbounded numbers let the model pass garbage your `execute` is the first to notice. Enumerate, floor, and cap every field — the Seal schema is the contract.
- **Don't build a god-tool with a mode switch.** One tool per verb keeps each `description` sharp and each schema actually constraining. The agent loop is built to chain small tools.
- **Don't use feedback mode for a pure side effect.** A write-and-forget tool in the default mode buys a second LLM trip to read `{ ok: true }`. Mark it `mode: "silent"`.
- **Don't round-trip system data through the model.** Return the minimal summary; push UI blocks, citations, and raw records to `ctx.artifacts` so the model never pays to carry IDs it shouldn't see.
- **Don't assume `execute` runs once.** The model retries — key any external side effect (charge, email, webhook) on the input so a second call is a no-op.
- **Don't swallow errors.** Returning a fake success tells the model the tool worked when it didn't. Throw a clear, specific message so the agent can recover.
- **Don't import heavy SDKs at module top.** `await import(...)` inside `execute` keeps the dependency off the boot path of processes that never call the tool.

## See also

- [Define tools](../the-basics/define-tools) — the full `ai.tool` contract: `name`, `description`, `action`, `mode`, `input`, `execute`, `ctx.artifacts`, and the error taxonomy.
- [Recipe — Silent tools](../recipes/silent-tools) — `mode: "silent"`, the all-silent loop-termination rule, and the per-provider prose behavior.
- [Best Practices — Agents & Prompts](./agents-and-prompts) — how tools plug into an agent's trip loop alongside the system prompt and output schema.
- [Best Practices — Cost and efficiency](./cost-and-efficiency) — the broader cost picture, including where silent tools and prompt caching save the most.

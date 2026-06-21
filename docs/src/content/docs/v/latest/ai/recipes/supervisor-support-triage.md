---
title: "Recipe — Support triage supervisor"
description: Route an inbound customer message to the right specialist (billing, tech, or sales) with a router agent, then loop until a resolver produces a reply — using an evaluate verdict to decide when the conversation is done.
---

The scenario: your support inbox gets a free-text message — "I was charged twice for my Pro plan and now the dashboard won't load." A human would glance at it, decide it's mostly a billing problem with a technical symptom, pull the right specialist in, and only close the ticket once there's an actual answer for the customer. That's exactly what a supervisor with a `router` plus an `evaluate` loop does: the router picks the next specialist each turn, each specialist writes its slice of state, and `evaluate` terminates the run the moment a customer-ready reply exists.

This recipe builds a three-intent triage supervisor — `billing`, `tech`, `sales` — plus a `resolver` that composes the final reply, and wires `ai.router` to drive dispatch.

:::caution[Which triage pattern should I use?]
Triage has a cost ladder. Pick the **cheapest** pattern your problem actually needs — don't reach for the router loop below until you've ruled out the rows above it. Each step up adds LLM round-trips.

| Pattern | Routing cost | When to use it |
| --- | --- | --- |
| Deterministic `route` / `classifier.run` | Zero routing tokens — one specialist call | The intent is known from the input itself (a form field, an enum, a keyword rule). No model picks the route. |
| Classifier fast-path | ~2 calls — one classify, one specialist | One specialist can answer the whole message, but you need a model to decide *which*. The classifier runs once on iteration zero. |
| Single agent with tools | One call + tool trips | One agent can handle everything if it can reach for billing/tech lookups as tools, instead of handing off to separate specialist agents. |
| Router + `evaluate` loop **(this recipe)** | ~2 calls per iteration — router decides, then a specialist runs | One message genuinely needs **multiple** specialists in sequence, and you need a verdict to decide when it's done. |

**This recipe demonstrates the heaviest pattern.** The router re-decides the next specialist on every iteration, so each turn costs a routing call plus a specialist call — justified only when a single message must pass through several specialists (billing *and* tech *and* a resolver). If one specialist can answer the whole message — the common case — use the cheaper [classifier fast-path recipe](./supervisor-classifier-fast-path) instead.
:::

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
```

```bash
# .env
OPENAI_API_KEY=sk-...
```

## The specialists

Each specialist is a plain agent with a `description` (the router reads these to decide) and a per-intent `output` schema (the slice it contributes to supervisor state). Keeping the slices disjoint lets shallow-merge accumulate everything across turns without collisions.

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({
  apiKey: process.env.OPENAI_API_KEY!,
  pricing: {
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
  },
});

const model = openai.model({ name: "gpt-4o-mini" });

const billingAgent = ai.agent({
  name: "billing",
  description: "Handles charges, refunds, invoices, and plan/subscription questions.",
  model,
  output: v.object({
    billingFindings: v.string(),
    refundEligible: v.boolean(),
  }),
  systemPrompt: ai.systemPrompt()
    .persona("You are a billing specialist for a SaaS product.")
    .instruction("Diagnose the billing issue and state plainly whether a refund is warranted."),
});

const techAgent = ai.agent({
  name: "tech",
  description: "Handles bugs, errors, outages, login failures, and anything that looks like a product defect.",
  model,
  output: v.object({
    techFindings: v.string(),
  }),
  systemPrompt: ai.systemPrompt()
    .persona("You are a technical support engineer.")
    .instruction("Identify the likely root cause and the next diagnostic step. Be concrete."),
});

const salesAgent = ai.agent({
  name: "sales",
  description: "Handles upgrades, plan comparisons, pricing, and pre-purchase questions.",
  model,
  output: v.object({
    salesFindings: v.string(),
  }),
  systemPrompt: ai.systemPrompt()
    .persona("You are a sales advisor.")
    .instruction("Recommend the right plan and explain the upgrade path in one short paragraph."),
});
```

## The resolver

The resolver reads whatever the specialists left in state and writes the single customer-facing `reply`. We thread state into its prompt via `placeholders` on the intent entry, so the resolver agent sees the findings without us hand-stitching a user message.

```ts
const resolverAgent = ai.agent({
  name: "resolver",
  description: "Composes the final customer-facing reply from specialist findings.",
  model,
  output: v.object({
    reply: v.string(),
  }),
  systemPrompt: ai.systemPrompt()
    .persona("You are the support lead who writes the final reply to the customer.")
    .instruction("Write one warm, direct reply. Use these findings:")
    .instruction("Billing: {{billing|none}}")
    .instruction("Tech: {{tech|none}}")
    .instruction("Sales: {{sales|none}}"),
});
```

## The supervisor

`intents` is shared by both `ai.router` (which reads each entry's `description`) and `ai.supervisor` (which dispatches them). The router never dispatches — it only emits the next intent name — so passing the same object to both keeps the two in lockstep.

```ts
import { END } from "@warlock.js/ai";

const intents = {
  billing: billingAgent,
  tech: techAgent,
  sales: salesAgent,
  resolver: {
    agent: resolverAgent,
    placeholders: (ctx) => ({
      billing: ctx.state.billingFindings,
      tech: ctx.state.techFindings,
      sales: ctx.state.salesFindings,
    }),
  },
};

const triageRouter = ai.router({
  name: "triage-router",
  model,
  intents,
  systemPrompt:
    "You coordinate a customer-support team. Pull in the specialist whose description " +
    "best matches the customer's problem. Once at least one specialist has reported " +
    "findings, route to `resolver` to write the reply. Emit END only after `resolver` runs.",
});

const supportTriage = ai.supervisor<{ reply: string }, {
  billingFindings?: string;
  refundEligible?: boolean;
  techFindings?: string;
  salesFindings?: string;
  reply?: string;
}>({
  name: "support-triage",
  goal: "Resolve the customer's message with one clear reply, pulling in only the specialists the problem needs.",
  router: triageRouter,
  intents,
  // Retrospective verdict — fires after each iteration's intents merge into state.
  // The moment a reply exists, we're done; otherwise trust the router for another turn.
  evaluate: (ctx) => (ctx.state.reply ? { satisfied: true } : undefined),
  output: v.object({ reply: v.string() }),
  maxIterations: 6,
});
```

## Run it

`execute()` never throws — failures land on `result.error`, and the termination reason is on `report.terminatedBy`. The accumulated, schema-validated state comes back on `data`.

```ts
const message =
  "I was charged twice for my Pro plan this month and now the dashboard won't load at all.";

const { data, error, usage, report } = await supportTriage.execute(message);

if (error) {
  console.error(
    `triage failed (${error.code}) after ${report.iterations} iterations,`,
    `terminated by ${report.terminatedBy}`,
  );
  return;
}

console.log(data?.reply);

// Forensics: which specialists ran, and what each contributed.
for (const snapshot of report.snapshots) {
  const ran = Object.keys(snapshot.result).join(", ") || "(routing only)";
  console.log(`iteration ${snapshot.iteration}: ${ran} — chose ${String(snapshot.decision.next)}`);
}

console.log(
  `${report.iterations} iterations, ${usage.total} tokens,`,
  `terminated by ${report.terminatedBy}`,
);
```

A likely run on this input:

1. **Iteration 0** — router reads the message, picks `billing` (the double-charge is the dominant signal). `billingAgent` writes `{ billingFindings, refundEligible }`. `evaluate` sees no `reply` yet → continue.
2. **Iteration 1** — router notices the unresolved "dashboard won't load" symptom and picks `tech`. `techAgent` writes `techFindings`. Still no `reply` → continue.
3. **Iteration 2** — router routes to `resolver`. It reads all the findings via placeholders and writes `reply`. `evaluate` sees `state.reply` → `{ satisfied: true }` and the run terminates with `terminatedBy: "evaluate"`.

## Production notes

- **`evaluate` outranks the router.** When `evaluate` returns `{ satisfied: true }` the run stops immediately, regardless of what the router would have said next — so a state-driven completion check is your real stop condition. The router's own `END` is the fallback when there's no `evaluate`.
- **Keep `maxIterations` low and meaningful.** Hitting the cap terminates the run with `MaxIterationsError` on `result.error` and `terminatedBy: "max-iterations"`. A triage flow that can't resolve in six turns is a flow worth alerting on, not one worth looping forever.
- **Disjoint state slices.** Because each specialist's `output` schema declares different keys, they shallow-merge cleanly across turns. If two intents need the same key, give the merge custom logic in a callback intent rather than letting them clobber each other.
- **Router cost is real.** Every iteration that goes through the router is an extra LLM trip. The rolled-up `usage` on the result counts the router, every dispatched specialist, and the resolver — budget against that total, not just the specialists. For cheaper single-pass triage, see the [classifier fast-path recipe](./supervisor-classifier-fast-path).
- **Descriptions are the routing surface.** The router decides entirely from each intent's `description` plus your `systemPrompt` framing and the `goal`. Vague descriptions cause misroutes far more often than a weak model does — write them like the one-line "when would you pick this?" answer.

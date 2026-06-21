---
title: "Best Practices — Cost and efficiency"
sidebar:
  label: "Cost and efficiency"
description: Keep a customer-support chatbot cheap and fast without dumbing it down — model tiering, classifier fast-paths, prompt and semantic caching, bounded context, streaming, and budget/SLO guardrails, each grounded in a real scenario.
---

The pillar this page answers: **how do you keep a production chatbot cheap and fast without making its answers worse?**

Cost and quality are not opposites — they trade off badly only when you spend the strong model on work a cheap one does identically. The discipline is to spend tokens where they change the answer and nowhere else. Everything below is one running scenario.

## The running scenario

A multi-turn customer-support bot for a SaaS product. A customer says *"I was charged twice for Pro and now the dashboard won't load,"* the bot triages the message, looks up the order, decides refund eligibility, and writes one customer-facing reply. The conversation continues over several turns in one session. Every recommendation here is about making *that* bot cheaper and faster while the reply the customer reads stays exactly as good.

The whole flow runs on two model tiers from one SDK:

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({
  apiKey: process.env.OPENAI_API_KEY!,
  // ModelPricing is USD per 1,000,000 tokens — the industry-standard unit.
  // With pricing present, every report carries a Usage.cost breakdown.
  pricing: {
    "gpt-4o-mini": { input: 0.15, output: 0.6, cachedInput: 0.075 },
    "gpt-4o": { input: 2.5, output: 10, cachedInput: 1.25 },
  },
});

const cheap = openai.model({ name: "gpt-4o-mini" }); // routing, classification, lookups
const strong = openai.model({ name: "gpt-4o" });     // the final customer-facing reply
```

## Tier the model — cheap for routing, strong only where it changes the answer

The single biggest lever. Routing, classification, intent detection, and field extraction are *easy* tasks where a `gpt-4o-mini`-class model is indistinguishable from a frontier model — and 15–20× cheaper per token. The strong model earns its rate in exactly one place: the final reply the customer reads, where nuance and tone genuinely change the outcome.

**Do this — cheap model for the decision, strong model for the prose.** The classifier and lookups run on `cheap`; only the reply-composing agent gets `strong`.

```ts
import { v } from "@warlock.js/seal";

const classifyAgent = ai.agent({
  name: "classify",
  model: cheap, // routing is an easy task — the strong model picks the same intent
  output: v.object({ intent: v.enum(["billing", "tech", "smalltalk"]) }),
  systemPrompt: ai.systemPrompt()
    .persona("You triage inbound support messages.")
    .instruction("Pick the single best intent: `billing`, `tech`, or `smalltalk`."),
});

const replyAgent = ai.agent({
  name: "reply",
  model: strong, // the only place tone and nuance change what the customer reads
  output: v.object({ reply: v.string() }),
  systemPrompt: ai.systemPrompt()
    .persona("You are a warm, precise support lead writing the final customer reply.")
    .instruction("Be specific about the order and the decision. One short paragraph."),
});
```

**Avoid this — the strong model for triage.** Routing a message with `gpt-4o` pays frontier rates to pick a label a `mini` model picks identically. On a bot doing one classify call per message, that's the strong model's input rate burned on the lowest-value step in the flow.

```ts
// Anti-pattern: frontier model to choose between three labels.
const classifyAgent = ai.agent({
  name: "classify",
  model: strong, // 15–20× the cost for zero quality gain on a classification task
  output: v.object({ intent: v.enum(["billing", "tech", "smalltalk"]) }),
});
```

> Tiering is a per-step decision, not a per-bot one. The rule of thumb: if the step's output is a *label, a number, a route, or a tool argument*, it's cheap-tier work. If the step's output is *what the human reads*, it's strong-tier work. Most of a support flow is the former.

## Prefer a classifier fast-path over a router loop for triage

Triage has a cost ladder, and the router loop is the top rung. A `router` re-decides the next specialist on **every** iteration — roughly **two LLM calls per iteration** (router decides, specialist runs). A `classifier` fast-path runs **once** on iteration zero, dispatches the single chosen specialist, and terminates: about **two calls total**. For the common case — one specialist can answer the whole message — the loop pays the routing tax on every turn for nothing.

**Do this — classify once, dispatch once, done.** No `router`, no `route` — just `classifier`. The run ends after the one specialist settles.

```ts
const fastTriage = ai.supervisor<{ reply: string }, { reply?: string }>({
  name: "support-triage",
  goal: "Answer the message in a single pass by routing it to exactly one specialist.",
  intents: {
    billing: billingAgent,
    tech: techAgent,
    smalltalk: smalltalkAgent,
  },
  classifier: { agent: classifyAgent }, // runs on iteration zero, then terminates
  output: v.object({ reply: v.string() }),
});

const { data, usage, report } = await fastTriage.execute(
  "What's your refund window if I cancel mid-cycle?",
);

// Two LLM trips total: one classify, one specialist.
console.log(`${report.iterations} iteration, ${usage.total} tokens`);
```

If the triage signal is a keyword or a metadata flag, drop the LLM classifier entirely with the callback form — **zero routing tokens**, the only model call is the specialist that answers:

```ts
classifier: {
  run: (ctx) => {
    const text = String(ctx.input).toLowerCase();

    if (text.includes("refund") || text.includes("charge")) {
      return { intent: "billing", confidence: 1 };
    }

    return { intent: "smalltalk", confidence: 0.5 };
  },
},
```

**Avoid this — a router loop for a single-specialist message.** *"What's your refund policy?"* is billing, full stop. A router loop spends a routing call to reach that conclusion, runs billing, then spends another routing call to decide it's done — two extra trips that a classifier never makes.

```ts
// Anti-pattern: the heaviest triage pattern for the lightest job.
const triage = ai.supervisor({
  name: "support-triage",
  router: triageRouter,            // ~2 calls per iteration
  intents,
  evaluate: (ctx) => (ctx.state.reply ? { satisfied: true } : undefined),
  maxIterations: 6,
});
```

Reserve the router loop for messages that *genuinely* need several specialists in sequence (billing **and** tech **and** a resolver). See the [classifier fast-path recipe](../recipes/supervisor-classifier-fast-path) for the cheap path and the [support-triage recipe](../recipes/supervisor-support-triage) for the full loop — including the cost ladder that tells you which rung your problem is actually on.

## Cache the prompt — keep the system prompt and tool schemas stable

Across turns and across trips, the most-repeated tokens in your prompt are the *fixed* parts — the system prompt, the persona, the tool schemas. Providers cache that stable prefix and bill the cached portion at a fraction of the input rate (OpenAI prompt-cache hits, Anthropic `cache_control`). You get the discount for free **as long as the prefix doesn't change byte-for-byte between calls**. The way to lose it is to splice volatile data (a timestamp, a request id, the customer's name) into the *front* of the system prompt — that invalidates the cache on every turn.

**Do this — keep the stable prefix stable, and confirm hits with `Usage.cachedTokens`.** The system prompt and tool set are fixed for the agent's lifetime; per-turn data rides in the user message or `placeholders`, not in the system prompt body.

```ts
const supportAgent = ai.agent({
  name: "support",
  model: strong,
  // Stable across every turn → cacheable prefix.
  systemPrompt: ai.systemPrompt()
    .persona("You are a warm, precise support lead for Acme Corp.")
    .instruction("Answer the customer's question using the order details provided."),
  tools: [lookupOrder, checkRefund], // stable schemas → cached alongside the prompt
  // On adapters with capabilities.promptCaching, place a write breakpoint after
  // the stable prefix. Read-side accounting works without this — it only controls
  // WHERE the cache boundary is written.
  modelOptions: { cacheControl: { breakpoints: 1 } },
});

const result = await supportAgent.execute("Where's my order A-7711?");

// Confirm the discount actually landed.
const cached = result.usage.cachedTokens ?? 0;
console.log(`${cached} of ${result.usage.input} input tokens served from cache`);
```

**Avoid this — a system prompt that changes every turn.** Interpolating volatile values into the system prompt body defeats the prefix cache: each turn presents a different prefix, so the provider re-reads (and re-bills) the whole thing at full rate.

```ts
// Anti-pattern: a per-turn timestamp at the front busts the cache on every call.
systemPrompt: ai.systemPrompt()
  .persona(`You are a support lead. The time is ${new Date().toISOString()}.`)
  .instruction("Answer the customer's question."),
```

> `cacheControl.breakpoints` is a *write*-placement hint and only matters on adapters whose `capabilities.promptCaching` is true (Anthropic). The read-side discount — `Usage.cachedTokens` billed at `ModelPricing.cachedInput` — flows automatically on providers that meter cache hits, with no option at all. Either way, the prerequisite is the same: a stable prefix. The breakpoint just tells the provider where the cacheable section ends.

## Add a semantic cache for FAQ repeats — skip the LLM entirely

Prompt caching makes a call cheaper. A semantic cache skips the call. Support traffic is heavy with near-duplicate questions — *"how do I reset my password,"* *"reset password,"* *"forgot my password"* — and `ai.middleware.semanticCache` answers all three from one stored response when they clear a cosine-similarity threshold. For FAQ-style traffic this commonly eliminates a large share of model calls outright: zero tokens, near-zero latency.

**Do this — layer a semantic cache for the FAQ tail.** A hit returns a synthetic response with `usage: { input: 0, output: 0, total: 0 }`, so cost and budget accounting correctly treat it as free.

```ts
import { MemoryCacheDriver } from "@warlock.js/cache";

// Dev/test: MemoryCacheDriver is zero-config and correct (O(N) per query).
// Production: a driver with a real ANN index — pg + pgvector, or redis + RediSearch.
const store = new MemoryCacheDriver();
store.setOptions({});

const faqAgent = ai.agent({
  name: "support",
  model: strong,
  middleware: [
    ai.middleware.semanticCache({
      embedder: openai.embedder({ name: "text-embedding-3-small" }),
      store,
      threshold: 0.95,            // high enough that only true paraphrases hit
      ttlMs: 60 * 60 * 1000,      // an hour — long enough to catch a burst of repeats
      namespace: "support-faq",   // isolate this agent's entries on a shared driver
    }),
  ],
});
```

**Avoid this — a loose threshold that serves the wrong answer.** Dropping the threshold to catch more hits is how a cache becomes a correctness bug: *"how do I cancel my subscription"* and *"how do I cancel my order"* are close in vector space but want different answers. A cache that confidently serves the wrong one is worse than a cache miss.

```ts
// Anti-pattern: a permissive threshold trades correctness for hit rate.
ai.middleware.semanticCache({
  embedder,
  store,
  threshold: 0.7, // too loose — paraphrases of DIFFERENT questions now collide
});
```

> Keep the semantic cache **outermost** in the middleware chain so a hit short-circuits before any inner middleware runs, and so a guardrail rejection in `trip.after` keeps a bad response out of the store. `0.95` is a solid starting threshold for question-answering; move it only with hit-quality data, never to chase a hit-rate number. See the [RAG with cache similarity recipe](../recipes/rag-with-cache-similarity) for the full one-driver setup.

## Bound the context — don't let token cost grow with conversation length

A multi-turn session has a quiet failure mode: every turn resends the whole transcript, so turn 20 costs far more than turn 1 for the same quality of answer. Two orchestrator knobs cap that. `historyWindow` limits how much of the running transcript each agent actually sees per turn; `summarize` compacts old turns into a short summary once the conversation gets long, so the token bill plateaus instead of climbing linearly.

**Do this — window the per-turn view and compact the tail.** The agent sees a bounded slice of recent history; older turns collapse into a summary once the conversation crosses a length you pick.

```ts
const supportBot = ai.orchestrator<SupportState>({
  name: "refund-support",
  intents,
  route,
  historyWindow: { agents: 20 }, // each agent sees at most the last 20 messages
  summarize: {
    afterTurns: 12,              // start compacting once the conversation gets long
    keep: 6,                     // keep the 6 most recent messages verbatim
    onCompact: async (compaction, { sessionId }) => {
      await messageStore.applyCompaction(sessionId, compaction);
    },
  },
  checkpointStore: ai.checkpoint.memory(),
});
```

**Avoid this — resending the full transcript every turn.** With no window and no compaction, the prompt grows without bound: each turn re-bills every prior message, and a long session quietly turns into your most expensive (and slowest) requests — with no improvement in the answer the customer gets.

> `historyWindow` controls per-turn *visibility*; `summarize` controls history *growth*. They are complementary — the window caps what one turn pays, compaction stops the underlying log from getting longer forever. Both are essential on any session that can run past a dozen turns. See the [stateful support bot recipe](../recipes/orchestrator-stateful-support-bot) for the full multi-turn build.

## Stream the final reply for perceived latency

Cost and *perceived* speed are different problems. Streaming doesn't make a call cheaper — it makes the customer see the first words sooner. For a chatbot, time-to-first-token is the latency the user actually feels; a reply that starts rendering in 200ms feels fast even if it finishes in three seconds.

**Do this — stream the customer-facing reply.** Iterate the typed event stream and flush each delta; the final envelope on `stream.result` is identical to what `execute()` would return.

```ts
const stream = replyAgent.stream("Where's my refund for order A-7711?");

for await (const event of stream) {
  if (event.type === "agent.trip.streaming") {
    process.stdout.write(event.delta); // first tokens reach the user immediately
  }
}

const result = await stream.result; // same { data, usage, report } as execute()
```

> Stream only the part the human reads. A classifier's one-word output or a tool-argument extraction has nothing to stream and gains nothing from it — `execute()` is simpler there. Reserve streaming for the final composed reply, where time-to-first-token is what the customer perceives as speed.

## Put a budget and SLO contract around every run

Tiering, caching, and bounded context lower the *expected* cost. A budget guardrail caps the *worst* case — the runaway tool loop that quietly burns dollars and seconds before anyone notices. `ai.middleware.budget` enforces a hard ceiling, and its `contract` clause expresses a full service-level objective (cost, latency, tokens) with one reaction when any clause trips.

**Do this — declare the SLO as data and react once.** A hard cap aborts on breach; the contract adds wall-clock latency and an `onViolation` policy.

```ts
import { BudgetExceededError } from "@warlock.js/ai";

const guardedAgent = ai.agent({
  name: "support",
  model: strong,
  middleware: [
    ai.middleware.budget({
      // BudgetPricing is USD per 1K tokens — note the per-1K shape, NOT per-1M.
      // This is the budget's own cost math, separate from SDK ModelPricing.
      pricing: {
        "gpt-4o": { inputPer1K: 0.0025, outputPer1K: 0.01 },
      },
      contract: {
        maxCostUSD: 0.05,
        maxLatencyMs: 8_000,
        maxTokens: 40_000,
        onViolation: "abort", // any breached clause aborts with BUDGET_EXCEEDED
      },
    }),
  ],
});

const result = await guardedAgent.execute("Summarize this customer's full history.");

if (result.error instanceof BudgetExceededError) {
  // The error exposes the breach numerically — no message parsing.
  console.warn(`budget breach: ${result.error.actual} ${result.error.unit}`);
}

// On a clean run, read the rolled-up spend off the result. Usage.cost has no
// single scalar total — sum the populated channels, treating undefined as 0.
const cost = result.usage.cost;
if (cost) {
  const totalUSD =
    cost.input + cost.output + (cost.cachedInput ?? 0) + (cost.cachedOutput ?? 0);
  metrics.gauge("ai.turn.cost_usd", totalUSD);
}
```

**Avoid this — shipping a model loop with no ceiling.** An agent with tools and no budget has one failure mode that costs real money: a tool loop that keeps re-asking the model. Without a cap, the first time it happens in production you find out from the invoice, not from an alert.

> Roll a budget out in `warn` mode first: `onExceeded: "warn"` logs once on the first breach and lets the run finish, so you can measure real traffic against a proposed cap before flipping to `"abort"`. For graceful degradation instead of a hard stop, `onViolation: "fallback"` records a typed signal an outer middleware reads back to route the *next* turn to a cheaper agent. The budget is per-execution, not per-session — for a daily or session-wide cap, read your ledger before the next call and short-circuit at the application layer. See the [budgets and SLO recipe](../recipes/cost-budgets-and-slo).

## Batch the offline work — don't pay interactive latency for bulk jobs

Not every AI task is a live customer turn. Re-classifying a backlog of tickets, generating summaries for a nightly report, back-filling tags — these are *offline* jobs where throughput matters and per-item latency doesn't. `ai.batch` runs any executable over a dataset with bounded concurrency and per-item retry, and rolls the usage up so you get one cost number for the whole job.

**Do this — run bulk work through `ai.batch` with bounded concurrency.** One failed item never cancels its siblings; the rolled-up `usage` is the job's total cost.

```ts
const tickets = await ticketRepo.findUntagged(); // an array of inputs

const batchResult = await ai.batch(classifyAgent, tickets, {
  concurrency: 8,                              // cap parallel calls — respect rate limits
  retry: { attempts: 3, backoff: "exponential" },
});

for (const item of batchResult.items) {
  if (item.status === "completed") {
    await ticketRepo.tag(item.index, item.result?.data);
  }
}

// One cost number for the whole offline job.
console.log(`classified ${tickets.length} tickets, ${batchResult.usage.total} tokens`);
```

> Bounded concurrency is the point: it keeps you under provider rate limits while still running far faster than a serial loop. Tune it to your account's limits, not to "as high as possible." See the [batch classify recipe](../recipes/dx-batch-classify-dataset).

## Use a fallback model for resilience — but it's a failover, not a default

`ai.fallbackModel` wraps an ordered list of models and advances to the next only when the current one fails with a *transient* provider error (rate-limit, timeout, 5xx). It's a resilience tool: a provider blip degrades to a backup instead of failing the customer. The trap is treating it as a cost or quality strategy — it changes nothing on the happy path, where the first model always answers.

**Do this — order it primary-first for failover only.** The first model handles every healthy request; the backup exists for the minutes your primary provider is down.

```ts
const resilientModel = ai.fallbackModel([
  strong,                                          // answers every healthy request
  openai.model({ name: "gpt-4o-mini" }),           // backup when the primary is unavailable
]);

const supportAgent = ai.agent({ name: "support", model: resilientModel });
```

**Avoid this — leaning on the fallback as your normal model.** The fallback never fires on a healthy primary, so a *quality* problem ("answers are weak") is not a fallback problem — fix the primary model or prompt. And it advances instantly with no backoff, so for rate-limits you usually want a backoff strategy too, not just a second model to immediately hammer.

> A non-transient failure (bad API key, oversized prompt, blocked content) fails identically on every downstream model, so `fallbackModel` re-throws it immediately rather than burning budget retrying. It's a failover, full stop — keep it in the resilience column, never the cost or quality column. See the [provider fallback recipe](../recipes/cost-provider-fallback).

## Avoid list

The short version of everything above — the mistakes that quietly inflate a support bot's bill with no improvement in the answer:

- **Don't run a router loop for one-specialist messages.** It pays the routing tax (~2 calls per iteration) to reach a conclusion a single classifier reaches in one pass. Use the classifier fast-path; reserve the loop for genuinely multi-specialist messages.
- **Don't resend the full history every turn.** Set `historyWindow` to bound the per-turn view and `summarize` to compact the tail, or a long session becomes your most expensive request for no quality gain.
- **Don't use the strong model for routing or classification.** A `gpt-4o-mini`-class model picks the same intent at a fraction of the cost. Spend the strong model only on the reply the customer reads.
- **Don't splice volatile data into the front of the system prompt.** It busts the provider's prefix cache every turn — keep the stable prefix stable and confirm hits with `Usage.cachedTokens`.
- **Don't loosen a semantic-cache threshold to chase hit rate.** A loose threshold serves the wrong stored answer; that's a correctness bug, not a saving.
- **Don't ship an agent with tools and no budget.** A runaway tool loop is the one failure mode that costs real money — cap it with `ai.middleware.budget`.
- **Don't treat `fallbackModel` as a default or a quality fix.** It only fires on transient provider failures; it does nothing on the happy path.

## See also

- [Recipe — Classifier fast-path triage](../recipes/supervisor-classifier-fast-path) — the cheapest triage: one classify, one specialist.
- [Recipe — Support triage supervisor](../recipes/supervisor-support-triage) — the full router loop and the triage cost ladder.
- [Recipe — Budget caps and SLO contracts](../recipes/cost-budgets-and-slo) — hard caps, the SLO contract, and the soft-fallback signal.
- [Recipe — Stateful support bot](../recipes/orchestrator-stateful-support-bot) — multi-turn sessions with `historyWindow` and compaction.
- [Recipe — RAG with cache similarity](../recipes/rag-with-cache-similarity) — one cache driver for retrieval, snapshots, and response caching.
- [Recipe — Track cost](../recipes/cost-tracking) — reading the `Usage.cost` breakdown off a result.
- [Architecture — Middleware](../architecture-concepts/middleware) — the onion model, install order, and the budget/cache built-ins.
- [Architecture — Orchestrators](../architecture-concepts/orchestrators) — the session lifecycle that `historyWindow` and `summarize` bound.

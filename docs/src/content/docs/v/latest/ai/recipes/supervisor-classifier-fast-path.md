---
title: "Recipe — Classifier fast-path triage"
description: Skip the per-iteration router entirely. A single iteration-zero classifier picks the one intent that runs, dispatches it, and terminates — the cheapest possible triage when one specialist can answer the whole message.
---

Most support messages don't need a multi-turn conversation between specialists — they need exactly one. "What's your refund policy?" is a billing question, full stop. Running a full router loop for that is wasteful: every iteration is an extra LLM trip just to re-decide what was obvious from word one.

The supervisor's `classifier` mode is the fast path. It runs **once**, on iteration zero, as a prelude: it classifies the input, the supervisor dispatches the single chosen intent, and — when there's no `router` or `route` configured alongside it — the run terminates right after that intent settles. One classify call, one specialist call, done. This recipe builds a cheap triage that classifies an inbound message into `billing`, `tech`, or `smalltalk` and answers it in a single pass.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
```

```bash
# .env
OPENAI_API_KEY=sk-...
```

## The classifier agent

A classifier agent must emit the framework's locked classifier shape — `{ intent, reasoning?, confidence? }` — where `intent` is one of the supervisor's intent keys. We declare that with a `v.enum` over the exact keys so the model can't invent an off-list intent, and add `reasoning`/`confidence` as telemetry.

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

const classifyAgent = ai.agent({
  name: "classify",
  description: "Single-pass triage classifier.",
  model,
  output: v.object({
    intent: v.enum(["billing", "tech", "smalltalk"]),
    reasoning: v.string().optional(),
    confidence: v.number().optional(),
  }),
  systemPrompt: ai.systemPrompt()
    .persona("You triage inbound support messages.")
    .instruction("Pick the single best intent: `billing`, `tech`, or `smalltalk`.")
    .instruction("Set `confidence` between 0 and 1 for how sure you are."),
});
```

## The specialists

Each intent produces its own `reply` slice. Because only one runs per fast-path execution, there's no merge contention to design around.

```ts
const billingAgent = ai.agent({
  name: "billing",
  description: "Answers charges, refunds, invoices, and plan questions.",
  model,
  output: v.object({ reply: v.string() }),
  systemPrompt: ai.systemPrompt()
    .persona("You are a billing specialist.")
    .instruction("Answer the customer's billing question directly in one short paragraph."),
});

const techAgent = ai.agent({
  name: "tech",
  description: "Answers bugs, errors, outages, and login failures.",
  model,
  output: v.object({ reply: v.string() }),
  systemPrompt: ai.systemPrompt()
    .persona("You are a technical support engineer.")
    .instruction("Give the most likely fix or next diagnostic step."),
});

const smalltalkAgent = ai.agent({
  name: "smalltalk",
  description: "Handles greetings, thanks, and non-support chit-chat.",
  model,
  output: v.object({ reply: v.string() }),
  systemPrompt: ai.systemPrompt()
    .persona("You are a friendly support concierge.")
    .instruction("Reply warmly and briefly. Invite a real question if there isn't one."),
});
```

## The supervisor

No `router`, no `route` — just `classifier`. That's the whole fast-path contract: the classifier picks iteration zero's intent, the supervisor dispatches it, and with nothing configured for iteration 1+, the run ends. We add a `refine` hook to demonstrate a deterministic safety net: when the model's self-reported confidence is weak, fall back to `tech` (a human-reviewable path) rather than guessing.

```ts
const fastTriage = ai.supervisor<{ reply: string }, { reply?: string }>({
  name: "classifier-fast-path",
  goal: "Answer the message in a single pass by routing it to exactly one specialist.",
  intents: {
    billing: billingAgent,
    tech: techAgent,
    smalltalk: smalltalkAgent,
  },
  classifier: {
    agent: classifyAgent,
    refine: (ctx) => {
      const { intent, confidence } = ctx.result.data;

      // Low-confidence guard: send ambiguous messages to the tech path
      // (the one that escalates to a human) instead of trusting a coin flip.
      if ((confidence ?? 1) < 0.6) {
        return { intent: "tech" };
      }

      return undefined; // accept the classifier's own pick
    },
  },
  output: v.object({ reply: v.string() }),
});
```

## Run it

```ts
const { data, error, usage, report } = await fastTriage.execute(
  "Hey, what's your refund window if I cancel mid-cycle?",
);

if (error) {
  console.error(`fast-path failed (${error.code}), terminated by ${report.terminatedBy}`);
  return;
}

console.log(data?.reply);

// The classifier's forensic trail is on report.classifier.
console.log(
  `classified as "${report.classifier?.intent}"`,
  report.classifier?.refined ? "(refined)" : "",
  `confidence ${report.classifier?.confidence ?? "n/a"}`,
);

console.log(
  `${report.iterations} iteration,`,
  `${usage.total} tokens, terminated by ${report.terminatedBy}`,
);
```

Expected flow for this input:

1. **Iteration 0, classify prelude** — `classifyAgent` returns `{ intent: "billing", confidence: 0.9 }`. The `refine` hook sees confidence ≥ 0.6 and returns `undefined`, accepting the pick.
2. **Iteration 0, dispatch** — the supervisor dispatches `billing`. `billingAgent` writes `{ reply }`.
3. **Terminate** — no router/route is configured, so the run ends with `report.terminatedBy: "classifier"` and `report.iterations === 1`.

Two LLM trips total (classify + billing) — exactly the floor for a triage that still uses a model to decide.

## When the classifier is deterministic

If your triage signal is a keyword or a metadata flag, skip the LLM classifier entirely with the callback form. A pure-code classifier costs zero tokens:

```ts
classifier: {
  run: (ctx) => {
    const text = String(ctx.input).toLowerCase();

    if (text.includes("refund") || text.includes("charge") || text.includes("invoice")) {
      return { intent: "billing", confidence: 1 };
    }

    if (text.includes("error") || text.includes("won't load") || text.includes("login")) {
      return { intent: "tech", confidence: 1 };
    }

    return { intent: "smalltalk", confidence: 0.5 };
  },
},
```

Now the only LLM call in the whole run is the one specialist that actually answers.

## Production notes

- **Fast-path vs. loop is a config switch, not a rewrite.** The same `intents` map works with `classifier` alone (single pass), with `router`/`route` alone (multi-turn loop), or with both — when you configure a classifier *and* a router, the classifier drives iteration 0 and the router picks up from iteration 1+. Start with the classifier; add a router later only if you find messages that genuinely need more than one specialist. See the [support-triage recipe](./supervisor-support-triage) for the full-loop version.
- **Don't gate control flow on raw `confidence`.** LLM-reported confidence is poorly calibrated — a model that says `0.95` is wrong about as often as one that says `0.85`. Use it as a *soft* signal inside `refine` (combined with a deterministic check or a fallback intent), never as the sole branch condition.
- **`refine` can also halt.** Returning the bare `END` sentinel from `refine` terminates the run before any intent dispatches — useful for a policy gate ("if the message is abusive, stop here"). Returning `{ intent: END, ...slice }` halts *after* merging a slice into state, so a rejection reason can surface on `data`.
- **`intent` must be a real key.** The classifier's (or `refine`'s) `intent` must match a key in `intents`, or the supervisor throws `SUPERVISOR_INVALID_ROUTE` at runtime. The `v.enum` over the intent keys catches this at the schema boundary before it ever reaches dispatch.
- **Forensics live on `report.classifier`.** `intent`, `reasoning`, `confidence`, the `refined`/`halted` flags, and the original pre-refine `raw` output are all captured there — log them to spot drift between what the classifier picked and what actually resolved the ticket.

---
title: "Recipe — Self-consistency voting with fanOut + router"
description: Run one agent N times in parallel under a supervisor with ai.fanOut, then vote on the majority answer in a callback intent — the self-consistency pattern for flaky reasoning.
sidebar:
  order: 12
  label: "Self-consistency voting"
---

A single sample from a reasoning model is a coin flip on the hard cases. Self-consistency fixes that cheaply: run the SAME agent N times independently, then take the majority answer. In `@warlock.js/ai` the building block is `ai.fanOut` — it spreads one agent into N distinctly-keyed supervisor intents that the supervisor dispatches in parallel — plus a callback intent that reads every branch's output and votes. You can drive dispatch with a deterministic `route` callback, or hand the choice to an LLM `ai.router`.

## The scenario

A math-word-problem agent is right most of the time but wrong on the same ~10% of cases in inconsistent ways. Running it five times and voting on the majority answer turns five flaky samples into one stable one. The flow is one supervisor:

1. **Iteration 0** — dispatch `solver1..solver5` in parallel (the fan-out).
2. **Iteration 1** — run a `vote` callback that tallies the five answers and writes the winner into state, then terminates.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
```

## The solver agent and its output slice

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { v } from "@warlock.js/seal";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

// Each branch contributes a typed slice. The supervisor strip-merges the
// agent's output against this schema before it lands on the snapshot.
const answerSchema = v.object({
  answer: v.string(),
  reasoning: v.string(),
});

const solver = ai.agent({
  name: "solver",
  description: "Solves a math word problem and shows its reasoning.",
  model: openai.model({ name: "gpt-4o-mini" }),
  output: answerSchema,
  modelOptions: { temperature: 0.8 }, // diversity across samples is the point
  systemPrompt: ai.systemPrompt()
    .persona("You solve math word problems carefully.")
    .instruction("Show brief reasoning, then give the final numeric answer."),
});
```

## The supervisor — fan out, then vote

`ai.fanOut(solver, 5)` returns `{ solver1, solver2, solver3, solver4, solver5 }`, each referencing the same agent but a distinct dispatch slot. The `vote` callback reads every settled branch off `ctx.result` and tallies the majority.

```ts
import type { DispatchContext } from "@warlock.js/ai";
import { END } from "@warlock.js/ai";

const SAMPLES = 5;

function tallyMajority(ctx: DispatchContext) {
  const counts = new Map<string, number>();

  // ctx.result holds this iteration's already-settled sibling branches,
  // keyed by intent name. Each branch's `output` is the strip-merged slice.
  for (const [intent, branch] of Object.entries(ctx.result)) {
    if (!intent.startsWith("solver") || branch.error) continue;

    const slice = branch.output as { answer?: string } | undefined;
    const answer = slice?.answer?.trim();
    if (!answer) continue;

    counts.set(answer, (counts.get(answer) ?? 0) + 1);
  }

  let winner: string | undefined;
  let best = 0;
  for (const [answer, count] of counts) {
    if (count > best) {
      best = count;
      winner = answer;
    }
  }

  // The returned object shallow-merges into supervisor state.
  return { answer: winner, votes: best, samples: SAMPLES };
}

const selfConsistency = ai.supervisor<{ answer?: string; votes?: number }>({
  name: "self-consistency-math",
  intents: {
    ...ai.fanOut(solver, SAMPLES), // solver1..solver5
    vote: {
      run: tallyMajority,
      description: "Tally the majority answer across the solver samples.",
    },
  },
  // Deterministic dispatch: fan out on turn 0, vote on turn 1, then stop.
  route: (ctx) => {
    if (ctx.iteration === 0) {
      return ["solver1", "solver2", "solver3", "solver4", "solver5"];
    }
    if (ctx.iteration === 1) {
      return "vote";
    }
    return END;
  },
  maxIterations: 3,
});
```

## Run it

```ts
const { data, report, usage, error } = await selfConsistency.execute(
  "A train travels 60 km in 45 minutes. What is its average speed in km/h?",
);

if (error) {
  console.error(error.code, "after", report.iterations, "iterations");
} else {
  console.log("majority answer:", data?.answer, `(${data?.votes}/${SAMPLES} votes)`);
  console.log("total cost:", usage.total, "tokens across all samples");
}
```

`usage` rolls up every one of the five solver runs plus the (zero-cost) vote callback, so the cost of self-consistency is visible in one number — it's roughly N times a single run, which is the honest price of the technique.

## Letting an LLM router decide instead

The deterministic `route` above is the right default — the flow is fixed, so an LLM call to decide it is pure waste. But when the dispatch order genuinely depends on the content (e.g. "only vote if the samples disagree, otherwise answer directly"), swap `route` for an `ai.router`. The router and the supervisor share the same `intents` object, and `route` / `router` are mutually exclusive — configure exactly one.

```ts
const intents = {
  ...ai.fanOut(solver, SAMPLES),
  vote: { run: tallyMajority, description: "Tally the majority answer." },
};

const router = ai.router({
  model: openai.model({ name: "gpt-4o-mini" }),
  intents,
  systemPrompt: "Coordinate a self-consistency vote over the solver samples.",
});

const routed = ai.supervisor({
  name: "self-consistency-routed",
  router,
  intents,
  maxIterations: 3,
});
```

`fanOut` requires each generated entry to carry a `description` when the supervisor uses a router (the LLM needs a signal per intent). It inherits the description from the unit by default — our `solver` has one (`"Solves a math word problem..."`), so the fan-out entries are router-ready. If your agent has no description, pass `ai.fanOut(solver, 5, { description: "..." })`.

## Production notes

:::note[Voting needs a comparable answer slice]
Majority voting only works when answers are comparable. Give the solver a structured `output` schema so each branch produces a clean `answer` field, and normalize before tallying (trim, lowercase, round numbers). Voting over free-form prose rarely finds a majority — two correct answers phrased differently each get one vote.
:::

- **Diversity is the fuel.** Identical samples can't disagree, so they can't correct each other. A non-zero `temperature` (and/or a "think differently this time" nudge) is what makes N samples worth more than one. At `temperature: 0` self-consistency degenerates to one expensive sample.
- **`fanOut` clones the slot, not the agent.** All five entries reference the same `solver` instance; each is a separate dispatch slot the supervisor runs independently in parallel. There's no per-sample config — vary behavior through `temperature`, not through five hand-built agents.
- **Read branches off `ctx.result`, not state.** Inside the vote callback, the just-settled sibling branches live on `ctx.result[intent].output` (this iteration's snapshot-in-progress). `ctx.state` holds the cross-iteration accumulator. Check `branch.error` and skip failed samples — a 4-of-5 vote is still a decisive majority.
- **Cost scales linearly with N.** Five samples cost roughly five single runs. Pick N for the accuracy you need (3 and 5 are common); the rolled-up `usage` tells you the exact bill.

## Related

- [Deterministic supervisor tests](./dx-deterministic-supervisor-tests) — test this supervisor without spending tokens.
- [Basic agent](./basic-agent) — the solver agent being fanned out.

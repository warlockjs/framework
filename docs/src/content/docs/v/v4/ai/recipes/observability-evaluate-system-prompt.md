---
banner:
  content: "This page documents Warlock v4. <a href='/v/latest'>View the latest docs.</a>"
title: "Recipe — Evaluate a system prompt from the dashboard"
description: Grade a trace's captured system prompt with an LLM judge, right from the Panoptic dashboard drawer, via the config-gated evaluate action.
sidebar:
  order: 23
  label: "Observability — evaluate a prompt"
---

You're staring at a failed (or merely mediocre) run in the dashboard. The system prompt is right there in the drawer, captured verbatim — but is it actually *good*? Clear enough, scoped enough, missing a rule that would have prevented this exact failure? Rather than copy it into a separate playground, the dashboard can grade it in place: click "Evaluate system prompt," optionally tweak the grading instructions, and get a score back — no new tooling, no leaving the trace you're already looking at.

This is the dashboard's **one write-capable route** — everything else is `GET`-only by design (see [Wire Panoptic](/v/v4/ai/recipes/observability-wire-panoptic/)). It's off unless you configure it.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/ai-panoptic
```

Content capture must be on — `evaluate` reads the system prompt off `span.input`, which only exists when the collector captured it:

```ts
import { ai } from "@warlock.js/ai";
import "@warlock.js/ai-panoptic";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

ai.config({
  panoptic: {
    dashboard: {
      evaluate: {
        model: openai.model({ name: "gpt-4o-mini" }), // the judge
        instructions: "Must stay under 150 words. Never invent prices or stock levels.",
      },
    },
    observeAll: true,
    captureContent: true,
  },
});
```

`model` accepts a literal `ModelContract` or a `() => ModelContract | Promise<ModelContract>` factory — the same shape `panoptic.cache` takes — so you can defer client construction until the first click. `instructions` is optional; the judge falls back to a built-in prompt-quality rubric when it's absent, and to whatever the operator typed in the dashboard's textarea when they used it.

## Using it

Open a trace in the dashboard, select the span whose prompt you want graded — any span that actually carries a system prompt (an agent span, not a tool span). The "Evaluate system prompt" button appears under the input/output block; click it to open a small panel with the grading instructions (pre-filled from `instructions` above, fully editable) and a "Run" button. The result — a `0–1` score and the judge's reasoning — renders inline.

Grading a specific failure without touching your config:

```
Instructions: Must explicitly say "I don't have pricing information" rather than guessing.
```

Run it, and the judge grades THIS run's captured prompt against THAT rule — a quick way to test a prompt-fix hypothesis before you actually change the prompt and redeploy.

## The building blocks (scripting it instead of clicking)

Everything the button does is a small set of exported functions — useful for a CI check or a batch re-grade over many traces:

```ts
import {
  evaluateSystemPrompt,
  extractLastSystemPrompt,
  findSpanById,
  createInMemoryTraceStore,
} from "@warlock.js/ai-panoptic";

const store = createInMemoryTraceStore();
// ...store filled by the collector, as in every other recipe...

const trace = store.get("trace-id");
const span = trace && findSpanById(trace.root, trace.root.spanId);
const systemPrompt = span && extractLastSystemPrompt(span);

if (systemPrompt) {
  const verdict = await evaluateSystemPrompt(systemPrompt, {
    model: openai.model({ name: "gpt-4o-mini" }),
    instructions: "Must address the customer by name.",
  });

  console.log(verdict); // { score?: number; issues: string[] }
}
```

`evaluateSystemPrompt` reuses `@warlock.js/ai`'s `judgePromptBody` — the exact same LLM-as-judge machinery `ai.prompts().validate({ criteria })` runs on prompt TEXT you already have in code. This recipe is the trace-sourced sibling: grading a prompt that actually ran, using what it actually said (including any placeholder values that were filled in), not the template you wrote it as.

## Production notes

- **"Last" system prompt, deliberately.** A long-running agent (`fullHistory` capture) can carry more than one system-role turn across its conversation; `extractLastSystemPrompt` takes the most recent one — the one actually in effect when the run produced its result.
- **The route is gated exactly like every other dashboard route** — the same `authToken` / `allowedHosts` checks (S4) apply. Configuring `evaluate` does not loosen any existing security posture.
- **`judgePromptBody` never throws** — a broken judge degrades to an issues-only outcome with no `score`, same as `ai.prompts().validate()`. The one thing that CAN fail is resolving `model` when it's a factory (e.g. a bad API key breaking SDK client construction); the route surfaces that as `502`.
- **Nothing persists.** The verdict lives in the drawer's client-side state for that viewing session — reload the page and it's gone. Re-run it if you need it again; grading isn't expensive enough to warrant storing it back onto the trace.

## Related

- [Observability — wire Panoptic](/v/v4/ai/recipes/observability-wire-panoptic/) — attach the subscriber and the store the dashboard reads from.
- [Observability — trace cost dashboard](/v/v4/ai/recipes/observability-trace-cost-dashboard/) — the read-only query layer this write route sits alongside.

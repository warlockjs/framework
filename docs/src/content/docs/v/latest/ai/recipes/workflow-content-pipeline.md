---
title: "Recipe — Content pipeline (outline → draft → edit → SEO)"
description: A four-stage editorial workflow built with ai.workflow — sequential drafting steps plus a parallel group that runs the copy-edit and the SEO pass at the same time, with typed final output.
---

The marketing team wants one call that turns a topic brief into a publish-ready article: first an **outline**, then a **draft**, then two independent finishing passes — a **copy edit** and an **SEO metadata** pass — that have no reason to wait on each other. Running those last two in parallel shaves a full model round-trip off the wall-clock time.

This is the canonical shape for `ai.workflow`: a few sequential agent steps feeding shared `ctx.state`, one `parallel` step that fans out work that is mutually independent, and a workflow-level `output` spec that extracts a single typed object at the end.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
```

## The agents

Each stage is a small, single-purpose agent. The outline and draft agents return prose; the SEO agent is pinned to a structured output schema so its result is a typed object, not free text.

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { v } from "@warlock.js/seal";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const outliner = ai.agent({
  name: "outliner",
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai.systemPrompt()
    .persona("You are a senior content strategist.")
    .instruction("Produce a tight, numbered outline. Headings only, no prose."),
});

const drafter = ai.agent({
  name: "drafter",
  model: openai.model({ name: "gpt-4o" }),
  systemPrompt: ai.systemPrompt()
    .persona("You are a long-form writer.")
    .instruction("Expand the supplied outline into a full first draft. Markdown."),
});

const copyEditor = ai.agent({
  name: "copy-editor",
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai.systemPrompt()
    .persona("You are a meticulous copy editor.")
    .instruction("Fix grammar, tighten sentences, keep the author's voice. Return the edited Markdown only."),
});

// The SEO agent has a baked-in output schema, so its result.data is typed.
const seoMeta = v.object({
  title: v.string(),
  metaDescription: v.string(),
  slug: v.string(),
  keywords: v.array(v.string()),
});

const seoAgent = ai.agent({
  name: "seo",
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai.systemPrompt()
    .persona("You are an SEO specialist.")
    .instruction("Given the draft, produce title, meta description, URL slug, and 5-8 keywords."),
  output: seoMeta,
});
```

## The workflow

The workflow input is the brief. Steps run top to bottom; `outline` writes to `ctx.state.outline`, `draft` reads it and writes `ctx.state.draft`, and the final `finishing` step runs its two children concurrently — they both read `ctx.state.draft` but write disjoint keys (`edited`, `seo`), so the last-write-wins shared-state rule never bites.

```ts
type Brief = { topic: string; audience: string; tone: string };

type FinalArticle = {
  body: string;
  seo: {
    title: string;
    metaDescription: string;
    slug: string;
    keywords: string[];
  };
};

const pipeline = ai.workflow<Brief, FinalArticle>({
  name: "content-pipeline",
  description: "Turn a topic brief into a publish-ready article with SEO metadata.",
  steps: [
    ai.step({
      name: "outline",
      agent: outliner,
      input: ctx => ({
        prompt: `Topic: ${ctx.input.topic}\nAudience: ${ctx.input.audience}\nTone: ${ctx.input.tone}\n\nWrite the outline.`,
      }),
      output: { extract: ctx => ctx.agentResult?.text ?? "" },
      after: ctx => {
        ctx.state.outline = ctx.steps.outline?.output as string;
      },
    }),

    ai.step({
      name: "draft",
      agent: drafter,
      input: ctx => ({
        prompt: `Outline:\n${ctx.state.outline}\n\nWrite the full draft in a ${ctx.input.tone} tone.`,
      }),
      output: { extract: ctx => ctx.agentResult?.text ?? "" },
      after: ctx => {
        ctx.state.draft = ctx.steps.draft?.output as string;
      },
    }),

    // Parallel finishing group: copy edit and SEO run at the same time.
    ai.step({
      name: "finishing",
      parallel: [
        ai.step({
          name: "edit",
          agent: copyEditor,
          input: ctx => ({ prompt: `Edit this draft:\n\n${ctx.state.draft}` }),
          output: { extract: ctx => ctx.agentResult?.text ?? "" },
          after: ctx => {
            ctx.state.edited = ctx.steps.edit?.output as string;
          },
        }),
        ai.step({
          name: "seo",
          agent: seoAgent,
          input: ctx => ({ prompt: `Produce SEO metadata for this draft:\n\n${ctx.state.draft}` }),
          // The SEO agent has a baked output schema, so agentResult.data is typed.
          output: { extract: ctx => ctx.agentResult?.data },
          after: ctx => {
            ctx.state.seo = ctx.steps.seo?.output;
          },
        }),
      ],
    }),
  ],

  // One typed object assembled from shared state at the end.
  output: {
    extract: ctx => ({
      body: ctx.state.edited as string,
      seo: ctx.state.seo as FinalArticle["seo"],
    }),
  },
});
```

## Run it

`execute` never throws — a failed step lands on `result.error` and `report.status`, so check those before reading `data`.

```ts
const { data, error, report } = await pipeline.execute({
  topic: "How vector databases power semantic search",
  audience: "Backend engineers new to RAG",
  tone: "practical and concrete",
});

if (error) {
  console.error(`pipeline failed at status=${report.status}:`, error.message);
  // Inspect which step broke:
  for (const [name, snap] of Object.entries(report.steps)) {
    if (snap.status === "failed") {
      console.error(`  step "${name}":`, snap.error);
    }
  }
} else {
  console.log(data!.seo.title);
  console.log(data!.seo.keywords.join(", "));
  console.log(`\n${data!.body}`);
}

// Timing: the parallel group means total < sum-of-stages.
console.log(`total ${report.duration}ms across ${Object.keys(report.steps).length} steps`);
```

A representative run:

1. **`outline`** — `outliner` returns a numbered outline; stored on `ctx.state.outline`.
2. **`draft`** — `drafter` expands the outline; stored on `ctx.state.draft`.
3. **`finishing`** — `edit` and `seo` fire **concurrently**. The parent step's snapshot is written atomically only after both children settle; both are addressable at `report.steps.edit` / `report.steps.seo` and at `report.steps.finishing.steps.edit`.
4. **`output.extract`** — assembles the final `{ body, seo }` object into `result.data`.

## Production notes

- **Parallel children share one `ctx.state` with last-write-wins.** It's safe here because `edit` and `seo` write disjoint keys (`edited`, `seo`). If two parallel children wrote the same key, the surviving value would be non-deterministic — keep their writes disjoint, or move the shared write into a sequential step after the group.
- **A failure in any parallel child fails the parent step.** The first child error surfaces as the parent's error; sibling children that already settled are still recorded in `report.steps.finishing.steps.*`. Add `retry` to a flaky child (see the retry-and-cancel recipe) rather than catching inside `run`/`input`.
- **`output.extract` only populates `result.data` on a clean completion.** On failure or cancellation `data` is `undefined` — always branch on `error` / `report.status` first.
- **`ctx.input` is deep-frozen and replayed verbatim on resume; `ctx.state` is the mutable scratch space.** Put the brief in `input`, derived artifacts (outline, draft, edited) in `state`.
- For long pipelines that must survive a crash, attach a `snapshotStore` and call `resume(runId)` — see the resumable-import-job recipe.

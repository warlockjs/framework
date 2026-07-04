---
title: "Refine prompts"
description: systemPrompt().refined({ model, criteria, store }) — the prompt compiler. Humans keep writing human prompt text; the refined wrapper lazily rewrites it into a model-optimized version, pins the result like a lockfile, enforces placeholder parity, and always falls back to the original on the agent path. refine() / refinePrompt() expose the compiled artifact for routes, review, warmup, and CI.
sidebar:
  order: 3
  label: "Refine prompts"
---

Humans write prompts as human text — a dev typing a persona inline, a product owner filling an admin-panel textarea. Models perform better on structured, specific, model-tuned phrasing. `.refined()` closes that gap **without asking the author to change how they write**: it turns any `SystemPrompt` into a lazily-compiled artifact. The first agent use rewrites the raw source template through a refiner model, pins the result, and every later use serves the pin.

Think **compilation with a lockfile**: the human text is the source (`package.json`); the refined text is the derived, pinned artifact (`yarn.lock`) — regenerated only when an input changes, never silently over time.

```ts
import { ai } from "@warlock.js/ai";

const support = ai
  .systemPrompt(
    [ai.persona("You are a friendly AI assistant."), ai.instruction("Help {{name}} with orders. Never discuss refunds over 500.")],
    { name: "support" },
  )
  .refined({ model: refinerModel, store: myCacheDriver });

// Lazy: compiles once on the first run, serves the pin afterwards.
const agent = ai.agent({ model, systemPrompt: support });
```

The wrapper is a full `SystemPromptContract` — it drops in anywhere a prompt does, and `meta()` still reads the source's identity, so agent reports keep stamping `support@1`.

## The four trust rules

1. **Lockfile posture.** The pin key hashes the built-in recipe version + refiner model + `criteria` + the raw source template. Any input change compiles fresh; an unchanged input **never** recompiles. `store` is a store, not a cache — pins don't expire, so your system prompt can't silently change text between Tuesday and Wednesday.
2. **Prose, never contract.** The exact `{{placeholder}}` set — names **and** `|default` parts — must survive the rewrite verbatim. This is machine-checked; a parity break gets one repair re-ask and is otherwise rejected. The compiled text is still a **template**: placeholders resolve per call, exactly as before.
3. **Advisory with fallback.** On the agent path, refinement can never break your app: if the refiner model fails, the run warns once and serves the **original** prompt — the human text is always a valid prompt. After 3 failed attempts the lazy path stops retrying entirely (a broken refiner key can't tax every request with its failure latency). The explicit surfaces (`refine()` / `refinePrompt()`) stay live and **throw** `PromptRefinementError` instead, because a route or CI caller needs the failure — and a later success re-arms the pin.
4. **Reviewable.** The compiled artifact is never a black box — read it with `refine()`, compose it with `refinePrompt()`, and diff it against the original through the registry.

## `refine()` — the compiled string

```ts
const text = await support.refine();
// "ROLE: You are a support assistant for order management.\n\nRULES:\n1. Address {{name}} directly…"

const anotherTake = await support.refine({ fresh: true }); // skip the pin, compile a new take
```

`refine()` is store-first: an unchanged input returns the pinned text with **zero** model calls. That makes it the natural surface for:

- **Admin preview/approve routes** — show original vs refined; the call itself warms the pin, so the next agent run pays nothing.
- **Boot warmup** — `await Promise.all(prompts.map(p => p.refine()))` before serving traffic.
- **CI compile checks** — fail the build when a prompt edit no longer compiles cleanly.

## `refinePrompt()` — the composable artifact

```ts
const compiled = await support.refinePrompt();

compiled.meta()?.refinedFrom;   // "support@1"
compiled.meta()?.refinerModel;  // "anthropic:claude-sonnet-4-5"
compiled.meta()?.required;      // carried from the source — the contract is preserved
compiled.resolve({ name: "Hasan" }); // placeholders still work
```

It returns a plain `SystemPrompt` (one instruction block holding the refined template) that composes with everything: hand it to an agent, `.merge()` it, `validate({ criteria })` it. It **never auto-registers** — registry versions stay human-intentional. Register it deliberately to unlock the review flow:

```ts
compiled.meta({ name: "support" });      // registers as support@2
ai.prompts.diff("support", "1", "2");    // original vs refined, block by block
```

## Options

| Option | Role |
| --- | --- |
| `model` | The refiner `ModelContract` (required). Runs as a one-shot `"prompt-refiner"` agent, so its usage/cost surface through the standard report machinery. |
| `criteria` | Your rules for the rewrite, on top of the built-in recipe — a string or list, same shape as [`validate({ criteria })`](/v/latest/ai/prompts/prompt-registry/#validate-against-your-own-criteria). *Validate grades against criteria; refined rewrites against them.* Folded into the pin key. |
| `store` | A structural `{ get, set }` (any `@warlock.js/cache` `CacheDriver` satisfies it — the package stays an optional peer). Share a redis/pg driver so one process pays each compilation and the fleet reads the pin. Omitted ⇒ the pin lives on the instance for the process lifetime. |

A pinned value that fails the parity check (corrupt or tampered store) is treated as a miss and recompiled — a poisoned store entry can't smuggle a placeholder-breaking prompt in.

## Where the lazy compile applies

The lazy hook rides the **agent path** — `ai.agent` execute/stream and everything built on it (supervisor member agents, planner steps, eval, `spawnSubAgent`, `serve`). Prompts that are resolved synchronously **at factory time** — `ai.planner({ systemPrompt })` / `ai.router({ systemPrompt })` prefixes, a supervisor's own `systemPrompt` / `goal`, and `ai.prompts.resolve()` — read whatever is pinned *at that moment*, so either warm the pin first (`await refined.refine()`) or pass the already-compiled `await refined.refinePrompt()` instead.

## Editing a refined prompt

`.persona()` / `.instruction()` / `.merge()` / `.meta()` on a refined prompt derive a new **source** and re-wrap it with the same refinement options — so editing naturally invalidates the pin (new source ⇒ new key ⇒ fresh compile on next use). `refined.source` always hands back the original builder.

## Prove it, don't assume it

A rewrite is a hypothesis, not a guarantee. Pair refinement with the two measurement tools you already have:

- [`validate({ criteria, judge })`](/v/latest/ai/prompts/prompt-registry/#validate-against-your-own-criteria) lints the compiled text against your rules.
- [`agent.eval`](/v/latest/ai/testing/evaluation-and-datasets/) runs original vs refined over a dataset — trust the compiled prompt when the numbers say so.

## Related

- [Prompt registry](/v/latest/ai/prompts/prompt-registry/) — `name@version`, tags, `diff`, and `validate` — the review flow rides on it.
- [Write system prompts](/v/latest/ai/prompts/write-system-prompts/) — the builder `.refined()` extends.
- [Evaluation and datasets](/v/latest/ai/testing/evaluation-and-datasets/) — measure the rewrite before trusting it.

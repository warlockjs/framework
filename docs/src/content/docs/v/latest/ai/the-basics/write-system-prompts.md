---
title: "Write system prompts"
description: ai.systemPrompt / ai.persona / ai.instruction — immutable builders with mustache placeholders and per-call overrides.
sidebar:
  order: 3
  label: "Write system prompts"
---

`@warlock.js/ai` ships a tiny prompt-composition surface. Three factories — `ai.systemPrompt()`, `ai.persona()`, `ai.instruction()` — compose into the `systemPrompt` option accepted by every agent and workflow step.

The whole point: keep prompts versioned, forkable, and free of brittle string concatenation.

## The three factories

```ts
import { ai } from "@warlock.js/ai";

ai.systemPrompt();                   // empty — chain blocks onto it
ai.systemPrompt("literal text");     // one-shot string form
ai.systemPrompt([block1, block2]);   // array form — blocks render in declaration order

ai.persona("You are Alex.");         // PersonaContract block
ai.instruction("Reply in Arabic.");  // InstructionContract block
```

## Three usage shapes

### String form — one-shot

```ts
ai.agent({
  model,
  systemPrompt: "You are a concise senior TypeScript engineer.",
});
```

Fine for prototypes. Doesn't scale to multiple agents that share a persona.

### Builder form — composable

```ts
const prompt = ai.systemPrompt()
  .persona("You are Alex, a senior TypeScript engineer.")
  .instruction("Explain things assuming the reader is a Go developer.")
  .instruction("Always cite the relevant TypeScript handbook section.");

const myAgent = ai.agent({ model, systemPrompt: prompt });
```

Each call returns a new `SystemPrompt`. Chain to add blocks; the original is never mutated.

### Array form — explicit order

```ts
ai.systemPrompt([
  ai.persona("You are Alex, a TypeScript expert."),
  ai.instruction("Respond in {{language|English}}."),
]);
```

Useful when you have prebuilt persona / instruction blocks reused across many prompts.

## How blocks order

`SystemPrompt` stores `blocks: readonly SystemPromptBlockContract[]` — not separate persona + instructions fields. Rendering honors insertion order.

- **Chained `.persona(x)`** — replaces the existing persona in place, or prepends when none exists. Default persona-first layout.
- **Chained `.instruction(y)`** — appends.
- **Array form** — verbatim.

## Immutability — safe forking

Every mutation returns a new `SystemPrompt`. The original is never touched:

```ts
const base = ai.systemPrompt().persona(alex).instruction(cite);
const arabic = base.instruction("Prefer Arabic comments");

// `base` still has 2 blocks. `arabic` has 3. Neither affects the other.
```

`Persona` and `Instruction` blocks follow the same rule — their `text` is `readonly`. Safe to share base prompts across multiple agents; safe to fork; nothing reaches back to mutate state you didn't intend.

## Mustache placeholders

`{{key}}` and `{{key|defaultValue}}` substitute at render time:

```ts
const prompt = ai.systemPrompt()
  .persona("You are Alex, a TypeScript expert.")
  .instruction("Respond in {{language|English}}.");

await myAgent.execute("Why use generics?", {
  placeholders: { language: "Arabic" },
});
```

Or set defaults on the agent — per-call values override them:

```ts
ai.agent({
  model,
  systemPrompt: prompt,
  placeholders: { language: "Arabic" },
});
```

Substitution works on the rendered concatenation of every block, so `{{key}}` inside a persona and inside an instruction both resolve against the same placeholder bag.

## Per-call overrides

Replace the agent's system prompt for a single run:

```ts
await myAgent.execute(input, { systemPrompt: alternativePrompt });
```

Useful for A/B testing, request-scoped personalization, turn-by-turn prompt variation.

## Forking a base prompt

```ts
const base = ai.systemPrompt()
  .persona("You are a support agent for Acme Corp.")
  .instruction("Cite policy §{{policy}} when denying a refund.");

const enterprise = base.instruction("Escalate immediately for Enterprise customers.");
const trial = base.instruction("Offer a 14-day extension before closing the ticket.");
```

Three distinct prompts, one common foundation. Base is immutable — safe to share across modules.

## Why tagged discriminator, not `instanceof`

All blocks implement `SystemPromptBlockContract { readonly type: string; readonly text; resolve() }`. Runtime discrimination uses the string `type` tag (`"persona"`, `"instruction"`) — NOT `instanceof`.

Why: `instanceof` breaks across duplicate package copies (different `node_modules` trees), across realms, across bundler scopes. Tagged unions don't.

## Related

- [Run agent](./run-agent) — `systemPrompt` on the factory and per-call override.
- [Run workflow](../digging-deeper/run-workflow) — per-step agents inherit their own system prompts.

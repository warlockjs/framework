---
title: Measure a call before generating
sidebar:
  label: Measure call tokens and cost
description: Measure tool schemas, system text, skills catalogues and messages, with native token counts or labelled estimates and input USD per call.
---

`ai.measure()` reports the input tokens carried by each call before generating a response. It uses the model's `countTokens` endpoint when available, and the existing input and tool-schema heuristics otherwise. Native counting can make several network requests; it never calls `complete()` or `stream()` or executes a tool.

```ts
import { ai, type ModelContract, type ToolConfig } from "@warlock.js/ai";

declare const model: ModelContract;
declare const tools: ToolConfig<unknown, unknown>[];

const library = ai.skills({
  name: "support",
  sources: [{ type: "directory", path: "./agent-skills" }],
});
const before = await ai.measure({
  model,
  tools,
  system: "Help customers find the right documentation.",
  messages: [{ role: "user", content: "How do I reset my password?" }],
  skills: library,
});
const after = await ai.measure({
  model,
  tools,
  toolSchemas: "compact",
  system: "Help customers find documentation.",
  messages: [{ role: "user", content: "How do I reset my password?" }],
  skills: library,
});

console.log(before.parts.tools.tokens, before.parts.tools.source);
console.log(before.total.costUSD); // undefined when model.pricing is absent
console.log(ai.measure.diff(before, after).total); // signed after minus before
```

The standalone `measure` export is the same function, including `measure.diff(before, after)`. Public types are `MeasureOptions`, `MeasurePart`, `MeasureParts`, `Measurement`, `MeasureDelta`, and `MeasurementDiff`.

## Read the report

Each of `parts.messages`, `parts.system`, `parts.skills`, `parts.tools`, and `total` has `tokens`, `source: "native" | "estimate"`, and optional `costUSD`. The report also carries `model`, `provider`, and `probe`.

Attribution is incremental: first messages, then system text, then the skills catalogue, then tools. Each part is the difference from the preceding stage, so the parts sum to `total`. Native tools are counted in the full prompt context. Attribution depends on this order and can be signed when tokenization changes at a boundary. It is not an independent tokenizer count of each isolated string. Estimated tool tokens reuse `measureTools`' per-schema rounding; the estimated total is the sum of those schemas and the estimated messages/system/catalogue input.

`system` is resolved text. Messages are used as supplied; avoid also placing the same system prompt or catalogue in `messages`. Skills catalogue text is prepended to the system text, matching agent injection order. `skills` accepts either a catalogue string or a library exposing `catalogPrompt()`. Measurement reads the catalogue only: it does not preload skill bodies or automatically add `loadSkill` / `saveSkill` tools. Include the library's exposed tool configs in `tools` when measuring an agent that carries them, and include already loaded bodies in the input you supply.

Omitted or empty `messages` uses a user message containing `.` as the counting context. `probe: true` records this, and `parts.messages` includes its tokens and framing. Supply representative messages to measure an actual turn. Options passed via `callOptions` apply to every count; any response-schema or provider-option overhead is therefore included in the messages baseline.

`toolSchemas: "compact"` measures compact schema copies without changing the original tools. `estimate` accepts `charsPerToken`, `attachmentTokens`, and `perMessageTokens` to tune the fallback. Estimates retain the existing helper's limitations for media and provider replay blocks; they are not billing counts.

If any native count explicitly rejects the request shape with `InvalidRequestError.reason: "count-unsupported"`, the entire report is recalculated as estimates. Authentication, transport and other provider errors propagate. Invalid negative or non-finite counts reject.

## Interpret USD and diffs

`costUSD` uses `model.pricing` and the existing cost helpers at the uncached input rate. It is the projected input cost of one call, excluding generated output, cache read/write adjustments, hosted-tool requests and provider-specific fees. Unknown pricing leaves `costUSD` absent, including in JSON; explicit zero pricing produces zero.

`measure.diff(before, after)` retains both reports and returns signed token and USD differences for each part and the total. Negative values mean a reduction. USD differences are absent if either side is unpriced. Check both reports' sources, models, and probe flags before interpreting a comparison; comparisons across models also reflect their different prices.

## Use the CLI

```sh
warlock ai measure --model "$MODEL_ID" --tools ./tools.ts --system ./system.md --skills ./agent-skills --json
```

The CLI measures the supplied fixed input with the explicit `.` probe. See [AI measure CLI](/v/latest/core/cli/ai/) for provider IDs, configured model modules, exports and pricing configuration.

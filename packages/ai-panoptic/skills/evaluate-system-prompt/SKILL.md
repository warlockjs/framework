---
name: evaluate-system-prompt
description: 'Grade a single trace''s LAST captured system prompt from the dashboard drawer — the dashboard''s only write-capable feature, config-gated via `DashboardOptions.evaluate` (`ai.config({ panoptic: { dashboard: { evaluate: { model, instructions } } } })`). Triggers: `evaluate`, `EvaluateConfig`, `EvaluateVerdict`, `evaluateSystemPrompt`, `extractLastSystemPrompt`, `findSpanById`, "Evaluate system prompt" button, `POST .../spans/:spanId/evaluate`, grading a prompt from a real trace, judging a captured system prompt, per-run instructions override, judge model factory; ''evaluate this trace''s prompt'', ''grade the system prompt from the dashboard'', ''judge a captured run'', ''score a live system prompt''. Skip: grading raw prompt TEXT you already have in code (no trace involved) — `@warlock.js/ai`''s `ai.prompts().validate({ criteria })`, the same judge machinery this wraps; a DATASET of test cases run through an agent — `@warlock.js/ai`''s `ai.dataset` + `agent.eval`; viewing/filtering/grouping traces without grading them — `@warlock.js/ai-panoptic/use-local-dashboard/SKILL.md`; capturing the content this feature reads — `@warlock.js/ai-panoptic/export-traces/SKILL.md` (`captureContent`).'
---

# Evaluate a trace's system prompt from the dashboard

A drawer button that grades the LAST `{role: "system"}` message captured on the selected span — not the whole conversation, not the tool code, just the system prompt that was actually in effect for that run. It's the dashboard's only write-capable feature: every other route is `GET`-only and read-only by design (see `use-local-dashboard/SKILL.md`'s security note); this one POSTs, and it's off unless you explicitly opt in.

## Enable it

```ts
import { ai } from "@warlock.js/ai";
import "@warlock.js/ai-panoptic";

ai.config({
  panoptic: {
    dashboard: {
      evaluate: {
        model: openai.model("gpt-4o-mini"),
        instructions: "Must address the user by name. Never invent prices.",
      },
    },
    observeAll: true,
    captureContent: true, // required — evaluate reads the captured span.input
  },
});
```

Absent `evaluate` ⇒ the drawer never renders the button and a `POST` to its route 405s like any other route would (the path is never even pattern-matched) — the dashboard stays fully read-only unless you opt in.

### `EvaluateConfig`

| Field | Required | Notes |
|---|---|---|
| `model` | yes | A `ModelContract`, or a `() => ModelContract \| Promise<ModelContract>` factory — mirrors `panoptic.cache`'s literal-or-factory ergonomics. Resolved fresh on every evaluate click (a deliberate, infrequent, human-triggered action — not the collector's hot path — so no memoization, unlike the cache store's driver). |
| `instructions` | no | Default grading rubric/criteria, verbatim — the same shape `ai.prompts().validate({ criteria })` accepts. Seeds the dashboard's editable textarea (baked into the served page at boot, so the operator sees and can extend the actual default, not a blank box); the built-in prompt-quality rubric is used when neither this nor a per-run override is supplied. |

## The UI

Open a trace, select the span whose prompt you want graded (any span carrying a captured `[system, user]` pair or `fullHistory` message array — an agent span, not a tool span). An "Evaluate system prompt" button appears under the input/output block **only when that span actually has a system prompt to grade** (`extractLastSystemPrompt` finds one) — no dead button on tool spans or system-prompt-less runs.

Click it to open an inline panel: a textarea pre-filled with the configured `instructions` (fully editable — type over it, append to it, or clear it to fall back to the built-in rubric) and a "Run" button. The result — `score` (0–1, shown as a percentage) and `issues` (the judge's reasoning, as a list) — renders inline once it lands. State (open/closed, typed text, last result) is kept per-span in client memory, so switching to a sibling span and back doesn't lose it; it does NOT persist to the trace store or survive a page reload.

## The building blocks (for embedding elsewhere)

```ts
import { evaluateSystemPrompt, extractLastSystemPrompt, findSpanById } from "@warlock.js/ai-panoptic";

const span = findSpanById(trace.root, spanId);          // walk the span tree
const prompt = extractLastSystemPrompt(span);            // undefined if none captured
if (prompt) {
  const verdict = await evaluateSystemPrompt(prompt, evaluateConfig, "Per-run override, optional");
  // verdict: { score?: number; issues: string[] }
}
```

- **`extractLastSystemPrompt(span)`** — reads `span.input` (only present under `captureContent`). Handles both shapes `report-to-span.ts` produces: the `[system, user]` first-trip pair, and — under `fullHistory` — the full `CapturedMessage[]` conversation, where it takes the LAST system-role turn (a long-running agent can carry more than one; the most recent one is the one actually in effect). Returns `undefined` for a tool span, an agent with no system prompt, or when content capture is off.
- **`findSpanById(root, spanId)`** — depth-first lookup inside a trace's span tree; the route uses it to resolve which node the drawer had selected.
- **`evaluateSystemPrompt(text, config, instructionsOverride?)`** — the grading call. `instructionsOverride` (trimmed; blank-after-trim is treated as absent, never as "grade against nothing") wins over `config.instructions`. Reuses `@warlock.js/ai`'s `judgePromptBody` verbatim — the SAME LLM-as-judge machinery `ai.prompts().validate({ criteria })` runs — so there's exactly one judging implementation in the whole framework, not two. `judgePromptBody` itself never throws (a broken judge degrades to an issues-only outcome with no `score`); the only step that CAN throw is resolving `config.model` when it's a factory (e.g. constructing an SDK client) — the dashboard route catches that and returns `502`.

## The route

`POST {basePath}api/traces/:traceId/spans/:spanId/evaluate`, body `{ instructions?: string }` (all optional — an empty body is valid). Gated by the same `authToken` / `allowedHosts` checks as every other route (S4) — off-loopback still requires a token, exactly like the rest of the dashboard. Body reads are capped at 64 KB (`413` past that) so a hostile/oversized payload can't hold the connection open.

| Status | Meaning |
|---|---|
| `200` | `EvaluateVerdict` — `{ score?: number; issues: string[] }` |
| `404` | trace or span not found |
| `422` | the span carried no captured system prompt to grade |
| `413` | request body over 64 KB |
| `400` | request body isn't valid JSON |
| `502` | `config.model` (a factory) threw resolving the judge model |
| `405` | POST hit this path but `evaluate` isn't configured |

```sh
curl -X POST 'http://127.0.0.1:4319/api/traces/tr_1/spans/sp_1/evaluate' \
  -H 'content-type: application/json' \
  -d '{"instructions": "Must never invent prices."}'
```

## See also

- [`@warlock.js/ai-panoptic/use-local-dashboard/SKILL.md`](@warlock.js/ai-panoptic/use-local-dashboard/SKILL.md) — the dashboard this feature is a drawer action of; its security note now says "every route is GET-only and read-only EXCEPT the one opt-in write route `evaluate` enables."
- [`@warlock.js/ai-panoptic/export-traces/SKILL.md`](@warlock.js/ai-panoptic/export-traces/SKILL.md) — `captureContent` (and `fullHistory`), the prerequisite for `span.input` to carry anything gradable.
- `ai.prompts().validate({ criteria })` in `@warlock.js/ai` — the sibling capability this reuses: grading raw prompt TEXT you already have in code, no trace or dashboard involved.

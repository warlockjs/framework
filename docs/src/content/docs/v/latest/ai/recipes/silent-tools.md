---
title: "Recipe — Silent Tools"
description: mode "silent" on ai.tool — fire-and-forget side-effect tools, the all-silent loop-termination rule, and provider quirks.
sidebar:
  order: 5
  label: "Silent tools"
---

> **What it is.** A `mode` flag on `ai.tool({ ... })` that tells the agent loop "don't round-trip this tool's result back to the model." Saves a full LLM call when the tool is a pure side effect.
>
> **When you want it.** State mutations (`update_state`, `set_locale`, `set_topic`), telemetry pings (`log_summary`), classifier updates — anything where the model's output doesn't depend on the tool's return value.
>
> **When you don't.** Anything where the model's reply needs to reference the tool result (`search_catalog`, `search_knowledge_base`, `ask_questions`). For those, leave `mode` unset (defaults to `"feedback"`).

---

## Quick start

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";

const updateStateTool = ai.tool({
  name: "update_state",
  description: "Persist customer slot-fill (preferences, constraints, focus).",
  mode: "silent",
  input: v.object({
    preferences: v.array(v.string()).optional(),
    constraints: v.array(v.string()).optional(),
    currentFocus: v.string().optional(),
  }),
  execute: async (patch, ctx) => {
    // Side-effect: write to chat.state. Result is not seen by the model.
    ctx.artifacts.stateUpdate = patch;
    return { ok: true };
  },
});
```

Register it on an agent like any other tool. The framework figures out the rest.

---

## How it works

The agent's trip loop normally goes:

1. Model emits `[prose][tool_use]` → `finishReason: "tool_calls"`.
2. Agent dispatches the tool, gets the result.
3. Agent appends `role: "tool"` message and runs **another** LLM trip.
4. Model reads the tool result and emits the final reply.

Two LLM round-trips. With a silent tool, step 3 is skipped: when **every** tool call this trip is silent, the loop terminates after dispatch. One LLM round-trip, side effects executed.

The "all silent" rule is load-bearing: if the model emits a silent tool AND a feedback tool in the same generation, the feedback tool's result still has to round-trip, so the loop continues normally (and the silent tool happens to piggyback for free).

---

## The three usage patterns

### Pattern 1 (recommended) — Silent piggybacks on a feedback tool

This is the cleanest, highest-value pattern. The agent calls a feedback tool to do real work AND a silent tool to update state on the side. The loop continues because of the feedback tool, and trip 2 produces the user-visible prose normally.

```
User: "Show me quiet ACs under 2000 AED for a bedroom"

Trip 1:
  Model emits:
    [tool_use: search_catalog, query="quiet AC under 2000 AED bedroom"]
    [tool_use: update_state, currentFocus="quiet AC <2000 AED bedroom",
                              constraints=["quiet", "<2000 AED"]]

  Agent dispatches both:
    search_catalog → 5 hits returned
    update_state   → state written, no return value seen by model

  Loop continues (feedback tool needs result).

Trip 2:
  Model reads search_catalog result, emits:
    "Here are 3 quiet units under 2000 AED..."
  Loop terminates (no tool calls).

User sees: "Here are 3 quiet units under 2000 AED..."
```

Cost: 2 LLM trips, but `update_state` was free of an extra trip — without `mode: "silent"` it would have taken 3.

### Pattern 2 (use carefully) — Silent-only background ops with no user reply

When the agent decides to do a side effect that the user doesn't need acknowledged in prose (telemetry, classification updates, summary refresh), silent-only is fine — the user sees no reply for that turn, but they weren't expecting one. This works best for **background actions the agent triggers itself**, not in response to a user message.

Caution: if the agent calls a silent tool in response to a user message and emits no prose, the user sees nothing. **OpenAI models (gpt-4o, gpt-4o-mini) do NOT reliably emit prose alongside a tool call** — even with explicit prompting. Don't design around the assumption that prose will appear.

### Pattern 3 (avoid) — Silent-only WITH expected prose acknowledgement

```
User: "Switch to Arabic please"

Naive design:
  Agent emits [prose: "Got it"][tool_use: set_locale]
  Loop terminates (silent only).
  User sees: "Got it"

Reality on OpenAI:
  Agent emits [tool_use: set_locale]   ← no prose
  Loop terminates.
  User sees: NOTHING.
```

**Don't design tools around this pattern.** If the user must see an acknowledgement, either:

- Combine with a feedback-mode no-op tool (ugly hack).
- Skip silent mode for that tool — let it round-trip; cost is one extra LLM call but the reply is reliable.
- Rework so the locale change happens during another tool call (e.g. agent always calls `set_locale` alongside `search_catalog` on the first turn — falls into Pattern 1).

---

## Constraints for silent tool authors

### MUST be cheap and fast

The user is already waiting on the prose stream that finished (in mixed-mode) or on nothing (in silent-only). The HTTP request is still open until the silent tool resolves. Keep silent tools to:

- Local DB writes (single row insert/update).
- In-memory mutations on `ctx.artifacts`.
- Cheap external calls with strict timeouts (< 500ms).

Bad fits for silent mode:

- Anything that talks to a slow third party.
- Long-running background jobs (use a queue inside the silent tool — kick off and return immediately).
- Anything where success/failure should change the reply.

### Should be idempotent

Silent tools have no surface to communicate failure to the model. If the tool fails, the model never knows. Design tools so a failure is recoverable on the next turn (state can be re-derived, telemetry can be re-emitted) rather than catastrophic.

### Result is silent on the LLM channel only

Middleware (logging, cost tracking, telemetry) still sees silent tools. `MiddlewareToolContext.tool.mode === "silent"` is exposed so observability tooling can branch — e.g. cost middleware can skip projecting a follow-up trip's tokens since there won't be one.

---

## Provider behavior (empirical)

Captured from the smoke test at `scripts/smoke/silent-tools.ts` and the side-by-side example at `src/app/examples/silent-tools.ts` (run 2026-05-07 via OpenRouter):

| Provider | Model | Single-trip terminates? | Prose alongside silent tool_use? |
| --- | --- | --- | --- |
| Anthropic | claude-sonnet-4.6 | ✓ Yes | ✓ Yes — emits prose deltas alongside the tool call |
| OpenAI | gpt-5 | ✓ Yes | ✗ No — emits the tool call alone |
| OpenAI | gpt-4o | ✓ Yes | ✗ No — emits the tool call alone |
| OpenAI | gpt-4o-mini | ✓ Yes | ✗ No — emits the tool call alone |

**Framework invariant.** Silent mode terminates the loop after dispatch regardless of provider. That part is solid across all four models tested.

**The split is in prose emission.** Claude interleaves text with tool calls naturally — "Sure, I've switched your language preference to Arabic!" was streamed before/around the `set_locale` call in a single generation. The OpenAI line (gpt-4o-mini, gpt-4o, gpt-5) consistently emits ONLY the tool call with no accompanying text, even when the system prompt explicitly demands a prose acknowledgement.

**Translation for tool authors:**

- **On Claude** — Pattern 3 (silent-only with visible prose) is viable. The user sees a streamed reply alongside the silent tool's side effect.
- **On the OpenAI line** — Pattern 3 is dead. A silent-only turn produces zero user-visible text. Use Pattern 1 (mixed-mode piggyback) when prose is required.

This is a hard provider distinction, not a prompting issue. Don't waste prompt tokens trying to coerce GPT into emitting prose alongside `tool_use` — the OpenAI Chat Completions API treats tool calls and text content as alternatives, not companions, when the model judges a tool call is the appropriate response.

---

## System-prompt guidance

When introducing a silent tool to an agent, **don't** instruct the model that "the prose alongside the tool IS the final reply" — that's the Pattern 3 footgun, and OpenAI ignores it.

**Do** treat silent tools as opportunistic enhancements. Example:

```
ai.instruction(`When you have new information about the customer that should
persist across turns (preferences, constraints, current focus), call
\`update_state\` with the deltas. Do this ALONGSIDE your normal tool calls
and reply — never instead of them.`)
```

The "alongside" framing nudges the model toward Pattern 1 (mixed mode) and avoids the brittle Pattern 3.

---

## Related

- `@warlock.js/ai/src/contracts/tool.contract.ts` — `ToolMode` type and `mode?: ToolMode` field.
- `@warlock.js/ai/src/agent/agent.ts` — trip loop terminal-decision logic at the all-silent check.
- `domains/ai/design/decisions.md` — locked decision capturing the rule.
- `domains/ai/plans/2026-05-07-silent-tools.md` — implementation plan.
- `scripts/smoke/silent-tools.ts` — provider smoke test, runnable via `tsx --env-file=.env scripts/smoke/silent-tools.ts`.

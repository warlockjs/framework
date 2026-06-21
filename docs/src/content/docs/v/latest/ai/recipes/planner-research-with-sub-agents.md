---
title: "Recipe — Research with sub-agents"
description: A planner that delegates each research subtask to a fresh ai.spawnSubAgent — a single-use agent with its own prompt, tools, and a first-class per-task budget so one runaway delegate can't overrun the whole run.
---

You are building a market-research assistant. A goal like *"Compare the three leading vector databases on pricing, scaling, and ecosystem"* fans out into several independent investigations — one per database, plus a synthesis pass. You want each investigation to run in its own clean context (no cross-contamination between the Pinecone notes and the Weaviate notes) and, crucially, you want a *hard cost ceiling per investigation* so a single sub-agent that gets stuck in a tool loop can never blow the budget for the whole report.

`ai.spawnSubAgent` is the primitive for exactly this. It's a thin wrapper: each call builds a brand-new `ai.agent` — its own system prompt, tools, and conversation, and (when you set `budget`) a `budget` middleware that aborts the moment a cap is crossed — then runs the task once. The fresh-conversation start is just ordinary new-instance behavior; the genuine convenience is the first-class per-task budget plus the build-run-discard shape. Wrap a spawn behind a planner capability and the planner can generate a plan that delegates each subtask to a single-use, budgeted delegate, while still rolling every spawn's cost and trace up into one unified report.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
```

## A sub-agent delegating capability

`ai.spawnSubAgent(spec)` is a one-shot async function: it spawns the agent, runs a single `task` through it, and returns the agent's `AgentResult` — it never throws on a runtime failure (failures land on `result.error`). To hand that delegation to a planner, wrap it in a capability whose `executable` satisfies the executable contract by calling `spawnSubAgent` and returning its result envelope.

```ts
import { ai } from "@warlock.js/ai";
import type { AgentResult } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { webSearchTool } from "./tools";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });
const researchModel = openai.model({ name: "gpt-4o-mini" });

/**
 * A planner capability that delegates its input — the subtask the
 * planner resolved — to a fresh, budgeted sub-agent. The capability's
 * `execute(input, options)` returns the sub-agent's full result
 * envelope, so the planner rolls its `usage` and `report` up uniformly.
 */
const investigate = {
  async execute(task: string, options?: { signal?: AbortSignal; sessionId?: string }): Promise<AgentResult> {
    return ai.spawnSubAgent({
      name: "researcher",
      model: researchModel,
      task,
      systemPrompt: ai.systemPrompt()
        .persona("You are a focused research analyst.")
        .instruction("Use web_search to gather facts. Report findings as terse bullet points with sources."),
      tools: [webSearchTool],
      // Hard per-spawn ceiling. The sub-agent's budget middleware aborts
      // the instant either cap is crossed — isolated from every other spawn.
      budget: { maxTokens: 8_000, maxCostUSD: 0.05 },
      maxTrips: 4,
      signal: options?.signal,
      sessionId: options?.sessionId,
    });
  },
};
```

### Anatomy of a spawn spec

`SpawnSubAgentSpec` is the full surface of one delegation. Every field below feeds the fresh `agent()` that the spawn builds internally — there is no other agent involved, so what you put on the spec *is* the entire delegate.

| Field | Type | What it sets |
| --- | --- | --- |
| `name` | `string` | Stable identifier for the spawned agent (shows up in its report node). |
| `model` | `ModelContract` | The model this delegate runs against — can differ per spawn. |
| `task` | `string` | The single instruction run through the sub-agent's `execute()`. |
| `systemPrompt` | `SystemPromptContract \| string` | The delegate's *own* persona + instructions, scoped to its subtask. |
| `tools` | `AgentToolEntry[]` | The delegate's *own* tool set — never the parent's. |
| `maxTrips` | `number` | Per-spawn round-trip cap. |
| `budget` | `BudgetOptions` | The per-spawn spend ceiling (see below). |
| `output` | `StandardSchemaV1` | A `@warlock.js/seal` schema validated into the delegate's `result.data`. |
| `signal` | `AbortSignal` | Cancellation handle threaded into the delegate's run. |
| `sessionId` | `string` | Stamped onto the delegate's report tree so it groups under the parent session. |

The `budget` field is a `BudgetOptions` object, not a number — the same shape the standalone `budget()` middleware takes. At least one cap must be present (a budget with no cap is a no-op):

```ts
budget: {
  maxTokens: 8_000,   // cumulative input + output tokens across every trip
  maxCostUSD: 0.05,   // cumulative USD — needs model pricing to fire (see below)
}
```

Either or both. `maxTokens` always enforces. `maxCostUSD` only fires when the model's pricing is resolvable; without it the USD check silently skips and the token cap still guards. Internally the spawn attaches the `budget` middleware *only when* `budget` is set — so the common no-budget delegation stays a plain agent with zero overhead, and the moment a cap is crossed the delegate aborts at the next trip boundary with a `BudgetExceededError` on its `result.error`.

Because every one of these fields is consumed by a brand-new `agent()` per call, two spawns share nothing: not the system prompt, not the tool list, not the conversation history, and not the budget ledger. Two `investigate` delegations running back-to-back each start from an empty conversation and an empty budget counter. Be precise about *why*, though: that separation isn't special machinery — it's just two different `ai.agent()` instances behaving the way any two agents do. What `spawnSubAgent` genuinely packages is the **per-task budget** as a first-class field plus the one-shot build-run-discard shape; the clean-slate start is ordinary new-instance behavior you'd get from constructing an agent yourself.

The synthesis step is a plain agent — no delegation, it just reads the gathered notes and writes the comparison.

```ts
const synthesizer = ai.agent({
  name: "synthesizer",
  description: "Combine independent research notes into one comparison.",
  model: openai.model({ name: "gpt-4o" }),
  systemPrompt: ai.systemPrompt()
    .persona("You are a senior analyst writing a buyer's comparison.")
    .instruction("Produce a clear side-by-side comparison. Cite the sources from the notes. No filler."),
  maxTrips: 2,
});
```

## The planner

Register the delegating capability once. The planner's LLM will reference `investigate` as many times as the goal warrants — one delegated investigation per database — then call `synthesize` to combine them. `maxSteps` caps total delegations so a wildly over-eager plan cannot spawn an unbounded number of sub-agents.

```ts
const researcher = ai.planner({
  name: "market-researcher",
  model: openai.model({ name: "gpt-4o" }),
  systemPrompt:
    "Break the goal into one focused investigation per subject, then a single synthesis step.",
  capabilities: [
    {
      name: "investigate",
      description: "Delegate one focused research subtask to an isolated, budgeted sub-agent.",
      executable: investigate,
    },
    {
      name: "synthesize",
      description: "Combine the gathered research notes into one final comparison.",
      executable: synthesizer,
    },
  ],
  maxSteps: 6,
});
```

## Run it

```ts
const { data, error, usage, report } = await researcher.execute(
  "Compare Pinecone, Weaviate, and Qdrant on pricing, scaling, and ecosystem.",
);

if (error) {
  console.error(`research run failed: ${error.code} — ${error.message}`);
  // Inspect which delegated step tripped its budget (if any):
  const overspent = report.executedSteps.find(
    (s) => s.status === "failed" && s.error?.code === "BUDGET_EXCEEDED",
  );
  if (overspent) {
    console.error(`sub-agent "${overspent.step.capability}" hit its budget cap`);
  }
  return;
}

console.log("Plan:", report.plan?.summary);

for (const snapshot of report.executedSteps) {
  console.log(
    `  [${snapshot.index}] ${snapshot.step.capability} → ${snapshot.status}` +
      ` (${snapshot.usage.total} tok, ${Math.round(snapshot.duration)}ms)`,
  );
}

console.log("\nComparison:\n", data);
console.log(`\nWhole-run total: ${usage.total} tokens`);
```

A likely run:

1. **Plan generation** — the planner emits, say, four steps: three `investigate` delegations (one per database) and one `synthesize`.
2. **Steps 0–2** — each `investigate` step spawns a *fresh* sub-agent. Each gets its own `web_search` loop, its own conversation, and its own `{ maxTokens: 8_000, maxCostUSD: 0.05 }` ceiling. If the Weaviate spawn loops on tool calls and crosses its cap, *only that spawn* aborts with a `BudgetExceededError` — the other spawns are untouched.
3. **Step 3** — `synthesize` runs the synthesizer agent. The planner threads the three investigations' outputs into its input context, so it writes the comparison from the gathered notes.

## Aggregating sub-agent outputs back into the parent

A delegate runs in isolation — but its result has to come *back* and feed the work that follows. There are two distinct aggregation paths, and which one you get depends on whether the spawns are ordered planner steps or hand-run in parallel.

### Inside the planner — automatic, output-threaded

When `investigate` is a planner capability, the planner does the aggregation for you. After each completed step it takes that step's output and **threads it into the input context of the next step**. The downstream `synthesize` step therefore receives a compact digest of every prior investigation prepended to its own task, roughly:

```text
Context from earlier steps:
- investigate: <Pinecone findings…>
- investigate: <Weaviate findings…>
- investigate: <Qdrant findings…>

Task: Combine the gathered research notes into one final comparison.
```

You write none of that plumbing — the synthesizer simply sees the three investigations as upstream context and writes the comparison from them. Two consequences worth internalizing:

- The output the planner threads forward is the delegate's **structured `data` when an `output` schema was set, otherwise its raw `text`.** So if you want the synthesis step to receive clean structured findings rather than prose, give each `investigate` spawn an `output` schema (see the typed-output note below) — the planner forwards the typed object verbatim.
- The **final completed step's output becomes the planner's own `result.data`.** Order your plan so the synthesis step runs last and you get the comparison straight off `data`, exactly as the "Run it" block above reads it.

Beyond the threaded context, every delegation is also recorded forensically. Each spawn folds into the parent on three axes at once:

```ts
const { usage, report } = await researcher.execute(goal);

// 1. Cost rollup — every spawn's tokens summed into the parent total.
console.log(`whole-run tokens: ${usage.total}`);

// 2. Trace rollup — each spawn's full report tree under report.children[].
console.log(`dispatched capabilities: ${report.children.length}`);

// 3. Per-step ledger — one snapshot per attempted step, in order.
for (const snapshot of report.executedSteps) {
  console.log(
    `[${snapshot.index}] ${snapshot.step.capability} → ${snapshot.status}` +
      ` · ${snapshot.usage.total} tok`,
  );
  // The delegate's own report tree, reachable per step:
  if (snapshot.childReport) {
    console.log(`   child report: ${snapshot.childReport.type}/${snapshot.childReport.status}`);
  }
  // The threaded output the next step received (structured data or text):
  if (snapshot.status === "completed") {
    console.log(`   output:`, snapshot.output);
  }
}
```

`usage` is the merged total across the plan-generation trip plus every spawn; `report.children[]` is the cross-cutting tree (every dispatched delegate's report in execution order); `report.executedSteps[]` is the authoritative per-step record, each entry carrying that step's `output`, `usage`, `error`, and the delegate's full `childReport`.

### Outside the planner — you aggregate explicitly

When you run the spawns yourself (the `Promise.allSettled` fan-out shown below), there is no planner to thread outputs forward — *you* collect them. Each spawn returns its own `AgentResult`, and you reduce those into whatever shape the next stage needs. The parallel block already does exactly this: it filters out budgeted-out spawns by checking `result.error`, pulls each surviving delegate's `result.text`, and joins them into one `notes` string you then hand to the synthesizer agent yourself:

```ts
const comparison = await synthesizer.execute(
  `Compare these vector databases from the gathered notes:\n\n${notes}`,
);

console.log(comparison.text);
console.log(`synthesis cost: ${comparison.usage.total} tokens`);
```

The trade-off is explicit control for explicit work: you decide which delegates' outputs survive, how they're stitched, and how their cost rolls up — the planner makes all three calls for you, at the cost of strict ordered execution that stops at the first failure.

## Why per-spawn budgets, not one shared cap

A single budget over the whole run can be exhausted by one greedy delegate before the others even start. Per-spawn budgets are the opposite contract: each sub-agent carries *its own* isolated ledger, so the failure of one investigation is contained to that investigation. The planner still records the failed step (and marks the steps after it `skipped`, since it stops at the first failure) — you see exactly which delegate overspent in `report.executedSteps`.

If you want partial-failure tolerance instead — keep going even when one investigation busts its budget — run the spawns yourself with `Promise.allSettled` rather than as ordered planner steps:

```ts
const subjects = ["Pinecone", "Weaviate", "Qdrant"];

const settled = await Promise.allSettled(
  subjects.map((subject) =>
    ai.spawnSubAgent({
      name: `research-${subject.toLowerCase()}`,
      model: researchModel,
      task: `Research ${subject}: pricing, scaling limits, ecosystem maturity. Cite sources.`,
      tools: [webSearchTool],
      budget: { maxTokens: 8_000, maxCostUSD: 0.05 },
      sessionId: "vectordb-comparison",
    }),
  ),
);

// spawnSubAgent never throws, so every entry fulfills — `result.error`
// distinguishes a budgeted-out spawn from a successful one.
const notes = settled
  .filter((entry): entry is PromiseFulfilledResult<AgentResult> => entry.status === "fulfilled")
  .map((entry) => entry.value)
  .filter((result) => !result.error)
  .map((result) => result.text)
  .join("\n\n");
```

Pass a shared `sessionId` to every spawn so their report trees group under one conceptual session in flat trace queries, even when they ran in parallel.

## When to spawn vs just call an agent

`ai.spawnSubAgent` constructs a fresh `agent()` per call (plus a budget middleware when budgeted) and runs it once. Reach for it when you want a named, single-use delegation with its own spend cap. The deciding question is: *does this subtask want a clean-slate agent of its own and a separate spend ceiling — and is a throwaway agent worth it to get them?*

**Spawn a sub-agent when:**

- **You want context isolation.** The subtask should run from a clean slate, with no exposure to the caller's conversation history and no chance of polluting it — the Pinecone investigation must not see the Weaviate notes, and vice versa. A fresh spawn guarantees the empty-conversation start.
- **You want a hard per-subtask budget.** You need a delegated subtask to carry *its own* `maxTokens` / `maxCostUSD` ceiling so a runaway tool loop is contained to that subtask. This is what `spawnSubAgent` makes ergonomic — a first-class `budget` field. (You *can* get the same with a plain `ai.agent({ middleware: [ai.middleware.budget(...)] })`; the spawn just saves the wiring and bundles it with the one-shot run.)
- **The subtask needs a different persona, tool set, or model.** A focused research delegate gets `web_search` and a "terse analyst" persona; the parent has neither. Each spawn's `systemPrompt` / `tools` / `model` are its own, so divergent delegates don't require divergent long-lived agents.
- **You're fanning out repeatable, independent units of work** — one per subject, per document, per shard — and want each to roll its cost and trace up into one unified report.

**Just call an agent (or run a tool) directly when:**

- **The work is part of one continuous reasoning thread.** If the step should *build on* the caller's accumulated conversation rather than start fresh, keep it in the same agent — spawning would throw that context away. The `synthesizer` above is exactly this: it's a plain `ai.agent`, not a spawn, because there's nothing to isolate.
- **You don't need a separate spend cap.** If the existing run-level budget already covers the step, a spawn's per-subtask ledger buys you nothing.
- **It's a single deterministic call** — a tool, a one-shot extraction, a formatting pass. Wrapping it in a whole agent loop is overhead with no payoff; call the tool or agent directly.

Rule of thumb: **spawn when you want a named single-use delegation with its own spend cap; otherwise call the agent or tool inline.** The strongest single signal is a *per-subtask budget requirement* — not because you couldn't wire `ai.middleware.budget` onto a plain agent yourself, but because `spawnSubAgent` makes that the one-line default for a throwaway delegate.

## Production notes

- **It's a thin wrapper, not a sandbox.** Each spawn is a plain new `ai.agent()` run once — its fresh conversation and own tools/prompt/budget-ledger are ordinary new-instance behavior, not special isolation (every `ai.agent()` already has them). What `spawnSubAgent` adds is packaging: a first-class per-task `budget`, the build-run-discard shape, and a `report` that slots under the caller's `report.children[]` so cost and traces roll up uniformly. It's also a *narrower* surface than `agent.execute` — one-shot, with no `history`, `placeholders`, per-call events, or `repair`.
- **`budget` vs `maxTrips`.** `budget` caps *spend* (`maxTokens` and/or `maxCostUSD`) and aborts at the trip boundary the moment a cap is crossed. `maxTrips` caps *round-trips*, not spend — a sub-agent can exhaust its trips while well under budget, or bust its budget on a single expensive trip. Set both for belt-and-suspenders.
- **`maxCostUSD` needs pricing.** The USD cap only fires when the model's pricing is known (configure it on the SDK adapter or per model). Without pricing, the token cap still enforces; the USD check silently skips. See the cost-tracking recipe for wiring pricing.
- **Typed sub-agent output.** Pass `output` (a `@warlock.js/seal` schema) in the spawn spec to validate the sub-agent's result into typed `result.data` — handy when a delegate must return structured findings rather than prose.
- **Cancellation and sessions thread through.** `signal` and `sessionId` on the spawn spec are forwarded into the sub-agent run; when you spawn from inside a planner capability, forward the planner's own `options.signal` / `options.sessionId` (as the capability above does) so a cancelled planner run cancels its in-flight delegates and every spawn shares the run's session id.
- **`maxSteps` bounds the fan-out.** Because each `investigate` step is one spawn, the planner's `maxSteps` is also your cap on how many sub-agents a single goal can spin up. Set it with the worst-case spawn count in mind.

## Related

- [Autonomous task runner](./planner-autonomous-task-runner) — the planner basics this recipe builds on.
- [Cost tracking](./cost-tracking) — configuring the pricing that `budget.maxCostUSD` reads.
- [Tool-calling agent](./tool-calling-agent) — the tools (like `web_search`) you hand a spawned sub-agent.

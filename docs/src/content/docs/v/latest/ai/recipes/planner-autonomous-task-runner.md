---
title: "Recipe — Autonomous task runner"
description: Hand ai.planner a goal plus a toolbox of agents and tools, let it generate an ordered plan, run it step-by-step, and read the executed steps and report.
---

You run a content ops team. A request lands as a single English sentence — *"Draft a launch announcement for our new pricing tiers and make sure the numbers are right"* — and the work behind it is always the same shape but never the same steps: pull the current pricing, sanity-check the figures, draft the copy. You do not want to hand-wire a fixed workflow for every variant of "research, verify, write". You want to describe the *capabilities* you have and let the model decide the order.

That is exactly what `ai.planner` is for. You register a toolbox of capabilities (each one an agent, a tool, a workflow — anything that satisfies the executable contract), hand the planner a goal, and it asks an LLM for an ordered plan over those capabilities, then executes that plan step-by-step through each capability's own `execute()`. You get back the generated plan, a per-step forensic record, and the rolled-up usage — one unified envelope.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/ai-openai @warlock.js/seal
```

## The toolbox: two agents and a tool

Each capability needs a `name` (the stable handle the LLM references in each plan step), a `description` (the "when would the planner pick this?" line injected into the plan-generation prompt), and an `executable`. Here the planner mixes a tool with two agents — heterogeneous primitives, one uniform surface.

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { pricingRepo } from "./repos";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

// A leaf tool: deterministic data fetch, no LLM cost.
const fetchPricingTool = ai.tool({
  name: "fetch_pricing",
  description: "Fetch the current published pricing tiers from the database.",
  action: "Loading current pricing",
  input: v.object({ product: v.string() }),
  execute: async ({ product }) => {
    const tiers = await pricingRepo.tiersFor(product);
    return { product, tiers };
  },
});

// An agent that sanity-checks figures.
const verifierAgent = ai.agent({
  name: "figure-verifier",
  description: "Cross-check that quoted prices and percentages are internally consistent.",
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai.systemPrompt()
    .persona("You are a meticulous numbers checker.")
    .instruction("Flag any price, discount, or percentage that does not add up. Be terse."),
  maxTrips: 2,
});

// An agent that writes the announcement.
const writerAgent = ai.agent({
  name: "announcement-writer",
  description: "Draft customer-facing launch copy from verified pricing notes.",
  model: openai.model({ name: "gpt-4o" }),
  systemPrompt: ai.systemPrompt()
    .persona("You are a product marketing writer.")
    .instruction("Write a concise, upbeat launch announcement. No placeholder text."),
  maxTrips: 2,
});
```

## The planner

The planner needs a `model` to build its internal plan-generation agent (or pass `planner` to bring your own — see the production notes), plus the `capabilities` array. `maxSteps` caps how many steps the planner will actually execute; a generated plan longer than that has its tail recorded as `skipped`.

```ts
const taskRunner = ai.planner({
  name: "launch-task-runner",
  model: openai.model({ name: "gpt-4o" }),
  capabilities: [
    {
      name: "fetch_pricing",
      description: "Fetch the current published pricing tiers from the database.",
      executable: fetchPricingTool,
    },
    {
      name: "verify_figures",
      description: "Cross-check that quoted prices and percentages are consistent.",
      executable: verifierAgent,
    },
    {
      name: "write_announcement",
      description: "Draft the customer-facing launch copy from the verified notes.",
      executable: writerAgent,
    },
  ],
  maxSteps: 5,
});
```

## Run it

`execute(goal)` returns the unified `{ type, data, error, usage, report }` envelope. The planner never throws on a runtime failure — a bad plan, a failed step, or a cancellation all surface on `result.error` with `report.status` narrowing further. Check `error` first.

```ts
const { data, error, usage, report } = await taskRunner.execute(
  "Draft a launch announcement for the new Acme pricing tiers and make sure the numbers are right.",
);

if (error) {
  console.error(`planner failed: ${error.code} — ${error.message}`);
  console.error(`got through ${report.executedSteps.filter((s) => s.status === "completed").length} step(s)`);
  return;
}

// The generated plan, verbatim, before any step ran.
console.log("Strategy:", report.plan?.summary);

for (const snapshot of report.executedSteps) {
  console.log(
    `  [${snapshot.index}] ${snapshot.step.capability} → ${snapshot.status} (${Math.round(snapshot.duration)}ms)`,
  );
  if (snapshot.step.reason) {
    console.log(`        why: ${snapshot.step.reason}`);
  }
}

// `data` is the final completed step's output — here, the writer's draft.
console.log("\nFinal draft:\n", data);
console.log(`\nTotal tokens: ${usage.total}`);
```

A likely run:

1. **Plan generation** — the planner's LLM emits a three-step plan: `fetch_pricing` → `verify_figures` → `write_announcement`, with a one-line `summary`.
2. **Step 0** — `fetch_pricing` runs the tool, returns the tiers. Zero LLM cost (it is a leaf tool).
3. **Step 1** — `verify_figures` runs the verifier agent. The planner threads step 0's output into this step's input context, so the verifier sees the actual tiers.
4. **Step 2** — `write_announcement` runs the writer agent with the verified notes threaded in. Its text becomes `result.data`.

Each step's output is prefixed onto the next step's input as a compact "Context from earlier steps:" digest, so a downstream capability builds on what ran before it without you wiring the hand-off yourself.

## Inspect the plan

Everything the planner decided and did lives on `result.report`. Two fields carry it: `report.plan` — the verbatim LLM output *before* any step ran — and `report.executedSteps` — one `PlannerStepSnapshot` per step the planner attempted, in execution order.

`report.plan` is a `PlannerPlan`: an ordered `steps` array plus an optional one-line `summary`. Each `PlannerStep` carries the `capability` it dispatches, the resolved `input` string, an optional `reason`, and the advisory `id` / `dependsOn` note the LLM may emit (recorded for forensics, never used to reorder — see the production notes).

```ts
// The strategy and the ordered steps the LLM committed to up front.
console.log("Strategy:", report.plan?.summary);

for (const step of report.plan?.steps ?? []) {
  console.log(`  plan → ${step.capability}: ${step.input}`);
  if (step.dependsOn?.length) {
    console.log(`         (depends on: ${step.dependsOn.join(", ")})`);
  }
}
```

`report.executedSteps` is the run-time counterpart — what *actually* happened to each step. Every snapshot carries its 0-based `index`, the `step` it ran, a terminal `status` of `"completed"`, `"failed"`, or `"skipped"`, the captured `output` (present only when completed), the typed `error` (present only when failed), timing (`startedAt` / `endedAt` / `duration`), the step's own `usage`, and the dispatched capability's full `childReport` tree.

```ts
for (const snapshot of report.executedSteps) {
  console.log(
    `  [${snapshot.index}] ${snapshot.step.capability} → ${snapshot.status} (${Math.round(snapshot.duration)}ms)`,
  );

  if (snapshot.status === "completed") {
    console.log(`        output:`, snapshot.output);
  }

  if (snapshot.status === "failed") {
    console.log(`        error: ${snapshot.error?.code} — ${snapshot.error?.message}`);
  }
}

// Quick tallies straight off the status discriminant.
const completed = report.executedSteps.filter((s) => s.status === "completed").length;
const failed = report.executedSteps.filter((s) => s.status === "failed").length;
const skipped = report.executedSteps.filter((s) => s.status === "skipped").length;
console.log(`completed ${completed}, failed ${failed}, skipped ${skipped}`);
```

A `skipped` snapshot is a real record — it carries the `step` the planner *would* have run, a zero `duration`, and an empty `usage`, but no `output` and no `childReport`. That is how the report stays a faithful description of the whole intended plan even when the run stopped early (see below).

## Reading the report

`report.executedSteps` is the authoritative per-step record — one `PlannerStepSnapshot` per step the planner attempted, each carrying `status` (`"completed"` / `"failed"` / `"skipped"`), `output`, `duration`, `usage`, and the dispatched capability's full `childReport`. `report.children` carries every dispatched capability's report tree in execution order (plus the plan-generation trip), and every node shares the run's `rootRunId` because lineage is stamped across the whole subtree.

```ts
// Drill into the verifier's own trips, for example:
const verifyStep = report.executedSteps.find((s) => s.step.capability === "verify_figures");
console.log("verifier child report status:", verifyStep?.childReport?.status);
```

## When a step fails

The planner executes steps strictly in order and stops at the first failure. When a capability dispatch returns a non-`undefined` `error`, that child error becomes the run error verbatim, the step is recorded with `status: "failed"`, and every step after it is recorded as `skipped` — so the report still describes the whole intended plan even though the tail never ran.

```ts
const result = await taskRunner.execute(goal);

if (result.error) {
  const failed = result.report.executedSteps.find((s) => s.status === "failed");
  console.error(`step "${failed?.step.capability}" failed:`, failed?.error?.message);

  // Steps after `failed` are present with status "skipped" — none of them ran.
  const skipped = result.report.executedSteps.filter((s) => s.status === "skipped");
  console.error(`${skipped.length} step(s) skipped:`, skipped.map((s) => s.step.capability));
}
```

The run can also fail *before any step runs*, when the generated plan itself is unusable. The planner constrains generation with a plan schema built from the live capability names, but it still guards the result and surfaces a `PlannerPlanInvalidError` (code `PLANNER_PLAN_INVALID`, category `schema`) on `result.error` in three cases:

- **Empty plan** — the LLM returned no `steps` (or an empty `steps` array). There is nothing to execute.
- **Unknown capability** — a step references a `capability` name that was never registered on the planner. The planner refuses to dispatch a handle it cannot resolve.
- **Bad final output** — only when you configured an `output` schema. The final completed step's output failed validation against it; the planner replaces the run error with `PlannerPlanInvalidError` and clears `result.data`.

In the first two cases `report.executedSteps` is empty (nothing was dispatched); in the third the steps ran but the typed output was rejected. Because `PlannerPlanInvalidError` extends `PlannerFailedError`, a broad `error instanceof PlannerFailedError` catch still covers it, while the narrow `error.code === "PLANNER_PLAN_INVALID"` check isolates the bad-plan family specifically.

```ts
import { PlannerPlanInvalidError } from "@warlock.js/ai";

const result = await taskRunner.execute(goal);

if (result.error instanceof PlannerPlanInvalidError) {
  // Empty plan, an unknown-capability reference, or a failed output guard.
  console.error("planner could not produce a usable plan:", result.error.message);
}
```

## The `maxSteps` cap

`maxSteps` is a hard ceiling on how many steps the planner will actually *dispatch*, not a hint to the LLM. It defaults to `10` and must be `>= 1` (a smaller value throws a `PlannerFailedError` tagged `authoring: true` at construction). When the generated plan is longer than the cap, the planner runs steps `0 … maxSteps - 1` and records every step at index `maxSteps` and beyond as `skipped` — they appear in `report.executedSteps` with the `step` the LLM proposed but are never executed and never billed.

```ts
const boundedRunner = ai.planner({
  name: "bounded-runner",
  model: openai.model({ name: "gpt-4o" }),
  capabilities: [
    { name: "fetch_pricing", description: "Fetch the current pricing tiers.", executable: fetchPricingTool },
    { name: "verify_figures", description: "Cross-check the figures.", executable: verifierAgent },
    { name: "write_announcement", description: "Draft the copy.", executable: writerAgent },
  ],
  // Even if the LLM plans four steps, only the first two ever run; the rest are `skipped`.
  maxSteps: 2,
});

const { report } = await boundedRunner.execute(goal);
const dispatched = report.executedSteps.filter((s) => s.status !== "skipped").length;
console.log(`dispatched ${dispatched} of ${report.plan?.steps.length} planned step(s)`);
```

Set it deliberately for cost-bounded runs — it is the one knob that guarantees an upper bound on dispatched work regardless of how ambitious the plan the LLM returns.

## A note on cost

A planner run bills in a predictable shape: **exactly one plan-generation call, then one call per executed step**. The plan-generation agent runs `maxTrips: 1`, so generation is always a single LLM round-trip. Step cost then depends entirely on what each capability is:

- A leaf **tool** (like `fetch_pricing`) runs deterministic code — zero LLM tokens.
- An **agent** capability costs whatever its own trips cost (bounded by that agent's `maxTrips`).

Every child's `usage` rolls up into the planner's top-level `result.usage` (and onto each snapshot's `snapshot.usage`), so the rolled-up `usage.total` already includes the planning call plus every dispatched step. Steps that were `skipped` — whether because a prior step failed, the run was cancelled, or they fell past `maxSteps` — contribute a zero `usage` and cost nothing. So the worst-case spend of a run is bounded by the planning call plus `maxSteps` capability dispatches. See [Cost tracking](./cost-tracking) for reading the rolled-up `usage` in detail.

## Production notes

- **`model` vs `planner`.** Pass `model` and the planner builds an internal single-trip plan-generation agent for you. Pass `planner` (a fully-configured `ai.agent`) instead when you want a custom system prompt, middleware, or a budget on the planning step itself. They are mutually exclusive — configure exactly one, or the factory throws a `PlannerFailedError` tagged `authoring: true`.
- **`maxSteps` is a hard ceiling, not a hint.** It defaults to `10`. A plan longer than the cap is truncated — the dropped tail lands in `executedSteps` as `skipped`, never executed. Set it deliberately for cost-bounded runs.
- **Typed final output.** Pass an `output` schema (factory-level or per-call via `execute(goal, { output })`) to validate the last completed step's output into `result.data`. A validation failure replaces the run error with a `PlannerPlanInvalidError` and clears `data`.
- **Cancellation.** Thread an `AbortSignal` through `execute(goal, { signal })`. The planner short-circuits at the next step boundary, returns `report.status === "cancelled"` with a `PlannerCancelledError`, and forwards the signal into in-flight capability dispatches (mid-step abort is best-effort, depending on the child honoring it).
- **Grouping traces.** Pass `sessionId` through `execute(goal, { sessionId })` to mirror it onto every report node this run produces, so flat trace queries can group a planner run without walking the tree.
- **Bounded v1.** Steps run strictly in array order, one at a time. The `dependsOn` field the LLM may emit on a step is advisory metadata only — recorded for forensics, not used to reorder or parallelize.

## Related

- [Research with sub-agents](./planner-research-with-sub-agents) — a planner that delegates subtasks to isolated, budgeted sub-agents.
- [Tool-calling agent](./tool-calling-agent) — the agents and tools you register as planner capabilities.
- [Cost tracking](./cost-tracking) — reading the rolled-up `usage` a planner returns.

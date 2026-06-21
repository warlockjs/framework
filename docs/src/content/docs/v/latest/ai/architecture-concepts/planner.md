---
title: "Planner"
description: ai.planner — an LLM generates an ordered plan over your registered capabilities, then runs it step-by-step.
sidebar:
  order: 6
  label: "Planner"
---

`ai.planner()` flips the supervisor's model. A supervisor decides **one next step at a time**; a planner asks an LLM to **generate the whole ordered plan up front**, then executes it step-by-step through each capability's own `execute()`. It is itself an executable — it implements the same `ExecutableContract` as agents, workflows, and supervisors, so a planner composes as a supervisor intent, an orchestrator capability, or an outer agent's tool.

## The shape

```ts
import { ai } from "@warlock.js/ai";

const research = ai.planner({
  name: "research-assistant",
  model: ai.openai.model({ name: "gpt-4o" }),
  capabilities: [
    { name: "search",    description: "Search the web for sources",   executable: searchAgent },
    { name: "summarize", description: "Summarize text into bullets",  executable: summarizer },
    { name: "write",     description: "Draft a final report",         executable: writerAgent },
  ],
  maxSteps: 6,
});

const { data, report, usage, error } = await research.execute(
  "Compare React vs Vue in 2026",
);

console.log(report.plan?.summary);
for (const executed of report.executedSteps) {
  console.log(executed.step.capability, executed.status);
}
```

The result is the same unified `{ data, report, usage, error }` envelope as every other primitive, with `report.type === "planner"`. Like the others, `execute()` never throws on runtime failure — errors surface on `result.error`; only authoring-time misconfiguration throws at the factory call.

## Capabilities

A `capability` adapts any executable — an agent, workflow, supervisor, tool, or anything satisfying `ExecutableContract` — into a uniform unit the planner can describe and dispatch:

```ts
{
  name: "search",                          // stable handle the LLM references in each plan step
  description: "Search the web for sources", // the "when would the planner pick this?" line — injected verbatim
  executable: searchAgent,                  // dispatched with the step's resolved string input
}
```

The `name` + `description` pair is what the LLM reads to decide *when* to use each capability — write descriptions like you'd write tool descriptions. Each capability's `usage` and `report` roll up into the planner's unified result.

## Two planning brains — `model` XOR `planner`

Exactly one of these supplies the plan-generation brain:

```ts
// model — the planner builds an internal planning agent for you
ai.planner({ name, model, capabilities });

// planner — bring your own fully-configured planning agent
ai.planner({ name, planner: myPlanningAgent, capabilities });
```

With `model`, the planner constructs the planning agent itself and supplies the plan schema as its `output`; `systemPrompt` (and `placeholders`) prepend to the generated prompt. With `planner`, your agent owns its own prompt and middleware — `systemPrompt` is ignored.

## Bounded v1 — what it does and doesn't do

```ts
type PlannerStep = {
  id?: string;
  capability: string;       // names a registered capability
  input: string;            // the concrete input the LLM resolved
  reason?: string;
  dependsOn?: string[];     // advisory ONLY in v1
};
```

- Steps execute **strictly in array order, one at a time**.
- `dependsOn` is **advisory metadata** — recorded on the snapshot for forensics, but the bounded-v1 planner does NOT reorder, parallelize, or schedule on it.
- Earlier steps' outputs are threaded into later steps' prompt context, so a downstream capability builds on what ran before it.
- `maxSteps` (default 10, must be ≥ 1) caps execution; a longer generated plan is truncated and the dropped tail recorded as `skipped`.

DAG scheduling, parallel fan-out, and mid-plan re-planning are deferred.

## Structured output

Set `output` and the planner validates the **last completed step's** output against the schema before populating `result.data`; omit it to pass the final step's raw output through untyped. A per-call `options.output` overrides the factory schema for that run.

## The report

`report.plan` is the verbatim LLM plan before any step ran. `report.executedSteps` is the authoritative per-step record — one `PlannerStepSnapshot` per step the planner attempted, each with `status` (`completed` / `failed` / `skipped`), `output`, typed `error`, timings, `usage`, and the dispatched capability's `childReport`. `report.children[]` carries every dispatched capability in execution order — the cross-cutting tree view shared with every primitive.

## Delegating a step with `ai.spawnSubAgent()`

When a plan step wants to hand a bounded subtask to a fresh, single-use agent with a hard spend cap, reach for [`ai.spawnSubAgent()`](../the-basics/spawn-sub-agent). It is **not** a planner feature — it's a general one-shot-agent helper (a fresh `ai.agent()` + an optional per-task `budget`, run once) that works just as well inside a tool, a workflow step, or hand-rolled orchestration. The planner engine itself does not call it; it's simply a handy primitive a capability *you* write can use. See [Spawn sub-agent](../the-basics/spawn-sub-agent) for the full surface.

## Related

- [Spawn sub-agent](../the-basics/spawn-sub-agent) — the general one-shot delegation helper a plan step can use.
- [Supervisors](./supervisors) — decide one step at a time; planner generates the whole plan.
- [Orchestrators](./orchestrators) — a planner composes as an orchestrator capability.
- [Run agent](../the-basics/run-agent) — the full agent surface a planner step's executable is built on.

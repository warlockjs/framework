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
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const research = ai.planner({
  name: "research-assistant",
  model: openai.model({ name: "gpt-4o" }),
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

## Plan steps and sequential execution

```ts
type PlannerStep = {
  id?: string;
  capability: string;       // names a registered capability
  input: string;            // the concrete input the LLM resolved
  reason?: string;
  dependsOn?: string[];     // step ids this one waits on
};
```

By default (`dag` off) the planner runs the classic loop:

- Steps execute **strictly in array order, one at a time**.
- `dependsOn` is **advisory metadata** — recorded on the snapshot for forensics, but not used to reorder or parallelize.
- Earlier steps' outputs are threaded into later steps' prompt context, so a downstream capability builds on what ran before it.
- `maxSteps` (default 10, must be ≥ 1) caps execution; a longer generated plan is truncated and the dropped tail recorded as `skipped`.

The three sections below — DAG execution, adaptive re-planning, and the plan-only/approval gate — are all **additive and off by default**. Leave them unset and the planner behaves exactly as the sequential loop above, byte-for-byte.

## DAG execution — `dag` and `maxConcurrency`

Set `dag: true` and the planner schedules independent steps **in parallel** off their `dependsOn` edges instead of running strictly in array order:

```ts
const research = ai.planner({
  name: "parallel-research",
  model: openai.model({ name: "gpt-4o" }),
  capabilities: [
    { name: "search-a", description: "Search source A", executable: searchA },
    { name: "search-b", description: "Search source B", executable: searchB },
    { name: "merge",    description: "Merge findings",  executable: merger },
  ],
  dag: true,
  maxConcurrency: 4, // max steps running at once. default 4
});
```

When `dag` is true the planner builds a DAG from each step's `id` (falling back to its array index) and `dependsOn`, then runs each **ready level** concurrently — a step becomes ready once every dependency has completed. Two independent `search-*` steps run at the same time; a `merge` step that `dependsOn` both waits for both, and is fed **only its dependencies' outputs** rather than the whole prior transcript.

Validation happens **before any step runs**: a `dependsOn` that names an unknown step, a duplicate step id, or a dependency **cycle** raises a typed `PlannerPlanInvalidError` with forensic context. A step whose ancestor failed or was skipped never becomes ready and is recorded `skipped`.

> Under parallelism the "final output" is the DAG's topological **sink** — the step nothing depends on. With an `output` schema set, a single sink is the unambiguous final step; multiple sinks are a convergence error the planner surfaces rather than guessing.

## Adaptive re-planning — `replan` and `onStep`

By default a failed step aborts the run. Set `replan` and a failure (or an explicit `replan` verdict) instead **revises the remaining plan** — re-asking the planning agent for a fresh plan over the remaining work, seeded with the executed-step digest plus feedback:

```ts
const resilient = ai.planner({
  name: "resilient",
  model,
  capabilities: [...],
  replan: { maxReplans: 2 }, // bound the re-planning attempts; on exhaustion the run ends with the last failure
});
```

Two triggers feed re-planning:

1. **An unhandled step failure** — when `replan` is configured, a failed step regenerates the remaining plan instead of aborting.
2. **An `onStep` directive** — the per-step hook can steer the run after each step settles:

```ts
const result = await resilient.execute("Build the report", {
  onStep: (snapshot, plan) => {
    if (snapshot.status === "failed" && snapshot.step.capability === "scrape") {
      return { type: "replan", feedback: "the scraper is down — use the cached source instead" };
    }

    return { type: "continue" }; // or { type: "abort" }
  },
});
```

`onStep` fires after **every** step settles (both the sequential and the DAG path) and returns a `PlannerStepDirective`:

- `{ type: "continue" }` (or returning nothing) — proceed as normal.
- `{ type: "abort" }` — stop now; remaining steps are recorded `skipped`.
- `{ type: "replan", feedback }` — re-ask the planning agent for a fresh plan over the **remaining** work, with `feedback` woven into the prompt. A `replan` directive with no `replan` config is treated as `continue`. Bounded by `config.replan.maxReplans`.

The hook may be async. The feedback string lands verbatim in the re-planning prompt, so the new plan can react to exactly what went wrong.

## Plan-only and approval — `mode: "plan-only"`, `approvedPlan`

For human-in-the-loop or audited pipelines, generate the plan, get sign-off, then execute the **exact approved plan** — no second guess:

```ts
// 1) Generate + validate the plan, execute NOTHING.
const draft = await research.execute("Compare React vs Vue in 2026", { mode: "plan-only" });

draft.report.status;      // "awaiting-approval"
draft.report.executedSteps; // [] — nothing ran
draft.plan;               // the generated PlannerPlan, surfaced for review

// 2) After a human approves it, run that exact plan — generation is skipped.
const final = await research.execute("Compare React vs Vue in 2026", {
  approvedPlan: draft.plan!,
});

final.report.status;      // "completed"
```

- `mode: "plan-only"` generates and validates the plan, then returns **without executing**: `report.status === "awaiting-approval"`, `result.plan` carries the plan, and `report.executedSteps` is empty.
- `approvedPlan` executes that exact plan and **skips generation entirely** (the planning agent is never called). The plan is still validated against the **live** capabilities, so a stale plan naming a capability the planner no longer has surfaces a typed `PlannerPlanInvalidError`.
- The two are contradictory when combined; **`approvedPlan` wins** (the plan is executed).

The approved plan can be serialized between the two calls (it's plain data), so the gate naturally spans an HTTP round-trip or a durable approval queue.

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

---
title: "Best Practices — Choosing a primitive"
sidebar:
  label: "Choosing a primitive"
description: The orchestration ladder — when to reach for ai.agent vs ai.workflow vs ai.supervisor vs ai.orchestrator vs ai.planner. Start at the lowest rung that fits, climb only when you hit its ceiling, and pay nothing to climb because every rung returns the same ExecuteResult and composes through the same tool surface.
---

The pillar this page answers: **given a task, which primitive do you build it on?**

Warlock's AI primitives form a ladder — `ai.agent` → `ai.workflow` → `ai.supervisor` → `ai.orchestrator`, plus `ai.planner` off to the side for the open-ended case. Each rung buys you one new capability and charges you in complexity, tokens, and moving parts. The senior-review answer is almost never "reach for the most powerful one." It's **start at the lowest rung that fits the task, and climb a rung only when you hit a concrete ceiling you can name.**

Climbing is deliberately cheap. Every primitive resolves to the same `ExecuteResult` envelope — `{ data, error, usage, report }` — so your call site barely changes when you upgrade. And every primitive composes as a tool: an agent drops straight into another agent's `tools: []` and is auto-adapted; a workflow, supervisor, or orchestrator exposes an explicit `.asTool({ inputSchema })`. So a rung you build today can become a sub-step of a higher rung tomorrow without a rewrite. That's what makes "start low" safe advice instead of a trap — you are never painting yourself into a corner by under-reaching.

## The decision table

Read it top-down and stop at the first row that's true. The row you stop on is the rung to build on.

| Your task is… | Rung | Why this and not the one below |
| --- | --- | --- |
| **A single task** — one prompt, maybe some tools, one answer. | `ai.agent` | Nothing to coordinate. A workflow around one agent is ceremony. |
| **A fixed, known sequence of steps** you can name in advance. | `ai.workflow` | The order is *yours*, not the model's. Don't pay an LLM to decide what you already know. |
| **Dynamic dispatch across multiple agents, resolved in one call.** | `ai.supervisor` | The *next* specialist depends on what the last one found — a fixed workflow can't branch on model output, an agent can't hand off. |
| **A multi-turn session** that must persist state, history, and memory across calls. | `ai.orchestrator` | A supervisor is amnesiac between `execute()` calls. Sessions need durable checkpoints and a `sessionId`. |
| **Open-ended** — you can't name the steps because they depend on the goal, and the model must *plan*. | `ai.planner` | When even *you* don't know the step list up front, hand the model your capabilities and let it generate the plan. |

The four core rungs are a strict ladder; `ai.planner` is the escape hatch for the one case the ladder can't express — *"I don't know the steps."*

Two side primitives sit next to the ladder rather than on it. Reach for them by shape, not by climbing:

| Your task is… | Primitive | Why this and not a rung |
| --- | --- | --- |
| **A named roster collaborating under a manager** — a builder, a reviewer, a fixer — with a "loop until approved/passed" quality gate. | `ai.team` | A supervisor expresses this, but you'd hand-wire the review-then-fix `evaluate` every time. `team` names the roles and ships the gate. |
| **Grounding an agent in your documents** — retrieve relevant passages and cite them. | `ai.rag` | Retrieval isn't an orchestration rung; it's a tool an agent calls. `rag` is chunk → embed → store → retrieve → rerank → cite, exposed via `.asTool()`. |

## Rung 1 — `ai.agent` for a single task

**Do this — reach for an agent when the task is "one prompt in, one answer out," even when it calls tools.** Tools don't make a task multi-primitive; a single agent runs a bounded trip loop, calling tools and looping until it has an answer.

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const lookupOrder = ai.tool({
  name: "lookup_order",
  description: "Fetch an order's current status by id.",
  input: v.object({ orderId: v.string() }),
  execute: async ({ orderId }) => orderRepo.status(orderId),
});

const supportAgent = ai.agent({
  name: "order-support",
  model: openai.model({ name: "gpt-4o-mini" }),
  tools: [lookupOrder],
  systemPrompt: ai.systemPrompt()
    .persona("You answer order-status questions.")
    .instruction("Look up the order before answering. Be concise."),
});

const { data, error, usage } = await supportAgent.execute(
  "Where is order #4471?",
);
```

**Avoid this — wrapping one agent in a workflow "to be structured."** A workflow whose only step dispatches one agent adds a snapshot store, a step contract, and a signature to maintain — and buys nothing the agent didn't already give you. The agent already returns `{ data, error, usage, report }`; the report already tells you which tools it called.

**The upgrade trigger:** you find yourself coordinating *several* agents, or you need steps to run in a guaranteed order with retries and resumability. The moment a single trip loop can't express the work — that's the climb.

## Rung 2 — `ai.workflow` for a fixed, known sequence

You run the same pipeline every time: fetch the source, draft, then fact-check. The steps never change — only the data does. That's a workflow: you own the order, each step is a named unit, and the engine gives you retries, cancellation, and resume-from-snapshot for free.

**Do this — use a workflow when *you* know the steps and the order.** A `run` step is plain code that writes into `ctx.state`; an agent step takes an `input(ctx)` that builds the prompt from prior state and an `output.extract` that pulls the text out. The order is declared, not inferred by a model.

```ts
import { ai } from "@warlock.js/ai";

type Brief = { slug: string };

const articlePipeline = ai.workflow<Brief, { draft: string }>({
  name: "article-pipeline",
  steps: [
    ai.step({
      name: "fetch",
      run: async (ctx) => {
        ctx.state.source = await cms.fetch(ctx.input.slug);
      },
    }),
    ai.step({
      name: "draft",
      agent: writerAgent,
      input: (ctx) => ({ prompt: `Draft an article from:\n${ctx.state.source}` }),
      output: { extract: (ctx) => ctx.agentResult?.text ?? "" },
      after: (ctx) => {
        ctx.state.draft = ctx.steps.draft?.output as string;
      },
    }),
    ai.step({
      name: "fact-check",
      agent: checkerAgent,
      input: (ctx) => ({ prompt: `Verify every claim in:\n${ctx.state.draft}` }),
      output: { extract: (ctx) => ctx.agentResult?.text ?? "" },
    }),
  ],
});

const { data, error, usage, report } = await articlePipeline.execute({ slug: "q3-launch" });
```

**Avoid this — using a workflow when the next step depends on the model's output.** The instant "if the draft is about pricing, run the finance reviewer; otherwise run the legal reviewer" becomes a real requirement, a static `steps: []` array can't express it. You'd be reaching for a `nextStep` callback that re-implements routing by hand — at which point you want the rung above, which does exactly that, well.

**The upgrade trigger:** the path through the steps stops being fixed. When *which agent runs next* is a decision the model (or post-step state) has to make, you've outgrown the fixed sequence. Climb to a supervisor.

## Rung 3 — `ai.supervisor` for dynamic multi-agent dispatch

A support message arrives — *"I was charged twice and now the dashboard won't load."* That needs a billing specialist *and* a tech specialist *and* a resolver, in an order nobody can fix in advance: it depends on what each specialist finds. The supervisor picks the next intent each iteration (deterministically via `route`, or LLM-driven via `router`), merges each specialist's slice into shared state, and an `evaluate` verdict decides when the run is done — all inside **one** `execute()` call.

**Do this — use a supervisor when dispatch is dynamic but the conversation is single-shot.** The router re-decides each turn; `evaluate` is your real stop condition.

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";

const intents = { billing: billingAgent, tech: techAgent, resolver: resolverAgent };

const triageRouter = ai.router({
  name: "triage-router",
  model: openai.model({ name: "gpt-4o-mini" }),
  intents,
  systemPrompt:
    "Pull in the specialist whose description fits the problem. " +
    "Route to `resolver` once a specialist has reported, then END.",
});

const supportTriage = ai.supervisor<{ reply: string }>({
  name: "support-triage",
  router: triageRouter,
  intents,
  // Verdict fires after each iteration's intents merge into state.
  evaluate: (ctx) => (ctx.state.reply ? { satisfied: true } : undefined),
  output: v.object({ reply: v.string() }),
  maxIterations: 6,
});

const { data, error, usage, report } = await supportTriage.execute(message);
```

**Avoid this — a supervisor when the routing is actually fixed.** If the route is knowable from the input alone (a form field, an enum, a keyword rule), you're paying a routing LLM trip per iteration for a decision a `switch` could make. Use a deterministic `route` callback, or drop back to a workflow. The supervisor earns its routing cost only when *one input genuinely needs several specialists in an order you can't predict.*

**The upgrade trigger:** the conversation has more than one turn, and turn N needs to remember turn N−1. A supervisor is amnesiac — each `execute()` starts cold, with no session, no persisted history, no carried-over state. The moment you're hand-threading `history` and reconstructing state on every call, you've outgrown it. Climb to an orchestrator.

## Rung 4 — `ai.orchestrator` for a stateful, multi-turn session

A customer is mid-refund. They said "the Pro plan" three messages ago and "actually make it annual" just now. The bot has to carry that across turns, survive a process restart, and not re-ask what it already knows. That's an orchestrator: a session manager wrapped around a supervisor, keyed by a `sessionId`, with durable checkpoints, history windowing, automatic compaction, and per-turn memory.

**Do this — use an orchestrator when the unit of work is a *session*, not a *call*.** Each `execute()` is one turn; `sessionId` and the prior `history` are required arguments, because the orchestrator is explicit that *you* own the message store and it owns the durable session state.

```ts
import { ai, END } from "@warlock.js/ai";

const supportBot = ai.orchestrator<SessionState>({
  name: "refund-support",
  intents: { classify, lookup, process, compose },
  route: (ctx) => (ctx.iteration === 0 ? "classify" : END),
  checkpointStore: ai.checkpoint.pg({ client: pg }),
  summarize: { afterTurns: 20, keep: 8 }, // automatic compaction
});

// Turn N — name the session and pass the prior turns.
const result = await supportBot.execute(userMessage, {
  sessionId: "refund-9931",
  history: priorTurns,
});
```

**Avoid this — an orchestrator for a one-shot request.** If there's no second turn, the `sessionId`, checkpoint store, and history plumbing are pure overhead — every one of them exists to serve continuity you don't have. A stateless triage that answers and forgets is a supervisor (or a single agent), not an orchestrator. Don't pay for durability a one-shot will never read back.

**The upgrade trigger (sideways, not up):** none — the orchestrator is the capstone of the linear ladder. The only thing left is the case the ladder can't express at all: *you can't name the steps.* That's not higher on this ladder; it's `ai.planner`.

## The side rung — `ai.planner` for the open-ended case

The four core rungs all assume *someone* knows the shape of the work — you (workflow), or a router choosing from a fixed intent set (supervisor/orchestrator). `ai.planner` is for when nobody does up front. You hand it a goal and a toolbox of `capabilities` (each an agent, tool, or workflow — anything executable), and it asks an LLM to *generate* an ordered plan over those capabilities, then runs it step by step.

**Do this — reach for a planner when the step list is a function of the goal, not a constant.** A request like *"draft a launch announcement and make sure the numbers are right"* always has the same *capabilities* (fetch, verify, write) but never a fixed step order you'd want to hard-code.

```ts
import { ai } from "@warlock.js/ai";

const taskRunner = ai.planner({
  name: "launch-task-runner",
  model: openai.model({ name: "gpt-4o" }),
  capabilities: [
    { name: "fetch_pricing", description: "Fetch current pricing tiers.", executable: fetchPricingTool },
    { name: "verify_figures", description: "Cross-check the numbers.", executable: verifierAgent },
    { name: "write_announcement", description: "Draft the launch copy.", executable: writerAgent },
  ],
  maxSteps: 5,
});

const { data, error, usage, report } = await taskRunner.execute(
  "Draft a launch announcement for the new pricing tiers and make sure the numbers are right.",
);
```

**Avoid this — a planner when you already know the steps.** If the order is fixed, a planner spends an LLM trip *generating* a plan you could have written by hand as a `workflow` — and you inherit the risk that the generated plan is wrong. Plan generation is a cost and a failure mode; only pay it when the alternative is hard-coding a step list you genuinely cannot predict. Known steps → `ai.workflow`. Known intent set, model picks among them → `ai.supervisor`. Only when even the *set* of steps is open-ended does the planner earn its keep. Bound it hard with `maxSteps`.

## The team rung — `ai.team` for a managed roster with a quality gate

You keep building the same supervisor shape: a manager that dispatches to a small roster — a builder, a reviewer, a fixer — and an `evaluate` that loops "until the reviewer approves" or "until the tests pass," re-dispatching the fixer with the reviewer's notes in between. `ai.team` is that shape named. It is **thin, transparent sugar over `ai.supervisor`** — the manager becomes `route`/`router`, the `members` become `intents`, and the `gate` becomes `evaluate`. It returns the *unchanged* `SupervisorContract`, so `.asTool()`, `.resume()`, snapshots, and `ctx.intents.<member>` all stay intact.

**Do this — reach for a team when the work is a named roster collaborating under a manager, gated on quality.** A `gate: "quality"` string desugars to a review-then-fix loop (reads `state.approved`, `reassignTo` the `fixer` with feedback on rejection); `gate: "verify"` is the test-then-fix variant (reads `state.passed`). A function `gate` forwards straight through as `evaluate` — the full escape hatch.

```ts
import { ai } from "@warlock.js/ai";
import { v } from "@warlock.js/seal";

const codeTeam = ai.team({
  name: "code-team",
  goal: "Ship a tested module that passes review.",
  manager: techLeadRouter,
  members: { builder, reviewer, fixer },
  gate: "quality", // review-then-fix; reads state.approved, reassigns `fixer` on rejection
  output: v.object({ code: v.string() }),
  maxIterations: 6,
});

const { data, error, usage, report } = await codeTeam.execute("Build a debounce<T> utility.");
```

**Avoid this — hand-wiring the same review-then-fix `evaluate` on a raw supervisor.** If you find yourself writing "read the reviewer verdict, `reassignTo` the fixer with `state.notes`, terminate on approval" by hand, you're re-implementing the gate `team` already ships and tests. Drop to a bare `ai.supervisor` only when the roster *isn't* a manager-plus-members-plus-gate shape — when the routing logic genuinely doesn't fit the team mold. When your `members` keys differ from the canonical `reviewer` / `fixer` / `tester`, map them with `roles` rather than abandoning the sugar; the missing-role check throws at construction, not at `maxIterations`.

## The retrieval primitive — `ai.rag` for grounding an agent in documents

Your agent needs to answer from *your* corpus — a policy handbook, a product catalog, last quarter's tickets — not just its training data. That's retrieval, and it isn't a rung on the orchestration ladder: it's a *tool* an agent calls. `ai.rag` is the pipeline behind that tool — chunk → embed → vector store → retrieve → rerank → cite — built on the existing `ai.embedder` and a `@warlock.js/cache` `CacheDriver` as the vector store, with zero new dependencies.

**Do this — use `ai.rag` to index a corpus once, then expose retrieval to an agent with `.asTool()`.** `index(docs)` chunks, embeds, and stores; `retrieve(query)` embeds the query, fetches candidates, reranks, slices `topK`, and attaches citations. `asTool()` drops the whole thing into an agent's `tools: []` as a `{ query }` → `RetrieveResult` tool.

```ts
import { ai } from "@warlock.js/ai";

const handbook = ai.rag({
  name: "handbook",
  embedder: openai.embedder({ name: "text-embedding-3-small" }),
  store: cacheDriver, // a vector-capable @warlock.js/cache CacheDriver
});

await handbook.index([{ id: "leave-policy", text: policyMarkdown }]);

const supportAgent = ai.agent({
  name: "hr-support",
  model: openai.model({ name: "gpt-4o-mini" }),
  tools: [handbook.asTool()], // model calls retrieve() when it needs grounding
  systemPrompt: ai.systemPrompt().instruction("Answer only from retrieved passages; cite them."),
});
```

**Avoid this — building a workflow or supervisor to "do retrieval as a step."** Retrieval isn't an orchestration shape; the agent's own trip loop decides *when* it needs context and calls the tool. Wrapping `rag` in a fixed step forces a retrieval on every run even when the model didn't need one, and discards the model's judgment about *what* to look up. Index with `ai.rag`, hand the agent `rag.asTool()`, and let the trip loop do the rest.

## Climbing is cheap — the same envelope, the same tool surface

The reason "start low, climb when you must" is safe advice and not a refactor tax: **every rung returns the same `ExecuteResult` and every rung composes as a tool.**

**Do this — lean on the uniform result envelope.** A call site written against an agent reads `data`, `error`, `usage`, and `report` — and so does the supervisor or orchestrator you replace it with. The branch that handles a failure doesn't change shape when you climb.

```ts
// Identical handling regardless of which rung produced `result`.
const { data, error, usage, report } = await executable.execute(input);

if (error) {
  logger.error(error.code, { runId: report.runId, duration: report.duration });
  return;
}

console.log(`spent ${usage.total} tokens across ${report.children.length} children`);
```

**Do this — compose a lower rung into a higher one instead of rewriting it.** The agent you shipped at rung 1 becomes a specialist `intent` in a rung-3 supervisor unchanged; the supervisor you built becomes a tool inside an outer agent via `.asTool({ inputSchema })`. Climbing *wraps* what you have — it doesn't replace it.

```ts
import { v } from "@warlock.js/seal";

// A rung-3 supervisor, exposed to an outer agent as one tool.
const triageTool = supportTriage.asTool({
  description: "Resolve a customer support message end to end.",
  inputSchema: v.object({ message: v.string() }),
});

const frontDesk = ai.agent({
  name: "front-desk",
  model: openai.model({ name: "gpt-4o-mini" }),
  tools: [triageTool], // an agent dropped here is auto-adapted; higher rungs use .asTool()
});
```

**Avoid this — pre-building the top rung "so you won't have to migrate later."** You pay the orchestrator's session plumbing or the planner's plan-generation trip on day one for a flexibility a single agent would have covered for months. Because the envelope and the tool surface are uniform, the migration you're fearing is a small, mechanical wrap when it finally comes — far cheaper than carrying the heavier rung's complexity through every iteration until then. Build the rung the task needs *today*; the ladder guarantees the climb stays cheap.

## See also

- [Architecture — Agents](../architecture-concepts/agents) — the trip loop, tools, and the `AgentResult` envelope every rung shares.
- [Architecture — Workflows](../architecture-concepts/workflows) — steps, state, retries, and resume-from-snapshot.
- [Architecture — Supervisors](../architecture-concepts/supervisors) — `route` vs `router`, intent dispatch, and the `evaluate` verdict.
- [Architecture — Orchestrators](../architecture-concepts/orchestrators) — sessions, checkpoints, compaction, and the per-turn lifecycle.
- [Architecture — Planner](../architecture-concepts/planner) — plan generation over capabilities and step-by-step execution.
- [Run a team](../digging-deeper/run-team) — a manager, role-named members, and the built-in quality / verify gate.
- [Run RAG](../the-basics/run-rag) — chunk, embed, store, retrieve, rerank, and cite over your own corpus.
- [Recipe — Basic agent](../recipes/basic-agent) — the rung-1 starting point.
- [Recipe — Content pipeline workflow](../recipes/workflow-content-pipeline) — a fixed sequence, end to end.
- [Recipe — Support triage supervisor](../recipes/supervisor-support-triage) — dynamic dispatch with a router and `evaluate` loop.
- [Recipe — Stateful support bot](../recipes/orchestrator-stateful-support-bot) — a multi-turn session with persisted state.
- [Recipe — Autonomous task runner](../recipes/planner-autonomous-task-runner) — a planner that generates and runs its own plan.

---
title: "Best Practices — Supervisors and routing"
sidebar:
  label: "Supervisors and routing"
description: How to route one input across specialists without overspending — deterministic route vs classifier vs router agent, intent descriptions as routing prompts, evaluate as the real stop condition, a low maxIterations with an alert on the cap, and disjoint intent output slices for clean merges. Each grounded in a real scenario with runnable code.
---

The pillar this page answers: **when one input could go to several specialists, how do you pick the right one cheaply and stop at the right moment?**

A supervisor has three dispatch surfaces — a deterministic `route` callback, a `classifier` iter-0 prelude, and a `router` agent — and they are not interchangeable. Each one costs differently and fails differently. The senior-review instinct is the same as everywhere else in this framework: **use the cheapest surface that can make the decision correctly, and let `evaluate` — not the router — decide when the run is done.** Everything below is one running scenario.

## The running scenario

A customer-support supervisor for a SaaS product. An inbound message — *"I was charged twice for Pro and the dashboard won't load"* — needs triaging to one or more specialists (`billing`, `tech`, `sales`), and a `resolver` composes the final customer-facing reply. Sometimes one specialist answers the whole thing; sometimes a message genuinely needs billing **and** tech before a resolver can reply. The job is to route each message through exactly as many specialists as it needs and no more.

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { v } from "@warlock.js/seal";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const cheap = openai.model({ name: "gpt-4o-mini" }); // routing + classification
const strong = openai.model({ name: "gpt-4o" });     // the customer-facing reply

// The four specialists, declared once and reused as intents.
const billing = ai.agent({ name: "billing", model: cheap, /* … */ });
const tech = ai.agent({ name: "tech", model: cheap, /* … */ });
const sales = ai.agent({ name: "sales", model: cheap, /* … */ });
const resolver = ai.agent({
  name: "resolver",
  model: strong,
  output: v.object({ reply: v.string() }),
});
```

## Prefer a deterministic `route` or a `classifier` over a `router` agent

This is the single biggest cost lever in a supervisor. A `router` agent re-decides the next intent on **every** iteration — that's roughly **two LLM calls per iteration** (the router decides, then a specialist runs). A deterministic `route` callback makes the same decision in **zero** model tokens, and a `classifier` makes it in **one** call on iteration zero and then terminates. You only earn the router's per-iteration tax when the routing decision genuinely needs an LLM's judgment *and* can change as state accumulates across turns.

**Do this — a `route` callback when the decision is a rule.** If the intent is derivable from the input itself — a keyword, an enum field, a metadata flag — no model needs to pick it. `route` returns `string | string[] | END`, and the array form fans out.

```ts
import { END } from "@warlock.js/ai";

const triage = ai.supervisor({
  name: "support-triage",
  intents: { billing, tech, sales, resolver },
  route: (ctx) => {
    if (ctx.state.reply) { return END; }      // resolver already replied — stop

    const text = typeof ctx.input === "string" ? ctx.input.toLowerCase() : "";

    if (text.includes("charge") || text.includes("refund")) { return "billing"; }
    if (text.includes("error") || text.includes("crash")) { return "tech"; }

    return "resolver";
  },
});
```

**Do this — a `classifier` when a model must pick, but one specialist answers the whole message.** The classifier runs once on iteration zero, dispatches the single chosen intent, and — with no `router`/`route` configured alongside — terminates. About two calls total, versus a router loop's two-per-iteration.

```ts
const classifyAgent = ai.agent({
  name: "classify",
  model: cheap, // classification is easy-tier work — the strong model picks the same label
  output: v.object({ intent: v.enum(["billing", "tech", "sales"]) }),
  systemPrompt: ai.systemPrompt()
    .persona("You triage inbound support messages.")
    .instruction("Pick the single specialist that should answer."),
});

const fastTriage = ai.supervisor<{ reply: string }, { reply?: string }>({
  name: "support-triage",
  goal: "Answer the message in one pass by routing it to exactly one specialist.",
  intents: { billing, tech, sales },
  classifier: { agent: classifyAgent }, // runs on iter 0, dispatches once, terminates
  output: v.object({ reply: v.string() }),
});
```

**Avoid this — a `router` agent for a single-pass, rule-based decision.** *"What's your refund policy?"* is billing, full stop. A router loop spends a routing call to reach that conclusion, runs billing, then spends a second routing call to decide it's done — two trips a `route` callback skips entirely and a `classifier` halves.

```ts
// Anti-pattern: the heaviest dispatch surface for the lightest decision.
const triage = ai.supervisor({
  name: "support-triage",
  router: ai.router({ model: cheap, intents: { billing, tech, sales, resolver } }),
  intents: { billing, tech, sales, resolver },
  evaluate: (ctx) => (ctx.state.reply ? { satisfied: true } : undefined),
  maxIterations: 6,
});
```

Reserve the `router` agent for what it's actually good at: a message that needs **several** specialists in sequence, where the *next* one depends on what the last one found — a path no static rule can express. The cost ladder is the [support-triage recipe's](../recipes/supervisor-support-triage) opening table; the cheap rungs are the [classifier fast-path recipe](../recipes/supervisor-classifier-fast-path). This ties directly back to the model-tiering rule on the [cost and efficiency](./cost-and-efficiency) page: routing is cheap-tier work, so even when you do use a `router`, give it the cheap model.

## Write intent descriptions like a one-line "when would you pick this?" answer

When you use a `router` (or an LLM `classifier`), the **descriptions are the routing prompt**. The supervisor renders each intent into the router's per-turn message as `- <intent>: <description>` — that line, and almost nothing else, is what the model uses to choose. A vague description misroutes more reliably than a weak model does: the strongest frontier model still can't pick `billing` over `sales` if both descriptions say "handles customer questions." Sharpening the description is usually the highest-leverage fix for a misrouting supervisor — cheaper and more reliable than upgrading the router's model.

**Do this — describe the *trigger condition*, not the agent.** Each description should read like the answer to "when would you route here, and not to a sibling?" — disjoint, concrete, decision-shaped.

```ts
const support = ai.supervisor({
  name: "support",
  router: ai.router({ model: cheap, intents }),
  intents: {
    billing: {
      agent: billingAgent,
      description: "Charges, refunds, invoices, plan changes, or anything about money owed or paid.",
    },
    tech: {
      agent: techAgent,
      description: "The product is broken or erroring — crashes, failed loads, features not working.",
    },
    sales: {
      agent: salesAgent,
      description: "Pre-purchase questions: pricing tiers, plan comparisons, upgrades, or trials.",
    },
    resolver: {
      agent: resolverAgent,
      description: "Compose the final customer reply once a specialist has gathered the answer.",
    },
  },
});
```

**Avoid this — descriptions that restate the agent's name.** "Handles billing," "handles technical issues," "handles sales" give the router no signal a boundary case can split on. A message like *"my upgrade to Pro failed and I got charged anyway"* touches all three — without a clear trigger condition per intent, the router's pick is a coin-flip the description was supposed to settle.

```ts
// Anti-pattern: name-shaped descriptions with overlapping, vague boundaries.
intents: {
  billing: { agent: billingAgent, description: "Handles billing questions." },
  tech: { agent: techAgent, description: "Handles technical questions." },
  sales: { agent: salesAgent, description: "Handles sales questions." },
}
```

> Under a `router`, a non-empty `description` is *mandatory* on every intent — the factory throws `SUPERVISOR_INTENT_DESCRIPTION_REQUIRED` if any router-routed intent lacks one. Bare-callback shorthand (`refund: async (ctx) => …`) carries no description, so under a router you must upgrade it to the object form `{ run, description }`. A deterministic `route` callback skips the check entirely — there's no LLM to read a description, so don't write prose your code doesn't use.

## Use `evaluate` as the real stop condition — it outranks the router

A router agent deciding to emit `END` is the *model's* opinion that the run is done. That's the weakest possible stop signal: it's a generation, it can be wrong, and it can loop. `evaluate` is the deterministic verdict you control, and the framework gives it the final word — the order of authority is **`evaluate` → `intent.next` → `router`/`route`**. So the robust pattern is to let the router pick *who runs next* but let `evaluate` decide *whether we're done*, keyed off accumulated state rather than the model's say-so.

**Do this — terminate on a state fact, not on the router's `END`.** The run stops the moment a customer-ready `reply` exists in state, regardless of what the router would have chosen next.

```ts
const support = ai.supervisor<{ reply: string }, { reply?: string }>({
  name: "support",
  router: ai.router({ model: cheap, intents }),
  intents,
  output: v.object({ reply: v.string() }),
  // The verdict the supervisor obeys over the router's own decision.
  evaluate: (ctx) => (ctx.state.reply ? { satisfied: true } : undefined),
  maxIterations: 6,
});
```

`evaluate` does more than stop the run. Returning `{ reassignTo: "tech" }` overrides the next iteration's dispatch; `{ feedback: "the reply ignored the double-charge" }` threads a reviewer note into the next turn's composed input; the two combine. That makes `evaluate` the place to encode "not good enough yet, try again with this hint" — a quality loop the router can't express on its own.

```ts
evaluate: (ctx) => {
  if (!ctx.state.reply) { return undefined; }                 // nothing to judge yet

  if (ctx.state.reply.length < 40) {
    return { reassignTo: "resolver", feedback: "Reply is too terse — be specific about the refund." };
  }

  return { satisfied: true };
},
```

**Avoid this — relying on the router to know when to quit.** With no `evaluate`, termination depends on the router emitting `END` — a generated token that can drift, repeat the same specialist, or never fire. The run then spins until it slams into `maxIterations` and fails, instead of stopping cleanly the turn the answer was ready.

```ts
// Anti-pattern: no deterministic stop — the run ends only when the LLM says so,
// or when it exhausts maxIterations (a failure, not a finish).
ai.supervisor({
  name: "support",
  router: routerAgent,
  intents,
  // evaluate omitted — termination is now the model's unreliable opinion
});
```

> A returned `{ satisfied: true }` is a *success* termination; hitting `maxIterations` is a *failure* termination that surfaces `MaxIterationsError` on `result.error`. Those are very different outcomes — design for the run to end via `evaluate`, and treat the cap as the safety net it is, not the expected exit. For state-driven termination in `route` mode, `evaluate` pairs with `route` too (not just `router`).

## Keep `maxIterations` low — and alert when you hit the cap

`maxIterations` defaults to `10`. That default is a backstop, not a target: a healthy support supervisor converges in two or three iterations. Setting the cap close to your real convergence count turns "the run is looping" from a slow, expensive, silent failure into a fast, cheap, *loud* one — every iteration past the answer is a wasted router call plus a wasted specialist call. And because hitting the cap is a genuine failure mode (`result.error` is a `MaxIterationsError`), it deserves an alert, not a swallow.

**Do this — set the cap to a tight multiple of expected iterations, and treat the cap as an incident.** If the supervisor should finish in three turns, `maxIterations: 5` leaves slack for a retry without letting a loop run to ten.

```ts
const support = ai.supervisor({
  name: "support",
  router: ai.router({ model: cheap, intents }),
  intents,
  evaluate: (ctx) => (ctx.state.reply ? { satisfied: true } : undefined),
  maxIterations: 5, // converges in ~3; the cap is a backstop, not the plan
});

const { data, error, report } = await support.execute(message);

// Hitting the cap is a real failure — alert on it, don't swallow it.
if (error?.code === "SUPERVISOR_MAX_ITERATIONS") {
  logger.warn("supervisor failed to converge", {
    supervisor: "support",
    iterations: report.iterations,
    // Partial per-iteration snapshots survive on the report for debugging.
  });
  metrics.increment("ai.supervisor.max_iterations", { name: "support" });
}
```

You can also wire the same signal live by subscribing to `supervisor.error` on the stream, or watch convergence in real time via `supervisor.iteration.completed`.

**Avoid this — leaving `maxIterations` at the default and never checking for the cap.** A high cap lets a non-converging run burn ten full router-plus-specialist round-trips before failing, and an unchecked `result.error` means the first you hear of it is the latency spike or the bill. The cap firing is the system telling you the routing logic or `evaluate` has a hole — silence loses that signal.

```ts
// Anti-pattern: default cap, no convergence guard.
const support = ai.supervisor({ name: "support", router, intents });
const { data } = await support.execute(message); // error never inspected
return data?.reply; // silently undefined when the run capped out
```

> When a router-mode supervisor keeps hitting the cap, the cause is almost always one of two things this page already covers: vague intent descriptions sending the router in circles, or a missing/too-strict `evaluate` that never returns `{ satisfied: true }`. Fix the description or the verdict — raising `maxIterations` just buys a more expensive failure.

## Keep intent output slices disjoint for a clean shallow-merge

Each intent contributes a typed slice to the supervisor's `state` via its `output` schema, and the merge across iterations (and across fan-out branches) is a **shallow merge** — last write wins on any key collision, with a warning logged. That's a feature when slices are disjoint: each specialist owns its own keys, the slices compose cleanly into the final `output` shape, and nothing clobbers anything. It's a silent bug when two intents both write the same key — a fan-out where `billing` and `tech` both emit `{ status }` means one of them quietly disappears.

**Do this — give every intent its own keys, so the union is the output shape.** `billing` owns `refund`, `tech` owns `diagnosis`, `resolver` owns `reply`. Fanning out `billing` and `tech` in parallel is safe because their slices never touch.

```ts
type SupportState = {
  refund?: { eligible: boolean; amount: number };
  diagnosis?: { rootCause: string };
  reply?: string;
};

// Disjoint slices — each intent owns its own keys.
const intents = {
  billing: { agent: billingAgent, output: v.object({ refund: v.object({ eligible: v.boolean(), amount: v.number() }) }) },
  tech: { agent: techAgent, output: v.object({ diagnosis: v.object({ rootCause: v.string() }) }) },
  resolver: { agent: resolverAgent, output: v.object({ reply: v.string() }) },
};

const support = ai.supervisor<SupportState>({
  name: "support",
  router: ai.router({ model: cheap, intents }),
  output: v.object({
    refund: v.object({ eligible: v.boolean(), amount: v.number() }).optional(),
    diagnosis: v.object({ rootCause: v.string() }).optional(),
    reply: v.string().optional(),
  }),
  intents,
});
```

**Avoid this — two parallel intents writing the same key.** Fan out `billing` and `tech` when both declare `output: v.object({ status: … })` and one branch's `status` silently overwrites the other's during the shallow-merge. The supervisor logs a warning, but the lost slice is gone — and which one survives is a race you didn't mean to write.

```ts
// Anti-pattern: colliding slices on a fan-out — last write wins, the other is dropped.
intents: {
  billing: { agent: billingAgent, output: v.object({ status: v.string() }) },
  tech: { agent: techAgent, output: v.object({ status: v.string() }) }, // collides with billing.status
},
route: (ctx) => (ctx.iteration === 0 ? ["billing", "tech"] : "resolver"), // both write `status` in parallel
```

> An intent with **no** `output` schema passes its raw result to the iteration snapshot but does **not** auto-merge into `state` — the opt-in keeps state clean. So declaring `output` is also how you say "this slice belongs in the final answer." When you genuinely need to combine same-keyed values across iterations (accumulate a `blocks` array rather than replace it), that's the job of `finalizeArtifacts` with the artifacts bag, not the default shallow-merge — see the [run-supervisor skill](/skills) for the artifacts pattern.

## Avoid list

The short version — the routing mistakes that quietly inflate a supervisor's cost or corrupt its output:

- **Don't reach for a `router` agent when a rule decides the route.** A deterministic `route` callback costs zero routing tokens; a `classifier` costs one call for a single-pass message. Reserve the router loop for genuinely multi-specialist messages where the next pick depends on the last result.
- **Don't write name-shaped intent descriptions.** Under a router, the descriptions *are* the routing prompt — write each as a disjoint "when would you pick this?" trigger condition. Vague descriptions misroute more than weak models do.
- **Don't let the router decide when to stop.** Make `evaluate` the stop condition keyed off accumulated state — it outranks the router and turns a model opinion into a deterministic verdict you control.
- **Don't leave `maxIterations` at the default and ignore the cap.** Set it to a tight multiple of expected iterations and alert on `SUPERVISOR_MAX_ITERATIONS` — hitting the cap is a failure that signals a routing or `evaluate` hole, not a normal finish.
- **Don't let two intents write the same state key.** The cross-branch merge is shallow and last-write-wins — keep slices disjoint so a fan-out composes instead of clobbering. Use `finalizeArtifacts` when you truly need to accumulate same-keyed values.

## See also

- [Skill — Run a supervisor](/skills) — the full `ai.supervisor()` surface: dispatch modes, `intents` shapes, `evaluate`, `ack`, artifacts, and resume.
- [Recipe — Support triage supervisor](../recipes/supervisor-support-triage) — the full `router` + `evaluate` loop and the triage cost ladder.
- [Recipe — Classifier fast-path triage](../recipes/supervisor-classifier-fast-path) — the cheapest triage: classify once, dispatch once, done.
- [Best Practices — Cost and efficiency](./cost-and-efficiency) — model tiering and the classifier-vs-router cost math this page ties back to.
- [Best Practices — Choosing a primitive](./choosing-a-primitive) — when a supervisor is the right rung at all, versus an agent, workflow, or orchestrator.

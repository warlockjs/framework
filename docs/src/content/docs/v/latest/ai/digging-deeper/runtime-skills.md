---
title: "Runtime skills"
description: ai.skills() and the skills agent option — a progressive-disclosure metadata catalog plus an on-demand loadSkill tool, backed by directory / url / store sources.
sidebar:
  order: 9
  label: "Runtime skills"
---

A **skill is text injected into an agent's context — it never runs code.** `ai.skills(config)` builds a `SkillsContract`: the mechanism behind the first-class `skills` agent option. The agent always injects a cheap **metadata catalog** (one line per in-scope skill) and registers a `loadSkill` tool so the model pulls a skill's full **body** only when it needs it — progressive disclosure. Bodies stay withheld until loaded, keeping context lean.

## The first-class agent option (the supported way)

```ts
import { ai } from "@warlock.js/ai";

const agent = ai.agent({
  model: openai.model({ name: "gpt-4o" }),
  systemPrompt: "You are a build assistant.",
  skills: {                                   // a SkillsConfig OR an ai.skills(...) instance
    name: "build-skills",
    sources: [{ type: "directory", path: "./agent-skills" }],
  },
});
```

When `skills` is set the agent owns the runtime flow at execute time: it **prepends the always-injected catalog** (and, under `inject`, the preloaded bodies) in front of your system prompt, auto-registers `loadSkill` (plus `saveSkill` only when a `review` gate is configured), and threads the run id so `maxLoadsPerRun` is enforced per execution. **Omitted ⇒ no skills behaviour; the agent runs byte-for-byte as before.** The option accepts a raw `SkillsConfig` (the agent builds the `SkillsContract` for you) or a pre-built instance.

## Factory config — `SkillsConfig`

```ts
const lib = ai.skills({
  name: "build-skills",                                       // surfaced in analytics + the catalog block
  sources: [{ type: "directory", path: "./agent-skills" }],   // >= 1; later source wins on name clash
  inject: { select: "semantic", topK: 2, embedder },          // body-injection policy (see below)
  maxLoadsPerRun: 4,                                          // cap on loadSkill calls per run. default 5
  scope: { tags: ["frontend"] },                              // only skills whose tags intersect are catalogued
  review: { approve, store },                                 // Phase 2 — absent ⇒ saveSkill is NOT exposed
  analytics: (event) => track(event),                         // optional efficacy sink (errors swallowed)
});
```

At least one source is required — the factory throws otherwise.

### Sources — `SkillSource` (discriminated by `type`, never `kind`)

- `{ type: "directory", path }` — reads `path/<folder>/SKILL.md` off the local filesystem (lazy `node:fs/promises`).
- `{ type: "url", url, headers? }` — `fetch()`es a JSON manifest of skills.
- `{ type: "store", store }` — any `SkillsStoreContract`, e.g. the shipped `MockSkillsStore`.

Sources merge in order; a later source wins on a name collision.

### Injection — `inject` (`SkillInjectMode`)

The metadata catalog is **always** injected (it's cheap). `inject` controls whether any **bodies** are auto-injected up front:

- **omitted** (default) — inject NO bodies; the model pulls them via `loadSkill`. Pure progressive disclosure.
- `"all"` — inject every body up front (small libraries only).
- `{ select: "semantic", topK, embedder?, threshold? }` — embed the run input, rank the catalog by cosine similarity, and inject the top-`topK` bodies. Needs an embedder (passed here, or lazily auto-resolved). This is the **semantic preload**: it front-loads the skills the input is most likely to need, while still leaving the rest pullable on demand.

### Scoping — `scope`

`scope: { tags: [...] }` filters the catalog to skills whose own `tags` intersect the requested set. A role-scoped agent only ever sees the skills relevant to its job, keeping the always-injected catalog block small.

### `maxLoadsPerRun`

Default 5. Caps `loadSkill` calls in a single run so the model can't loop forever pulling bodies. Exhaustion is an **error result the model self-corrects from**, never a throw: `loadSkill` returns `{ error: "skill load budget exhausted" }` and the run continues.

## How `loadSkill` works

The agent registers one `loadSkill` tool per run, closing over a per-run counter. Its input is `{ name: string; version?: number }`; on success it returns the skill **body**, which the agent loop feeds straight back to the model as a `role: "tool"` message — so the loaded procedure is visible on the next trip. Both failure modes are error results, not throws:

- past `maxLoadsPerRun` ⇒ `{ error: "skill load budget exhausted" }`;
- unknown skill ⇒ `{ error: "unknown skill: <name>" }`.

## `SkillRecord` and the catalog

```ts
type SkillRecord = {
  name: string;        // stable slug — the SKILL.md folder name (or store key)
  description: string; // single-line description — the catalog line
  version: number;     // monotonic; a promotion bumps this. defaults to 1
  body: string;        // the full SKILL.md body, loaded on demand
  tags?: string[];     // role / context tags for scope filtering
  type: "authored" | "promoted" | "candidate";
  metadata?: Record<string, unknown>;
};
```

The catalog entry is a `Pick<SkillRecord, "name" | "description" | "version" | "tags" | "type">` — `body` is structurally absent, the type-level guarantee that the catalog never carries skill bodies.

## `MockSkillsStore` — the in-memory store

Ships with the package; backs tests and small/ephemeral libraries with zero external dependencies. Construct it directly (it's a concrete utility store, not a factory-fronted primitive):

```ts
import { ai, MockSkillsStore } from "@warlock.js/ai";

const store = new MockSkillsStore([
  { name: "scaffold-form", description: "Scaffold a react-form", version: 1, body: "...", type: "authored" },
]);

const lib = ai.skills({ name: "build", sources: [{ type: "store", store }] });
```

It holds the latest record per name, lists only non-`candidate` skills, and supports the Phase-2 `saveCandidate` / `promote` lifecycle.

## Phase 2 — self-authoring (inert by default)

An agent can author a new skill, but **the machinery is inert unless you wire a `review` gate**. With no `review`:

- the `saveSkill` tool is **never registered** — a candidate can't be written, let alone injected.

With a `review` gate, `saveSkill` is exposed; it writes an INERT `type: "candidate"` (filtered out of the catalog and `loadSkill`). A candidate is only ever surfaced after the **default-DENY** gate promotes it:

```ts
const lib = ai.skills({
  name: "self-improving",
  sources: [{ type: "store", store }],
  review: {
    store,                                          // where promoted skills are written
    approve: async (candidate) => {
      // a policy fn, a validator agent, or a human callback — all reduce to this Promise
      return { approve: candidate.body.length > 50, reason: "too thin" };
    },
  },
});
```

`approve` resolving `{ approve: true }` promotes the candidate to a new audited VERSION; anything else — including a throw, treated as deny — keeps it inert. The gate is default-DENY by design: nothing the agent writes becomes live without an explicit approval.

## When to use runtime skills

- Reach for skills when an agent has **many** possible procedures but only needs a few per run — a catalog plus on-demand loading keeps every run's context small while the full library stays reachable.
- Use [`ai.systemPrompt`](../the-basics/write-system-prompts) instead for the always-on persona and instructions — that's the fixed framing, not a pullable catalog.
- Use [`ai.memory`](./persist-ai-data) for accumulated factual recall across runs; use [`ai.rag`](../the-basics/run-rag) for grounding answers in a document corpus. Skills are *procedures the model loads*, not *facts it recalls* or *documents it cites*.

## Related

- [Write system prompts](../the-basics/write-system-prompts) — the always-on framing, complementary to a pullable catalog.
- [Persist AI data](./persist-ai-data) — `ai.memory` recall tiers.
- [Run RAG](../the-basics/run-rag) — document grounding with citations.
- [Define tools](../the-basics/define-tools) — the tool surface `loadSkill` / `saveSkill` are built on.

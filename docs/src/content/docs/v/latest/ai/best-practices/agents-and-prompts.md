---
title: "Best Practices — Agents & Prompts"
sidebar:
  label: "Agents & Prompts"
description: How to shape an agent so the model behaves — layer the system prompt into persona plus instructions, declare a typed output schema with repair, bound maxTrips, set temperature for the task, attach images for vision, and drop executables straight into tools instead of hand-stitching asTool.
---

The pillar this page answers: **once you have a model, how do you shape the agent around it so the output is correct, bounded, and cheap — instead of a prompt blob that mostly works?**

An `ai.agent` is the smallest unit that turns a model into something you can depend on. Everything you hand it — the system prompt, the output schema, the trip cap, the temperature, the tools — is a lever on correctness, latency, and cost. Getting these right is the difference between an agent you can put in a request path and one you have to babysit. This page is the opinionated version of those levers, every example grounded in the real `ai.agent` / `ai.systemPrompt` / `ai.tool` surface.

## Compose the system prompt — persona, then instructions, then placeholders

A plain string `systemPrompt` works, and for a one-shot script it's fine. But the moment a prompt has more than one job — a voice *and* a set of rules *and* a piece of per-call context — a single string forces you to re-paste and re-edit the whole thing every time one part changes. `ai.systemPrompt()` exists so the parts stay separate: one persona block (the voice), ordered instruction blocks (the rules), and `{{placeholder}}` slots filled at call time.

**Do this — layer the prompt with `persona()` and `instruction()`.** Each concern is its own block, and placeholders carry per-call values without rebuilding the prompt.

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const support = ai.agent({
  name: "support-agent",
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: ai.systemPrompt()
    .persona("You are Mira, a calm, concise customer-support specialist.")
    .instruction("Answer only from the facts provided; if you don't know, say so.")
    .instruction("Respond in {{language|English}}."),
  // Per-call placeholder values; the `|English` default fills in when omitted.
  placeholders: { language: "Arabic" },
});
```

The builder is immutable — every `.persona()` / `.instruction()` call returns a fresh prompt — so you can fork a base prompt into specialized variants without the parent ever mutating. That's the real payoff: take the base prompt, chain one more `.instruction("Offer a refund when the order is >30 days late.")`, and you have a second prompt that shares the persona and diverges by exactly one line — the original untouched.

**Avoid this — one frozen string that bakes context in.** Hardcoding the language (or the customer name, or today's date) into the prompt text means a new value is a new string literal, and the "voice" and the "rules" blur into one block nobody wants to touch.

```ts
// Anti-pattern: per-call context welded into the prompt; no reuse, no placeholders.
const support = ai.agent({
  name: "support-agent",
  model: openai.model({ name: "gpt-4o-mini" }),
  systemPrompt: "You are Mira, a support specialist. Answer only from the facts provided. Respond in Arabic.",
});
```

**Do this — load repo-checked prompts with `systemPrompt.fromFile`.** When a prompt is long enough to review, version, and diff, it belongs in a file next to the code, not inline. `fromFile` reads it once at construction and still supports placeholders and further chaining.

```ts
const support = ai.agent({
  name: "support-agent",
  model: openai.model({ name: "gpt-4o-mini" }),
  // Read once at construction; a typo in the path throws InvalidRequestError up front.
  systemPrompt: ai.systemPrompt
    .fromFile("./prompts/support-agent.md")
    .instruction("Respond in {{language|English}}."),
});
```

The file is read synchronously exactly once — never re-read per call — so this stays a drop-in for the inline form with zero runtime cost. Keep the persona and the durable rules in the file; keep the per-call slot (`{{language}}`) in code where the value lives.

## Declare a structured output schema when you need typed data — and enable repair

If you need a field out of the answer — a status, a number, a list — don't parse prose. Hand the agent a `v.object` schema as `output`, and `result.data` comes back typed and validated. The agent extracts a JSON Schema from it to drive native structured-output mode where the model supports it, and validates the model's response against the same schema client-side. Prefer `@warlock.js/seal`'s `v` builder — it's Standard Schema-compatible, so one schema both shapes the request and validates the response.

**Do this — pass a `v` schema as `output` and turn on `repair` for self-correction.** When validation fails, the agent feeds the bad response plus the validation error back to the model and re-asks, bounded by `maxAttempts`.

```ts
import { ai } from "@warlock.js/ai";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { v } from "@warlock.js/seal";

const openai = new OpenAISDK({ apiKey: process.env.OPENAI_API_KEY! });

const ticketSchema = v.object({
  category: v.enum(["billing", "bug", "feature", "other"]),
  priority: v.enum(["low", "medium", "high"]),
  summary: v.string(),
});

const triage = ai.agent({
  name: "ticket-triage",
  model: openai.model({ name: "gpt-4o-mini" }),
  // Baking the schema into the agent's identity — its shape never varies per call.
  output: ticketSchema,
  systemPrompt: ai.systemPrompt()
    .persona("You classify inbound support tickets.")
    .instruction("Pick the single best category and priority; summarize in one line."),
});

const { data, error } = await triage.execute(rawTicket, {
  repair: { maxAttempts: 1 },
});

if (error) {
  // execute() never throws — a validation failure that survived every repair lands here.
  console.error(`triage failed: ${error.code}`);
} else {
  console.log(data.category, data.priority); // fully typed
}
```

Bake the schema into the agent (`config.output`) when its shape never varies — a classifier, a router, a title generator. Pass `options.output` at the call site only when the same agent needs a different shape per run; the call-site value fully replaces the baked one, no merging.

**Avoid this — asking for JSON in prose and parsing the string yourself.** "Return JSON like `{...}`" in the system prompt gets you a string you have to `JSON.parse`, defend against prose-wrapping, and hand-validate — re-implementing, worse, exactly what `output` does for free.

```ts
// Anti-pattern: no schema, no validation, no repair — just a brittle parse.
const { data } = await triage.execute(rawTicket); // data is a string
const parsed = JSON.parse(data); // throws on prose, no type, no validation
```

> `repair` only fires when `output` (or `responseSchema`) is set — it repairs *validation* failures, not tool loops or provider errors. Keep `maxAttempts` at 1, occasionally 2: one re-ask catches "the model wrapped the JSON in prose" and "it fat-fingered one field"; beyond that you're paying for LLM trips to fight a prompt problem you should fix at the source.

## Keep `maxTrips` bounded — it's your circuit breaker

A tool-using agent loops: call model, dispatch tools, feed results back, call model again, until the model stops or it runs out of trips. `maxTrips` caps that loop. It defaults to 10, which is generous; the failure mode isn't setting it too low, it's leaving it unbounded in spirit — a model that keeps calling tools in a circle will burn ten paid round-trips before it stops, on every stuck request.

**Do this — set `maxTrips` to the real depth the task needs.** A single-tool lookup needs two or three trips; a multi-step research agent might need six. Size it to the task and the loop can't run away.

```ts
const lookup = ai.agent({
  name: "order-lookup",
  model: openai.model({ name: "gpt-4o-mini" }),
  tools: [getOrderStatus],
  // One tool call + one trip to read the result + a little slack. Not 10.
  maxTrips: 3,
});
```

**Avoid this — leaving the default on an agent that can loop.** The default exists so nothing runs forever, not as the right value for your agent. An agent that should resolve in three trips but is allowed ten will, when it gets confused, cost you ten trips and the latency of all of them before it gives up.

Every repair attempt also counts against `maxTrips` — it's the belt-and-suspenders cap that bounds both the tool loop *and* the repair loop. Size `maxTrips` with both in mind: `maxTrips` must leave room for the tool round-trips *plus* the repair re-asks you allowed.

## Set `temperature` deliberately — low for extraction, higher for copy

Temperature is not a knob you leave at the provider default and forget. It trades determinism for variety, and the right value is entirely a function of the job. Extraction, classification, and routing want the *same* answer every time — that's `temperature: 0` to `0.2`. Marketing copy, brainstorms, and conversational replies want range — that's `0.7` and up. Pass it through `modelOptions` (the agent-level base) and it applies to every call.

**Do this — pin temperature low for anything that must be repeatable.** Extraction and classification should be boring and deterministic.

```ts
const extractor = ai.agent({
  name: "field-extractor",
  model: openai.model({ name: "gpt-4o-mini" }),
  output: ticketSchema,
  // Deterministic: the same input should classify the same way every run.
  modelOptions: { temperature: 0 },
});
```

**Do this — open temperature up when you want variety.** A tagline generator that returns the identical line every time is broken, not stable.

```ts
const copywriter = ai.agent({
  name: "tagline-writer",
  model: openai.model({ name: "gpt-4o" }),
  systemPrompt: ai.systemPrompt()
    .persona("You write punchy product taglines.")
    .instruction("Give three distinct options, each under eight words."),
  // Range is the point — three taglines should not be three copies.
  modelOptions: { temperature: 0.9 },
});
```

**Avoid this — high temperature on an extraction agent.** A "creative" extractor invents fields, paraphrases values, and classifies the same ticket two ways on two runs. You'll chase the non-determinism as a bug when it's a setting.

> `modelOptions` on the agent is the base; per-call `execute()` options win on conflict. Set the task's natural temperature on the agent, override per call only for the genuine exception — not as the routine path.

## Use attachments for vision — let the agent build the multipart message

When the input is an image — a scanned invoice, a screenshot, a photo — don't OCR it yourself and paste text. Hand the image straight to a vision-capable model via `attachments` and let it read the fields out. The agent resolves the source (file path, URL, or raw base64), builds the multipart user message, and checks the model's `vision` capability up front so you get a clear error instead of an opaque provider 400.

**Do this — pass the image as a tagged attachment and extract into a schema.** Tagged form (`{ type: "image", source }`) makes intent explicit; combine it with `output` to get typed fields out of pixels.

```ts
import { v } from "@warlock.js/seal";

const invoiceSchema = v.object({
  invoiceNumber: v.string(),
  total: v.float(),
  currency: v.string(),
});

const reader = ai.agent({
  name: "invoice-reader",
  model: openai.model({ name: "gpt-4o" }), // auto-infers vision capability
  output: invoiceSchema,
  systemPrompt: ai.systemPrompt()
    .persona("You read fields out of scanned invoice images.")
    .instruction("Transcribe exactly what the image shows; do not recompute totals."),
});

const { data, error } = await reader.execute("Extract the invoice fields.", {
  attachments: [{ type: "image", source: "./invoices/inv-4821.jpg" }],
  repair: { maxAttempts: 1 },
});
```

The source is flexible: a local path or `https://` URL (auto-detected from the prefix), a `@warlock.js/core` storage file, or inline bytes (`{ base64, mediaType }`) for an image that never touched disk. The bare-string shorthand (`attachments: ["./photo.png"]`) infers the kind from the extension — fine for a quick `.png`, but reach for the tagged form when intent matters.

**Avoid this — aiming an image at a non-vision model and hoping.** If the model doesn't declare `vision`, the agent throws an `InvalidRequestError` up front by design — but the deeper anti-pattern is bolting a separate OCR step in front of a text model when a vision model reads the image directly in one trip.

## Prefer auto-adapt executables in `tools` over hand-stitched `asTool`

There are two ways to give an agent a tool that's itself an executable — another agent, a workflow, a supervisor. You can wrap it with `.asTool()` and pass the wrapper, or you can drop the executable straight into the `tools` array and let the agent auto-adapt it. When you're not customizing the tool's name or schema, the second is less code and one fewer thing to keep in sync.

**Do this — drop the executable straight into `tools` when composing.** The agent derives the tool manifest from the executable's own `name` + `description` (+ optional `inputSchema`) and dispatches through its `execute()`. One source of truth.

```ts
const researcher = ai.agent({
  name: "researcher",
  description: "Researches a topic and returns a sourced summary.",
  model: openai.model({ name: "gpt-4o-mini" }),
  tools: [webSearch],
});

const writer = ai.agent({
  name: "writer",
  model: openai.model({ name: "gpt-4o" }),
  // The researcher agent is auto-adapted into a tool — no asTool wrapper needed.
  // Its `name` + `description` become the tool the model sees.
  tools: [researcher, summarize],
});
```

This is why `description` on an agent earns its keep: it's the "when would the model pick this?" line a parent reads when the agent is used as a tool. A composed agent without a `description` gives the parent model nothing to route on.

**Avoid this — a hand-written `asTool` wrapper that just restates the executable's own metadata.** If the name, description, and schema you'd pass to `.asTool()` are exactly the executable's own, the wrapper is pure boilerplate that drifts out of sync the day you rename the agent.

```ts
// Anti-pattern: an asTool wrapper that duplicates what auto-adapt reads for free.
tools: [
  researcher.asTool({
    name: "researcher",                 // same name the agent already has
    description: "Researches a topic.",  // a worse copy of the agent's own description
  }),
],
```

Reach for `.asTool()` only when you genuinely need a *different* name, description, or input schema per use — a custom argument shape, or the same executable exposed under two distinct tool names. For a plain "use this agent as a tool", the bare array entry is the right call.

> For leaf tools — a database lookup, a weather call — `ai.tool({ name, description, input, execute })` with a `v` input schema is the direct path; only executables (agent / workflow / supervisor) get auto-adapted from the `tools` array. And when a tool only mutates state and the model already knows what to say, mark it `mode: "silent"` so its result never round-trips — the prose the model already streamed is the final reply.

## See also

- [Architecture — Agents](../architecture-concepts/agents) — the trip loop, the report tree, and how output parsing and repair fit in.
- [Run an AI agent skill](/skills) — the `@warlock.js/ai/skills/run-ai-agent` playbook for wiring an agent end to end (the docs site projects every package skill under the `/skills` page).
- [Recipe — Extract structured data with self-repair](../recipes/agent-extract-structured-data) — `output` + `repair` parsing a messy resume into a typed record.
- [Recipe — Extract fields from a document image](../recipes/agent-vision-document-extraction) — attachments and the vision capability gate, end to end.
- [Recipe — A multi-tool research agent](../recipes/agent-multi-tool-research-agent) — several tools in one `tools` array and the bounded trip loop.
- [Recipe — A basic agent](../recipes/basic-agent) — the smallest agent + system prompt, if you're starting from zero.

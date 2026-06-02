---
title: "Tag-routed polymorphic schemas with `v.discriminatedUnion`"
sidebar:
  order: 7
  label: "Polymorphic data (discriminated unions)"
---

Real-world data is often one of N shapes, distinguished by a tag field. Notifications come as email, sms, or push. Events have a type. AI tool calls have a name. The shapes share a discriminator but differ everywhere else.

`v.union` can express this — but routes by `matchesType()`, which only knows "is plain object" / "is array" / "is string". For object-vs-object unions, that's not enough: every branch matches, the first one wins, and the validator confidently produces errors from the wrong branch.

`v.discriminatedUnion` solves this. You name the discriminator, every branch carries a `v.literal(…)` on that field, and validation routes by reading the field's value at runtime.

## The pattern

```ts
import { v, validate, type Infer } from "@warlock.js/seal";

const email = v.object({
  type: v.literal("email"),
  to: v.string().email(),
  subject: v.string(),
});

const sms = v.object({
  type: v.literal("sms"),
  to: v.string(),
  message: v.string(),
});

const push = v.object({
  type: v.literal("push"),
  deviceId: v.string(),
  title: v.string(),
  body: v.string(),
});

const notification = v.discriminatedUnion("type", [email, sms, push]);

type Notification = Infer<typeof notification>;
// { type: "email"; to: string; subject: string }
// | { type: "sms"; to: string; message: string }
// | { type: "push"; deviceId: string; title: string; body: string }
```

## What happens at validate-time

Three things, in order:

1. **Read `data[discriminator]`** — for the example above, `data.type`.
2. **Look up the branch** in the key→branch map built at construction. The map is `{ "email" → emailSchema, "sms" → smsSchema, "push" → pushSchema }`.
3. **Delegate** to the matched branch. Errors (if any) come from that branch only.

If the discriminator's value isn't in the map, validation fails with one clear error: `"Field 'type' must be one of: email, sms, push"`. If the input isn't a plain object, validation fails with `"Expected object with discriminator field 'type'"`.

## Compared to plain `v.union`

```ts
// Without discriminator routing
const naive = v.union([email, sms]);
await validate(naive, { type: "sms", to: "555-1234", message: "hi" });
// → ERROR: errors from the email branch:
//   "The to must be a valid email"
//   "The subject is required"
// The sms branch was the right match; the user gets nonsense.

// With discriminator routing
const tagged = v.discriminatedUnion("type", [email, sms]);
await validate(tagged, { type: "sms", to: "555-1234", message: "hi" });
// → SUCCESS: routed to sms, no errors.
```

## Construction-time validation

The discriminator contract is checked when you build the validator, not when you run it. Three failure modes throw at schema-build time:

```ts
// 1. Missing discriminator field on some branch
v.discriminatedUnion("type", [
  v.object({ type: v.literal("a"), x: v.string() }),
  v.object({ y: v.string() }),                     // ❌ no "type" field
]);
// Throws: [Seal] discriminatedUnion: branch missing discriminator field "type"

// 2. Non-literal discriminator
v.discriminatedUnion("type", [
  v.object({ type: v.string(), x: v.string() }),   // ❌ not a v.literal
]);
// Throws: [Seal] discriminatedUnion: discriminator "type" must be v.literal(...) on every branch

// 3. Duplicate discriminator values
v.discriminatedUnion("type", [
  v.object({ type: v.literal("a"), x: v.string() }),
  v.object({ type: v.literal("a"), y: v.string() }),   // ❌ "a" used twice
]);
// Throws: [Seal] discriminatedUnion: duplicate discriminator value "a"
```

Failing eagerly means tests catch misconfigurations at definition time. You don't ship a schema that silently routes payloads wrong.

## Multi-literal discriminators

A single branch can accept multiple discriminator values via `v.literal("a", "b")`:

```ts
const status = v.discriminatedUnion("status", [
  v.object({
    status: v.literal("draft", "scheduled"),
    publishAt: v.date().optional(),
  }),
  v.object({
    status: v.literal("published"),
    publishedAt: v.date(),
    publishedBy: v.string(),
  }),
  v.object({
    status: v.literal("archived"),
    archivedAt: v.date(),
  }),
]);
```

Both `"draft"` and `"scheduled"` route to the first branch.

## Numeric and boolean discriminators

`v.literal` accepts `string | number | boolean`, so discriminators can be any of those:

```ts
v.discriminatedUnion("version", [
  v.object({ version: v.literal(1), legacy: v.string() }),
  v.object({ version: v.literal(2), modern: v.string() }),
]);

v.discriminatedUnion("isAdmin", [
  v.object({ isAdmin: v.literal(true), adminScopes: v.array(v.string()) }),
  v.object({ isAdmin: v.literal(false), userScopes: v.array(v.string()) }),
]);
```

The lookup map handles all three primitive types identically.

## AI tool-calling use case

The pattern shines for AI tool calls — every tool has a name (the discriminator) and specific args (the branch body):

```ts
const searchTool = v.object({
  name: v.literal("search"),
  args: v.object({ query: v.string(), limit: v.int().min(1).max(50) }),
});

const fetchTool = v.object({
  name: v.literal("fetch"),
  args: v.object({ url: v.string().url() }),
});

const summarizeTool = v.object({
  name: v.literal("summarize"),
  args: v.object({ text: v.string().min(10), maxWords: v.int().optional() }),
});

const toolCall = v.discriminatedUnion("name", [searchTool, fetchTool, summarizeTool]);
```

Pair with `Infer<typeof toolCall>` and TS narrows the args type inside `if (call.name === "search")` blocks. No casting, no `any`, no runtime type assertions.

## JSON Schema output

`v.discriminatedUnion(...).toJsonSchema()` emits `oneOf` with each branch's own JSON Schema. Each branch's `type` discriminator becomes `properties.type.const`, so JSON-Schema-aware tooling (OpenAPI generators, AJV with discriminator support) can route as well:

```ts
notification.toJsonSchema("openai-strict")
// → {
//   oneOf: [
//     { type: "object", properties: { type: { const: "email" }, to: ..., subject: ... }, required: [...], additionalProperties: false },
//     { type: "object", properties: { type: { const: "sms" }, to: ..., message: ... }, required: [...], additionalProperties: false },
//     { type: "object", properties: { type: { const: "push" }, deviceId: ..., title: ..., body: ... }, required: [...], additionalProperties: false },
//   ],
// }
```

OpenAI strict mode accepts this shape — every branch's required fields are listed; optional fields are expressed as nullable types per the strict contract.

## When to reach for it (and when not)

**Use `v.discriminatedUnion` when:**
- Multiple branches share a common tag field
- The tag is a literal value (`v.literal(...)`) per branch
- You want precise errors from the matched branch

**Stay on `v.union` when:**
- The branches are different *types* (string vs number vs boolean) — `matchesType` handles those well
- There's no natural discriminator

**Use a single `v.object` with `v.literal(...one-of...)` when:**
- The non-discriminator fields are identical across branches — discriminator is just a tag, not a router

## Related

- [Essentials → Structural shapes](../essentials/03-structural-shapes.md) — `v.discriminatedUnion` in context with the other structural validators
- [Guides → Generate JSON Schema](../guides/generate-json-schema.md) — `oneOf` output for OpenAI strict mode

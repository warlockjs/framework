---
title: "Generate JSON Schema"
description: Export a seal schema as JSON Schema — draft-2020-12, draft-07, openapi-3.0, openai-strict for OpenAI structured outputs.
sidebar:
  order: 3
  label: "Generate JSON Schema"
---

Every seal validator exposes `toJsonSchema(target)`. The result is a plain object — pass it straight to OpenAI's `response_format`, drop it into an OpenAPI spec, hand it to AJV, or feed it to any other consumer that takes JSON Schema as input.

```ts
import { v } from "@warlock.js/seal";

const userSchema = v.object({
  email: v.string().email(),
  age: v.int().min(13).optional(),
});

userSchema.toJsonSchema("draft-2020-12");
// {
//   type: "object",
//   properties: {
//     email: { type: "string", format: "email" },
//     age:   { type: "integer", minimum: 13 },
//   },
//   required: ["email"],
//   additionalProperties: false,
// }
```

## The four targets

```ts
type JsonSchemaTarget =
  | "draft-2020-12"  // default — modern JSON Schema
  | "draft-07"       // older tooling, Swagger 2.0
  | "openapi-3.0"    // uses { nullable: true } instead of type unions
  | "openai-strict"; // OpenAI Structured Outputs strict mode
```

Pick by consumer:

| Consumer | Target |
| --- | --- |
| Modern JSON Schema tooling, no specific reason | `"draft-2020-12"` |
| Swagger 2.0, older OpenAPI, older form builders | `"draft-07"` |
| OpenAPI 3.0 spec | `"openapi-3.0"` |
| OpenAI `response_format: { type: "json_schema", strict: true }` | `"openai-strict"` |

## OpenAI structured outputs

The `openai-strict` target encodes the quirks of OpenAI's strict mode:

- **Every field listed in `required`** — strict mode forbids leaving fields out.
- **Optional fields encoded as `type: ["T", "null"]`** instead of being omitted from `required`.
- **`additionalProperties: false` on every object.**

```ts
const schema = v.object({
  reply: v.string(),
  citations: v.array(v.string()).optional(),
});

schema.toJsonSchema("openai-strict");
// {
//   type: "object",
//   properties: {
//     reply: { type: "string" },
//     citations: { type: ["array", "null"], items: { type: "string" } },
//   },
//   required: ["reply", "citations"],     // every field listed
//   additionalProperties: false,
// }
```

Hand it to OpenAI:

```ts
import OpenAI from "openai";

const openai = new OpenAI();

const completion = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Reply with citations." }],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "reply_with_citations",
      strict: true,
      schema: schema.toJsonSchema("openai-strict"),
    },
  },
});
```

When you use `@warlock.js/ai` with a seal schema as the supervisor or agent `output`, the runtime picks `openai-strict` automatically for OpenAI-backed providers. You only call `toJsonSchema()` directly when integrating with OpenAI outside the Warlock AI runtime.

## OpenAPI 3.0 nullable

OpenAPI 3.0 uses the boolean `nullable` keyword instead of a type union. Use the `openapi-3.0` target when generating a `paths.openapi.yaml` consumed by Swagger UI or codegen tools.

```ts
v.string().nullable().toJsonSchema("openapi-3.0");
// { type: "string", nullable: true }

v.string().nullable().toJsonSchema("draft-2020-12");
// { type: ["string", "null"] }
```

Same field, different wire format — pick the target your consumer reads.

## What's cleanly mapped

- `v.string()` — `{ type: "string" }` (with `format: "email" | "url" | "uuid"`, `pattern`, `minLength`, `maxLength`, `enum`).
- `v.int()` / `v.float()` / `v.number()` — `{ type: "integer" | "number" }` (with `minimum`, `maximum`, `multipleOf`).
- `v.boolean()` — `{ type: "boolean" }`.
- `v.date()` — `{ type: "string", format: "date-time" | "date" | "time" }` (format derived from the transformer chain).
- `v.literal(values)` — `{ const: value }` (single) or `{ enum: [...] }` (multiple).
- `v.array(item)` — `{ type: "array", items: ... }` (with `minItems`, `maxItems`, `uniqueItems`).
- `v.object({...})` — `{ type: "object", properties, required, additionalProperties }`.
- `v.union([...])` — `{ anyOf: [...] }`.
- `v.discriminatedUnion(key, [...])` — `{ oneOf: [...] }` with literal `const` on the discriminator field.
- `v.tuple([...])` — `{ type: "array", prefixItems: [...] }` (draft-2020-12) or `{ type: "array", items: [...] }` (draft-07).
- `.nullable()` — type union or `nullable: true` per target.

## What's silently dropped

Some seal constructs have no JSON Schema representation:

- **Cross-field rules** (`sameAs`, `requiredIf`, `requiredWith`, …) — runtime-only. The generated schema describes the *shape*, not the inter-field invariants.
- **Transformers and mutators** — output reshaping doesn't appear in the schema. The schema reflects the post-mutator, pre-transformer shape (since that's what rules see, and what an LLM is asked to produce for `openai-strict`).
- **`v.computed` / `v.managed`** — they produce `{}` (permissive). They aren't part of the data contract.
- **`v.instanceof(Ctor)`** — produces `{}`. Class identity isn't expressible. For `File`, attach `{ type: "string", format: "binary" }` manually after generation if you need it for OpenAPI.
- **`v.any()`** — produces `{}` deliberately.
- **Coercion-style boolean rules** (`.accepted()`, `.declined()`) — JSON Schema doesn't have a notion of "yes/no/on/off" beyond `enum`.

If a runtime constraint matters at the consumer end, enforce it on the consumer side too — JSON Schema can't carry it across the boundary.

## When the generated schema rejects valid data

If your runtime validator accepts data but the generated JSON Schema rejects it downstream:

- **Cross-field rule.** Not encoded in JSON Schema — the consumer might enforce it separately, or your runtime ran a check at a different stage.
- **Transformer reshaping the wrong side.** The schema describes the input shape (or strict-mode normalized form). If your transformer reshapes `Date` to ISO string for `result.data`, the *input* still needs to be a Date-parseable thing.
- **`openai-strict` optional quirk.** Optional fields show as `["T", "null"]`. If the model omits them entirely (without sending `null`), strict mode fails. The fix is on the prompt side: tell the model to send `null` for unused fields.

## Recursive schemas

`v.lazy(() => schema).toJsonSchema()` uses simple-resolve in v1 — recursive shapes infinite-loop. If you need JSON Schema for a recursive shape, generate it manually with `$defs` + `$ref`:

```ts
const recursiveJsonSchema = {
  $defs: {
    category: {
      type: "object",
      properties: {
        name: { type: "string" },
        children: {
          type: "array",
          items: { $ref: "#/$defs/category" },
        },
      },
      required: ["name", "children"],
    },
  },
  $ref: "#/$defs/category",
};
```

Runtime validation still uses your seal schema; only the JSON Schema export is hand-rolled until proper `$ref` support lands.

## Cost note

Generating JSON Schema is cheap — a pure-function tree walk over the validator graph. No shared mutable state, no I/O, no async work. Don't worry about caching the result for schemas that change at startup. For dynamic schemas built per request, generate per request.

## Related

- [Bridge Standard Schema](./bridge-standard-schema.md) — `schema["~standard"].jsonSchema.input({ target })` is the Standard Schema accessor for the same data.
- [Essentials → Structural shapes](../essentials/03-structural-shapes.md) — what gets emitted for objects, arrays, unions, discriminated unions.

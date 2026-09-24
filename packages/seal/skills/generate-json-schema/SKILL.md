---
name: generate-json-schema
description: 'Generate JSON Schema via `schema.toJsonSchema(target)` — `draft-2020-12` / `draft-07` / `openapi-3.0` / `openai-strict`. Triggers: `toJsonSchema`, `JsonSchemaTarget`, `draft-2020-12`, `draft-07`, `openapi-3.0`, `openai-strict`, `response_format`, `additionalProperties`, `nullable`; "how do I generate JSON Schema from seal", "OpenAI structured outputs from schema", "OpenAPI 3.0 nullable", "json_schema strict mode"; typical import `import { v } from "@warlock.js/seal"`. Skip: foundations — `@warlock.js/seal/seal-basics/SKILL.md`; bridge typing — `@warlock.js/seal/bridge-standard-schema/SKILL.md`; competing libs `zod-to-json-schema`, `ajv`, `@anatine/zod-openapi`.'
---

# JSON Schema generation

Every seal validator exposes `toJsonSchema(target)`. The result is a plain object — pass it straight to OpenAI's `response_format`, an OpenAPI spec, a UI form builder, or anywhere else JSON Schema is the contract.

```ts
const userSchema = v.object({
  email: v.string().email(),
  age: v.int().min(13).optional(),
});

userSchema.toJsonSchema("draft-2020-12");
// {
//   type: "object",
//   properties: {
//     email: { type: "string", format: "email" },
//     age: { type: "integer", minimum: 13 },
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
  | "openai-strict"  // OpenAI Structured Outputs strict mode
```

Pick by consumer:

| Consumer | Target |
| --- | --- |
| Modern tooling, no specific reason otherwise | `"draft-2020-12"` |
| Swagger 2.0 / older OpenAPI / older form builders | `"draft-07"` |
| OpenAPI 3.0 spec (uses `nullable: true`) | `"openapi-3.0"` |
| OpenAI `response_format: { type: "json_schema", strict: true }` | `"openai-strict"` |

## OpenAI structured outputs (`openai-strict`)

This target encodes the quirks of OpenAI's strict mode:

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
//   required: ["reply", "citations"],   // every field listed
//   additionalProperties: false,
// }
```

Hand to OpenAI:

```ts
import OpenAI from "openai";

const completion = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [...],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "user_reply",
      strict: true,
      schema: schema.toJsonSchema("openai-strict"),
    },
  },
});
```

In `@warlock.js/ai`, this happens automatically when you set `output: schema` on a supervisor / agent — the runtime picks `openai-strict` for OpenAI providers. You only call `toJsonSchema()` directly when integrating with a non-warlock OpenAI usage.

## OpenAPI 3.0 nullable

```ts
v.string().nullable().toJsonSchema("openapi-3.0");
// { type: "string", nullable: true }

v.string().nullable().toJsonSchema("draft-2020-12");
// { type: ["string", "null"] }
```

OpenAPI 3.0 uses the boolean `nullable` keyword instead of a type union. Use this target when generating a `paths.openapi.yaml` consumed by Swagger UI or codegen tools.

## What's representable

Cleanly mapped:

- `v.string()` — `{ type: "string" }` (with `format: email/url/uuid`, `pattern`, `minLength`, `maxLength`, `enum`)
- `v.int()` / `v.float()` — `{ type: "integer" | "number" }` (with `minimum`, `maximum`, `multipleOf`)
- `v.boolean()` — `{ type: "boolean" }`
- `v.date()` — `{ type: "string", format: "date-time" | "date" | "time" }` (format derived from transformer if applicable)
- `v.literal(values)` — `{ const: value }` (single) or `{ enum: [...] }` (multiple)
- `v.array(item)` — `{ type: "array", items: ... }` (with `minItems`, `maxItems` from length rules; `.unique()`/`.sorted()` are runtime-only and not emitted)
- `v.object({...})` — `{ type: "object", properties, required, additionalProperties }`
- `v.union([...])` — `{ oneOf: [...] }`
- `v.tuple([...])` — `{ type: "array", prefixItems: [...] }` (draft-2020-12) or `{ type: "array", items: [...] }` (draft-07)
- `v.nullable()` — type union or `nullable: true` per target

## What's silently dropped

Some seal constructs have no JSON Schema representation:

- **Cross-field rules** (`sameAs`, `requiredIf`, `requiredWith`, etc.) — runtime-only. The generated schema describes the *shape*, not the inter-field invariants.
- **Transformers and mutators** — output reshaping doesn't appear in the schema; the schema reflects *post-mutator, pre-transformer* shape (since that's what rules see and what the LLM is asked to produce for `openai-strict`).
- **`v.computed` / `v.managed`** — **skipped** entirely by the parent `v.object`; they never appear in `properties`. They aren't part of the data contract. (Calling `.toJsonSchema()` directly on one throws — the parent object is responsible for skipping them.)
- **`v.instanceof(Ctor)`** — produces `{}`. Class identity isn't expressible. For `File`, attach `{ type: "string", format: "binary" }` manually after generation if needed for OpenAPI.
- **`v.any()`** — produces `{}` deliberately (any value is valid).

Boolean rules `accepted` / `declined` and similar coercion-style rules are also dropped — JSON Schema doesn't have a notion of "yes/no/on/off" beyond `enum`.

## When the generated schema rejects valid data

If the schema validator itself accepts data but the *generated* JSON Schema rejects the same data downstream, the cause is usually one of:

- **Cross-field rule.** The generated schema doesn't enforce it, but a separate consumer might. (Or the runtime check fired at a different stage.)
- **Transformer running on the wrong side.** The schema describes the input shape (or strict-mode normalized form). If your transformer reshapes `Date` to ISO string for `data`, the *input* still needs to be a Date-parseable thing.
- **`openai-strict` quirk.** Optional fields show as `["T", "null"]` rather than omitted — if the model omits them entirely (without sending `null`), strict mode fails. The fix is on the prompt side: tell the model to send `null` for unused fields.

## Cost note

Generating JSON Schema is cheap (pure-function tree walk), so don't worry about caching the result for schemas that change at startup. For dynamic schemas built per-request, generate per-request — there's no shared mutable state.

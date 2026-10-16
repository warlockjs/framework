---
title: "Bridge Standard Schema"
description: Pass a seal schema to any Standard-Schema-aware library — TanStack Form, Conform, LangGraph, OpenAI structured outputs — without casts.
sidebar:
  order: 4
  label: "Bridge Standard Schema"
---

Every seal validator implements [Standard Schema V1](https://standardschema.dev). The factory return — `v.object({...})`, `v.string()`, `v.literal(...)` — satisfies `StandardSchemaV1<T>` for the inferred `T`, with no cast required.

That means any library that accepts `StandardSchemaV1<T>` accepts a seal schema directly:

- `@warlock.js/ai` supervisor `output` and tool `input` slots.
- TanStack Form.
- Conform (Remix forms).
- LangGraph state schemas.
- Any custom slot you type as `StandardSchemaV1<T>`.

```ts
import { v, type Infer } from "@warlock.js/seal";
import { ai } from "@warlock.js/ai";

const userSchema = v.object({
  email: v.string().email(),
  age: v.int().optional(),
});

type User = Infer<typeof userSchema>;

// No cast needed — schema satisfies StandardSchemaV1<User> structurally
ai.tool({
  name: "create_user",
  description: "Create a new user",
  input: userSchema,
  execute: async (input) => createUser(input),
});
```

## Two access patterns

### 1. Pass the schema, library reads `~standard` internally

This is the normal path. The library types its input as `StandardSchemaV1<T>`, reads `schema["~standard"]` internally, and calls `validate`. You hand it the schema object — you don't reach into `~standard` yourself.

```ts
// TanStack Form
const form = useForm({ validators: { onChange: userSchema } });

// Conform (Remix)
const [form] = useForm({
  onValidate({ formData }) {
    return parseWithStandardSchema(formData, { schema: userSchema });
  },
});
```

### 2. Call `~standard.validate` directly

Lower-level access — most apps don't need this. Reach for it when you're implementing a custom adapter.

```ts
const result = await userSchema["~standard"].validate(rawData);

if ("value" in result) {
  result.value; // success — the validated data
} else {
  result.issues; // [{ message, path: [{ key }, ...] }, ...]
}
```

The Standard Schema issue shape uses `message` (not `error`) and a path-segment array (not a dot-notation string). It's the cross-library wire format.

## JSON Schema via Standard Schema

The bridge also exposes JSON Schema:

```ts
const jsonSchema = userSchema["~standard"].jsonSchema.input({ target: "openai-strict" });
// → { type: "object", properties: {...}, required: [...], additionalProperties: false }
```

This is the same data as `userSchema.toJsonSchema("openai-strict")` — just the Standard Schema accessor for cross-library tooling.

## Why no casts? Input and output types

`ObjectValidator<TSchema>` supplies distinct input and output shapes to
`BaseValidator<TInput, TOutput>`. Both object factories return that class directly;
adding another Standard Schema intersection duplicates compiler work on nested
schemas. Other factories use precise intersections when their class does not
already carry the output type, for example `StringValidator & StandardSchemaV1<string>`.

Use `Infer.Input<typeof schema>` for caller data and `Infer.Output<typeof schema>`
for successful validation results. Defaults and catches may make fields optional
in input and required in output. Unions and records preserve this distinction,
and unions return the matching branch's validated data.

## When the bridge "fails"

### 1. An annotation discarded schema details

```ts
import type { ObjectValidator } from "@warlock.js/seal";

const fields = { email: v.string() };
const schema: ObjectValidator<typeof fields> = v.object(fields);
// Concrete object class generics preserve the Standard Schema input and output.
```

A bare `ObjectValidator` annotation loses the concrete fields. Bare primitive
class annotations can also discard the factory's precise Standard Schema
intersection. Let factories infer their concrete types where possible.

### 2. The schema's inferred shape doesn't match the slot

```ts
ai.supervisor<MyOutput, ...>({
  output: schema,  // ❌ schema infers differently from MyOutput
});
```

The supervisor's explicit `<MyOutput>` generic is a constraint the schema must satisfy. If they diverge, TS rightly rejects. Two fixes:

- **Drop the explicit generic.** Let the supervisor infer the output type from the schema. The hand-rolled type was probably documentation-only.
- **Align them.** If the hand-rolled type is the source of truth (a domain type from elsewhere), reshape the schema to match.

### 3. The error mentions `Result<unknown>`

Check for annotations that erased factory details, then compare the schema's
`Infer.Input` and `Infer.Output` with the consumer's expected types. Output slots
should use the post-default output shape. Objects carry it in class generics;
union/record factory intersections put their precise Standard Schema validation
signature first so direct `~standard.validate()` calls also return typed output.

## Cascade `Model<TSchema>` variance

`@warlock.js/cascade` Models declare `static schema: ObjectValidator<TSchema>`. Passing `v.object({...})` works directly — the factory returns the same generic object class.

If you see _"`ObjectValidator<{specific}>` is not assignable to `ObjectValidator<TSchema>`"_, the answer isn't to widen the schema. It's almost always that `Model<TSchema>` was parameterized with a hand-rolled type that drifted from the schema's inferred shape. Fix the type, not the schema.

## Why seal forks the Standard Schema types

Seal vendors the Standard Schema spec types locally instead of importing from `@standard-schema/spec`:

- Seal extends the spec with `StandardJSONSchemaV1` (the JSON Schema converter on `~standard.jsonSchema`). Mixing a local extension with an external import gets messy.
- The V1 spec is locked. The fork is short and updates rarely.
- Vendoring avoids version-coupling pain across `@warlock.js/*` packages.

When V2 lands, the fork will re-sync. Until then, the local copy is the right call.

## Related

- [Essentials → Inferring types](../essentials/04-inferring-types.md) — `Infer<>` vs `Infer.Input` vs `Infer.Output`.
- [Generate JSON Schema](./generate-json-schema.md) — the same JSON Schema accessor via the direct `.toJsonSchema()` method.
- [Standard Schema spec](https://standardschema.dev) — the upstream contract.

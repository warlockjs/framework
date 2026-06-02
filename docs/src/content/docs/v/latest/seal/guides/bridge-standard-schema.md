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
  result.value;   // success — the validated data
} else {
  result.issues;  // [{ message, path: [{ key }, ...] }, ...]
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

## Why no casts? The phantom intersection

Under the hood, each factory call widens its return with an intersection at the type level only:

```ts
// Conceptually:
object: <T extends Schema>(schema: T) =>
  new ObjectValidator<T>(schema) as ObjectValidator<T> & StandardSchemaV1<Infer<ObjectValidator<T>>>;

string: () =>
  new StringValidator() as StringValidator & StandardSchemaV1<string>;
```

The intersection lives **only on the factory return** — not on the `ObjectValidator` or `BaseValidator` class shapes. That distinction matters: putting `Infer<this>` on the class itself breaks cascade's `Model<TSchema>` (the invariant generic explodes when class members vary with `TSchema`). The factory-side intersection avoids that — bare classes still slot into `Model.schema: ObjectValidator<TSchema>` positions.

You don't think about this in app code. Just use `Infer<typeof schema>` for the type and hand the schema to typed slots without casting.

## When the bridge "fails"

Three failure modes appear in real projects.

### 1. You annotated the schema with the bare class type

```ts
import type { ObjectValidator, StringValidator } from "@warlock.js/seal";

// ❌ Discards the phantom intersection
const schema: ObjectValidator<{ email: StringValidator }> = v.object({
  email: v.string(),
});

// ✅ Let inference run
const schema = v.object({
  email: v.string(),
});
```

The class-type annotation strips `& StandardSchemaV1<...>` from the type. The schema then stops fitting `StandardSchemaV1<T>` slots. Fix: remove the annotation. If you need the value type elsewhere, use `Infer<typeof schema>`.

### 2. The schema's inferred shape doesn't match the slot

```ts
ai.supervisor<MyOutput, ...>({
  output: schema,  // ❌ schema infers differently from MyOutput
});
```

The supervisor's explicit `<MyOutput>` generic is a constraint the schema must satisfy. If they diverge, TS rightly rejects. Two fixes:

- **Drop the explicit generic.** Let the supervisor infer the output type from the schema. The hand-rolled type was probably documentation-only.
- **Align them.** If the hand-rolled type is the source of truth (a domain type from elsewhere), reshape the schema to match.

### 3. The error mentions `Result<unknown>` even though `Infer<>` looks right

A TypeScript reporting quirk. When a `StandardSchemaV1<T>` slot rejects a schema, TS picks the simplest mismatch chain — sometimes it falls through `BaseValidator['~standard'].validate`'s wider `Result<unknown>` declaration before reaching the narrower factory-side one.

The intersection *is* there structurally. To check the actual inferred type:

```ts
type _Probe = Infer<typeof schema>;
const _force: { __nope: 1 } = null as unknown as _Probe;
// Hover the error in your editor to see the resolved shape.
// Compare to the slot's expected T.
```

That's the real mismatch — ignore the `Result<unknown>` mention.

## Cascade `Model<TSchema>` variance

`@warlock.js/cascade` Models declare `static schema: ObjectValidator<TSchema>`. Passing `v.object({...})` works directly — the factory return widens to fit the invariant generic.

If you see *"`ObjectValidator<{specific}>` is not assignable to `ObjectValidator<TSchema>`"*, the answer isn't to widen the schema. It's almost always that `Model<TSchema>` was parameterized with a hand-rolled type that drifted from the schema's inferred shape. Fix the type, not the schema.

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

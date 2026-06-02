---
title: "Inferring types"
description: Infer, Infer.Input, Infer.Output — how seal turns a schema into a TypeScript type, and when to reach for which.
sidebar:
  order: 4
  label: "Inferring types"
---

`Infer<typeof schema>` is the bridge between a runtime schema and a static TypeScript type. You write the shape once, and TS reads the brands (`isOptional`, `hasDefault`, `hasCatch`, `isNullable`) attached by each chain method to compute the inferred type.

There are three helpers:

- `Infer<T>` — alias for `Infer.Input<T>`. The common case.
- `Infer.Input<T>` — what the caller is allowed to send (pre-validation).
- `Infer.Output<T>` — what `result.data` contains (post-validation).

For simple schemas — no defaults, no catches, just `.optional()` and `.nullable()` — all three resolve identically. The split only matters once you add defaults or catches.

## The basic shape

```ts
import { v, type Infer } from "@warlock.js/seal";

const schema = v.object({
  email: v.string().email(),
  age: v.int().min(13).optional(),
  role: v.literal("admin", "user", "guest"),
});

type User = Infer<typeof schema>;
// {
//   email: string;
//   age?: number;
//   role: "admin" | "user" | "guest";
// }
```

Three things to notice:

- Required fields appear without `?` — `email` and `role`.
- `.optional()` adds the `?` brand — `age?: number`.
- `v.literal(...)` narrows to the literal union, not the wider `string`.

This is the type you reach for in HTTP handlers, form payloads, DTOs — anywhere the data is *about to be validated*.

## `Infer.Input` vs `Infer.Output`

Add a default or a catch, and the input and output shapes diverge.

```ts
const schema = v.object({
  bio: v.string().optional(),
  status: v.enum(["active", "inactive"]).optional().default("active"),
  retries: v.int().min(0).catch(3),
  deletedAt: v.date().nullable(),
});

type In = Infer.Input<typeof schema>;
// {
//   bio?:      string;
//   status?:   string;        ← default → caller may omit
//   retries?:  number;        ← catch   → caller may omit
//   deletedAt: Date | null;
// }

type Out = Infer.Output<typeof schema>;
// {
//   bio?:      string;
//   status:    string;        ← default fired → required
//   retries:   number;        ← catch rescued → required
//   deletedAt: Date | null;
// }
```

The asymmetry is intentional:

- **`Infer.Input`** describes what the *caller* sends. `.optional()`, `.default()`, and `.catch()` all make a key optional — any of them means "you don't have to supply this".
- **`Infer.Output`** describes what `result.data` *contains*. `.default()` and `.catch()` guarantee a value, so those keys are required even when chained with `.optional()`.

## When to reach for which

| Use case | Type to reach for |
| --- | --- |
| HTTP request body, form payload, DTO, anything pre-validation | `Infer<T>` (alias) or `Infer.Input<T>` |
| Validated state, Cascade `Model<>` params, anywhere downstream of `validate()` | `Infer.Output<T>` |

The bare `Infer<T>` is the common case (input). Reach for the explicit `Infer.Output<T>` when you're typing post-validation data:

```ts
const userSchema = v.object({
  email: v.string().email(),
  createdAt: v.date().defaultNow(),
});

// HTTP handler — caller omits createdAt
async function createUser(body: Infer.Input<typeof userSchema>) {
  const result = await validate(userSchema, body);

  if (result.isValid) {
    // Downstream uses Infer.Output — createdAt is guaranteed
    persist(result.data as Infer.Output<typeof userSchema>);
  }
}
```

## How the brands work

Each chain method attaches a type-level brand to the validator's type. The inference walker reads four brands:

- `{ isOptional: true }` — set by `.optional()`.
- `{ isNullable: true }` — set by `.nullable()`.
- `{ hasDefault: true }` — set by `.default(...)`.
- `{ hasCatch: true }` — set by `.catch(...)`.

`Infer.Input` marks a key optional whenever any of `isOptional`, `hasDefault`, or `hasCatch` is present. `Infer.Output` marks a key optional only when `isOptional` is present *and* neither `hasDefault` nor `hasCatch` is.

Both flavours widen with `| null` when `isNullable` is set.

You never touch the brands directly — they're attached automatically by chain methods. The intuition is enough.

## Common gotchas

### 1. Annotating the schema with the bare class type

```ts
import type { ObjectValidator } from "@warlock.js/seal";

// ❌ Discards the Standard Schema bridge intersection
const schema: ObjectValidator<{...}> = v.object({...});

// ✅ Let inference run
const schema = v.object({...});
```

The bare class annotation strips the `& StandardSchemaV1<...>` intersection that the factory return carries. If you need the value type, use `Infer<typeof schema>` instead of typing the schema itself.

### 2. Hand-rolled parallel types drift

```ts
// ❌ Two sources of truth — they'll diverge
type User = { email: string; age?: number };
const userSchema = v.object({
  email: v.string().email(),
  age: v.int().optional(),
});

// ✅ One source — the schema
const userSchema = v.object({
  email: v.string().email(),
  age: v.int().optional(),
});
type User = Infer<typeof userSchema>;
```

Adding a field to the schema and forgetting to update the parallel type used to be silent. Seal's tightened inference now catches the mismatch at compile time — but the right fix is to delete the parallel type, not to keep them aligned by hand.

### 3. Recursive schemas need a type alias

TypeScript can't infer recursion from the validator alone. Declare the type explicitly and annotate the schema variable. See [the recursive schemas recipe](../recipes/recursive-schemas.md) for the full pattern.

## Standard Schema interop

`v.object({...})` also satisfies `StandardSchemaV1<Infer<typeof schema>>`. Any library that types its input as `StandardSchemaV1<T>` — TanStack Form, Conform, LangGraph, OpenAI structured outputs in a wrapper library — accepts a seal schema directly. No `as unknown as` casts.

The mechanism is a phantom intersection applied at the factory return type. The [Standard Schema bridge guide](../guides/bridge-standard-schema.md) covers the typing details and what to do when a slot rejects your schema.

## Related

- [Modifiers](./02-modifiers.md) — `.optional`, `.default`, `.catch`, `.nullable` — the chain methods that attach the brands.
- [Guides → Bridge Standard Schema](../guides/bridge-standard-schema.md) — the phantom intersection, `Result<unknown>` errors, cascade `Model<TSchema>` variance.

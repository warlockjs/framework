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
    // result.data is Infer.Output — createdAt is guaranteed
    persist(result.data);
  }
}
```

`validate()` narrows on `isValid`: on success `result.data` is `Infer.Output<typeof schema>`, on failure it is `undefined`. A schema whose type does not describe its output (a value annotated as bare `BaseValidator` or `ObjectValidator`) keeps `data: any`; a typed `v.record(...)` keeps its `Record<string, …>` output. The Standard Schema bridge follows the same rule: `schema["~standard"].validate(...)` resolves to the output type, discriminated unions included.

:::caution[Typing validated data as `Infer<T>`]
Bare `Infer<T>` is the *input* shape, where `.default()`, `.catch()` and `.optional()` all make a key optional. Annotate post-validation data with it and every defaulted field reads as possibly `undefined`. Use `Infer.Output<T>` (or let `validate()` infer it) for anything downstream of validation.
:::

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

const fields = { email: v.string() };
const inferred = v.object(fields);
const typed: ObjectValidator<typeof fields> = inferred; // preserves object input/output
```

An `ObjectValidator<typeof fields>` annotation preserves both shapes through the
class's generic parameters. A bare `ObjectValidator` loses the concrete fields;
a bare primitive class annotation can discard its factory's Standard Schema
intersection. Let the factory infer its concrete type when possible.

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

### 4. `.refine()` checks successful typed output

Refinement callbacks read the validator's declared output type and run after
value rules, container children, defaults, computed fields and transformers.
They skip failed validation and absent/null values, including when
`firstErrorOnly: false`. Successful empty defaults such as `.default("")` are
checked too. Return `undefined` to accept the value or an error string to reject
it. Use `.addRule()` for checks against input before child validation.

```ts
v.object({ count: v.int().optional().default(1) }).refine((value) => {
  // count is already defaulted, and its type is number.
  return value.count > 10 ? "Too many items" : undefined;
});
```

Output transformers do not yet update every declared type. For example,
`v.date().toISOString()` produces a string while its declaration remains `Date`.
A refinement sees the string even when `.refine()` appears first in the chain.
Use a Date input rule or convert after validation when you need Date methods.

### 5. Very large composed schemas still have a compiler cost

The deterministic 16-entity/8-service fixture currently uses about 655,000 type
instantiations and 663 MB of compiler memory with TypeScript 5.9.3 (roughly 41,000
instantiations and 41 MB per entity for this fixture). Returning an object's
already typed class directly removed a duplicate Standard Schema intersection
and reduced instantiations by about 63% from the previous baseline. Larger or
more deeply nested schemas can still need a larger compiler heap; memory varies
by environment. Run `pnpm bench:types --check` from `packages/seal` after inference
changes; CI gates deterministic type/instantiation counts within 5% of the
baseline. Time and memory are diagnostic only.

## Standard Schema interop

`v.object({...})` exposes `StandardSchemaV1<Infer.Input<typeof schema>, Infer.Output<typeof schema>>`. Any library that types its input as `StandardSchemaV1<T>` — TanStack Form, Conform, LangGraph, OpenAI structured outputs in a wrapper library — accepts a seal schema directly. No `as unknown as` casts.

Object validators thread their input/output shapes through class parameters; primitive and other factories add precise Standard Schema intersections when needed. The [Standard Schema bridge guide](../guides/bridge-standard-schema.md) covers the typing details and what to do when a slot rejects your schema.

## Related

- [Modifiers](./02-modifiers.md) — `.optional`, `.default`, `.catch`, `.nullable` — the chain methods that attach the brands.
- [Guides → Bridge Standard Schema](../guides/bridge-standard-schema.md) — input/output class parameters, factory intersections and `Result<unknown>` errors, cascade `Model<TSchema>` variance.

---
name: bridge-standard-schema
description: 'Diagnose `StandardSchemaV1` interop — phantom-intersection at the `v` factory return, why typed slots reject a schema, cascade `Model<TSchema>` variance. Triggers: `StandardSchemaV1`, `~standard`, `Infer`, `ObjectValidator`, `StringValidator`, `LiteralValidator`, `BaseValidator`, `Model<TSchema>`, `StandardJSONSchemaV1`, `Result<unknown>`; "StandardSchemaV1 slot rejecting my schema", "Result<unknown> error", "drop as unknown as cast", "cascade Model schema variance"; typical import `import { v, type Infer } from "@warlock.js/seal"`. Skip: foundations — `@warlock.js/seal/seal-basics/SKILL.md`; JSON Schema gen — `@warlock.js/seal/generate-json-schema/SKILL.md`; competing spec `@standard-schema/spec`.'
---

# The Standard Schema bridge

Seal validators implement [Standard Schema V1](https://standardschema.dev) — every validator exposes a `~standard` member with `validate()`, JSON Schema metadata, and inferred types. Any consumer that accepts `StandardSchemaV1<T>` (`@warlock.js/ai` supervisor `output`, ai tool `input`, LangGraph state, OpenAI structured outputs, TanStack Form, Conform) accepts a seal schema directly.

This skill is about the **typing** of that interop — the phantom intersection that makes `v.object({...})` satisfy `StandardSchemaV1<T>` without `as unknown as` casts.

## The shape of the bridge

The `v` factory returns aren't bare validator classes. Each factory widens its return with a phantom intersection:

```ts
// Inside seal's factory:
object: <T extends Schema>(schema: T) =>
  new ObjectValidator<T>(schema) as ObjectValidator<T>
    & StandardSchemaV1<Infer<ObjectValidator<T>>>;

string: () =>
  new StringValidator() as StringValidator & StandardSchemaV1<string>;

literal: <T extends readonly [...] >(...values: T) =>
  new LiteralValidator<T>(values) as LiteralValidator<T> & StandardSchemaV1<T[number]>;

// ...one intersection per factory.
```

The intersection is **only on the factory return type** — the `BaseValidator` and `ObjectValidator` *class* shapes are unchanged. That distinction is load-bearing: putting `Infer<this>` directly on `BaseValidator['~standard']` breaks `@warlock.js/cascade`'s `Model<TSchema>` because `ObjectValidator` becomes invariant when its members vary with `TSchema`. The factory-side intersection avoids that — bare classes in `Model.schema: ObjectValidator<TSchema>` slots are still structurally compatible with the typed factory return.

## What this means for app code

You write the schema once, you use it anywhere a `StandardSchemaV1<T>` is expected, you never cast:

```ts
import { v, validate, type Infer } from "@warlock.js/seal";
import { ai } from "@warlock.js/ai";

const userSchema = v.object({
  email: v.string().email(),
  age: v.int().optional(),
});

type User = Infer<typeof userSchema>;

// ✅ ai-side slot — no cast
ai.tool({
  name: "create_user",
  description: "Create a new user",
  input: userSchema,
  execute: async input => createUser(input),
});

// ✅ supervisor output — no cast
ai.supervisor({
  name: "user-flow",
  output: userSchema,
  // ...
});

// ✅ direct validation — call ~standard
const result = await userSchema["~standard"].validate(rawData);
```

## `Infer<typeof schema>` vs hand-rolled types

Use `Infer<>`. Always:

```ts
const schema = v.object({
  email: v.string(),
  blocks: v.array(v.literal("text", "image")).optional(),
});

type Output = Infer<typeof schema>;
// { email: string; blocks?: ("text" | "image")[] }
```

Hand-rolled parallel types drift the moment a field changes — and seal's tightened typing now catches that drift at compile time. The old loose typing hid the mismatch; the bridge surfaces it.

## When the bridge "fails"

Three failure modes you'll see in real projects:

### 1. You annotated the schema with the bare class type

```ts
// ❌ Discards the phantom intersection
const schema: ObjectValidator<{ email: StringValidator }> = v.object({...});

// ✅ Let inference run
const schema = v.object({...});
```

The annotation strips `& StandardSchemaV1<...>` from the type. The schema stops fitting `StandardSchemaV1<T>` slots. Fix: remove the annotation. If you need the value type, use `Infer<typeof schema>`.

### 2. The schema's inferred shape doesn't match the target type

```ts
ai.supervisor<MyOutput, ...>({
  output: schema,  // ❌ schema infers differently from MyOutput
});
```

The supervisor's explicit `<MyOutput>` generic is a constraint the schema must satisfy. If they diverge, TS rightly rejects. Two fixes:

- **Drop the explicit generic** — let the supervisor infer output type from the schema. The hand-rolled type was probably documentation-only anyway.
- **Align them** — if the hand-rolled type is the source of truth (e.g. a domain type from elsewhere), make the schema match.

### 3. The error says `Result<unknown>` even though `Infer<>` resolves correctly

This is a TypeScript reporting quirk, not a bridge bug. When a `StandardSchemaV1<T>` slot rejects a schema, TS picks the simplest mismatch chain to report — often it falls through `BaseValidator['~standard'].validate`'s wider `Result<unknown>` declaration before reaching the factory-side narrower one. The intersection *is* there structurally, but the error message mentions `unknown`.

If you see this, ignore the `unknown` and ask: does `Infer<typeof schema>` match the slot's expected `T`? Probe with:

```ts
type _Probe = Infer<typeof schema>;
const _force: { __nope: 1 } = null as unknown as _Probe;
// Hover the error to see the resolved shape, then compare to the slot's T.
```

That's the real mismatch.

## Why not `Omit<class, "~standard"> & StandardSchemaV1<T>`?

Tempting — it would force the factory's `~standard` to fully replace the class's wider one, fixing the misleading `Result<unknown>` error message. **Don't do it.** `Omit` on a class instance type triggers the same variance trap as putting `Infer<this>` on the class itself: cascade explodes with hundreds of `ObjectValidator<{specific}>` vs `ObjectValidator<TSchema>` errors. The phantom intersection is the only shape that satisfies both ends — narrower for typed slots, structurally identical to the class for cascade's invariant generic positions.

## Why not import `@standard-schema/spec` instead of forking the types?

Seal forks the types locally. Reasons:

- Seal extends the spec with `StandardJSONSchemaV1` (JSON Schema converter on `~standard.jsonSchema`). The package doesn't have this — half-importing is the worst of both worlds.
- V1 spec is locked. The fork is ~70 lines and updates rarely.
- Avoids version-coupling pain across `@warlock.js/*` packages.

If V2 lands, re-fork. Until then the local copy is the right call.

---
name: bridge-standard-schema
description: 'Diagnose `StandardSchemaV1` interop — input/output class parameters and primitive factory intersections, why typed slots reject a schema, cascade `Model<TSchema>` variance. Triggers: `StandardSchemaV1`, `~standard`, `Infer`, `ObjectValidator`, `StringValidator`, `LiteralValidator`, `BaseValidator`, `Model<TSchema>`, `StandardJSONSchemaV1`, `Result<unknown>`; "StandardSchemaV1 slot rejecting my schema", "Result<unknown> error", "drop as unknown as cast", "cascade Model schema variance"; typical import `import { v, type Infer } from "@warlock.js/seal"`. Skip: foundations — the `seal-basics` topic; JSON Schema gen — the `generate-json-schema` topic; competing spec `@standard-schema/spec`.'
---

# The Standard Schema bridge

Seal validators implement [Standard Schema V1](https://standardschema.dev) — every validator exposes a `~standard` member with `validate()`, JSON Schema metadata, and inferred types. Any consumer that accepts `StandardSchemaV1<T>` (`@warlock.js/ai` supervisor `output`, ai tool `input`, LangGraph state, OpenAI structured outputs, TanStack Form, Conform) accepts a seal schema directly.

This skill covers the input and output types exposed through `~standard`, and
compatibility with consumers such as Cascade model schemas and AI tool schemas.

## The shape of the bridge

`ObjectValidator<TSchema>` already threads `Infer.Input` and `Infer.Output` shapes
into `BaseValidator<TInput, TOutput>`. Both `v.object(fields)` and the standalone
`object(fields)` factory return that class directly. No extra Standard Schema
intersection is needed for objects: avoiding one keeps large composed schemas
cheaper for TypeScript to instantiate.

Other factories add a Standard Schema intersection when their class has no precise
generic output declaration, for example:

```ts
// Inside Seal's factory:
string: () =>
  new StringValidator() as StringValidator & StandardSchemaV1<string>;
```

Keep input and output distinct when writing consumer types. Defaults and catches
can make input fields optional while output fields are required. Avoid computing
`Infer<this>` in the base class: object shapes are already supplied as generic
parameters, and recursively walking the full class increases compiler work.

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

type Output = Infer.Output<typeof schema>;
// { email: string; blocks?: ("text" | "image")[] }
```

Hand-rolled parallel types drift the moment a field changes — and seal's tightened typing now catches that drift at compile time. The old loose typing hid the mismatch; the bridge surfaces it.

## When the bridge "fails"

Three failure modes you'll see in real projects:

### 1. An annotation discarded schema details

Let the factory infer its concrete schema. An annotation such as bare
`ObjectValidator` loses the field types; primitive factories also lose their
Standard Schema intersection when annotated with a bare primitive class.
`ObjectValidator<typeof fields>` preserves an object's input and output types.

### 2. The schema's inferred shape doesn't match the target type

```ts
ai.supervisor<MyOutput, ...>({
  output: schema,  // ❌ schema infers differently from MyOutput
});
```

The supervisor's explicit `<MyOutput>` generic is a constraint the schema must satisfy. If they diverge, TS rightly rejects. Two fixes:

- **Drop the explicit generic** — let the supervisor infer output type from the schema. The hand-rolled type was probably documentation-only anyway.
- **Align them** — if the hand-rolled type is the source of truth (e.g. a domain type from elsewhere), make the schema match.

### 3. The error says `Result<unknown>`

Check whether an annotation erased a factory's output type, and compare
`Infer.Input<typeof schema>` and `Infer.Output<typeof schema>` with the consumer's
expected types. Output slots should use the post-default output shape. Objects
carry that shape directly through their class generics; primitive factories add
it through their Standard Schema intersection.

## Compiler budget

From `packages/seal`, run `pnpm bench:types --check` after changes to inference or
factory types. CI runs the same deterministic composed-schema fixture when Seal
is selected. Instantiations and type counts may grow at most 5% above the checked-in
baseline. Refresh with `node scripts/bench-types.mjs --update` only after reviewing
the measurements; time and memory are diagnostic rather than gated.

## Why not `Omit<class, "~standard"> & StandardSchemaV1<T>`?

Tempting — it would force the factory's `~standard` to fully replace the class's wider one, fixing the misleading `Result<unknown>` error message. **Don't do it.** `Omit` on a class instance type triggers the same variance trap as putting `Infer<this>` on the class itself: cascade explodes with hundreds of `ObjectValidator<{specific}>` vs `ObjectValidator<TSchema>` errors. Keep object factories as their existing generic class, and retain factory-side intersections for primitive classes that need them. Both preserve the validator's class members for generic consumers.

## Why not import `@standard-schema/spec` instead of forking the types?

Seal forks the types locally. Reasons:

- Seal extends the spec with `StandardJSONSchemaV1` (JSON Schema converter on `~standard.jsonSchema`). The package doesn't have this — half-importing is the worst of both worlds.
- V1 spec is locked. The fork is ~70 lines and updates rarely.
- Avoids version-coupling pain across `@warlock.js/*` packages.

If V2 lands, re-fork. Until then the local copy is the right call.

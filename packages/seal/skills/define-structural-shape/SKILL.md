---
name: define-structural-shape
description: 'Compose `v.object` / `v.array` / `v.record` / `v.tuple` / `v.union` / `v.discriminatedUnion` / `v.lazy`. Triggers: `v.object`, `v.array`, `v.record`, `v.tuple`, `v.union`, `v.discriminatedUnion`, `v.lazy`, `ObjectValidator`; "how do I build an object schema", "dynamic-keyed record", "tagged union with discriminator", "recursive schema", "self-referencing schema"; typical import `import { v, type Infer } from "@warlock.js/seal"`. Skip: leaf primitives — `@warlock.js/seal/pick-seal-primitive/SKILL.md`; modifiers — `@warlock.js/seal/compose-seal-modifiers/SKILL.md`; standard-schema bridge — `@warlock.js/seal/bridge-standard-schema/SKILL.md`; competing libs `zod`, `valibot`.'
---

# Structural validators — picking guide

The five structural factories. Each composes — pass leaf primitives or other structural validators inside, infer with `Infer<typeof schema>`. **Method surface for `v.object` and `v.array` lives in `object-methods.md` and `array-methods.md`** — this file is just orientation.

## `v.object` — fixed-key records

```ts
v.object({
  email: v.string().email(),
  age: v.int().min(13).optional(),
  role: v.literal("admin", "user", "guest"),
})
```

- **Required by default.** `.optional()` to opt out — the `{ isOptional: true }` brand makes the key optional in `Infer<>`.
- **Unknown keys policy.** By default extra keys are silently dropped from `data`. Toggle with `.allowUnknown()` (forward as-is), `.stripUnknown()` (explicit drop), or `.allow(...keys)` (whitelist specific extras). See [`object-methods.md`](./object-methods.md).
- **Schema composition.** `.extend(schema)`, `.merge(other)`, `.pick(...keys)`, `.without(...keys)`, `.partial(...keys)`, `.requiredFields(...keys)` — all in [`object-methods.md`](./object-methods.md).
- **Cross-field rules** (`sameAs`, `requiredIf`, `requiredWith`) attach to fields *inside* a `v.object`. Without a parent, sibling resolution silently passes.

## `v.array` — homogeneous lists

```ts
v.array(v.string())          // type: string[]
v.array(userSchema)          // type: User[]
v.array(v.array(v.int()))    // type: number[][] — recursive inference
```

The inner validator runs against each element; failure on any element fails the array. Method surface (`.min`, `.max`, `.unique`, `.sorted`, `.flip`, …) in [`array-methods.md`](./array-methods.md).

## `v.record` — homogeneous values, dynamic keys

```ts
v.record(v.int())                          // type: Record<string, number>
v.record(v.object({ count: v.int() }))     // type: Record<string, { count: number }>
v.record()                                 // type: Record<string, any>
```

Reach for `v.record` when keys are dynamic (user-provided, dictionary-style) but values share a schema. If keys are also constrained (e.g. only `"draft" | "published"`), use `v.object` with literal keys instead — the constraint lives in the type.

## `v.tuple` — positional types

```ts
v.tuple([v.string(), v.int(), v.boolean()])  // type: [string, number, boolean]
v.tuple([v.literal("ok"), v.string()])       // type: ["ok", string]
```

Each position has its own validator; the array length must match the tuple length. Pair with `v.literal` at position 0 for result-tuple patterns (`["ok", data]` vs `["error", message]`).

## `v.union` — one of N validators (untagged)

```ts
v.union([v.string(), v.int()])  // type: string | number
```

The first type-matching validator wins, picked via each branch's `matchesType()`. Use for unions of **scalar** types (string vs number, etc.) where `matchesType` is enough to disambiguate. For object-vs-object unions, reach for `v.discriminatedUnion` instead — `matchesType` can't distinguish two object branches and you'll get errors from the wrong branch.

## `v.discriminatedUnion` — tagged unions (recommended for objects)

```ts
const email = v.object({ type: v.literal("email"), email: v.string().email() });
const sms   = v.object({ type: v.literal("sms"),   phone: v.string() });
const push  = v.object({ type: v.literal("push"),  deviceId: v.string() });

const notif = v.discriminatedUnion("type", [email, sms, push]);

type Notif = Infer<typeof notif>;
// { type: "email"; email: string }
// | { type: "sms"; phone: string }
// | { type: "push"; deviceId: string }
```

Routes payloads by reading the discriminator field (here `type`), looking it up in a key→branch map built at construction time, and delegating to the matching branch only. Benefits over plain `v.union`:

- **Precise errors.** Failures come from the matched branch, not from every branch.
- **O(1) routing** instead of trial-and-error.
- **Exact TS inference** — discriminated union with narrowing inside `if (x.type === "email")` blocks.
- **Cleaner JSON Schema** — `oneOf` with literal discriminators; OpenAI-strict accepts it.

Construction-time validation throws on:

- Missing discriminator field in any branch
- Non-literal discriminator (must be `v.literal(...)`)
- Duplicate discriminator values across branches

So misconfigurations surface at schema-build time, not runtime.

## `v.lazy` — recursive and forward-referenced schemas

```ts
type Category = { name: string; children: Category[] };

const categorySchema: ObjectValidator<...> = v.object({
  name: v.string(),
  children: v.array(v.lazy(() => categorySchema)),
});

type T = Infer<typeof categorySchema>;
// { name: string; children: T[] }   ← recursive type
```

Defers resolution of the inner validator until validate-time. JavaScript evaluates the object literal before the `const` binding completes, so the inner reference would normally fail with `ReferenceError`. The thunk is invoked only when `validate()` runs, by which time the binding exists.

**Memoised.** The thunk fires once on first use; subsequent calls reuse the cached validator.

**JSON Schema caveat.** Simple-resolve in v1 — recursive shapes will infinite-loop in `toJsonSchema()`. If you need JSON Schema for a recursive shape, generate it manually with `$defs` + `$ref` until v2 lands.

**TS inference requires a recursive type alias.** TS can't infer `Category = { name: string; children: Category[] }` from the schema alone — declare the type explicitly and annotate the schema variable with `ObjectValidator<...>` or similar (same pattern as Zod's `z.ZodType<Category>`).

Use for: trees (categories, file systems), threaded data (comment chains), mutually recursive schemas (`A` references `B` references `A`), and forward references (a schema needs to use one defined later in the file).

## Quick map

| Want | Reach for |
| --- | --- |
| Fixed-shape record | `v.object({...})` |
| Dynamic keys, same value shape | `v.record(valueSchema)` |
| List of items | `v.array(itemSchema)` |
| Position-typed array | `v.tuple([a, b, c])` |
| One of N scalar types | `v.union([...])` |
| One of N object shapes with a tag field | `v.discriminatedUnion(key, [...])` |
| Self-referencing or forward reference | `v.lazy(() => schema)` |
| One of N constants | `v.literal(...values)` (not structural — see [`@warlock.js/seal/pick-seal-primitive/SKILL.md`](@warlock.js/seal/pick-seal-primitive/SKILL.md)) |

## A note on cascade Models

`@warlock.js/cascade` Models declare `static schema: ObjectValidator<TSchema>`. Passing a `v.object({...})` works directly — the factory return widens to fit the Model's invariant generic without breaking type checking. If TS complains *"`ObjectValidator<{specific}>` is not assignable to `ObjectValidator<TSchema>`"*, that's the variance trap and the answer isn't to widen the schema — it's almost always that `Model<TSchema>` was parameterized with a hand-rolled type that drifted from the schema's inferred shape. Fix the type, not the schema. See [`@warlock.js/seal/bridge-standard-schema/SKILL.md`](@warlock.js/seal/bridge-standard-schema/SKILL.md).

## Method-surface reference

- [`object-methods.md`](./object-methods.md) — `.extend` / `.merge` / `.pick` / `.without` / `.partial` / `.requiredFields` / `.allowUnknown` / `.stripUnknown` / `.allow` / `.trim`.
- [`array-methods.md`](./array-methods.md) — `.minLength` / `.maxLength` / `.length` / `.between` / `.unique` / `.sorted` / `.flip` / `.sort` / `.onlyUnique`.

`v.record` and `v.tuple` share the array-style length surface. `v.union` and `v.discriminatedUnion` have no chainable methods beyond what's shown above. `v.lazy` is a single-call factory.

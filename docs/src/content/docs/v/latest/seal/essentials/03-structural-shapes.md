---
title: "Structural shapes"
description: Composing primitives into objects, arrays, records, tuples, unions, discriminated unions, and recursive schemas.
sidebar:
  order: 3
  label: "Structural shapes"
---

Primitives describe single values. Structural validators describe how values nest. The five structural factories compose — pass leaf primitives or other structural validators inside, infer the full nested type with `Infer<typeof schema>`.

## `v.object` — fixed-key records

```ts
v.object({
  email: v.string().email(),
  age: v.int().min(13).optional(),
  role: v.literal("admin", "user", "guest"),
});
```

- **Required by default.** `.optional()` to opt out. The inferred type marks optional keys with `?`.
- **Cross-field rules live here.** `.sameAs("password")`, `.requiredIf("role", "admin")` resolve siblings against the parent `v.object`. Without a parent, sibling resolution silently passes.
- **Unknown keys are dropped silently by default.** Toggle behavior:
  - `.allowUnknown()` — forward extras as-is.
  - `.stripUnknown()` — explicit drop (the default behavior, called out).
  - `.allow("trackingId", "_meta")` — whitelist specific extras.

### Composing objects

`v.object` schemas can be reshaped and combined with first-class methods:

```ts
const userBase = v.object({
  email: v.string().email(),
  name: v.string(),
  passwordHash: v.string(),
});

// Add fields
userBase.extend({ role: v.literal("admin", "user") });

// Merge with another schema
const auditFields = v.object({
  createdAt: v.date(),
  updatedAt: v.date(),
});
userBase.merge(auditFields);

// Subset / superset
userBase.pick("email", "name");           // only those two keys
userBase.without("passwordHash");         // drop one
userBase.partial("email");                // mark specific keys optional
userBase.requiredFields("email", "name"); // force-required specific keys
```

These return new validators — the source is untouched.

## `v.array` — homogeneous lists

```ts
v.array(v.string())          // type: string[]
v.array(userSchema)          // type: User[]
v.array(v.array(v.int()))    // type: number[][] — nests naturally
```

The inner validator runs against each element. Failure on any element fails the array.

Length and uniqueness constraints:

```ts
v.array(v.string()).minLength(1).maxLength(10)
v.array(v.string()).length(5)        // exactly 5 items
v.array(v.string()).unique()         // no duplicates
```

## `v.record` — homogeneous values, dynamic keys

```ts
v.record(v.int())                          // type: Record<string, number>
v.record(v.object({ count: v.int() }))     // type: Record<string, { count: number }>
v.record()                                 // type: Record<string, any>
```

Reach for `v.record` when keys are dynamic (user-supplied, dictionary-style) but values share a schema. If keys are also constrained (e.g. only `"draft" | "published"`), use `v.object` with literal keys instead — the constraint lives in the type.

## `v.tuple` — positional types

```ts
v.tuple([v.string(), v.int(), v.boolean()])  // type: [string, number, boolean]
v.tuple([v.literal("ok"), v.string()])       // type: ["ok", string]
```

Each position has its own validator. The array length must match the tuple length. Pair with `v.literal` at position 0 for result-tuple patterns (`["ok", data]` vs `["error", message]`).

## `v.union` — one of N validators (untagged)

```ts
v.union([v.string(), v.int()])  // type: string | number
```

The first type-matching branch wins, picked via each branch's `matchesType()`. Use for unions of **scalar** types where matching against the JS type is enough to disambiguate.

For object-vs-object unions, reach for `v.discriminatedUnion` instead — `matchesType` can't distinguish two object branches, and you'll get errors from the wrong one.

## `v.discriminatedUnion` — tagged unions (the right call for objects)

```ts
const email = v.object({ type: v.literal("email"), email: v.string().email() });
const sms   = v.object({ type: v.literal("sms"),   phone: v.string() });
const push  = v.object({ type: v.literal("push"),  deviceId: v.string() });

const notification = v.discriminatedUnion("type", [email, sms, push]);

type Notif = Infer<typeof notification>;
// { type: "email";  email: string }
// | { type: "sms";  phone: string }
// | { type: "push"; deviceId: string }
```

Routes payloads by reading the discriminator field, looking it up in a key→branch map built at construction time, and delegating to the matching branch only.

Benefits over plain `v.union`:

- **Precise errors.** Failures come from the matched branch, not from every branch.
- **O(1) routing** instead of trial-and-error.
- **Exact TypeScript narrowing** inside `if (x.type === "email")` blocks.
- **Cleaner JSON Schema** — `oneOf` with literal discriminators; OpenAI strict mode accepts it.

Construction-time validation throws on:

- Missing discriminator field on any branch.
- Non-literal discriminator (must be `v.literal(...)`).
- Duplicate discriminator values across branches.

Misconfigurations surface at schema-build time, not at runtime.

## `v.lazy` — recursive and forward references

Some shapes describe themselves — a category has sub-categories, a comment has replies. Referencing the schema from inside its own definition hits a JavaScript evaluation-order problem: the inner reference fires before the `const` binding resolves.

```ts
type Category = { name: string; children: Category[] };

const categorySchema: ObjectValidator<{
  name: ReturnType<typeof v.string>;
  children: ReturnType<typeof v.array>;
}> = v.object({
  name: v.string(),
  children: v.array(v.lazy(() => categorySchema)),
});

type T = Infer<typeof categorySchema>;
// { name: string; children: T[] }   ← recursive type
```

Three pieces make this work:

1. **The thunk `() => categorySchema`** — evaluated lazily, by which time the binding resolves.
2. **The recursive type alias `Category`** — TypeScript can't infer recursion from the validator alone.
3. **The explicit annotation `ObjectValidator<...>`** — without it, TS won't accept the circular reference. Same pattern as Zod's `z.ZodType<Category>`.

The thunk fires **once** per validator instance (memoised) — calling `validate()` 10,000 times invokes the thunk once.

**JSON Schema caveat.** Simple-resolve in v1 — recursive shapes will infinite-loop in `toJsonSchema()`. If you need JSON Schema for a recursive shape, generate it manually with `$defs` + `$ref` until proper `$ref` support lands.

The [recursive schemas recipe](../recipes/recursive-schemas.md) covers mutual recursion, forward references, and the depth/cycle gotchas.

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
| One of N constants | `v.literal(...values)` (not structural — a primitive) |

## Related

- [Primitives](./01-primitives.md) — the leaf validators that go inside structural shapes.
- [Modifiers](./02-modifiers.md) — `.optional`, `.default`, `.catch`, the cross-cutting chain methods.
- [Recipe → Polymorphic data](../recipes/polymorphic-data.md) — tag-routed unions in depth.
- [Recipe → Recursive schemas](../recipes/recursive-schemas.md) — `v.lazy` patterns.

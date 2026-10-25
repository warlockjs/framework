---
name: define-structural-shape
description: 'Compose `v.object` / `v.array` / `v.record` / `v.tuple` / `v.union` / `v.discriminatedUnion` / `v.lazy`. Triggers: `v.object`, `v.array`, `v.record`, `v.tuple`, `v.union`, `v.discriminatedUnion`, `v.lazy`, `ObjectValidator`; "how do I build an object schema", "dynamic-keyed record", "tagged union with discriminator", "recursive schema", "self-referencing schema"; typical import `import { v, type Infer } from "@warlock.js/seal"`. Skip: leaf primitives — the `pick-seal-primitive` topic; modifiers — the `compose-seal-modifiers` topic; standard-schema bridge — the `bridge-standard-schema` topic; competing libs `zod`, `valibot`.'
---

# Structural validators — picking guide

The five structural factories. Each composes — pass leaf primitives or other structural validators inside, infer with `Infer<typeof schema>`. **Method surface for `v.object` and `v.array` lives in `object-methods.md` and `array-methods.md`** — this file is just orientation.

## `v.object` — fixed-key records

```ts
v.object({
  email: v.string().email(),
  age: v.int().min(13).optional(),
  role: v.literal("admin", "user", "guest"),
});
```

- **Plain objects only.** Arrays and non-plain objects fail even with `.allowUnknown()` or `.stripUnknown()`. Null-prototype dictionaries work. Convert class instances to explicit DTOs; no permissive opt-in is provided.
- **Required by default.** `.optional()` to opt out — the `{ isOptional: true }` brand makes the key optional in `Infer<>`.
- **Unknown keys policy.** By default extra keys fail validation. Toggle with `.allowUnknown()` (forward as-is), `.stripUnknown()` (explicit drop), or `.allow(...keys)` (whitelist specific extras). See [`object-methods.md`](./object-methods.md).
- **Schema composition.** `.extend(schema)`, `.merge(other)`, `.pick(...keys)`, `.without(...keys)`, `.partial(...keys)`, `.requiredFields(...keys)` — `.partial()` keeps the inferred type; mark a server-set field `.internal()` and `schema.withoutInternal()` / `schema.internalKeys()` derive the request-facing schema. All in [`object-methods.md`](./object-methods.md).
- **Cross-field rules** (`sameAs`, `requiredIf`, `requiredWith`) attach to fields _inside_ a `v.object`. Without a parent, sibling resolution silently passes.

## `v.array` — homogeneous lists

```ts
v.array(v.string()); // type: string[]
v.array(userSchema); // type: User[]
v.array(v.array(v.int())); // type: number[][] — recursive inference
```

The inner validator runs against each element; failure on any element fails the array. Method surface (`.min`, `.max`, `.unique`, `.sorted`, `.flip`, …) in [`array-methods.md`](./array-methods.md).

## `v.record` — homogeneous values, dynamic keys

```ts
v.record(v.int()); // type: Record<string, number>
v.record(v.object({ count: v.int() })); // type: Record<string, { count: number }>
v.record(); // type: Record<string, any>
```

Reach for `v.record` when keys are dynamic (user-provided, dictionary-style) but values share a schema. Use `v.record(keyValidator, valueValidator)` to constrain present keys, or `v.object` to require named keys.

## `v.tuple` — positional types

```ts
v.tuple([v.string(), v.int(), v.boolean()]); // type: [string, number, boolean]
v.tuple([v.literal("ok"), v.string()]); // type: ["ok", string]
```

Each position has its own validator; the array length must match the tuple length. Pair with `v.literal` at position 0 for result-tuple patterns (`["ok", data]` vs `["error", message]`).

Pass the validators as a literal list so each position keeps its own type, for input and validated output alike. A list typed `BaseValidator[]` (built at runtime) has no fixed positions, so its output is an array rather than a tuple.

## `v.union` — one of N validators (untagged)

```ts
v.union([v.string(), v.int()]); // type: string | number
```

Every branch whose type matches the value (`matchesType()`) is tried, in order, and the first that passes wins; the union returns that branch's validated output. `firstErrorOnly` limits the errors reported, never the branches tried, so a union of several object shapes accepts a value matching any of them:

```ts
const owner = v.object({ kind: v.literal("owner"), id: v.literal("__owner__") });
const member = v.object({ kind: v.literal("member"), id: v.string() });

await validate(v.union([owner, member]), { kind: "member", id: "x" });
// → valid, data: { kind: "member", id: "x" }
```

When no branch passes, the union reports the **closest** failed branch, picked by: fewest mismatched `v.literal(...)` fields, then fewest errors, then the deepest error path, then declaration order. Its errors keep their own paths (`actor.id`, not `actor`) and have the type `"union"` — the first one by default, all of them with `firstErrorOnly: false`. A custom `errorMessage` (`v.union([...], "Unknown actor")`), or a value no branch can hold by type, gives a single error at the union's path.

For object shapes that share a tag field, `v.discriminatedUnion` is still the better fit: it routes straight to one branch instead of trying each, and narrows exactly in TypeScript.

## `v.discriminatedUnion` — tagged unions (recommended for objects)

```ts
const email = v.object({ type: v.literal("email"), email: v.string().email() });
const sms = v.object({ type: v.literal("sms"), phone: v.string() });
const push = v.object({ type: v.literal("push"), deviceId: v.string() });

const notif = v.discriminatedUnion("type", [email, sms, push]);

type Notif = Infer<typeof notif>;
// { type: "email"; email: string }
// | { type: "sms"; phone: string }
// | { type: "push"; deviceId: string }
```

Routes payloads by reading the discriminator field (here `type`), looking it up in a key→branch map built at construction time, and delegating to the matching branch only. Benefits over plain `v.union`:

- **Precise errors.** Failures come from the branch the tag names, not from the closest guess.
- **O(1) routing** instead of trying each branch.
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

| Want                                    | Reach for                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| Fixed-shape record                      | `v.object({...})`                                                             |
| Dynamic keys, same value shape          | `v.record(valueSchema)`                                                       |
| List of items                           | `v.array(itemSchema)`                                                         |
| Position-typed array                    | `v.tuple([a, b, c])`                                                          |
| One of N scalar types                   | `v.union([...])`                                                              |
| One of N object shapes with a tag field | `v.discriminatedUnion(key, [...])`                                            |
| Self-referencing or forward reference   | `v.lazy(() => schema)`                                                        |
| One of N constants                      | `v.literal(...values)` (not structural — see the `pick-seal-primitive` topic) |

## A note on cascade Models

`@warlock.js/cascade` Models declare `static schema: ObjectValidator<TSchema>`. Passing a `v.object({...})` works directly — the factory return widens to fit the Model's invariant generic without breaking type checking. If TS complains _"`ObjectValidator<{specific}>` is not assignable to `ObjectValidator<TSchema>`"_, that's the variance trap and the answer isn't to widen the schema — it's almost always that `Model<TSchema>` was parameterized with a hand-rolled type that drifted from the schema's inferred shape. Fix the type, not the schema. See the `bridge-standard-schema` topic.

## Method-surface reference

- [`object-methods.md`](./object-methods.md) — `.extend` / `.merge` / `.pick` / `.without` / `.partial` / `.requiredFields` / `.allowUnknown` / `.stripUnknown` / `.allow` / `.trim`.
- [`array-methods.md`](./array-methods.md) — `.minLength` / `.maxLength` / `.length` / `.between` / `.unique` / `.sorted` / `.flip` / `.sort` / `.onlyUnique`.

`v.record` and `v.tuple` share the array-style length surface. `v.union` and `v.discriminatedUnion` have no chainable methods beyond what's shown above. `v.lazy` is a single-call factory.

## Validate dictionary keys (5.34)

```ts
import { v, type Infer } from "@warlock.js/seal";

const counts = v.record(v.literal("draft", "published"), v.int());
type Counts = Infer.Output<typeof counts>; // Partial<Record<"draft" | "published", number>>
await v.validate(counts, { draft: 2 });
const dictionary = v.record(v.string(), v.int()); // Record<string, number>
await v.validate(dictionary, { arbitrary: 1 });
```

`v.record(valueValidator)` and its optional string error message still work.
Two validator arguments mean key then value; an optional third string sets the
object error. Invalid arguments throw at definition. Key transforms never
rename entries; present keys are validated as strings. Literal keys are optional
in the inferred dictionary; use `v.object` for required named fields.

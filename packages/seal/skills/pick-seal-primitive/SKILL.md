---
name: pick-seal-primitive
description: 'Pick the right `v` factory primitive — string / int / literal / date / enum / computed / managed / instanceof / any. Triggers: `v.string`, `v.email`, `v.number`, `v.int`, `v.float`, `v.numeric`, `v.boolean`, `v.scalar`, `v.date`, `v.literal`, `v.enum`, `v.instanceof`, `v.computed`, `v.managed`, `v.any`; "v.string vs v.scalar", "v.literal vs v.enum", "v.date vs v.instanceof(Date)", "what is v.computed"; typical import `import { v } from "@warlock.js/seal"`. Skip: structural shapes — `@warlock.js/seal/define-structural-shape/SKILL.md`; modifiers — `@warlock.js/seal/compose-seal-modifiers/SKILL.md`; competing libs `zod`, `valibot`, `yup`.'
---

# Picking the right primitive

This is the orientation skill — *which* primitive for *which* job. For the chainable methods on each (`.email()`, `.min()`, `.between()`, etc.), load the matching `*-methods.md` reference file in this skill folder.

## Strings

```ts
v.string()              // type: string — full surface in string-methods.md
v.email()               // shorthand for v.string().email()
v.enum(["a", "b"])      // type: "a" | "b" — runs as v.string().oneOf, but the factory overload preserves the literal union
```

Reach for `v.string()` for any text input. `v.email()` is just sugar — switch back to `v.string().email().min(...)` when you need extra rules.

## Numbers — pick by what you accept

| Validator | Accepts | When |
|---|---|---|
| `v.number()` | any finite number | accepts both integers and floats |
| `v.int()` | integers only | rejects `1.5` |
| `v.float()` | finite, non-integer | rejects `1` |
| `v.numeric()` | numeric strings + numbers | form/query inputs that arrive as `"42"` — coerces to number |

All four share the same chain surface (see [`number-methods.md`](./number-methods.md)). Picking is about input acceptance, not chain power.

## Booleans & scalars

```ts
v.boolean()  // type: boolean — adds .accepted() / .declined() for form-style inputs
v.scalar()   // type: string | number | boolean — usually a smell pointing at a missing discriminator
```

Use `v.scalar()` only when the field truly accepts any of the three primitives. If it's "one of N specific values across types", `v.literal(...)` is cleaner.

## Dates

```ts
v.date()                  // type: Date — normalizes strings/timestamps to Date, rich rule surface
v.instanceof(Date)        // type: Date — raw instanceof, no normalization, no rules
```

`v.date()` is the right tool 99% of the time — it ships `.min/.max/.before/.after/.weekDay/.minAge/...` and a built-in mutator that parses strings. `v.instanceof(Date)` is the escape hatch when you specifically need strict instance identity with zero coercion.

## Literals & instances

```ts
v.literal("items")                          // type: "items"
v.literal("draft", "published", "archived") // type: "draft" | "published" | "archived"
v.literal(1, 2, 3)                          // type: 1 | 2 | 3
v.literal(true)                             // type: true

v.instanceof(File)                          // type: File
v.instanceof(Buffer)                        // type: Buffer
v.instanceof(MyClass)                       // type: MyClass
```

**`v.literal` vs `v.string().oneOf([...])` vs `v.enum([...])`:**

- `v.literal("a", "b")` infers as `"a" | "b"` (literal narrowing). **Use this for discriminator fields.**
- `v.string().oneOf(["a", "b"])` infers as `string` (loses literal types). Use when broad type is fine.
- `v.enum(["a", "b"])` runs the same `oneOf` rule at runtime (it builds a `StringValidator().oneOf(...)`), but the `v.enum` factory overload **preserves the literal union** — it infers `"a" | "b"`, not `string`. Pass a TS enum object (`v.enum(Direction)`) and it uses `Object.values`, inferring `Direction[keyof Direction]`.

`v.instanceof(Ctor)` for File/Buffer/Uint8Array/custom classes. Returns `{}` from `toJsonSchema()` (not representable). For OpenAPI `File`, attach `{ type: "string", format: "binary" }` manually after generation.

## `v.any` — escape hatch

```ts
v.any()  // type: any — skips validation entirely
```

Reach for it when you genuinely don't care about the shape. Usually a smell — search PRs for it and ask whether a real schema would catch a class of bugs.

## Derived: `v.computed` and `v.managed`

These two **don't validate input** — they produce a value as part of validation.

```ts
v.object({
  firstName: v.string(),
  lastName: v.string(),
  fullName: v.computed<string>((data) => `${data.firstName} ${data.lastName}`),
  createdAt: v.managed<Date>(() => new Date()),
  createdBy: v.managed<string>((context) => context.context?.userId),
});
```

- **`v.computed`** runs after sibling validation; callback signature is `(data, context)` — `data` is the validated sibling object. Use for derived values (full name, hash of fields, computed totals). An optional second arg validates the result: `v.computed<string>(cb, v.string().min(3))`.
- **`v.managed`** runs from `SchemaContext` only — callback signature is `(context)`. Caller-supplied extras passed to `validate(schema, data, { context })` land on `context.context`. Use for framework-injected values — timestamps, current user, request id. The callback is optional (`v.managed()`) for values the framework injects without a generator.

Both are **skipped** when their parent `v.object` generates JSON Schema — they never appear in `properties`, since they're runtime-only and not part of the JSON contract an LLM or external API consumer reads. Calling `.toJsonSchema()` *directly* on a `v.computed` / `v.managed` validator **throws** (it's a programming error — let the parent object skip them).

## Quick map — "I need to validate…"

| Need | Reach for |
|---|---|
| Email | `v.string().email()` or `v.email()` |
| URL | `v.string().url()` |
| UUID | `v.string().uuid()` (see [`string-methods.md`](./string-methods.md)) |
| Number 0–100 | `v.number().between(0, 100)` |
| Positive integer | `v.int().positive()` |
| One of N constants | `v.literal(...values)` |
| One of TS enum values | `v.enum(MyEnum)` |
| Date in the past | `v.date().past()` |
| File upload | `v.instanceof(File)` |
| Class instance (not Date) | `v.instanceof(Ctor)` |
| Discriminated union | see [`@warlock.js/seal/define-structural-shape/SKILL.md`](@warlock.js/seal/define-structural-shape/SKILL.md) |
| Derived value (computed from siblings) | `v.computed<T>(callback)` |
| Framework-injected value | `v.managed<T>(callback)` |
| Free-form / pass-through | `v.any()` (only when you've thought about it) |

## Method-surface reference

Each primitive's full method list lives in a sibling file:

- [`string-methods.md`](./string-methods.md) — `.email` / `.url` / `.uuid` / `.pattern` / `.startsWith` / `.alpha` / `.trim` / `.slug` / `.mask` / `.base64Encode` / …
- [`number-methods.md`](./number-methods.md) — `.min` / `.max` / `.between` / `.greaterThan` / `.positive` / `.even` / `.multipleOf` / `.minSibling` / `.round` / …
- [`date-methods.md`](./date-methods.md) — `.min` / `.before` / `.after` / `.today` / `.past` / `.future` / `.weekDay` / `.minAge` / `.year` / `.quarter` / `.toISOString` / …
- [`boolean-methods.md`](./boolean-methods.md) — `.accepted` / `.declined` / `.mustBeTrue` / `.mustBeFalse` / `.acceptedIf` / `.declinedWithout` / …

For cross-cutting modifiers (`.optional`/`.nullable`/`.default`/`.catch`/`.in`/`.oneOf`), see [`@warlock.js/seal/compose-seal-modifiers/SKILL.md`](@warlock.js/seal/compose-seal-modifiers/SKILL.md). For containers (object/array/record/tuple/union), see [`@warlock.js/seal/define-structural-shape/SKILL.md`](@warlock.js/seal/define-structural-shape/SKILL.md).

## Things NOT to do

- Don't `new ObjectValidator()` (or any class) directly — factory returns carry the StandardSchema bridge that bare instantiation loses.
- Don't pick `v.scalar` because "it's flexible". Flexibility at this layer usually means a missing discriminator — try `v.literal` or `v.union` first.
- Don't reach for `v.instanceof(Date)` when `v.date()` works. The latter is purpose-built.
- Don't use `v.string().oneOf(["a", "b"])` for discriminator fields where you need the literal type — use `v.literal("a", "b")`.
- Don't expect `v.computed` / `v.managed` to validate input — they ignore input shape entirely. Reach for them only when *producing* a value.

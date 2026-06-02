---
title: "Primitives"
description: The leaf validators on the v factory — strings, numbers, booleans, dates, literals, enums, instanceof, computed/managed, any.
sidebar:
  order: 1
  label: "Primitives"
---

Primitives are the leaf validators — the ones you reach for when a field holds a single value (not an object, array, or union). Every primitive comes off the `v` factory.

```ts
import { v } from "@warlock.js/seal";

v.string();       // any string
v.int();          // integer (rejects 1.5)
v.boolean();      // true / false
v.date();         // Date — accepts string / timestamp, normalizes to Date
v.literal("a");   // type: "a"
```

Each call returns a fresh, immutable validator. Chain methods (`.email()`, `.min(3)`, `.optional()`) return a clone — the original is unchanged.

## Strings

```ts
v.string()            // any string
v.string().email()    // RFC-compliant email
v.string().url()      // valid URL
v.string().uuid(4)    // UUID v4 specifically
v.string().min(3)     // length ≥ 3
v.string().max(50)    // length ≤ 50
v.string().regex(/^[a-z]+$/)
```

`v.email()` is a shortcut for `v.string().email()` — switch to the full chain when you need extra rules.

```ts
v.email()                        // same as v.string().email()
v.string().email().min(5)        // when you need more than just the format
```

The string surface is broad — slug normalization, mask, base64 encode/decode, HTML escape, trim variants, case conversions (`.uppercase()`, `.camelCase()`, `.kebabCase()`). The full method list is in the [API reference](../reference/api.md).

## Numbers — pick by what you accept

Four number validators, differing only in what they accept as input:

| Validator | Accepts | Use when |
| --- | --- | --- |
| `v.number()` | any finite number | accepts both integers and floats |
| `v.int()` | integers only | rejects `1.5` |
| `v.float()` | finite non-integers | rejects `1` |
| `v.numeric()` | numeric strings + numbers | form/query inputs that arrive as `"42"` |

`v.numeric()` is the one that handles `"42"` from a query string — it coerces to a number before rules run. The others reject non-number inputs.

All four share the same chain surface — `.min(0)`, `.max(100)`, `.between(0, 100)`, `.positive()`, `.negative()`, `.multipleOf(5)`, `.even()`, `.odd()`.

## Booleans

```ts
v.boolean()             // strict true / false
v.boolean().accepted()  // accepts truthy form values ("on", "yes", "1", true, 1)
v.boolean().declined()  // opposite
```

`.accepted()` / `.declined()` exist for form-style inputs where the wire format is a string. For JSON APIs where the client sends a real boolean, plain `v.boolean()` is enough.

## Scalars

```ts
v.scalar()  // string | number | boolean
```

Reach for `v.scalar()` only when a field genuinely accepts all three primitives. Most of the time "I want it to be flexible" is a missing discriminator — `v.literal(...)` or `v.union([...])` reads cleaner.

## Dates

```ts
v.date()                    // type: Date — normalizes strings/timestamps to Date
v.date().past()             // before now
v.date().future()           // after now
v.date().min("2024-01-01")  // not before
v.date().max("2024-12-31")  // not after
v.date().weekDay()          // Mon-Fri
v.date().minAge(18)         // at least 18 years before today
```

`v.date()` ships a built-in mutator that parses string inputs (`"2024-01-01"`, `"2024-01-01T10:00:00Z"`) and timestamps to `Date` objects. By the time rules run, the value is a real `Date`. The post-validation type is `Date`.

For raw `instanceof Date` with no coercion, use `v.instanceof(Date)` — but `v.date()` is the right tool 99% of the time.

## Literals

```ts
v.literal("items")                          // type: "items"
v.literal("draft", "published", "archived") // type: "draft" | "published" | "archived"
v.literal(1, 2, 3)                          // type: 1 | 2 | 3
v.literal(true)                             // type: true
```

`v.literal(...)` narrows to the **literal union**, not the wider primitive type. Compare:

```ts
v.string().oneOf(["a", "b"])  // type: string — literal info lost
v.literal("a", "b")           // type: "a" | "b" — literal preserved
v.enum(["a", "b"])            // type: string — array form, same as oneOf
v.enum(MyTSEnum)              // type: enum's value type — accepts a TS enum
```

Use `v.literal(...)` for discriminator fields where the literal type matters at the call site (TypeScript narrowing inside `if (x.role === "admin")` blocks). Use `v.enum(...)` when the values come from an array or a TS enum object and the broader primitive type is fine.

## Instances

```ts
v.instanceof(File)       // type: File
v.instanceof(Buffer)     // type: Buffer
v.instanceof(MyClass)    // type: MyClass
```

For File uploads, Buffers, Uint8Arrays, or custom class instances. The JSON Schema output is `{}` (not representable) — for OpenAPI `File`, attach `{ type: "string", format: "binary" }` manually after generation.

## Derived values — `v.computed` and `v.managed`

These two **don't validate input** — they produce a value as part of validation.

```ts
v.object({
  firstName: v.string(),
  lastName: v.string(),
  fullName: v.computed<string>(({ firstName, lastName }) =>
    `${firstName} ${lastName}`
  ),
  createdAt: v.managed<Date>(() => new Date()),
  createdBy: v.managed<string>(({ user }) => user.id),
});
```

- **`v.computed`** runs *after* sibling validation; its callback receives the validated `data` plus the `SchemaContext`. Use for derived values — full name, hash of fields, computed totals.
- **`v.managed`** runs from `SchemaContext` only — no sibling data. Use for framework-injected values: timestamps, current user, request id.

Both produce `{}` from `toJsonSchema()` — they're runtime-only, not part of the JSON contract an LLM or OpenAPI consumer reads.

## Escape hatch — `v.any`

```ts
v.any()  // type: any — skips validation entirely
```

Reach for it when you genuinely don't care about the shape. Usually a smell — a real schema would catch a class of bugs. If you use it, leave a comment explaining why.

## Quick map

| Need | Reach for |
| --- | --- |
| Email | `v.string().email()` or `v.email()` |
| URL | `v.string().url()` |
| UUID | `v.string().uuid()` |
| Number 0–100 | `v.number().between(0, 100)` |
| Positive integer | `v.int().positive()` |
| One of N constants | `v.literal(...values)` |
| One of TS enum values | `v.enum(MyEnum)` |
| Date in the past | `v.date().past()` |
| File upload | `v.instanceof(File)` |
| Derived value | `v.computed<T>(callback)` |
| Framework-injected value | `v.managed<T>(callback)` |
| Free-form pass-through | `v.any()` |

## Related

- [Modifiers](./02-modifiers.md) — the cross-cutting chain methods (`.optional`, `.default`, `.catch`, `.nullable`).
- [Structural shapes](./03-structural-shapes.md) — composing primitives into objects, arrays, unions.
- [Guides → Pick the right primitive](../guides/pick-the-right-primitive.md) — `v.string` vs `v.scalar`, `v.literal` vs `v.enum`, etc.

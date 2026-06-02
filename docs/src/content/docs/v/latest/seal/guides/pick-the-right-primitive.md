---
title: "Pick the right primitive"
description: Decision guide — v.string vs v.scalar, v.literal vs v.enum, v.date vs v.instanceof(Date), v.number vs v.numeric.
sidebar:
  order: 1
  label: "Pick the right primitive"
---

You know you need a leaf validator. The factory has several candidates that look similar at a glance. This guide is the decision tree.

## `v.string()` vs `v.scalar()`

```ts
v.string()  // type: string
v.scalar()  // type: string | number | boolean
```

Reach for `v.string()` for any text input. Reach for `v.scalar()` only when the field genuinely accepts all three primitives — a config value, a query parameter that hasn't been parsed, a polymorphic tag.

Most of the time `v.scalar()` is a smell. "I want it to be flexible" usually means "I haven't decided on the shape yet" or "I have N different cases I should encode explicitly". Try `v.literal(...)` or `v.union([...])` first.

## `v.literal(...)` vs `v.enum(...)` vs `v.string().oneOf([...])`

All three constrain a field to a set of values. They differ in what TypeScript sees.

```ts
v.literal("a", "b")              // type: "a" | "b"     ← literal preserved
v.enum(["a", "b"])               // type: string       ← widened
v.enum(MyTSEnum)                 // type: MyTSEnum     ← enum's value type
v.string().oneOf(["a", "b"])     // type: string       ← widened
```

**Pick `v.literal(...)` when you want TypeScript to narrow.** Discriminator fields, role checks, status fields — places where `if (x.role === "admin")` should narrow the type.

**Pick `v.enum(MyTSEnum)` when the values come from a TS enum.** It calls `Object.values(MyTSEnum)` and produces the enum's value type.

**Pick `v.enum(["a", "b"])` or `v.string().oneOf([...])` when the broader `string` type is fine.** Common when the values are dynamic (loaded from config, computed from a registry) and the constraint is purely runtime.

## `v.number()` vs `v.int()` vs `v.float()` vs `v.numeric()`

Four numeric validators. They differ only in what they accept as input:

| Validator | Accepts | Common use |
| --- | --- | --- |
| `v.number()` | any finite number | JSON body fields that may be int or float |
| `v.int()` | integers only (rejects `1.5`) | counts, ids, ages |
| `v.float()` | finite non-integers (rejects `1`) | rare — usually `v.number()` works |
| `v.numeric()` | numeric strings + numbers | query strings, form values arriving as `"42"` |

The rule surface is identical across all four — `.min()`, `.max()`, `.between()`, `.positive()`, `.multipleOf()`. Picking is about *input acceptance*, not about chain power.

The one that catches people: `v.numeric()` is the form-input choice. It coerces `"42"` to `42` before rules run, so `.min(10)` against `"5"` correctly rejects.

## `v.date()` vs `v.instanceof(Date)`

```ts
v.date()             // type: Date — normalizes strings/timestamps to Date
v.instanceof(Date)   // type: Date — strict instanceof, no coercion
```

`v.date()` is the right tool 99% of the time. It ships a built-in mutator that parses string inputs (`"2024-01-01"`, `"2024-01-01T10:00:00Z"`) and Unix timestamps into `Date` objects. By the time your rules run, the value is a real `Date`.

It also ships a rich rule surface:

```ts
v.date().past()           // before now
v.date().future()         // after now
v.date().min("2024-01-01")
v.date().max("2024-12-31")
v.date().before(otherDate)
v.date().after(otherDate)
v.date().today()          // same calendar day as now
v.date().weekDay()        // Mon-Fri
v.date().weekend()
v.date().businessDay()
v.date().minAge(18)       // at least 18 years ago
v.date().year(2024)
v.date().quarter(1)
```

Reach for `v.instanceof(Date)` only when you specifically need strict instance identity with zero coercion — e.g. you've already parsed the value upstream and want to assert nothing reshaped it.

## `v.boolean()` — the form-input variants

```ts
v.boolean()             // strict true / false only
v.boolean().accepted()  // accepts "on", "yes", "1", true, 1, "true"
v.boolean().declined()  // opposite
```

For JSON APIs where the wire format is a real boolean, plain `v.boolean()` is enough. For HTML form submissions where a checkbox produces `"on"` or `"1"` as a string, `.accepted()` / `.declined()` handle the coercion.

There's also conditional sugar:

```ts
v.boolean().acceptedIf("tier", "premium")   // must be accepted when tier === "premium"
v.boolean().declinedIf("role", "guest")
v.boolean().mustBeTrue()
v.boolean().mustBeFalse()
```

## `v.computed` and `v.managed` — derived values

These two don't validate input — they *produce* a value.

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

**`v.computed<T>(callback)`** runs *after* sibling validation. The callback receives the validated `data` plus the `SchemaContext`. Use for values derived from other fields — full name, hash, computed totals.

**`v.managed<T>(callback)`** runs from `SchemaContext` only — no sibling data. Use for framework-injected values: timestamps, current user, request id, request ip.

Both produce `{}` from `toJsonSchema()`. They're runtime-only — not part of the JSON contract an LLM or OpenAPI consumer reads. Document them in your code, not in the schema.

## `v.instanceof(Ctor)` — File, Buffer, custom classes

```ts
v.instanceof(File)        // type: File
v.instanceof(Buffer)      // type: Buffer
v.instanceof(Uint8Array)  // type: Uint8Array
v.instanceof(MyClass)     // type: MyClass
```

For File uploads, Buffers, byte arrays, and custom class instances. The validator just runs `value instanceof Ctor`.

JSON Schema output is `{}` (class identity isn't expressible). For OpenAPI `File`, attach `{ type: "string", format: "binary" }` manually after generating:

```ts
const schema = v.instanceof(File);
const json = schema.toJsonSchema();
const openapi = { ...json, type: "string", format: "binary" };
```

## `v.any()` — when you really mean it

```ts
v.any()  // type: any — skips validation entirely
```

Sometimes you genuinely don't care. A pass-through field, an arbitrary metadata bag, a freeform `details` payload. `v.any()` is honest about that.

It's usually a smell. Search PRs that introduce it and ask whether a real schema would catch a class of bugs. If the answer is "yes but we don't have time" — fine, leave a comment, file a ticket, move on. If the answer is "no, this really is arbitrary" — ship it.

## Quick map

| Need | Reach for |
| --- | --- |
| Email | `v.email()` or `v.string().email()` |
| URL | `v.string().url()` |
| UUID | `v.string().uuid()` (or `.uuid(4)`, `.uuid(7)`) |
| Number 0–100 | `v.number().between(0, 100)` |
| Positive integer | `v.int().positive()` |
| Numeric from a query string | `v.numeric().min(0)` |
| One of N string constants | `v.literal(...)` (for narrowing) or `v.enum([...])` (for `string`) |
| TS enum values | `v.enum(MyEnum)` |
| Date in the past | `v.date().past()` |
| File upload | `v.instanceof(File)` |
| Class instance (not Date) | `v.instanceof(Ctor)` |
| Discriminated union | `v.discriminatedUnion(key, [...])` (see [Structural shapes](../essentials/03-structural-shapes.md)) |
| Derived value (computed from siblings) | `v.computed<T>(callback)` |
| Framework-injected value | `v.managed<T>(callback)` |
| Free-form pass-through | `v.any()` (only when you've thought about it) |

## Related

- [Essentials → Primitives](../essentials/01-primitives.md) — the full primitive reference.
- [Essentials → Structural shapes](../essentials/03-structural-shapes.md) — `v.object`, `v.array`, `v.union`, `v.discriminatedUnion`, `v.lazy`.
- [Recipe → ID validation](../recipes/id-validation.md) — picking between UUID / ULID / CUID / nanoid.

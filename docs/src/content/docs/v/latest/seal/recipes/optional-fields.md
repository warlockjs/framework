---
title: "Optional fields, defaults, fallbacks, and the absent-vs-empty distinction"
sidebar:
  order: 2
  label: "Optional fields"
---

You've written a schema. Some fields are mandatory. Others are not. Seal gives you four knobs to express different flavours of "not mandatory" — `.optional()`, `.default(x)`, `.catch(y)`, and `.nullable()` — and each one means something subtly different. The differences only matter when you start asking questions like "what does the validated output actually look like when the caller didn't send this field?" — but once you ship your first HTTP route they matter a lot. This recipe answers them head-on.

## The four knobs

```ts
import { v, validate, type Infer } from "@warlock.js/seal";

const schema = v.object({
  // 1. Optional — absent input is fine. No rules run on absent input.
  bio: v.string().optional(),

  // 2. Default — absent input becomes the default. Rules then run on the default.
  status: v.string().in(["active", "inactive"]).optional().default("active"),

  // 3. Catch — invalid input becomes the fallback. Errors are swallowed.
  retries: v.int().min(0).catch(3),

  // 4. Nullable — null is an explicit, valid value (orthogonal to optional).
  deletedAt: v.date().nullable(),
});
```

Required is the implicit base case — every field inside `v.object(…)` is required unless you mark it otherwise. Skip writing `.required()`; the canonical seal style relies on `.optional()` standing out.

Sugar: `.nullish()` ≡ `.optional().nullable()` (key may be absent OR null).

## Default fires on absent, catch fires on invalid

The two pipeline mechanisms rescue different failure modes:

```ts
// .default(x) — fires when input is ABSENT
v.string().optional().default("guest")
//   {}              → { x: "guest" }
//   { x: "alice" }  → { x: "alice" }    ← caller wins
//   { x: 123 }      → ERROR             ← rules still run on present input

// .catch(y) — fires when input is PRESENT but INVALID
v.string().email().catch("noreply@example.com")
//   { x: "bad" }    → { x: "noreply@example.com" }   ← email rule failed, catch rescued
//   {}              → ERROR                          ← required, no default to rescue absence

// Combine them for "rescue both" semantics
v.string().email().optional().default("a@b.com").catch("noreply@example.com")
//   {}              → { x: "a@b.com" }              ← default fires
//   { x: "bad" }    → { x: "noreply@example.com" }  ← catch fires
//   { x: "ok@a.b" } → { x: "ok@a.b" }               ← caller wins
```

The decision tree:

| Want this | Use |
| --- | --- |
| Caller may omit; we don't care | `.optional()` |
| Caller may omit; we fill with a default | `.optional().default(x)` |
| Caller may send invalid data; rescue with a fallback | `.catch(y)` |
| Caller may omit OR send invalid; rescue either way | `.optional().default(x).catch(y)` |
| `null` is a meaningful value | `.nullable()` (combine with optional if absent is also allowed, or use `.nullish()`) |
| Required, but rescue any failure | `.catch(y)` (rescues "missing required" too) |

## Absent vs present-empty — they are not the same

This is the bit that trips people up. Consider:

```ts
const schema = v.object({
  tags: v.array(v.string()).optional(),
});
```

Two payloads, two different validated outputs:

```ts
// Payload A — caller never mentioned `tags`
const a = await validate(schema, { });
a.data
// → {}
// `tags` is OMITTED. Not `undefined`-valued — the key isn't there at all.
// `"tags" in a.data === false`

// Payload B — caller explicitly cleared `tags` to []
const b = await validate(schema, { tags: [] });
b.data
// → { tags: [] }
// `tags` IS there, just empty. The intent ("I deliberately have no tags")
// is preserved.
```

This distinction sounds academic until you store the result. With the absent payload, your Mongo document has no `tags` field, so `db.collection.find({ tags: { $exists: false } })` finds it. With the present-empty payload, the document has `tags: []`, so the same query misses it. Two different states. Seal preserves both faithfully.

The same rule applies to records, tuples, strings, numbers — every validator type. Absent stays absent; empty stays empty.

## `Infer<>` vs `Infer.Input<>` vs `Infer.Output<>`

Once you start mixing `.default()` / `.catch()` / `.optional()`, the inferred type splits in two:

```ts
const schema = v.object({
  bio: v.string().optional(),
  status: v.string().optional().default("active"),
  retries: v.int().catch(3),
  deletedAt: v.date().nullable(),
});

type In  = Infer.Input<typeof schema>;
// {
//   bio?:       string;
//   status?:    string;       ← default → caller may omit
//   retries?:   number;       ← catch   → caller may omit
//   deletedAt:  Date | null;
// }

type Out = Infer.Output<typeof schema>;
// {
//   bio?:       string;
//   status:     string;       ← default fired → required
//   retries:    number;       ← catch rescued → required
//   deletedAt:  Date | null;
// }

type Default = Infer<typeof schema>;
// Equivalent to Infer.Input<typeof schema>
```

**Pick by use case:**
- **HTTP request body, form payload, DTO, anything pre-validation** → bare `Infer<>` or `Infer.Input<>`
- **Cascade `Model<>` params, validated state, post-`validate()` data** → `Infer.Output<>`

Both widen with `| null` when `.nullable()` is set.

## Defaults still run through rules

`.default(x)` is **not** a fallback for "if validation fails, use x" — that's `.catch()`. It's a fallback for "if input is absent, treat it as if it were x — then run all the rules". This catches people:

```ts
const schema = v.object({
  username: v.string().min(3).optional().default("a"),
});

await validate(schema, { });
// → { isValid: false, errors: [{ type: "min", error: "…", input: "username" }] }
// "a" failed `min(3)`.
```

If you want a default that's guaranteed to satisfy the rules, make sure the value satisfies them. Or pair with `.catch()` if you want belt-and-suspenders.

For values that should be fresh per validation (timestamps, ids), pass a callback:

```ts
v.date().optional().default(() => new Date())
// or the sugar:
v.date().optional().defaultNow()
```

The callback runs every time `validate()` is called against an absent input, so each validation gets a unique value. A bare `.default(new Date())` would freeze a single timestamp at schema-definition time — almost never what you want.

## `.catch()` is leaf-only in v1

Catch is honoured on **leaf validators** (string, number, boolean, date, …) and for fields inside containers. It is a **no-op on container validators themselves** (`v.object`, `v.array`, `v.record`, `v.tuple`, `v.discriminatedUnion`):

```ts
// ✅ Works — catch on a leaf field inside an object
v.object({
  retries: v.int().catch(3),       // retries.validate() goes through the catch hook
})

// ❌ No-op — catch on the container itself
v.object({...}).catch({})           // never fires; the container's iteration bypasses the hook
```

To rescue a whole-container failure, wrap the `validate()` call site in your own try/catch instead. Container-level catch is on the roadmap for a future minor version.

## The callback variant lets you log

`.catch(fallback)` accepts a value **or** a callback `(errors, originalInput) => fallback`. The callback is the only side-channel for the swallowed errors — use it when silently substituting feels wrong:

```ts
v.object({
  user_id: v.string().uuid().catch((errors, input) => {
    log.warn(`bad user_id: ${JSON.stringify(input)}`, { errors });
    return ANONYMOUS_USER_ID;
  }),
});
```

For LLM output parsing, third-party API responses, or stale schema migrations, this is the lever — substitute a known-good value AND keep observability.

## Quick reference — what comes back

For a field declared as `v.string().optional()` inside `v.object(…)`:

| Input | `data` |
| --- | --- |
| `{}` (absent) | `{}` — key omitted |
| `{ field: undefined }` | `{}` — key omitted |
| `{ field: "" }` | `{ field: "" }` |
| `{ field: "x" }` | `{ field: "x" }` |
| `{ field: null }` | `{}` — key omitted (on an **optional** field `null` coalesces to empty; use `.nullable()` if you want `null` to survive as a value) |

For `v.string().optional().default("x")`:

| Input | `data` |
| --- | --- |
| `{}` | `{ field: "x" }` |
| `{ field: "y" }` | `{ field: "y" }` |
| `{ field: undefined }` | `{ field: "x" }` |

For `v.string().email().catch("noreply@example.com")`:

| Input | `data` |
| --- | --- |
| `{}` | error (required, no default; catch doesn't rescue absence here) |
| `{ field: "bad" }` | `{ field: "noreply@example.com" }` |
| `{ field: "ok@a.b" }` | `{ field: "ok@a.b" }` |

For `v.string().optional().nullable()` (or `v.string().nullish()`):

| Input | `data` |
| --- | --- |
| `{}` | `{}` — key omitted |
| `{ field: null }` | `{ field: null }` |
| `{ field: "x" }` | `{ field: "x" }` |

The pattern generalises to every validator type. Absent never produces a synthesized value (use `.default()`); invalid never produces a synthesized value (use `.catch()`); nullable opens up an explicit `null` slot orthogonal to either.

## Related

- [Essentials → Modifiers](../essentials/02-modifiers.md) — the full pipeline (default → mutators → required check → rules → transformers → catch)
- [Essentials → Inferring types](../essentials/04-inferring-types.md) — `Infer.Input` vs `Infer.Output`
- [Guides → Compose modifiers](../guides/compose-modifiers.md) — task-shaped patterns for `.optional` / `.default` / `.catch`

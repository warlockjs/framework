---
name: use-model-transformers
description: 'Three schema-side helpers — `useHashedPassword()` (bcrypt on save) attaches via `.addTransformer(...)`; `useComputedSlug(field?, scope?)` (auto-slug from another field) and `useComputedModel(callback)` (arbitrary computed-on-save value) attach via `v.computed(...)`. Triggers: `useHashedPassword`, `useComputedSlug`, `useComputedModel`, `.addTransformer`, `v.computed`, `ComputedCallback`; "auto-hash a password field", "auto-slug from title on save", "derive a value at write time", "declarative model transformers"; typical import `import { useHashedPassword, useComputedSlug } from "@warlock.js/core"`. Skip: bcrypt setup details — `@warlock.js/core/hash-password/SKILL.md`; repository writes — `@warlock.js/core/use-repository/SKILL.md`; output filtering — `@warlock.js/core/define-resource/SKILL.md`; competing patterns: manual `await hashPassword(input)` in services, ORM lifecycle hooks.'
---

# Warlock — declare model transformers

Three helpers in `@warlock.js/core` plug into Seal schemas to compute or mutate a field at write time. They sit between "controllers + services" (the mutable-input layer) and "the database row" (the stored state) — so the value the DB sees is always derived, even if the caller didn't think about it.

| Helper | Job | Attaches via | Behavior |
| --- | --- | --- | --- |
| `useHashedPassword()` | bcrypt-hash a password field on save | `.addTransformer(useHashedPassword())` on the field | Hash on new row; hash on change; pass through on no-change |
| `useComputedSlug(field?, scope?)` | Derive a slug from another field | `v.computed(useComputedSlug("title"))` | Compute on every save where the source field is set |
| `useComputedModel(callback)` | Any custom derived value | `v.computed(useComputedModel(...))` | Runs your callback with `(data, model, context)` |

All three are imported from `@warlock.js/core` (despite living in `src/database/utils.ts` under the hood).

**Why the split:** `useHashedPassword()` returns a Seal `TransformerCallback` (built via cascade's `useModelTransformer`), so it mutates the field's own value through `.addTransformer(...)`. `useComputedSlug()` / `useComputedModel()` return a Seal `ComputedCallback` (signature `(data, context)`) — those are wired with the `v.computed(...)` field validator, **not** `.addTransformer(...)`. Passing a computed helper to `.addTransformer(...)` is wrong: the second argument shapes differ (`{ options, context }` vs bare `context`), so it misbehaves at runtime.

## The shape

```ts title="src/app/users/models/user/user.model.ts"
import { useHashedPassword } from "@warlock.js/core";
import { type Infer, v } from "@warlock.js/seal";

export const userSchema = v.object({
  email: v.email().unique("User"),
  password: v.string().requiredIfEmpty("id").addTransformer(useHashedPassword()),
});

export type UserSchema = Infer<typeof userSchema>;
```

```ts title="src/app/articles/models/article/article.model.ts"
import { useComputedSlug } from "@warlock.js/core";
import { type Infer, v } from "@warlock.js/seal";

export const articleSchema = v.object({
  title: v.string(),
  slug: v.computed(useComputedSlug("title")),
});

export type ArticleSchema = Infer<typeof articleSchema>;
```

Two attachments, two completely different behaviors — `useHashedPassword()` rides on `.addTransformer(...)` (it mutates the field), while `useComputedSlug()` rides on `v.computed(...)` (it derives the field).

## `useHashedPassword()` — bcrypt on save

```ts
password: v.string().addTransformer(useHashedPassword()),
```

What it does at save time:

| Situation                       | Behavior                                    |
| ------------------------------- | ------------------------------------------- |
| New row, password set           | Hash the value before insert.               |
| Existing row, password changed  | Re-hash the new value.                      |
| Existing row, password unchanged | Pass through (no re-hashing — stored hash preserved). |
| Empty / undefined value         | Pass through untouched.                     |

Calls `authService.hashPassword(String(value))` under the hood — same bcryptjs path as the standalone `hashPassword()` helper. See [`hash-password/SKILL.md`](../hash-password/SKILL.md) for full bcrypt setup (salt rounds, `yarn add bcryptjs`).

### Why declarative wins

Without the transformer, every code path that writes a password has to remember:

```ts
await User.create({
  email: input.email,
  password: await hashPassword(input.password),  // easy to forget
});
```

Forget the hash once — even in a one-off seed or admin tool — and you've stored plaintext. The transformer makes the wrong thing impossible: the field can only end up hashed, no matter who wrote it.

Pass plaintext to `User.create({ password: input.password })` and the transformer handles the rest.

## `useComputedSlug(field?, scope?)` — auto-slug from another field

```ts
slug: v.computed(useComputedSlug("title")),
```

- **`field`** *(default `"title"`)* — the source field name to slugify.
- **`scope`** — `"sibling"` *(default)* or `"global"`. `"sibling"` reads `data[field]` from the same object being saved; `"global"` reads `get(context.allValues, field)` (the root context — useful in nested schemas where the source field lives on a parent).

What it does:

| Situation                          | Behavior                                   |
| ---------------------------------- | ------------------------------------------ |
| Source field has a value           | Return `slugify(value)` — overwrite the slug. |
| Source field is empty / undefined  | Return `model.get(field)` — i.e. the model's existing value for the **source** field (e.g. the stored `title`), not the existing slug. |

So if a caller sets `title: "Hello World"` without touching `slug`, the saved row has `slug: "hello-world"`. If they explicitly set `slug: "custom-handle"` AND leave `title` populated, the computed field **still overwrites** with the slugified title — because the source value is set. (Note the empty-source fallback returns `model.get(field)` keyed by the *source* field name, not the slug — a quirk of the implementation; if `title` is also empty on the model you get whatever the source field holds, which may be `undefined`.)

To allow explicit slug overrides, branch in your service before calling save, or skip the transformer for that one save (model-level mutation).

```ts title="example service — letting the transformer slug"
await Article.create({
  title: "Hello World",
  // slug auto-derived → "hello-world"
});
```

```ts title="example service — manual slug, bypassing"
const article = new Article();
article.set("title", "Hello World");
article.set("slug", "my-custom-handle");
// The transformer still fires and overwrites — to truly bypass,
// store the slug on a separate non-transformed field instead.
await article.save();
```

The slug uses `@mongez/slug` under the hood — sensible defaults (lowercase, hyphenated, ASCII transliteration).

## `useComputedModel(callback)` — arbitrary derived values

The general-purpose computed-value helper. Use it when the value depends on the row in non-trivial ways:

```ts
import { useComputedModel } from "@warlock.js/core";

slug: v.computed(useComputedModel((data, model, context) => {
  // data    — the current schema-level input object
  // model   — the Model instance being saved
  // context — Seal's SchemaContext (allValues, rootContext, etc.)

  return `${data.category}-${slugify(data.title)}`;
})),
```

`useComputedSlug` is implemented on top of `useComputedModel` — they share the same signature. Reach for `useComputedSlug` for the common slug case; reach for `useComputedModel` when you need to combine fields, branch on env, or call out to a service.

### Signature

```ts
type ComputedCallbackModel = (
  data: any,         // the schema input being saved
  model: Model,      // the Cascade model instance
  context: SchemaContext,
) => any | Promise<any>;
```

The callback can be async — return a `Promise<T>` and the schema layer awaits it.

## Patterns

### Hash + computed slug on the same model

```ts
export const userSchema = v.object({
  email: v.email().unique("User"),
  password: v.string().requiredIfEmpty("id").addTransformer(useHashedPassword()),
  display_name: v.string(),
  handle: v.computed(useComputedSlug("display_name")),
});
```

The two attachment kinds coexist — `password` mutates via `.addTransformer(...)`, `handle` derives via `v.computed(...)`. Each fires at save time, independent of the other.

### Derived total from line items

```ts
total: v.computed(useComputedModel((data) => {
  const items = (data.items as Array<{ price: number; quantity: number }>) ?? [];
  return items.reduce((sum, it) => sum + it.price * it.quantity, 0);
})),
```

Whenever `items` is part of the save payload, `total` is overwritten with the computed sum. Callers literally can't set `total` to a wrong value.

### Conditional compute

```ts
status: v.computed(useComputedModel((data, model) => {
  // First save → "draft"
  if (!model.id) return "draft";
  // Subsequent saves → leave the existing status alone
  return model.get("status");
})),
```

Use the `model` argument to branch on "is this a new row or an update."

### Multi-locale slugs

```ts
slug_en: v.computed(useComputedSlug("title_en")),
slug_ar: v.computed(useComputedSlug("title_ar")),
```

One computed field per locale. Cleaner than juggling multi-locale logic in `useComputedModel`.

## When NOT to use a transformer

Transformers live at the **schema layer** — they fire on every `create()` / `save()`. They're not the right tool when:

- **The derived value depends on side effects** (an API call, external lookup, time-bounded data). Do that in a service; service code is testable and observable. A transformer that calls an external API on every save is hard to reason about.
- **You need conditional skipping by caller intent.** Transformers run unconditionally based on the schema. A service-side mutation lets the caller opt in / out per call.
- **The "compute" requires reading other rows.** Possible (await DB lookups), but it puts query latency on the save path. Often better to compute upstream and pass the value in.

Rule of thumb: transformers are for **pure, deterministic** transforms of the row's own fields. Hashing, slugifying, summing, normalizing — yes. Cross-row lookups, network calls, audit-side effects — no.

## Gotchas

- **All three are imported from `@warlock.js/core`.** They live in `src/database/utils.ts` internally, but the public surface is the core package. `.addTransformer(...)` and `v.computed(...)` are Seal's APIs, but these helpers are Warlock's — don't reach into `@warlock.js/cascade` or `@warlock.js/seal` for them.
- **Match the attachment to the helper.** `useHashedPassword()` → `.addTransformer(...)` (it's a `TransformerCallback`). `useComputedSlug()` / `useComputedModel()` → `v.computed(...)` (they're `ComputedCallback`s). Cross-wiring them is a runtime bug, not just a type error.
- **`useHashedPassword` only re-hashes on actual change.** It returns the value unchanged when `!isNew && !isChanged`, where `isChanged` comes from the model's dirty tracking (`model.isDirty(column)`). Save an already-stored hash and the field isn't marked dirty, so it isn't re-hashed.
- **`useComputedSlug` overwrites unconditionally when the source field is present.** Set both `title` and `slug` in one save — the slug derived from `title` wins. When the source is empty it falls back to `model.get(field)` keyed by the **source** field name (not the slug field). To allow user-customized slugs, keep them on a separate field that isn't computed.
- **Computed callbacks run through the save pipeline.** A slow callback (an external API call) blocks every save. Keep them fast and deterministic. They may be async — `v.computed`'s validator awaits the result.
- **`v.computed(...)` is the write-time computed field.** The value is computed during validation and persisted on the row. There is no separate `.compute()` method on a field — `useComputedSlug` / `useComputedModel` produce the `ComputedCallback` you hand to `v.computed(...)`.

## See also

- [`hash-password/SKILL.md`](../hash-password/SKILL.md) — the bcrypt setup that `useHashedPassword` calls under the hood; salt rounds, `yarn add bcryptjs`.
- [`use-repository/SKILL.md`](../use-repository/SKILL.md) — where `create` / `save` calls happen that trigger the transformers.
- [`define-resource/SKILL.md`](../define-resource/SKILL.md) — filtering transformed fields (`password`) out of API responses.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — schema files live in `src/app/<module>/models/<entity>/<entity>.model.ts`.

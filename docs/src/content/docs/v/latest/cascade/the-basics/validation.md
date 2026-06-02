---
title: "Validation"
sidebar:
  order: 5
  label: "Validation"
---

Validation in Cascade lives in **one place**: the model's `static schema`, declared with `v` from `@warlock.js/seal`. The same schema validates inputs at save time, infers your TypeScript type, and describes the table you migrate against. One source of truth, three jobs.

This guide covers the validation half of the schema: when it runs, what shapes errors take, how to add custom rules, how to hook into the pipeline, and the Cascade-specific extras seal gains when you import `@warlock.js/cascade` (the `embed` validator for nested-model storage).

For the full validator vocabulary — `.string()`, `.email()`, `.min()`, `.max()`, `.default()`, `.optional()`, custom rules — see the [seal docs](https://github.com/warlockjs/seal). Cascade doesn't reinvent the API; it just plugs into it.

## Where validation runs

Validation fires automatically inside every `save()` — both inserts and updates. The pipeline:

1. **`validating` event** — emitted before validation runs. Listeners can transform input (hash passwords, normalise emails) before the schema sees it.
2. **Schema validation** — `userSchema.validate(model.data)` runs all the validators on every field.
3. **If invalid** → `DatabaseWriterValidationError` is thrown. The save is aborted. Nothing hits the database.
4. **`validated` event** — emitted after validation succeeds.
5. **Save continues** — `saving`, `creating` / `updating`, driver write, `created` / `updated`, `saved`.

The catch: you don't call `validate(...)` yourself. Cascade does. Your responsibility is **declaring** the schema and **handling** the error if it fires.

## The minimal schema

```ts
import { v, type Infer } from "@warlock.js/seal";

export const userSchema = v.object({
  name: v.string(),
  email: v.string().email(),
  age: v.number().min(0).optional(),
  status: v.enum(["active", "inactive"]).default("active"),
});

type UserSchema = Infer<typeof userSchema>;

@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;
}
```

A couple of properties worth knowing without leaving this page:

- **Fields are required by default.** `v.string()` means "must be a non-empty string." If a field is allowed to be missing or null, chain `.optional()`.
- **Defaults apply during write, not read.** `v.enum([...]).default("active")` fills in `"active"` if the input doesn't have `status`. The model after save has `status` set; subsequent reads see the value, not the default-source.

## What an invalid save looks like

```ts
try {
  await User.create({ name: "", email: "not-an-email" });
} catch (err) {
  if (err instanceof DatabaseWriterValidationError) {
    console.log(err.errors);
    // → [
    //     { input: "name",  error: "name is required",     rule: "required" },
    //     { input: "email", error: "email must be valid",  rule: "email" },
    //   ]
  }
}
```

`DatabaseWriterValidationError` extends `Error` and carries:

- **`errors`** — an array of `{ input, error, rule, type?, value? }` entries. One per failing rule, one or more per field.
- **`getFieldErrors(path)`** — filter errors by field path.
- **`hasFieldError(path)`** — quick boolean check.
- **`toString()`** — a coloured, formatted dump suitable for `console.log` during development.

The error is *thrown*, not returned. If you want the validation result without committing to a save, call `userSchema.validate(data)` directly — that gives you the seal-native `ValidationResult` shape without the throw.

## Catching validation in HTTP controllers

The pattern most apps end up with:

```ts
try {
  const user = await User.create(req.body);
  return res.json(user);
} catch (err) {
  if (err instanceof DatabaseWriterValidationError) {
    return res.status(422).json({
      message: "Validation failed",
      errors: err.errors.map(e => ({
        field: e.input,
        message: e.error,
        rule: e.rule,
      })),
    });
  }
  throw err;
}
```

Standardise the error shape once at the framework level (middleware, exception filter, whatever your stack calls it) and your controllers stay clean.

## Hooking validation with events

### `onValidating` — transform input before validation

```ts
User.events().onValidating(async user => {
  // Normalise email before the .email() validator sees it
  const email = user.get("email");
  if (typeof email === "string") {
    user.set("email", email.trim().toLowerCase());
  }
});
```

The listener runs before `userSchema.validate(...)`, so any normalisation you do here is what the validators see. Useful for trimming, lowercasing, hashing passwords, attaching default-from-context values.

### `onValidated` — post-validation hook

```ts
User.events().onValidated(async user => {
  // Schema passed; do anything that depends on a clean payload
});
```

Less commonly used than `onValidating`. Reach for it when you need a guarantee the data is shaped correctly before you compute something derived.

### Vetoing a save with custom logic

```ts
User.events().onValidating(async user => {
  if (user.isDirty("email")) {
    const existing = await User.where("email", user.get("email")).first();
    if (existing && existing.id !== user.id) {
      throw new Error("Email already in use");
    }
  }
});
```

Throwing inside `onValidating` aborts the save with whatever error you threw. For form errors that should join the `DatabaseWriterValidationError.errors[]` array, see "Async validation rules" below — that's the more idiomatic shape.

## Database-aware rules — `unique` and `exists`

For checks that need the database — *"is this email already in use?"*, *"does this `category_id` actually exist?"* — Cascade ships two database-aware seal validators you chain like any other:

```ts
export const userSchema = v.object({
  name: v.string(),
  email: v.email().unique("User"),
  organization_id: v.string().exists("Organization"),
});
```

What each does:

- **`.unique(Model | "ModelName", options?)`** — fails validation if a record on `Model` already has the value you're trying to save. By default it checks the column with the same name as the field being validated; override with `{ column: "..." }`.
- **`.exists(Model | "ModelName", options?)`** — fails validation if no record on `Model` has the value. The mirror of `unique` — useful for foreign-key-style checks at the validation layer (catch the bad reference before the insert blows up). Defaults to looking up by the related model's primary key; override with `{ column: "slug" }` to point at a different unique column.

Both rules accept the **registered model name** (`"User"`, `"Organization"`) or the **model class directly** (`User`, `Organization`). Use the string form when you'd hit a circular import otherwise; use the class form when the import is clean.

Both rules run inside the regular validation pass; failures join `DatabaseWriterValidationError.errors[]` alongside `required` / `email` / etc. Same error handling downstream.

### Excluding the current record on update

The classic gotcha with `unique`: on update, the row being updated will match itself, and the rule false-fails. Pass `except` to exclude it:

```ts
email: v.email().unique("User", { except: "id" }),
```

`except: "id"` tells the rule to read the `id` field off the same payload and exclude that record from the uniqueness check. On insert (no `id` present yet), `except` is ignored — only update flows trigger the exclusion.

For request-context-aware exclusions (e.g., "unique except for the currently-authenticated user"), Core ships request-aware wrappers (`uniqueExceptCurrentUser`, etc.) that delegate to the base `unique` rule with the context pre-injected. Reach for those when you're inside an HTTP context; reach for `.unique("User", { except: "id" })` for the framework-agnostic pattern.

### Custom query refinement

Both rules accept a `query` callback to add conditions before the lookup runs:

```ts
slug: v.string().unique("Post", {
  query: ({ query }) => query.where("status", "published"),
}),
```

Slug only needs to be unique among *published* posts — drafts can share. The callback receives the in-progress query builder, the value being validated, and the rest of the input object, so you can branch on whatever context you need.

## Writing your own custom rules

For checks beyond unique/exists — cross-field validation, third-party API calls, computed-value rules — write a plain seal rule:

```ts
import { type SchemaRule, invalidRule, VALID_RULE } from "@warlock.js/seal";

export const futureDate: SchemaRule = {
  name: "futureDate",
  defaultErrorMessage: "The :input must be in the future",
  async validate(value, context) {
    if (!(value instanceof Date)) return invalidRule(this, context);
    if (value.getTime() <= Date.now()) return invalidRule(this, context);
    return VALID_RULE;
  },
};

// Then on the schema:
export const eventSchema = v.object({
  startsAt: v.date().addRule(futureDate),
});
```

Custom rules run inside the same pipeline — errors join `DatabaseWriterValidationError.errors[]`, async is fully supported, the seal API is plain TypeScript with no Cascade-specific decorations.

## The `embed` validator — Cascade-only

Cascade ships one validator on top of the seal vocabulary: `v.embed()`. It's for fields that store another **model** inline (rather than as a foreign-key reference):

```ts
import { v } from "@warlock.js/seal";
import "@warlock.js/cascade"; // registers the embed plugin

export const orderSchema = v.object({
  user: v.embed().model("User"),         // single embedded user document
  items: v.embed().models("OrderItem"),   // array of embedded order-item docs
});
```

What it does:

- **At write time** — accepts a `User` instance or a primary-key value; resolves to the full embedded model representation. Useful for snapshotting "the user as they were at order time" so later edits to the live user don't rewrite history.
- **At read time** — the field comes back as a hydrated `User` model instance (or array of `OrderItem` instances).

When to reach for it: **document-style** denormalisation where you specifically want to *embed* (not reference) another model. Most apps use foreign keys + relations (covered in the [Relationships essentials](../the-basics/03-relationships.md)) and never need `embed`; reach for it when you've decided a column should hold a snapshot.

## Where to put schema declarations

Conventions, not rules — Cascade doesn't care where the schema is defined as long as it's set on `Model.schema`. The patterns that work well:

- **Co-located with the model** — `user.model.ts` exports both `userSchema` and `User`. Most apps stop here.
- **Composed from shared fragments** — extract repeated shapes (address, money, audit fields) into shared seal validators and reuse them across models. Seal supports this natively via plain TypeScript composition.
- **Schemas re-exported for non-model uses** — `userSchema` is just a seal validator; you can validate API request bodies with it the same way you validate model writes. One declaration, multiple call sites.

## Going further

- **The full seal validator API** (operators, rules, transformers, mutators): [seal docs](https://github.com/warlockjs/seal)
- **Events around validation** — [Events and hooks guide](../architecture-concepts/events-and-hooks.md)
- **Resource shaping for output** (the read-side counterpart): [Resources guide](./resources.md)
- **Embedded vs referenced models** (`v.embed()` vs `belongsTo`): [Relationships essentials](../the-basics/03-relationships.md) (planned deeper coverage in relationships guide)

---
name: define-model
description: 'Define a Cascade model — `@RegisterModel()`, class extends `Model<TSchema>`, `static table`, `static schema`, three update idioms (`.set` / `.merge` / `.save`), `.unset`, `.destroy`, `static toJsonColumns` / `resource` / `static hidden` for output shaping. Covers write safety: `static hidden` fields are ALWAYS stripped from `toJSON()` regardless of `resource`/`toJsonColumns`, cascade warns once per model on an unhidden credential-shaped field, and `merge()` on a persisted model drops identity columns so request data can never retarget an `update()`/`destroy()` at another row. Triggers: `Model`, `RegisterModel`, `static schema`, `.set`, `.merge`, `.save`, `.unset`, `.destroy`, `toJsonColumns`, `resource`, `hidden`, `trustedPrimaryKey`; "how do I define a model", "shape the JSON output", "remove a field", "hide password from response", "prevent id in request body overwriting another row"; typical import `import { Model, RegisterModel } from "@warlock.js/cascade"`. Skip: querying — `@warlock.js/cascade/query-data/SKILL.md`; relations — `@warlock.js/cascade/define-relations/SKILL.md`; competing libs `mongoose`, `prisma`, `typeorm` `@Entity`.'
---

# Define a model

Four moves: schema → class → write → read. Every Cascade model uses the same shape.

## Step 1 — Define the schema

The schema is your single declaration of what a record looks like. Same `v.object` does triple duty later: validates incoming data, infers the TypeScript type, and is the shape your table writes against.

```ts title="src/app/users/models/user/user.model.ts"
import { v, type Infer } from "@warlock.js/seal";

export const userSchema = v.object({
  name: v.string(),
  email: v.string().email(),
  status: v.literal("active", "inactive").default("active"),
});

export type UserSchema = Infer<typeof userSchema>;
```

- Fields are **required by default** — chain `.optional()` on any field that may be missing.
- `Infer<typeof userSchema>` derives the TS type. No second declaration, no drift.
- The schema is standalone — reuse it for HTTP body validation, service-input validation, anywhere else.
- See [`@warlock.js/seal/seal-basics/SKILL.md`](@warlock.js/seal/seal-basics/SKILL.md) for the validator vocabulary.

## Step 2 — Define the model class

```ts
import { Model, RegisterModel } from "@warlock.js/cascade";

@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;
}
```

- `@RegisterModel()` puts `User` in the global registry. That registry is what lets relations look each other up by name.
- `extends Model<UserSchema>` gives the class the entire CRUD/query API typed against your schema.
- `static table` matches the migration. Plural, lowercase, snake_case is the convention on both drivers.
- `static schema` attaches the validator. On every `save()`, the data goes through `userSchema` before it hits the database.

## Read state — `.id`, `.uuid`, and `.get(field)`

```ts
user.id;                   // direct property — ID is so common cascade exposes it directly
user.uuid;                 // the same id, narrowed to `string` (see below)
user.get("status");        // canonical reader for every other column
user.get<number>("age");   // TypeScript generic for typed reads
```

Use the direct `.id` property; use `.get("field")` for everything else. Add a typed getter on the model class when the same field is read in many places — turns N typed-cast call sites into one named accessor.

### `.id` vs `.uuid` — a TypeScript convenience, same value

Both getters return the model's primary id (`this.get("id")`); the only difference is the **static type**:

| Accessor | Return type | Use when |
|---|---|---|
| `model.id` | `string \| number` | You want the real id type — SQL auto-increment is `number`, MongoDB's ObjectId is `string`. |
| `model.uuid` | `string` | You want to pass the id to code typed for a single `string` id, without leaking the engine's `string \| number` union everywhere. |

`uuid` does **not** validate or coerce the value to a UUID — the name is historical. It simply returns the same id, typed as `string`, so a helper typed for a string id accepts it on either engine:

```ts
function shareLink(modelId: string) { /* ... */ }

shareLink(user.uuid);  // ✓ typechecks on both Postgres and MongoDB
shareLink(user.id);    // ✗ TS error on SQL: `number` is not assignable to `string`
```

## Write — three update idioms

Cascade gives you three ways to update an instance. Knowing when each fits saves you from reaching for the wrong one.

### `.set(field, value).save()` — one field change

```ts
await user.set("status", "inactive").save();
```

Direct, reads top to bottom. `.set()` stages; `.save()` persists and fires events.

### `.merge(data).save()` — bulk update from an object

```ts
await user.merge({ name: "Augusta Ada King", status: "active" }).save();
```

The everyday case. Service takes `Partial<UserSchema>` from a request body, merges it into the instance, saves. Existing fields not in the object are untouched.

**Safe against id-retargeting by design.** `model.merge(req.body); await model.save();` is the canonical update-my-profile shape — and `req.body` is attacker-controlled. On an already-persisted model, `merge()` drops identity columns (`id`, `_id`, the configured primary key) instead of applying them, so a body carrying `{ id: "<victim-id>", role: "admin" }` cannot redirect the write onto someone else's row: `update()`/`replace()`/`destroy()` build their filter from `model.trustedPrimaryKey` — the id captured when the instance became persisted (hydration, or right after an insert), never the current in-memory value. Identity columns are also excluded from the `$set`/`$unset` payload, so an explicit `.set("id", …)` on a loaded record doesn't rewrite the key of the row it's pinned to either. This only applies to an *existing* record — `User.create({ id, ... })` with an explicit id is unchanged, since there's no row to retarget yet. If you deliberately need to change a primary key, do it through the atomic/raw APIs (see [`perform-atomic-ops`](@warlock.js/cascade/perform-atomic-ops/SKILL.md)), not `merge()`.

### `.save()` after manual mutation — when changes are spread

```ts
user.set("status", "inactive");

if (someCondition) {
  user.set("online_state", "offline");
}

await user.save();
```

Quick reference:

| Situation | Pattern |
| --- | --- |
| 1–2 specific fields | `user.set(k, v).save()` |
| Bulk from an object | `user.merge(data).save()` |
| After spread mutations | `user.save()` |

## Remove a field — `.unset(field)`

```ts
await user.unset("image").save();
```

`.unset()` marks the field for removal — Postgres sets it to `NULL`, MongoDB drops the field entirely. Different from `.set("image", null)` which stores an explicit null (and may fail validation if the field isn't `.optional()`).

## Delete — `.destroy()`

```ts
await user.destroy();
```

Runs the model's lifecycle (events, configured delete strategy), then removes the record. See [`@warlock.js/cascade/configure-delete-strategy/SKILL.md`](@warlock.js/cascade/configure-delete-strategy/SKILL.md) for soft / hard / trash semantics.

## Public output shaping

`JSON.stringify(user)` calls `model.toJSON()` under the hood. With no configuration, it returns the entire row. **Always configure shaping when the model is returned from an HTTP handler.**

### Fast escape — `static toJsonColumns`

```ts
@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;
  public static toJsonColumns = ["id", "name", "email"];
}
```

Anything outside the allow-list is dropped from serialization. Use when the public shape is a strict subset of the columns.

### Richer path — `static resource`

```ts
class UserResource {
  public constructor(private data: Record<string, unknown>) {}

  public toJSON() {
    return {
      id: this.data.id,
      displayName: this.data.name,
      contactEmail: this.data.email,
      avatar: this.data.image ?? null,
    };
  }
}

@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;
  public static resource = UserResource;
}
```

Plain TypeScript class. No framework dependencies. `static resourceColumns` narrows which columns reach the resource; pair the two for strongly-typed public output.

### Fields that must never serialize — `static hidden`

```ts
@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;
  public static hidden = ["password", "resetToken"];
}
```

`static hidden: string[]` names top-level fields `toJSON()` (and therefore `JSON.stringify(user)` / `res.json(user)`) can **never** emit — stripped whether the model falls back to the raw-document default, uses `toJsonColumns`, or goes through `resource` (hidden wins over all three). Defaults to `[]`, so declaring it is opt-in and nothing changes on an existing model until you add fields — but because that default fails open, cascade logs a one-time `console.warn` per model whose schema declares a credential-shaped column (`password`, `passwordHash`, `secret`, `token`, `apiKey`/`api_key`, case-insensitive) that isn't covered by `hidden`, `resource`, or `toJsonColumns`. Treat that warning as "add this field to `hidden`," not noise to suppress. Prefer `hidden` over remembering to exclude the field from every `toJsonColumns` list by hand — it's enforced regardless of which shaping strategy a given model (or a future refactor) picks.

## Things NOT to do

- Don't `new User()` to create a record — `User.create({...})` validates, persists, fires events.
- Don't `.set("relation_name", instance)` for a relation slot. Use `setRelation("name", instance)`.
- Don't return the raw model from an HTTP route without shaping output. Add `toJsonColumns` or `resource`.
- Don't rely on `toJsonColumns`/`resource` alone to keep a password or token out of responses — declare it in `static hidden` too; that's the one path enforced no matter which shaping strategy is used, and the only one that survives someone adding a second `resource` later.
- Don't `await user.save()` and forget the `await` — your changes live only on the instance and never reach the DB.
- Don't expect schema defaults to apply on `.merge()` — defaults fire on `.create()` only.

## See also

- [`@warlock.js/cascade/query-data/SKILL.md`](@warlock.js/cascade/query-data/SKILL.md) — finding and filtering records
- [`@warlock.js/cascade/define-relations/SKILL.md`](@warlock.js/cascade/define-relations/SKILL.md) — relations and eager loading
- [`@warlock.js/cascade/track-changes/SKILL.md`](@warlock.js/cascade/track-changes/SKILL.md) — dirty tracking
- [`@warlock.js/cascade/subscribe-to-model-events/SKILL.md`](@warlock.js/cascade/subscribe-to-model-events/SKILL.md) — lifecycle hooks

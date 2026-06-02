---
name: cascade-basics
description: 'Start with @warlock.js/cascade ORM — model-first for MongoDB and Postgres, one schema (seal) does triple duty (type / validator / DB shape), model is the query entry point. Triggers: `Model`, `RegisterModel`, `connectToDatabase`, `Infer`, `v.object`; "which cascade skill do I need", "set up the ORM", "define my first model", "model-first ORM"; typical import `import { Model, RegisterModel } from "@warlock.js/cascade"`. Skip: schema vocabulary — `@warlock.js/seal/seal-basics/SKILL.md`; competing libs `mongoose`, `prisma`, `typeorm`, `drizzle`, `sequelize`, `mongodb` driver, `knex`.'
---

# Cascade basics

Model-first TypeScript ORM for MongoDB and Postgres. Query straight off the model — `User.where(...)`, `User.find(id)`, `User.paginate(...)`. One schema (via `@warlock.js/seal`) does triple duty: TS type via `Infer<>`, runtime validator on save, DB shape via the migration.

> This skill is the cascade **map** — read it first, then load the specific skill for the task.

## Install

```bash
yarn add @warlock.js/cascade @warlock.js/seal
```

## Foundations

The 10 things that are true in every cascade use:

1. **The model is the query entry point.** `User.where(...)`, `User.find(id)`, `User.paginate(...)`. No `db.users`, no separate client, no repository layer.
2. **One schema does triple duty.** `userSchema` via `v.object({...})` is your TS type (`Infer<typeof userSchema>`), your runtime validator on save, and the shape your migration writes against. Defined via [`@warlock.js/seal/seal-basics/SKILL.md`](@warlock.js/seal/seal-basics/SKILL.md).
3. **`@RegisterModel()` puts the model in the global registry.** Other models look it up by name for relations (`@BelongsTo("User")` or `@BelongsTo(lazy(() => User))`).
4. **Two drivers ship in-box: MongoDB and Postgres.** Same query API across both. Switch via config; the call sites stay identical.
5. **Migrations are required.** `cascade migrate` runs schema changes; the model class doesn't auto-create tables. See [`@warlock.js/cascade/write-migration/SKILL.md`](@warlock.js/cascade/write-migration/SKILL.md).
6. **`.create()` validates against the schema before persisting.** Defaults (`v.string().default(...)`) fire here. Validation errors throw — see [`@warlock.js/seal/handle-seal-errors/SKILL.md`](@warlock.js/seal/handle-seal-errors/SKILL.md).
7. **Three update idioms — pick by shape.** `.set(k, v).save()` for 1–2 fields, `.merge(data).save()` for object payloads, `.save()` after spread mutations. See [`@warlock.js/cascade/define-model/SKILL.md`](@warlock.js/cascade/define-model/SKILL.md).
8. **`.destroy()` runs the configured delete strategy** (`permanent` / `soft` / `trash`). See [`@warlock.js/cascade/configure-delete-strategy/SKILL.md`](@warlock.js/cascade/configure-delete-strategy/SKILL.md).
9. **Lifecycle events fire on every meaningful moment** — `saving` / `saved`, `creating` / `created`, `deleting` / `deleted`. Hook on the model class. See [`@warlock.js/cascade/subscribe-to-model-events/SKILL.md`](@warlock.js/cascade/subscribe-to-model-events/SKILL.md).
10. **Transactions are first-class.** `transaction(async () => { ... })` wraps a unit; rollback on throw, commit on resolve. See [`@warlock.js/cascade/manage-transactions/SKILL.md`](@warlock.js/cascade/manage-transactions/SKILL.md).

## Minimal example — model, write, read

```ts
import { v, type Infer } from "@warlock.js/seal";
import { Model, RegisterModel } from "@warlock.js/cascade";

const userSchema = v.object({
  name: v.string(),
  email: v.string().email(),
  status: v.literal("active", "inactive").default("active"),
});

type UserSchema = Infer<typeof userSchema>;

@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;
}

// Write
const user = await User.create({ name: "Ada Lovelace", email: "ada@example.com" });
user.id;                  // generated ID — direct property
user.get("status");        // "active" — default fired

// Read
const found = await User.find(user.id);
found?.get("email");       // "ada@example.com"

// Filter
const active = await User.where("status", "active").get();
const page = await User.paginate({ page: 1, limit: 20 });
```

## Pick a skill

| If the task is about… | Load |
| --- | --- |
| Defining a model class — schema, decorators, `Model<TSchema>`, accessors | [`@warlock.js/cascade/define-model/SKILL.md`](@warlock.js/cascade/define-model/SKILL.md) |
| Querying — `.where`, `.find`, `.first`, `.all`, `.count`, `.exists`, ordering | [`@warlock.js/cascade/query-data/SKILL.md`](@warlock.js/cascade/query-data/SKILL.md) |
| Pagination — `.paginate`, `cursorPaginate`, `chunk` | [`@warlock.js/cascade/paginate-results/SKILL.md`](@warlock.js/cascade/paginate-results/SKILL.md) |
| Relations — `belongsTo` / `hasMany` / `belongsToMany`, eager loading | [`@warlock.js/cascade/define-relations/SKILL.md`](@warlock.js/cascade/define-relations/SKILL.md) |
| Migrations — `migration` definition, `up`/`down`, CLI | [`@warlock.js/cascade/write-migration/SKILL.md`](@warlock.js/cascade/write-migration/SKILL.md) |
| Transactions — `transaction(fn)`, rollback, isolation | [`@warlock.js/cascade/manage-transactions/SKILL.md`](@warlock.js/cascade/manage-transactions/SKILL.md) |
| Dirty tracking — `hasChanges`, `isDirty`, `getDirtyColumns`, `getDirtyColumnsWithValues` | [`@warlock.js/cascade/track-changes/SKILL.md`](@warlock.js/cascade/track-changes/SKILL.md) |
| Lifecycle hooks — `saving`, `saved`, `deleting`, `deleted` | [`@warlock.js/cascade/subscribe-to-model-events/SKILL.md`](@warlock.js/cascade/subscribe-to-model-events/SKILL.md) |
| Soft / hard / trash deletes + restore | [`@warlock.js/cascade/configure-delete-strategy/SKILL.md`](@warlock.js/cascade/configure-delete-strategy/SKILL.md) |
| Atomic ops — `Model.increase`, `decrease`, `atomic`, `Model.delete(filter)` | [`@warlock.js/cascade/perform-atomic-ops/SKILL.md`](@warlock.js/cascade/perform-atomic-ops/SKILL.md) |
| Aggregates — `.sum`, `.avg`, `.count`, `.groupBy`, `.having` | [`@warlock.js/cascade/aggregate-data/SKILL.md`](@warlock.js/cascade/aggregate-data/SKILL.md) |
| Vector search — `similarTo`, pgvector / Atlas vector index | [`@warlock.js/cascade/search-by-vector/SKILL.md`](@warlock.js/cascade/search-by-vector/SKILL.md) |
| Multiple databases — `connectToDatabase`, per-model `static dataSource` | [`@warlock.js/cascade/manage-data-sources/SKILL.md`](@warlock.js/cascade/manage-data-sources/SKILL.md) |
| CLI + Operations API — `cascade migrate`, `migrate:rollback`, programmatic | [`@warlock.js/cascade/run-cascade-cli/SKILL.md`](@warlock.js/cascade/run-cascade-cli/SKILL.md) |

## Things NOT to do

- Don't call `new User()` directly to create a record. Use `User.create({...})` — it runs validation, generates IDs, fires events.
- Don't `.set()` a relation slot (e.g. `user.set("contact", contactModel)`). Use `setRelation("contact", contactModel)` — relations have their own slot semantics.
- Don't forget `await` on writes. Without it, the mutation lives on the instance and never reaches the DB.
- Don't reach for `.count() > 0` to test existence. Use `.exists()` / `.notExists()` — short-circuits, doesn't hydrate.
- Don't return the raw model from an HTTP handler. `JSON.stringify(user)` returns the entire row; configure `static toJsonColumns` or `static resource` to shape the public output.
- Don't auto-run migrations from app code. They're a deploy step; run via `cascade migrate` or the Operations API.

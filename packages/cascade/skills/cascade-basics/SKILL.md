---
name: cascade-basics
description: "Start here for @warlock.js/cascade models, data sources, migrations, and query workflows."
---

# Cascade basics

Model-first TypeScript ORM for MongoDB and Postgres. Query straight off the model — `User.where(...)`, `User.find(id)`, `User.paginate(...)`. One schema (via `@warlock.js/seal`) does triple duty: TS type via `Infer<>`, runtime validator on save, DB shape via the migration.

> This skill is the cascade **map** — read it first, then load the specific skill for the task.

Server-only: `package.json` declares `"warlock": { "environment": "server" }`. `@warlock.js/web`'s build refuses app client code that value-imports this package; type-only imports are allowed, and server loaders/controllers/modules are unaffected.

## Install

```bash
npm install @warlock.js/cascade @warlock.js/seal
```

`pg` and `mongodb` are optional peer dependencies — install whichever driver your app actually uses (`npm install pg` for Postgres, `npm install mongodb` for MongoDB); a project that uses neither, or only one, installs no extra driver package.

## Foundations

The 10 things that are true in every cascade use:

1. **The model is the query entry point.** `User.where(...)`, `User.find(id)`, `User.paginate(...)`. No `db.users`, no separate client, no repository layer.
2. **One schema does triple duty.** `userSchema` via `v.object({...})` is your TS type (`Infer<typeof userSchema>`), your runtime validator on save, and the shape your migration writes against. Defined via the `seal-basics` topic of the `warlock-js-seal` skill.
3. **`@RegisterModel()` puts the model in the global registry.** Other models look it up by name for relations (`@BelongsTo("User")` or `@BelongsTo(lazy(() => User))`).
4. **Two drivers ship in-box: MongoDB and Postgres.** Same query API across both. Switch via config; the call sites stay identical.
5. **Migrations are required.** `cascade migrate` runs schema changes; the model class doesn't auto-create tables. See the `write-migration` topic.
6. **`.create()` validates against the schema before persisting.** Defaults (`v.string().default(...)`) fire here. Validation errors throw — see the `handle-seal-errors` topic of the `warlock-js-seal` skill.
7. **Three update idioms — pick by shape.** `.set(k, v).save()` for 1–2 fields, `.merge(data).save()` for object payloads, `.save()` after spread mutations. See the `define-model` topic.
8. **`.destroy()` runs the configured delete strategy** (`permanent` / `soft` / `trash`). See the `configure-delete-strategy` topic.
9. **Lifecycle events fire on every meaningful moment** — `saving` / `saved`, `creating` / `created`, `deleting` / `deleted`. Hook on the model class. See the `subscribe-to-model-events` topic.
10. **Transactions are first-class.** `transaction(async () => { ... })` wraps a unit; rollback on throw, commit on resolve. See the `manage-transactions` topic.

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
| Defining a model class — schema, decorators, `Model<TSchema>`, accessors | The `define-model` topic |
| Querying — `.where`, `.find`, `.first`, `.all`, `.count`, `.exists`, ordering | The `query-data` topic |
| Pagination — `.paginate`, `cursorPaginate`, `chunk` | The `paginate-results` topic |
| Relations — `belongsTo` / `hasMany` / `belongsToMany`, eager loading | The `define-relations` topic |
| Migrations — `migration` definition, `up`/`down`, CLI | The `write-migration` topic |
| Transactions — `transaction(fn)`, rollback, isolation | The `manage-transactions` topic |
| Dirty tracking — `hasChanges`, `isDirty`, `getDirtyColumns`, `getDirtyColumnsWithValues` | The `track-changes` topic |
| Lifecycle hooks — `saving`, `saved`, `deleting`, `deleted` | The `subscribe-to-model-events` topic |
| Soft / hard / trash deletes + restore | The `configure-delete-strategy` topic |
| Atomic ops — `Model.increase`, `decrease`, `atomic`, `Model.delete(filter)` | The `perform-atomic-ops` topic |
| Aggregates — `.sum`, `.avg`, `.count`, `.groupBy`, `.having` | The `aggregate-data` topic |
| Vector search — `similarTo`, pgvector / Atlas vector index | The `search-by-vector` topic |
| Multiple databases — `connectToDatabase`, per-model `static dataSource` | The `manage-data-sources` topic |
| CLI + Operations API — `cascade migrate`, `migrate:rollback`, programmatic | The `run-cascade-cli` topic |

## Things NOT to do

- Don't call `new User()` directly to create a record. Use `User.create({...})` — it runs validation, generates IDs, fires events.
- Don't `.set()` a relation slot (e.g. `user.set("contact", contactModel)`). Use `setRelation("contact", contactModel)` — relations have their own slot semantics.
- Don't forget `await` on writes. Without it, the mutation lives on the instance and never reaches the DB.
- Don't reach for `.count() > 0` to test existence. Use `.exists()` / `.notExists()` — short-circuits, doesn't hydrate.
- Don't return the raw model from an HTTP handler. `JSON.stringify(user)` returns the entire row; configure `static toJsonColumns` or `static resource` to shape the public output.
- Don't auto-run migrations from app code. They're a deploy step; run via `cascade migrate` or the Operations API.

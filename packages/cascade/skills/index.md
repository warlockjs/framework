---
description: "Model-first ORM for MongoDB and Postgres. Exports `Model`, `RegisterModel`, `Migration`, `defineModel`, `BelongsTo`, `HasMany`, `transaction`, `DataSource`, `dataSourceRegistry`, `connectToDatabase`, `runMigrations`. Use for: define a model, add a column or collection, write or alter a migration, query or filter records, paginate, aggregate or group, add a relation, run a transaction, soft delete, track changes, react to save or delete events, vector search. Not this package: request validation and schemas → @warlock.js/seal; routes, controllers, repositories → @warlock.js/core."
---
# @warlock.js/cascade

Cascade is the data layer. The model is the query entry point (`User.find(id)`, `User.paginate(...)`); one seal schema gives the TypeScript type, the save-time validation, and the shape migrations write against. MongoDB and Postgres drivers ship with the same query API. Server-only.

## The 80% path
1. Read `cascade-basics.md` first: it is the map and the ten foundations.
2. Define the model and register it (`define-model.md`), then relations (`define-relations.md`).
3. Write the migration; models never create tables or collections on their own (`write-migration.md`, `alter-migration.md`, run with `run-cascade-cli.md`).
4. Query, paginate, aggregate (`query-data.md`, `paginate-results.md`, `aggregate-data.md`, `perform-atomic-ops.md`).
5. Wrap multi-step writes in a transaction (`manage-transactions.md`); pick a delete strategy (`configure-delete-strategy.md`).
6. Connect and manage drivers (`manage-data-sources.md`); hook lifecycle and diffs (`subscribe-to-model-events.md`, `track-changes.md`); embeddings via `search-by-vector.md`.

## Conventions and pitfalls
- `pg` and `mongodb` are optional peers; install only the driver you use.
- `.create()` validates against the schema, applies defaults, and throws on failure.
- Pick an update idiom by shape: `.set(k, v).save()` for one or two fields, `.merge(data).save()` for payloads.
- `.destroy()` follows the configured strategy (permanent, soft, or trash), not always a hard delete.
- Relations refer to models by registered name, so `@RegisterModel()` must run first.
- Run code needing a live connection through `onceConnected`, not at import time.
- Undefined `where` values and unsafe filters throw on purpose; sanitize user-supplied filters.

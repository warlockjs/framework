# `@warlock.js/cascade` — skills index

Per-task skills. All cross-references use the form `@warlock.js/<pkg>/<skill>/SKILL.md`.

## Skills

### [`aggregate-data/`](./aggregate-data/SKILL.md)

Compute aggregates over a query — `.count()`, `.sum(field)`, `.avg`, `.min`, `.max`, plus the two-arg `.groupBy(fields, { alias: $agg.* })` + `.having` for group-level rollups. Load when building reports, dashboards, 'X per category' rollups, or any query returning numbers rather than rows.

### [`cascade-basics/`](./cascade-basics/SKILL.md)

Start with @warlock.js/cascade ORM — model-first for MongoDB and Postgres, one schema (seal) does triple duty (type / validator / DB shape), model is the query entry point. Load when importing @warlock.js/cascade, wiring connectToDatabase, defining the first model, or choosing which cascade skill to load.

### [`configure-delete-strategy/`](./configure-delete-strategy/SKILL.md)

Pick the delete behavior — `permanent` (hard delete), `soft` (set deletedAt, keep the row), `trash` (move to a separate table). Configure per-model via `static deleteStrategy` or pass `.destroy({ strategy })` per call; restore via static `Model.restore(id)` / `Model.restoreAll()`. Soft-deleted rows are NOT auto-hidden — add a `notDeleted` global scope yourself. Load when records should be reversibly deletable or implementing GDPR hard delete.

### [`define-model/`](./define-model/SKILL.md)

Define a Cascade model — @RegisterModel() decorator, class extends Model<TSchema>, static table, static schema, three update idioms (.set / .merge / .save), .unset, .destroy, static toJsonColumns / resource for output shaping. Load when creating a model file, adding accessors, or shaping serialized output.

### [`define-relations/`](./define-relations/SKILL.md)

Define and query relations — @BelongsTo('Model') / @HasMany('Model') / @BelongsToMany('Model', { pivot, localKey, foreignKey }), .with('relation') eager loading, .whereHas(relation, cb) filter-by-related, setRelation on save, .joinWith for SQL joins, .load(relation) for lazy loading. Load when two models reference each other, avoiding N+1, or filtering parents by child conditions.

### [`manage-data-sources/`](./manage-data-sources/SKILL.md)

Configure multiple databases — register each via `connectToDatabase({ name, driver, database, isDefault })`, assign a model with `static dataSource = 'name'`, pin a migration with `public dataSource`, inspect via `dataSourceRegistry.get(name)` / `getAllDataSources()`. Load when the app talks to more than one database (reporting replica, analytics DB, per-tenant DBs).

### [`manage-transactions/`](./manage-transactions/SKILL.md)

Wrap multi-statement work in transaction(async () => {...}) — rollback on throw or `ctx.rollback()`, commit on resolve, `isolationLevel` option (Postgres). Postgres native, MongoDB requires replica set; not nestable. Load when two or more writes must succeed or fail together (creating parent + children, transferring balances, multi-step state machines).

### [`paginate-results/`](./paginate-results/SKILL.md)

Paginate query results — `.paginate({ page, limit })` for offset (returns `data` + `pagination`), `.cursorPaginate({ limit, cursor })` for very large datasets (cursor fields under `pagination`), `.chunk(size, callback)` for streaming. Load when listing records for a UI, fetching a slice for an API, or processing a large table in batches.

### [`perform-atomic-ops/`](./perform-atomic-ops/SKILL.md)

Avoid races on concurrent writes — Model.increase(filter, field, n) / Model.decrease for atomic counters, Model.atomic(filter, ops) for arbitrary atomic mutations, Model.createMany / Model.findAndUpdate / Model.delete for bulk. Load when incrementing counters under concurrency, bulk ops without N+1, or single-document atomic mutations without a full transaction.

### [`query-data/`](./query-data/SKILL.md)

Query records via the model — .where(field, value) / .where(field, op, value), .find(id) / .first(filter?) / .all(filter?), .count / .exists, plus the broader query-builder vocabulary (.orderBy / .whereIn / .whereBetween / .whereLike / .pluck / .firstOrFail / scopes) via .query() or chained off .where(). Load when filtering, fetching by ID, getting a single match, or ordering.

### [`run-cascade-cli/`](./run-cascade-cli/SKILL.md)

Cascade's standalone CLI binary + programmatic Operations API — cascade migrate / migrate:list / migrate:rollback / migrate:export-sql, plus runMigrations / rollbackMigrations / freshMigrate / exportMigrationsSQL / listExecutedMigrations / migrationRunner functions. Load when applying migrations during deploy, resetting DB for test setup, or programmatic migration ops from a custom script.

### [`search-by-vector/`](./search-by-vector/SKILL.md)

Vector similarity search via `.similarTo(column, embedding, alias?)` — adds a `score` column, orders by distance for index usage, cap with `.limit()`. Postgres uses pgvector (IVFFlat index via `this.vectorIndex`); MongoDB uses Atlas. Load when building semantic search, RAG retrieval against documents, hybrid (vector + full-text) search, or 'find records most similar to this vector'.

### [`subscribe-to-model-events/`](./subscribe-to-model-events/SKILL.md)

Hook into model lifecycle events — `saving` / `saved`, `creating` / `created`, `updating` / `updated`, `validating` / `validated`, `deleting` / `deleted`, `restoring` / `restored`, `fetching` / `fetched`. The gerund form is the "before" hook (no `beforeSave` alias). Per-model `Model.on` or global. Load when wiring an audit log, sending notifications on changes, or denormalizing into a search index.

### [`track-changes/`](./track-changes/SKILL.md)

Inspect a model's pending changes — `hasChanges()`, `isDirty(column)`, `getDirtyColumns()` (changed field names), `getDirtyColumnsWithValues()` (old + new per field), `getRemovedColumns()`. Load when implementing audit logs, conditionally running expensive logic only if a field changed, or building a change diff.

### [`write-migration/`](./write-migration/SKILL.md)

Write a Cascade migration — a class `extends Migration` with `public table`, `up()` / `down()`, and fluent schema builders on `this` (`createTable`, `id`, `string`, `timestamps`, `references`, `index`). Run with `cascade migrate`. Load when creating or altering a table, indexing a column, dropping data, or wiring a new model.

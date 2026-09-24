---
name: alter-migration
description: 'Evolve an existing table with `Migration.alter(Model, schema, options?)` — add/drop/rename/modify columns; add/drop regular, unique, expression, full-text, geo, vector, and TTL indexes; add/drop foreign keys and CHECK constraints; write rollbacks with class-form methods in `down()`. Triggers: "alter a table", "add a column to existing table", "drop a column", "rename a column", "add an index", "drop a unique constraint", "change a column type", `Migration.alter`, `dropUnique`, `addIndex`, `addForeign`. Skip: creating a brand-new table — `@warlock.js/cascade/write-migration/SKILL.md`.'
---

# Alter a migration

Use `Migration.alter` to evolve an existing table — adding or dropping columns, renaming them, changing their type, and managing every variety of index or constraint. It's the declarative counterpart to `Migration.create` and inherits the table name and data source straight from the model.

> **Key difference from `Migration.create`:** `alter` does **not** auto-infer rollbacks. You must supply a `down()` function in options whenever you need to be able to roll back.

---

## Minimal example

```ts title="src/app/users/models/user/migrations/06-09-2026_00-00-00-add-phone-to-users.migration.ts"
import { Migration, text } from "@warlock.js/cascade";
import { User } from "../user.model";

export default Migration.alter(User, {
  add: {
    phone: text().nullable(),
  },
}, {
  down() {
    this.dropColumn("phone");
  },
});
```

---

## Signature

```ts
Migration.alter(
  model: ModelClass,
  schema: AlterSchema,
  options?: MigrationAlterOptions,
): MigrationConstructor
```

- **`model`** — the model class; provides `table` and `dataSource` automatically.
- **`schema`** — any combination of the keys below; omit everything you don't need.
- **`options`** — rollback logic + order/transaction overrides (see [Options](#options)).

---

## Column operations

### `add` — new columns

```ts
import { Migration, text, integer, bool, uuid } from "@warlock.js/cascade";
import { Organization } from "app/organizations/models/organization";
import { User } from "../user.model";

export default Migration.alter(User, {
  add: {
    phone:           text().nullable(),
    login_attempts:  integer().notNullable().default(0),
    is_verified:     bool().notNullable().default(false),
    organization_id: uuid().references(Organization.table).onDelete("cascade").notNullable(),
  },
}, {
  down() {
    this.dropColumn("phone");
    this.dropColumn("login_attempts");
    this.dropColumn("is_verified");
    this.dropColumn("organization_id");
  },
});
```

Column helpers (`text`, `integer`, `bool`, `uuid`, `double`, `json`, `timestamp`, `date`, …) are imported from `@warlock.js/cascade` and support the same modifier chain as in `Migration.create`.

### `drop` — remove columns

```ts
export default Migration.alter(User, {
  drop: ["legacy_token", "old_avatar_url"],
}, {
  down() {
    // re-add with the original definition if rollback is meaningful
    this.text("legacy_token").nullable();
    this.text("old_avatar_url").nullable();
  },
});
```

### `rename` — rename columns

```ts
export default Migration.alter(Post, {
  rename: {
    body:      "content",
    thumb_url: "thumbnail_url",
  },
}, {
  down() {
    this.renameColumn("content",       "body");
    this.renameColumn("thumbnail_url", "thumb_url");
  },
});
```

### `modify` — change column type or nullability

```ts
import { Migration, string } from "@warlock.js/cascade";
import { User } from "../user.model";

export default Migration.alter(User, {
  modify: {
    // widen email from text to varchar(320) and keep not-null
    email: string(320).notNullable(),
  },
}, {
  down() {
    // revert to unbounded text
    this.text("email").notNullable();
  },
});
```

> `modify` re-declares the column. Include every modifier you want to keep (`.notNullable()`, `.default(…)`, etc.) — the declaration replaces the old one entirely.

---

## Index operations

### Regular indexes — `addIndex` / `dropIndex`

```ts
export default Migration.alter(Order, {
  // single column
  addIndex: [{ columns: "status" }],
}, {
  down() {
    this.dropIndex("status");
  },
});
```

```ts
// composite index with an explicit name
export default Migration.alter(Order, {
  addIndex: [
    { columns: ["organization_id", "status"], name: "idx_org_status" },
    { columns: "created_at" },
  ],
}, {
  down() {
    this.dropIndex("idx_org_status");
    this.dropIndex("created_at");
  },
});
```

`dropIndex` accepts a name string or a columns array:

```ts
export default Migration.alter(Order, {
  dropIndex: ["idx_org_status", ["created_at"]],
});
```

`options.concurrently: true` builds the index without locking the table (Postgres):

```ts
addIndex: [{ columns: "email", options: { concurrently: true } }]
```

### Unique constraints — `addUnique` / `dropUnique`

```ts
// promote an indexed column to unique
export default Migration.alter(User, {
  addUnique: [{ columns: "email" }],
}, {
  down() {
    this.dropUnique("email");
  },
});
```

Composite unique constraint:

```ts
export default Migration.alter(Membership, {
  addUnique: [{ columns: ["organization_id", "user_id"], name: "uq_org_member" }],
}, {
  down() {
    this.dropUnique(["organization_id", "user_id"]);
  },
});
```

Downgrade a unique to a plain index (the pattern used in this session):

```ts
export default Migration.alter(User, {
  dropUnique: [["email"]],
  addIndex:   [{ columns: "email", name: "users_email_index" }],
}, {
  down() {
    this.dropIndex("users_email_index");
    this.unique("email");
  },
});
```

### Expression indexes — `addExpressionIndex` (Postgres)

```ts
export default Migration.alter(User, {
  addExpressionIndex: [
    { expressions: "lower(email)",          name: "idx_email_ci" },
    { expressions: "lower(name)",           name: "idx_name_ci" },
    { expressions: ["year(created_at)", "status"] },
  ],
}, {
  down() {
    this.dropIndex("idx_email_ci");
    this.dropIndex("idx_name_ci");
  },
});
```

---

## Specialized indexes

### Full-text — `addFullText` / `dropFullText`

```ts
export default Migration.alter(Article, {
  addFullText: [
    {
      columns: ["title", "body"],
      options: { name: "ft_article_search", language: "english" },
    },
  ],
}, {
  down() {
    this.dropFullText("ft_article_search");
  },
});
```

### Geo-spatial — `addGeoIndex` / `dropGeoIndex`

```ts
export default Migration.alter(Store, {
  addGeoIndex: [{ column: "location" }],
}, {
  down() {
    this.dropGeoIndex("location");
  },
});
```

Options: `{ name?, type?: "2dsphere" | "2d", min?, max? }`

### Vector (AI embeddings) — `addVectorIndex` / `dropVectorIndex`

```ts
export default Migration.alter(Document, {
  addVectorIndex: [{
    column: "embedding",
    options: { dimensions: 1536, similarity: "cosine", name: "idx_doc_embedding" },
  }],
}, {
  down() {
    this.dropVectorIndex("embedding");
  },
});
```

Similarity options: `"cosine"` | `"euclidean"` | `"dotProduct"`.

### TTL (MongoDB) — `addTTLIndex` / `dropTTLIndex`

Expires documents automatically after a fixed duration:

```ts
export default Migration.alter(Session, {
  addTTLIndex: [{ column: "created_at", expireAfterSeconds: 86400 }], // 24 h
}, {
  down() {
    this.dropTTLIndex("created_at");
  },
});
```

---

## Constraints

### Foreign keys — `addForeign` / `dropForeign`

Pass a model class or a raw table-name string for `references`:

```ts
import { Migration } from "@warlock.js/cascade";
import { Team } from "app/teams/models/team";
import { User } from "../user.model";

export default Migration.alter(User, {
  addForeign: [
    { column: "team_id",  references: Team,     onDelete: "cascade" },
    { column: "owner_id", references: "users",  on: "id", onDelete: "setNull" },
  ],
}, {
  down() {
    this.dropForeign("team_id",  Team.table);
    this.dropForeign("owner_id", "users");
  },
});
```

`onDelete` / `onUpdate` values: `"cascade"` | `"restrict"` | `"setNull"` | `"noAction"`. Both default to `"restrict"` when omitted.

Drop by constraint name when you named it manually:

```ts
dropForeign: [{ columnOrConstraint: "fk_my_custom_name" }]
```

### CHECK constraints — `addCheck` / `dropCheck`

```ts
export default Migration.alter(Product, {
  addCheck: [
    { name: "price_positive",    expression: "price_cents >= 0" },
    { name: "stock_non_negative", expression: "stock >= 0" },
  ],
}, {
  down() {
    this.dropCheck("price_positive");
    this.dropCheck("stock_non_negative");
  },
});
```

---

## Raw SQL inside an alter

Use `raw` when you need a one-off SQL statement alongside declarative changes (e.g. backfilling a new column in the same migration when the table is small):

```ts
export default Migration.alter(User, {
  add: {
    full_name: text().nullable(),
  },
  raw: `UPDATE users SET full_name = first_name || ' ' || last_name`,
}, {
  down() {
    this.dropColumn("full_name");
  },
});
```

Pass an array for multiple statements:

```ts
raw: [
  `UPDATE users SET status = 'active' WHERE status IS NULL`,
  `UPDATE users SET role = 'member' WHERE role IS NULL`,
]
```

---

## Writing `down()` — the rollback function

`Migration.alter` **never** auto-infers rollback. Supply `down()` in options whenever you want `cascade migrate:rollback` to work. Inside `down()`, `this` is a full `Migration` instance — every class-form builder is available:

| Operation | Class-form call in `down()` |
|---|---|
| Drop an added column | `this.dropColumn("name")` |
| Re-add a dropped column | `this.text("name").nullable()` |
| Undo a rename | `this.renameColumn("new", "old")` |
| Undo a column modify | `this.text("col").notNullable()` |
| Drop a plain index (by name) | `this.dropIndex("idx_name")` |
| Drop a plain index (by columns) | `this.dropIndex(["col_a", "col_b"])` |
| Drop a unique constraint | `this.dropUnique("email")` or `this.dropUnique(["a", "b"])` |
| Add a unique constraint back | `this.unique("email")` |
| Add a plain index back | `this.index("email", "idx_name")` |
| Drop a foreign key | `this.dropForeign("col", "ref_table")` |
| Drop a CHECK constraint | `this.dropCheck("constraint_name")` |
| Drop full-text index | `this.dropFullText("ft_name")` |
| Drop geo index | `this.dropGeoIndex("column")` |
| Drop vector index | `this.dropVectorIndex("column")` |
| Drop TTL index | `this.dropTTLIndex("column")` |
| Raw SQL | `this.raw("SQL statement")` |

If a migration is genuinely irreversible, throw inside `down()` so accidental rollbacks fail loudly:

```ts
{
  down() {
    throw new Error("This migration is irreversible — restore from backup.");
  },
}
```

---

## Options (`MigrationAlterOptions`)

| Key | Type | Purpose |
|---|---|---|
| `down` | `(this: Migration) => void \| Promise<void>` | Rollback logic (not auto-inferred) |
| `up` | `(this: Migration) => void \| Promise<void>` | Extra imperative logic to run after declarative changes |
| `order` | `number` | Execution order override (default `0`) |
| `createdAt` | `string` | ISO timestamp override for migration name ordering |
| `transactional` | `boolean` | Wrap the migration in a DB transaction |

The `up` hook runs **after** the declarative schema changes, making it useful for data backfills or conditional DDL that depends on the added schema:

```ts
export default Migration.alter(User, {
  add: { verified_at: timestamp().nullable() },
}, {
  up() {
    // backfill: mark existing confirmed users as verified
    this.raw(`UPDATE users SET verified_at = updated_at WHERE status = 'confirmed'`);
  },
  down() {
    this.dropColumn("verified_at");
  },
});
```

---

## Common recipes

### Add a column + foreign key together

```ts
import { Migration, uuid } from "@warlock.js/cascade";
import { Team } from "app/teams/models/team";
import { User } from "../user.model";

export default Migration.alter(User, {
  add: {
    team_id: uuid().nullable(),
  },
  addForeign: [
    { column: "team_id", references: Team, onDelete: "setNull" },
  ],
  addIndex: [{ columns: "team_id" }],
}, {
  down() {
    this.dropForeign("team_id", Team.table);
    this.dropIndex("team_id");
    this.dropColumn("team_id");
  },
});
```

### Swap unique → plain index

```ts
export default Migration.alter(User, {
  dropUnique: [["email"]],
  addIndex:   [{ columns: "email", name: "users_email_index" }],
}, {
  down() {
    this.dropIndex("users_email_index");
    this.unique("email");
  },
});
```

### Rename + widen a column

```ts
export default Migration.alter(Post, {
  rename: { body: "content" },
  modify: { content: text().notNullable() },
}, {
  down() {
    this.renameColumn("content", "body");
  },
});
```

### Multiple operations in one migration

Combine freely — all operations run in a single `up()` call:

```ts
export default Migration.alter(Product, {
  add:    { sku: text().unique().notNullable() },
  drop:   ["old_code"],
  rename: { price: "price_cents" },
  modify: { price_cents: integer().notNullable() },
  addIndex:  [{ columns: ["category_id", "status"], name: "idx_cat_status" }],
  addCheck:  [{ name: "price_non_negative", expression: "price_cents >= 0" }],
}, {
  down() {
    this.dropCheck("price_non_negative");
    this.dropIndex("idx_cat_status");
    this.renameColumn("price_cents", "price");
    this.text("old_code").nullable();
    this.dropColumn("sku");
  },
});
```

---

## Things NOT to do

- **Don't edit a shipped migration.** If it's already run in any environment, add a new migration on top.
- **Don't skip `down()` for reversible changes.** Without it, `cascade migrate:rollback` is a no-op on your migration.
- **Don't put large backfills and schema changes together.** Schema change first (nullable column or default), backfill second — in its own migration or a background job. This keeps rollback safe.
- **Don't use `raw` for something the declarative API already covers.** Use `addIndex`, `addUnique`, etc. — raw SQL bypasses Cascade's driver abstraction and breaks on non-Postgres sources.
- **Don't declare `id`, `createdAt`, or `updatedAt`** — they're managed by the framework.

---

## See also

- [`@warlock.js/cascade/write-migration/SKILL.md`](@warlock.js/cascade/write-migration/SKILL.md) — `Migration.create` for brand-new tables + all column helpers
- [`@warlock.js/cascade/run-cascade-cli/SKILL.md`](@warlock.js/cascade/run-cascade-cli/SKILL.md) — CLI flags + programmatic Operations API
- [`@warlock.js/cascade/manage-data-sources/SKILL.md`](@warlock.js/cascade/manage-data-sources/SKILL.md) — multi-DB migrations

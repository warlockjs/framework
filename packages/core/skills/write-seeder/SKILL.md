---
name: write-seeder
description: 'Author a seed file under `src/app/<module>/seeds/<name>.ts` using the `seeder()` factory — `name`, `dependsOn`, `once`, `order`, `batchSize`, `run({ track })`. Auto-discovered by `warlock seed`; tracked in a `seeds` table; per-record refs in `seed_records` so `warlock seed --drop` can undo a seed. Triggers: `seeder`, `Seeder`, `SeedResult`, `SeedContext`, `track`, `SeedersManager`, `warlock seed`, `--fresh`, `--drop`, `--list`, `--path`; "seed default roles", "undo a seed", "one-time data migration", "auto-discovered seeds", "order seeds by dependency"; typical import `import { seeder } from "@warlock.js/core"`. Skip: module folder layout — `@warlock.js/core/create-module/SKILL.md`; repository CRUD — `@warlock.js/core/use-repository/SKILL.md`; CLI flags — `@warlock.js/core/write-cli-command/SKILL.md`; competing patterns: hand-rolled `node scripts/seed.js`, `typeorm-seeding`.'
---

# Warlock — write a seeder

Seeds are how you push initial data into the database — default roles, currencies, lookup tables, sample records for staging. They sit beside the module they belong to (`src/app/<module>/seeds/<name>.ts`), get auto-discovered by `warlock seed`, and the framework tracks which seeds have run so `once: true` ones don't re-run on a clean DB after the first time.

## The shape

```ts title="src/app/roles/seeds/default-roles.seed.ts"
import { seeder } from "@warlock.js/core";
import { Role } from "../models/role";

export default seeder({
  name: "default-roles",
  description: "Insert admin / member / viewer roles",
  once: true,
  order: 1,
  async run({ track }) {
    for (const slug of ["admin", "member", "viewer"]) {
      const existing = await Role.first({ slug });
      if (existing) continue;

      // track() records the created row in `seed_records` (same transaction)
      // AND returns its argument so you can chain inline.
      track(await Role.create({ slug, name: slug.toUpperCase() }));
    }
  },
});
```

`recordsCreated` is **auto-derived from the track count** — you no longer have to count by hand or return a `SeedResult`.

Run them:

```bash
yarn warlock seed                            # discover + run all
yarn warlock seed --list                     # show registry, don't run
yarn warlock seed --path=src/app/roles/seeds/default-roles.seed.ts  # one file
yarn warlock seed --fresh                    # truncate every table first, then run all
yarn warlock seed --drop                     # undo every tracked record, reset the log
yarn warlock seed --drop=default-roles       # undo just one seeder's records
```

`--fresh` truncates **every** table in the DB (`datasource.driver.truncateTable(table, { cascade: true })`), including the `seeds` tracking table. After `--fresh`, `once: true` seeds will run again.

`--drop` is the surgical alternative: it deletes only the rows a seeder **tracked**, in reverse run-order, then resets the matching `seeds`-log rows so `once: true` seeds re-run. See [Undo — `seed_records` + `--drop`](#undo--seed_records----drop).

## The `Seeder` type

```ts
type Seeder = {
  name: string;                                // required, used as the registry key
  enabled?: boolean;                            // default true — set false to skip
  description?: string;                         // shown in --list output
  dependsOn?: string[];                         // names of seeds that must run first
  once?: boolean;                               // skip if a row exists in the `seeds` table
  order?: number;                               // sort key — lower runs first
  batchSize?: number;                           // documented; not enforced by the manager
  run(ctx: SeedContext): Promise<SeedResult | void>;   // your work
};

type SeedContext = {
  track: Track;                                 // register created records for --drop
};

type SeedResult = {
  recordsCreated: number;                       // OPTIONAL fallback when nothing was tracked
};
```

`run` now receives a `{ track }` context. Declaring the parameter is optional — an existing **zero-arg `run()` keeps working unchanged** (it just ignores the context). Returning a `SeedResult` is also optional: the manager prefers the track count and only falls back to `result.recordsCreated` when you tracked nothing. A seed that neither tracks nor returns still counts as run (the `seeds` row is inserted with `recordsCreated: 0`).

## `track` — register created records

`track` is how a seed tells the framework which rows it created, so `--drop` can undo them. It has three forms, and **every form returns its first argument** so you can wrap a `create()` call inline:

```ts
track(model)                 // single model — reads model.getTableName() + model.id
track([modelA, modelB])      // bulk — array of models
track("legacy_table", id)    // raw escape hatch — table name + id, no model
```

```ts
async run({ track }) {
  const role = track(await Role.create({ slug: "admin" }));      // chain inline
  const users = track(await User.createMany([...]));             // bulk
  track("audit_log", auditId);                                    // raw
}
```

Tracked refs are written to the `seed_records` table **inside the same transaction** the seed runs in — if the seed throws, the refs roll back with the data. Only the **last run's** refs are kept: re-running a seed drops its prior refs first, so undo stays bounded to what currently exists.

## Auto-discovery

`warlock seed` walks `src/app/*/seeds/*.ts` and imports each file via the framework's module loader. Each file must **default-export** a `Seeder`:

```
src/app/
├── roles/
│   └── seeds/
│       ├── default-roles.seed.ts
│       └── role-permissions.seed.ts
└── currencies/
    └── seeds/
        └── default-currencies.seed.ts
```

A seed file that doesn't export a default `Seeder` throws at discovery time:
> `Seeder file <relative> does not export a default seeder.`

Filename convention is `<name>.seed.ts` but the loader doesn't enforce it — any `.ts` inside a `seeds/` folder is picked up. Sticking to the suffix keeps things grep-able.

## Tracking — the `seeds` table

The first `warlock seed` run creates a `seeds` table via `SeedsTableMigration`. Every successful seed run stores a row:

| Column                  | Meaning                                    |
| ----------------------- | ------------------------------------------ |
| `name`                  | Seeder's `name` (the lookup key)           |
| `createdAt`             | Wall time of the first run                 |
| `firstRunAt`            | Same as `createdAt`                        |
| `lastRunAt`             | Updated on every subsequent successful run |
| `runCount`              | Increments by 1 per run                    |
| `totalRecordsCreated`   | Sum of `recordsCreated` across all runs    |
| `lastRunRecordsCreated` | Last run's `recordsCreated`                |

Skip-on-`once`:

- Before each seed runs, the manager looks up `name` in the `seeds` table.
- If a row exists **and** `once: true`, the seed is skipped with `⏭️  Skipping <name> (already executed)`.
- If `once` is unset / `false`, the seed always runs (but still appends a row, incrementing `runCount`).

Use `once: true` for irreversible "starter" data (the framework's default `roles`, fixed enum tables) and leave it off for repeatable seeds (dev fixtures you re-run after rolling the DB).

## Undo — `seed_records` + `--drop`

Every record you `track()` is written to a `seed_records` table (created on first run via `SeedRecordsTableMigration`):

| Column     | Meaning                                  |
| ---------- | ---------------------------------------- |
| `seeder`   | Owning seeder's `name`                   |
| `table`    | Table the tracked record lives in        |
| `recordId` | Primary key of the tracked record        |
| `runAt`    | Wall time the reference was recorded      |

`warlock seed --drop` reads those refs and undoes the seed:

```bash
yarn warlock seed --drop                # undo every tracked record across all seeders
yarn warlock seed --drop=default-roles  # undo just one seeder's records
```

What it does, inside a single transaction:

1. Deletes the tracked records in **reverse run-order**, and within each seed in **reverse insertion-order** (highest `seed_records.id` first — so children created after their parents are removed first).
2. Clears the `seed_records` refs it acted on.
3. Resets the matching `seeds`-log rows, so a `once: true` seed **re-runs** on the next `warlock seed`.

Only **tracked** rows are deleted — records you created without `track()` (or rows added by hand) are untouched. A seed whose `run()` never calls `track()` can't be undone with `--drop`; it has nothing to delete and its log row stays.

`--drop` vs `--fresh`: `--fresh` is the blunt reset (truncates *every* table); `--drop` is surgical (only what a seed tracked). Reach for `--drop` when you want to re-run one seeder without nuking the whole DB.

## Ordering

```ts
seeder({
  name: "user-roles",
  order: 10,
  // ...
});

seeder({
  name: "default-admin-user",
  order: 20,         // runs AFTER user-roles (which created the roles it references)
  // ...
});
```

The manager sorts by `order` ascending — lower runs first. Seeds without an `order` get sorted to the end (`Number.MAX_SAFE_INTEGER`).

### `dependsOn` — topological order

`dependsOn: ["user-roles"]` is **resolved** by the manager: it topologically sorts seeders so every dependency runs before its dependents, *layered over* the numeric `order` tie-break. Among seeders whose dependencies are already satisfied, the lowest `order` (then registration order) runs first.

```ts
seeder({ name: "roles", order: 20, async run() { /* ... */ } });
seeder({ name: "admin-user", dependsOn: ["roles"], order: 10, async run() { /* ... */ } });
// → roles runs FIRST despite its higher order, because admin-user depends on it.
```

Two ways it fails loudly:

- **Unknown dependency** — `dependsOn` names a seeder that isn't registered (or is `enabled: false`, since disabled seeds are filtered out *before* resolution) → `UnknownSeederDependencyError`.
- **Cycle** — `a → b → a` → `SeederDependencyCycleError` (the message includes the cycle path).

Use `dependsOn` to express *hard* ordering constraints and `order` for soft sequencing within a dependency layer.

## Transactions

By default, each seed runs inside a transaction. The manager wraps `run({ track })` **and** the write of its tracked `seed_records` refs in one transaction:

```ts
const result = withTransaction
  ? await transaction(runSeeder)   // run() + seed_records writes, atomically
  : await runSeeder();
```

If your `run()` throws, the transaction rolls back — including the `seed_records` refs, so a failed seed leaves no dangling track rows. The CLI takes `--transaction` to flip this — pass `--transaction=false` for large seeds where you want each insert committed individually (avoid the rollback-on-failure cost; accept partial state on error).

Within a single seed, multiple model `create()` / `insert()` calls share the same transaction — partial-on-error doesn't apply unless you opt out.

## Patterns

### Idempotent seed (safe to re-run without `once`)

```ts title="src/app/currencies/seeds/default-currencies.seed.ts"
import { seeder } from "@warlock.js/core";
import { Currency } from "../models/currency";

export default seeder({
  name: "default-currencies",
  description: "USD / EUR / SAR / EGP currencies",
  order: 5,
  async run({ track }) {
    const seeds = [
      { code: "USD", name: "US Dollar", decimals: 2 },
      { code: "EUR", name: "Euro", decimals: 2 },
      { code: "SAR", name: "Saudi Riyal", decimals: 2 },
      { code: "EGP", name: "Egyptian Pound", decimals: 2 },
    ];

    for (const data of seeds) {
      const existing = await Currency.first({ code: data.code });
      if (existing) continue;
      track(await Currency.create(data));   // count auto-derived from track()
    }
  },
});
```

`first` + `continue` keeps the seed safe to run twice — the second run does nothing.

### Run-once admin user (depends on roles)

```ts title="src/app/users/seeds/default-admin.seed.ts"
import { seeder } from "@warlock.js/core";
import { Role } from "../../roles/models/role";
import { User } from "../models/user";

export default seeder({
  name: "default-admin",
  description: "Insert the seed admin user",
  once: true,                   // never re-run
  dependsOn: ["default-roles"], // roles must exist first
  async run({ track }) {
    const adminRole = await Role.first({ slug: "admin" });
    if (!adminRole) throw new Error("admin role missing — run the roles seed first");

    track(
      await User.create({
        email: "admin@example.com",
        password: "change-me-immediately",
        role_id: adminRole.id,
      }),
    );
  },
});
```

Combining `once: true` + `dependsOn` is the canonical "starter data" pattern.

### Bulk dev fixtures (no `once`, large batch)

```ts title="src/app/products/seeds/dev-products.seed.ts"
import { seeder } from "@warlock.js/core";
import { Product } from "../models/product";

export default seeder({
  name: "dev-products",
  description: "100 sample products for dev",
  enabled: process.env.NODE_ENV === "development",
  order: 100,
  async run({ track }) {
    for (let i = 0; i < 100; i++) {
      track(
        await Product.create({
          name: `Sample ${i}`,
          price: Math.random() * 100,
        }),
      );
    }
  },
});
```

`enabled: false` (or env-gated like above) keeps the seed off in production runs while leaving the file in the repo.

### Wire seeds explicitly (alternative to auto-discovery)

If you need to bypass auto-discovery — e.g. a shared-seeds package — register via `SeedersManager` directly:

```ts
import { SeedersManager } from "@warlock.js/core";
import { defaultRoles } from "./seeds/default-roles.seed";
import { defaultCurrencies } from "./seeds/default-currencies.seed";

const manager = new SeedersManager();
manager.register(defaultRoles, defaultCurrencies);
await manager.run();
```

Most projects don't need this — auto-discovery handles the common case.

## CLI flags

```
warlock seed                  # run all auto-discovered seeds
warlock seed --list           # show registry (name, order, enabled), don't run
warlock seed --path=<file>    # run one file by absolute or relative path
warlock seed --fresh          # truncate every table first, then run all
warlock seed --drop           # undo every tracked record, reset the seeds-log
warlock seed --drop=<name>    # undo just one seeder's tracked records
warlock seed --transaction    # (default true) — pass --transaction=false to skip wrapping
```

`--fresh` is **destructive** — it truncates all tables, including the `seeds` tracking table. Treat it as "reset the dev DB," not "run pending seeds." `--drop` is the surgical undo — only tracked rows, scoped to one seeder if you name it.

## Gotchas

- **The seed file must default-export.** A named export gets the discovery error at boot. Wrap with `export default seeder({...})`.
- **`once: true` only works if the seed run succeeds.** A throw rolls back the transaction including the `seeds` table insert — the next run will retry.
- **`--drop` only undoes what you `track()`.** A seed that never calls `track()` has nothing in `seed_records`, so `--drop` can't reverse it. Track every row you want to be able to undo.
- **`dependsOn` is resolved** (topological sort over `order`). An unknown dependency throws `UnknownSeederDependencyError`; a cycle throws `SeederDependencyCycleError`. A `dependsOn` pointing at a `enabled: false` seeder errors, because disabled seeds are filtered out before resolution.
- **`batchSize` is documented on the type but unused by the manager.** It's a forward-compat field. If you need batch inserts, batch inside `run()` directly.
- **`--fresh` truncates `cascade: true`.** Foreign-key chains delete with their parents. If you have data outside the seeded scope that you want to keep, do NOT run `--fresh`.
- **Seeds aren't migrations.** Schema changes go in `migrations/`. Seeds populate data into a schema that already exists. Mixing the two (creating a table in a seed) confuses the lifecycle.
- **`enabled: false` skips the seed but it's still in the registry.** `warlock seed --list` shows it as disabled. Re-enable by flipping the flag, not by deleting the file.

## See also

- [`create-module/SKILL.md`](../create-module/SKILL.md) — the `seeds/` folder layout in a module, `generate.module` scaffolding.
- [`use-repository/SKILL.md`](../use-repository/SKILL.md) — the model `create` / `first` calls used inside seeds.
- [`write-cli-command/SKILL.md`](../write-cli-command/SKILL.md) — the `warlock seed` CLI flags and full preload shape.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — `seeds/` is the canonical folder name (singular `seed/` is incorrect).

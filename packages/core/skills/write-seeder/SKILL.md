---
name: write-seeder
description: 'Author a seed file under `src/app/<module>/seeds/<name>.ts` using the `seeder()` factory — `name`, `dependsOn`, `once`, `order`, `batchSize`, `run()`. Auto-discovered by `warlock seed`; tracked in a `seeds` table. Triggers: `seeder`, `Seeder`, `SeedResult`, `SeedersManager`, `warlock seed`, `--fresh`, `--list`, `--path`; "seed default roles", "one-time data migration", "auto-discovered seeds", "order seeds by dependency"; typical import `import { seeder } from "@warlock.js/core"`. Skip: module folder layout — `@warlock.js/core/create-module/SKILL.md`; repository CRUD — `@warlock.js/core/use-repository/SKILL.md`; CLI flags — `@warlock.js/core/write-cli-command/SKILL.md`; competing patterns: hand-rolled `node scripts/seed.js`, `typeorm-seeding`.'
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
  async run() {
    let recordsCreated = 0;

    for (const slug of ["admin", "member", "viewer"]) {
      const existing = await Role.first({ slug });
      if (existing) continue;

      await Role.create({ slug, name: slug.toUpperCase() });
      recordsCreated++;
    }

    return { recordsCreated };
  },
});
```

Run them:

```bash
yarn warlock seed                            # discover + run all
yarn warlock seed --list                     # show registry, don't run
yarn warlock seed --path=src/app/roles/seeds/default-roles.seed.ts  # one file
yarn warlock seed --fresh                    # truncate every table first, then run all
```

`--fresh` truncates **every** table in the DB (`datasource.driver.truncateTable(table, { cascade: true })`), including the `seeds` tracking table. After `--fresh`, `once: true` seeds will run again.

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
  run(): Promise<SeedResult | void>;            // your work
};

type SeedResult = {
  recordsCreated: number;                       // tracked in the seeds table
};
```

Returning a `SeedResult` is optional — the manager uses `recordsCreated` only to populate metadata in the `seeds` table. If you don't return anything, the seed still counts as run (the row is inserted with `recordsCreated: 0`).

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

`dependsOn: ["user-roles"]` is on the `Seeder` type but **not yet resolved** by the manager (there's an explicit `TODO: Handle dependsOn resolution` in the source — topological sort isn't implemented). For now, rely on `order` to express dependencies. The `dependsOn` field stays available for forward-compat.

## Transactions

By default, each seed runs inside a transaction:

```ts
const result = withTransaction
  ? await transaction(async () => seeder.run())
  : await seeder.run();
```

If your `run()` throws, the transaction rolls back. The CLI takes `--transaction` to flip this — pass `--transaction=false` for large seeds where you want each insert committed individually (avoid the rollback-on-failure cost; accept partial state on error).

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
  async run() {
    const seeds = [
      { code: "USD", name: "US Dollar", decimals: 2 },
      { code: "EUR", name: "Euro", decimals: 2 },
      { code: "SAR", name: "Saudi Riyal", decimals: 2 },
      { code: "EGP", name: "Egyptian Pound", decimals: 2 },
    ];

    let recordsCreated = 0;
    for (const data of seeds) {
      const existing = await Currency.first({ code: data.code });
      if (existing) continue;
      await Currency.create(data);
      recordsCreated++;
    }

    return { recordsCreated };
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
  order: 20,                    // after roles (order: 10)
  async run() {
    const adminRole = await Role.first({ slug: "admin" });
    if (!adminRole) throw new Error("admin role missing — run user-roles seed first");

    await User.create({
      email: "admin@example.com",
      password: "change-me-immediately",
      role_id: adminRole.id,
    });

    return { recordsCreated: 1 };
  },
});
```

Combining `once: true` + `order` is the canonical "starter data" pattern.

### Bulk dev fixtures (no `once`, large batch)

```ts title="src/app/products/seeds/dev-products.seed.ts"
import { seeder } from "@warlock.js/core";
import { Product } from "../models/product";

export default seeder({
  name: "dev-products",
  description: "100 sample products for dev",
  enabled: process.env.NODE_ENV === "development",
  order: 100,
  async run() {
    let recordsCreated = 0;
    for (let i = 0; i < 100; i++) {
      await Product.create({
        name: `Sample ${i}`,
        price: Math.random() * 100,
      });
      recordsCreated++;
    }
    return { recordsCreated };
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
warlock seed --transaction    # (default true) — pass --transaction=false to skip wrapping
```

`--fresh` is **destructive** — it truncates all tables, including the `seeds` tracking table. Treat it as "reset the dev DB," not "run pending seeds."

## Gotchas

- **The seed file must default-export.** A named export gets the discovery error at boot. Wrap with `export default seeder({...})`.
- **`once: true` only works if the seed run succeeds.** A throw rolls back the transaction including the `seeds` table insert — the next run will retry.
- **`dependsOn` is documented but not enforced yet.** Use `order` until topological sort lands (`TODO` in source).
- **`batchSize` is documented on the type but unused by the manager.** It's a forward-compat field. If you need batch inserts, batch inside `run()` directly.
- **`--fresh` truncates `cascade: true`.** Foreign-key chains delete with their parents. If you have data outside the seeded scope that you want to keep, do NOT run `--fresh`.
- **Seeds aren't migrations.** Schema changes go in `migrations/`. Seeds populate data into a schema that already exists. Mixing the two (creating a table in a seed) confuses the lifecycle.
- **`enabled: false` skips the seed but it's still in the registry.** `warlock seed --list` shows it as disabled. Re-enable by flipping the flag, not by deleting the file.

## See also

- [`create-module/SKILL.md`](../create-module/SKILL.md) — the `seeds/` folder layout in a module, `generate.module` scaffolding.
- [`use-repository/SKILL.md`](../use-repository/SKILL.md) — the model `create` / `first` calls used inside seeds.
- [`write-cli-command/SKILL.md`](../write-cli-command/SKILL.md) — the `warlock seed` CLI flags and full preload shape.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — `seeds/` is the canonical folder name (singular `seed/` is incorrect).

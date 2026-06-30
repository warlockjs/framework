---
title: "Seeding"
description: Author seed files with the seeder() factory — the run context (track, now, batchSize), dependsOn ordering, undo via warlock seed --drop, and injecting a deterministic clock for historical back-fills and tests.
sidebar:
  order: 16
  label: "Seeding"
---

Seeds push initial data into the database — default roles, currencies, lookup tables, sample fixtures for staging. They sit beside the module they belong to (`src/app/<module>/seeds/<name>.ts`), get auto-discovered and run by [`warlock seed`](../cli/cli-commands.md#seed), and the framework tracks which seeds have run so `once: true` ones don't re-run.

This page covers the seed-authoring API: the `seeder()` factory, the run context (`track` / `now` / `batchSize`), dependency ordering, and undoing a seed. For the CLI flags themselves (`--fresh`, `--list`, `--drop`, `--transaction`), see [CLI commands → `seed`](../cli/cli-commands.md#seed).

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

      // track() records the created row AND returns its argument
      track(await Role.create({ slug, name: slug.toUpperCase() }));
    }
  },
});
```

Each file **default-exports** a `Seeder`. `recordsCreated` is auto-derived from the `track` count — you don't count by hand or return a `SeedResult`.

## The run context

`run` receives a `SeedContext`:

```ts
type SeedContext = {
  track: Track;        // register created records for --drop
  now: SeedClock;      // injectable clock — () => Date, default () => new Date()
  batchSize: number;   // from the seeder's batchSize field (0 when unset)
};

type SeedClock = () => Date;
```

Declaring the parameter is optional — an existing zero-arg `run()` keeps working unchanged (it just ignores the context).

### `now` — the injectable clock

`now` is a `SeedClock` (`() => Date`) the seed should read **instead of** an ambient `new Date()` / `dayjs()`. It defaults to `() => new Date()`, and the seeders manager reads the **same clock** for its own seeds-log timestamps (`createdAt` / `firstRunAt` / `lastRunAt` and each tracked ref's `runAt`) — so seed data and the tracking rows never disagree.

```ts
async run({ track, now }) {
  // every timestamp in the run reads from one clock
  track(await User.create({ name: "Admin", created_at: now() }));
}
```

Why it matters: ambient `new Date()` calls scattered through a seed can't be pinned, so a historical back-fill or a snapshot test drifts. Reading `now()` everywhere gives the run **one overridable clock**.

Inject a fixed clock for deterministic tests or historical back-fills. Two ways in:

```ts
import { SeedersManager } from "@warlock.js/core";

// 1. Construct the manager with a clock
const manager = new SeedersManager({ clock: () => new Date("2020-01-01") });

// 2. Programmatically, via seedCommandAction's overrides argument
import { seedCommandAction } from "@warlock.js/core";

await seedCommandAction(
  { command: "seed", options: {} },
  { clock: () => new Date("2020-01-01") },
);
```

Pinning the clock makes every timestamp the run produces — the seed data *and* the seeds-log rows — resolve to that one value. The CLI never passes `overrides`, so the command-line signature is unchanged; it's a programmatic-only escape hatch for scripts and tests.

### `batchSize` — bulk-insert hint

`batchSize` surfaces the seeder's own `batchSize` field into the run context (`0` when unset), so a seed can forward it straight to `Model.createMany(rows, { batchSize })` without re-reading its config:

```ts
import { seeder } from "@warlock.js/core";
import { User } from "../models/user";

export default seeder({
  name: "dev-users",
  batchSize: 1000,
  async run({ track, batchSize }) {
    const rows = buildManyRows();
    track(await User.createMany(rows, { batchSize })); // chunked insert
  },
});
```

The manager doesn't act on `batchSize` itself — it only hands the value through; the chunking happens inside `createMany`. See the Cascade [Bulk inserts guide](/v/latest/cascade/digging-deeper/bulk-inserts/) for what `createMany` does with it.

### `track` — register created records

`track` tells the framework which rows the seed created, so [`warlock seed --drop`](../cli/cli-commands.md#seed) can undo them later. It has three forms, and **every form returns its first argument** so you can wrap a `create()` call inline:

```ts
track(model)                 // single model — reads model.getTableName() + model.id
track([modelA, modelB])      // bulk — array of models
track("legacy_table", id)    // raw escape hatch — table name + id, no model
```

```ts
async run({ track }) {
  const role = track(await Role.create({ slug: "admin" }));   // chain inline
  const users = track(await User.createMany([...]));          // bulk
  track("audit_log", auditId);                                 // raw
}
```

Tracked refs are written inside the **same transaction** the seed runs in — if the seed throws, the refs roll back with the data. Only the **last run's** refs are kept per seeder, so undo stays bounded to what currently exists.

## Ordering and dependencies

The manager sorts by `order` ascending — lower runs first; seeds without an `order` sort to the end. `dependsOn` is **resolved** via a topological sort layered over that `order` tie-break, so a dependency always runs before its dependents:

```ts
seeder({ name: "roles", order: 20, async run() { /* ... */ } });
seeder({ name: "admin-user", dependsOn: ["roles"], order: 10, async run() { /* ... */ } });
// → roles runs FIRST despite its higher order, because admin-user depends on it.
```

Two ways it fails loudly:

- **Unknown dependency** — `dependsOn` names a seeder that isn't registered (or is `enabled: false`, since disabled seeds are filtered out *before* resolution) → `UnknownSeederDependencyError`.
- **Cycle** — `a → b → a` → `SeederDependencyCycleError` (the message includes the cycle path).

## Undo — `warlock seed --drop`

Every record you `track()` is recorded so it can be undone:

```bash
yarn warlock seed --drop                # undo every tracked record across all seeders
yarn warlock seed --drop=default-roles  # undo just one seeder's records
```

Inside a single transaction, `--drop` deletes the tracked records in reverse run/insertion order, clears the refs, then resets the matching seeds-log rows so a `once: true` seed re-runs on the next `warlock seed`. Only **tracked** rows are deleted — a seed that never calls `track()` has nothing to undo. Contrast with `--fresh`, which truncates *every* table; `--drop` is the surgical alternative.

## Gotchas

- **The seed file must default-export.** A named export gets the discovery error at boot. Wrap with `export default seeder({...})`.
- **`now()` over ambient time.** Read the injected `now()` in every seed instead of `new Date()` / `dayjs()` — only then can a back-fill or test pin the run to a fixed clock.
- **`batchSize` is relayed, not enforced.** The manager hands the value through; the chunking happens inside `Model.createMany`. Set it on the seeder and forward it.
- **`--drop` only undoes what you `track()`.** Track every row you want to be able to reverse.
- **`dependsOn` is resolved.** An unknown dependency throws `UnknownSeederDependencyError`; a cycle throws `SeederDependencyCycleError`.

## See also

- **[CLI commands → `seed`](../cli/cli-commands.md#seed)** — the `warlock seed` flags (`--fresh`, `--list`, `--path`, `--drop`, `--transaction`).
- **[Bulk inserts](/v/latest/cascade/digging-deeper/bulk-inserts/)** — what `Model.createMany(rows, { batchSize })` does with the relayed `batchSize`.
- **[Repositories](../the-basics/05-repositories.md)** — the model `create` / `first` calls used inside seeds.

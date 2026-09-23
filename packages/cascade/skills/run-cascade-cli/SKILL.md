---
name: run-cascade-cli
description: "Run the cascade CLI / Operations API in @warlock.js/cascade; use when you need to run cascade cli."
---

# Run the cascade CLI / Operations API

Cascade ships a standalone `cascade` binary plus a programmatic **Operations API** — named functions over the migration-runner singleton. The binary is a thin wrapper over those functions; warlock-core's CLI wraps the same code path. Use the binary from terminal / deploy scripts; use the Operations API from test setup, container init, or custom tooling.

## CLI commands

The standalone binary exposes four colon-keyed subcommands:

```bash
cascade migrate                 # run all pending migrations
cascade migrate:list            # show executed migrations from _migrations
cascade migrate:rollback        # undo the last batch
cascade migrate:export-sql      # write .up.sql / .down.sql instead of executing
```

Flags:
- `migrate` — `-f/--fresh` (drop everything and re-run), `-s/--sql` (export SQL instead of executing), `--pending-only`, `-c/--compact`, `-p/--path <glob>`
- `migrate:rollback` — `-a/--all` (roll back everything), `--batches N`, `-p/--path <glob>`
- `migrate:export-sql` — `--pending-only`, `-c/--compact`, `-p/--path <glob>`

There is **no** `seed`, `db:create`, or `db:drop-tables` in the standalone binary — those need project context; use the warlock CLI when you have a Warlock app.

## Configuration — env vars only

No `cascade.config.{ts,js}` file. The CLI auto-loads `.env` from cwd at start.

```bash
DATABASE_URL=postgres://user:pass@host:5432/db    # one connection string …
# … or discrete vars:
DB_DIALECT=postgres        # or mongodb
DB_HOST=localhost
DB_PORT=5432
DB_NAME=myapp
DB_USER=postgres
DB_PASSWORD=secret

# Migration defaults — only set when overriding library defaults:
CASCADE_PRIMARY_KEY=uuid   # uuid | int | bigInt
CASCADE_UUID_STRATEGY=v7   # v4 | v7
```

Warlock-project aliases accepted: `DB_URL` ↔ `DATABASE_URL`, `DB_DRIVER` ↔ `DB_DIALECT`, `DB_USERNAME` ↔ `DB_USER`.

## Diagnose first: "foreign key constraint … cannot be implemented"

On a fresh Postgres run this is almost always a primary-key type mismatch: a migration declared a `uuid()` foreign key, but the referenced table's PK got created as `bigserial` because `migrationDefaults.primaryKey` defaulted to `"int"`. Fix by matching the project's PK convention via env:

```bash
CASCADE_PRIMARY_KEY=uuid
CASCADE_UUID_STRATEGY=v7
```

Warlock projects set these in `src/config/database.ts`'s `migrationOptions`; the cascade CLI mirrors them via env — match the values exactly.

## TS migrations — invoke through a TS runtime

The cascade CLI ships **no TypeScript transpiler.** For `.ts` migrations, invoke through `tsx` / `ts-node` / any TS-aware runtime:

```bash
npx tsx node_modules/.bin/cascade migrate
```

If forgotten, cascade catches the import failure and prints a pointer to this pattern.

## Migration file discovery

Default glob: `./migrations/**/*.{ts,js,mjs,cjs}` from cwd. Override with `-p`, and **always quote the pattern** (the shell expands `**`/`*` before the binary sees it otherwise):

```bash
cascade migrate -p "src/app/**/migrations/*.ts"
```

Each file must `export default` a migration class; cascade infers the name from the filename and uses any leading `MM-DD-YYYY_HH-MM-SS` timestamp for ordering.

## Operations API — programmatic equivalents

```ts
import {
  runMigrations,
  rollbackMigrations,
  freshMigrate,
  exportMigrationsSQL,
  listExecutedMigrations,
  createDatabase,
  dropAllTables,
  migrationRunner,
} from "@warlock.js/cascade";
import CreateUsersTable from "./migrations/create-users.migration";

migrationRunner.registerMany([CreateUsersTable /* … */]);

const results = await runMigrations();
const failed = results.filter((r) => !r.success);
```

Reach for these when you need migrations inside test setup (`beforeAll(async () => { await runMigrations(); })`), container init scripts, custom CLI wrappers, or reading `_migrations` programmatically (`listExecutedMigrations()`). The Operations API returns structured data and **does not print** — the caller decides how to surface progress. (The runner still emits per-migration logs through `@warlock.js/logger`.)

## Common task → command

| You want to… | Command |
|---|---|
| Run all pending migrations | `cascade migrate` |
| Drop everything and re-run | `cascade migrate -f` |
| Roll back the last batch | `cascade migrate:rollback` |
| Roll back everything | `cascade migrate:rollback --all` |
| Generate SQL without executing | `cascade migrate --sql` |
| Generate SQL for pending only | `cascade migrate --sql --pending-only` |
| See what's been executed | `cascade migrate:list` |
| Run from a non-default folder | `cascade migrate -p "<glob>"` |

## Things NOT to do

- Don't run `cascade migrate -f` (fresh) anywhere that could touch production — it drops everything first.
- Don't run `migrate` from inside app code at boot. Migrations are a deploy step; coupling them to boot makes rolling restarts dangerous.
- Don't forget to quote `-p` globs, or the shell expands them and cascade registers a single file.

## See also

- [`@warlock.js/cascade/write-migration/SKILL.md`](@warlock.js/cascade/write-migration/SKILL.md) — writing migration files
- [`@warlock.js/cascade/manage-data-sources/SKILL.md`](@warlock.js/cascade/manage-data-sources/SKILL.md) — multi-database routing

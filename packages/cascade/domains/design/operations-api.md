# Primitive spec — Cascade Operations API + standalone CLI

**Status:** Agreed
**Last updated:** 2026-05-23
**Source of truth:** `@warlock.js/cascade/src/operations/{migrations,database}.ts`, `@warlock.js/cascade/src/cli*`, `@warlock.js/cascade/bin/cascade.mjs`
**Skill (how-to):** [`../skills/cascade-cli/SKILL.md`](../skills/cascade-cli/SKILL.md)
**User guide:** [`../docs/guides/cli.md`](../docs/guides/cli.md)
**API reference:** [`../docs/reference/operations-api.md`](../docs/reference/operations-api.md)
**Decision:** [`decisions.md` #10](./decisions.md)
**Originating plan:** `plans/2026-05-22-operations-api-and-cli.md` (delete on full ship)

Answers *how the migration CLI surface is organised, where each piece lives, and why* — not how to use it (that's the guide and the skill).

## The shape

```
@warlock.js/cascade/
├── src/
│   ├── operations/                  ← public seam consumed by every CLI
│   │   ├── migrations.ts            ← runMigrations, rollbackMigrations, ...
│   │   ├── database.ts              ← createDatabase, dropAllTables
│   │   └── index.ts                 ← barrel
│   ├── cli.ts                       ← entry — setLoggerConfig + loadEnv + runMain
│   ├── cli/
│   │   ├── index.ts                 ← citty root + subcommand registry
│   │   ├── commands/                ← migrate, migrate-list, migrate-rollback, migrate-export-sql
│   │   ├── connection-from-env.ts   ← env → DataSource (+ migrationDefaults)
│   │   ├── load-migrations.ts       ← glob + dynamic import → migrationRunner.register
│   │   ├── setup-logger.ts          ← ConsoleLog channel on @warlock.js/logger
│   │   ├── with-cli-connection.ts   ← connect → handler → disconnect
│   │   └── printers.ts              ← @mongez/copper colored output
│   └── migration/migration-runner.ts  ← the singleton the Operations API wraps
└── bin/
    └── cascade.mjs                  ← side-effect import of esm/cli.js
```

## The seam — Operations API

`@warlock.js/cascade/src/operations/` exports **functions, not classes**. They orchestrate the existing `migrationRunner` singleton and `dataSourceRegistry` driver lookups. No new state is introduced — the runner remains the canonical registration point; callers do `migrationRunner.register(MigrationClass)` (or use the CLI's `loadMigrations` helper) before invoking `runMigrations()`.

The seven public exports cluster into two roles:

- **Migration ops** (`migrations.ts`) — `runMigrations` / `rollbackMigrations` / `freshMigrate` / `exportMigrationsSQL` / `listExecutedMigrations`. Each is a 1–3 line wrapper over the corresponding `migrationRunner` method, picked to be the intent-named verb a consumer reaches for ("run", "rollback", "fresh") rather than the implementation method ("runAll", "rollbackAll", "fresh"). The renaming buys API stability — `runMigrations`' shape stays stable even if `migrationRunner.runAll`'s argument list grows.
- **Database ops** (`database.ts`) — `createDatabase` / `dropAllTables`. These resolve a data source via `dataSourceRegistry.get(connection)`, call the driver method, return a typed result (`{ created, name }` or `{ tables, dropped }`). They exist because the raw driver call requires registry-lookup plus driver chaining at every call site; the function collapses that into one named entry.

**Print/log policy.** Operations API returns structured data and prints nothing. CLI consumers print. The migration runner still emits progress through `@warlock.js/logger` (`log.info` / `log.warn` / etc.) — that's the runner's own concern, not the Ops API's. Library consumers who don't want runner logs configure the logger's `minLevel` themselves.

## Two consumers, one path

The Operations API has two consumers today:

1. **Warlock-core's CLI actions** (`@warlock.js/core/src/database/*-action.ts`). They handle warlock-specific glue — file discovery (`getFilesFromDirectory(srcPath("app"), ...)`), config-registered migrations (`warlockConfigManager.get("database")?.migrations`), `filesOrchestrator.load` for TS files in the dev-server pipeline. Once registration is done, they hand off to the Ops API for actual execution. The drop-tables action also keeps direct registry access for the *introspection* phase (listing tables + per-table row counts before a destructive confirm) — the Ops API surfaces actions, not reads.
2. **Cascade's standalone `cascade` binary** (`@warlock.js/cascade/src/cli*`). Scope is narrower — migration ops only, no `db:create` / `db:drop-tables` (those need project context to know which DB to act on; cascade-standalone has no config file naming the DB). Config is env-only. Migration files are discovered by glob (`./migrations/**/*.{ts,js,mjs,cjs}` from cwd) and loaded via plain `await import()`.

The two share zero state at runtime — each starts its own Node process, registers its own DataSource, calls into the same Operations API. Bug-for-bug identical behavior is verified end-to-end against the live `ai` PostgreSQL DB (36 migrations).

## Standalone CLI configuration — env only

No `cascade.config.{ts,js}`. Two reasons settled it: (1) the cascade CLI's knob universe is small — connection plus migrationDefaults — and env vars cover all of it with one validation per knob; (2) adding a discoverable config file makes the "fancier than env" path the default expectation. Users would assume they need one even when they don't. The minute `cascade.config.{ts,js}` exists, every tutorial and Stack Overflow answer recommends adding one, and the simple path feels incomplete. Revisit trigger: cascade-specific env vars climb past 5–6, **or** scope expands beyond migrations.

What the CLI reads:

| Env var | Maps to | Aliases |
|---|---|---|
| `DATABASE_URL` | Driver `connectionString` / `uri` | `DB_URL` |
| `DB_DIALECT` | Driver selection (`postgres` / `mongodb`) | `DB_DRIVER` |
| `DB_HOST` | Driver host | — |
| `DB_PORT` | Driver port | — |
| `DB_NAME` | Driver database | — |
| `DB_USER` | Driver user | `DB_USERNAME` |
| `DB_PASSWORD` | Driver password | — |
| `CASCADE_PRIMARY_KEY` | `DataSource.migrationDefaults.primaryKey` (`uuid` / `int` / `bigInt`) | — |
| `CASCADE_UUID_STRATEGY` | `DataSource.migrationDefaults.uuidStrategy` (`v4` / `v7`) | — |

Aliases let an existing warlock project's `.env` (which uses `DB_URL` / `DB_DRIVER` / `DB_USERNAME`) work with the cascade binary unchanged. `.env` is auto-loaded via `@mongez/dotenv`'s `loadEnv()` at CLI start, wrapped in try/catch so missing `.env` is a no-op rather than a crash.

The migration-defaults env vars matter because `Migration.create()` derives the table's primary-key column from `migrationDefaults.primaryKey`. A warlock project sets this to `uuid` in `src/config/database.ts`; cascade's library default is `int`. Without `CASCADE_PRIMARY_KEY=uuid`, the cascade CLI registers a DataSource with `primaryKey: "int"`, so the same migrations that work under `warlock migrate` produce INT primary keys — then foreign keys declared as `uuid()` can't reference them and Postgres rejects with "cannot be implemented" (the iteration log F.3 captures the live diagnosis).

## Lifecycle helpers

Three small helpers in `src/cli/` keep each command file under 60 lines:

- `setLoggerConfig(options?)` — registers a `ConsoleLog` channel on `@warlock.js/logger`. The logger ships with zero channels by default; without this step every `log.*` call from the migration runner is a silent no-op in standalone mode. Accepts optional `showContext` + `minLevel` overrides.
- `withCliConnection(handler)` — wraps a command body in `connectFromEnv()` → `handler()` → `disconnect()` (every data source in the registry). Disconnect errors are swallowed so they can't mask the handler's real error; the process is exiting anyway.
- `loadMigrations(pattern?)` — globs migration files via `fast-glob`, dynamic-imports each, registers on `migrationRunner`. Throws a helpful error pointing at `tsx node_modules/.bin/cascade migrate` when a `.ts` file fails to load — cascade ships no transpiler, so TS users invoke through their own runtime.

## Command surface — colons, not flags

Cascade CLI uses colon-keyed subcommands (`cascade migrate:list`, `cascade migrate:rollback`) rather than the flag-style core uses (`warlock migrate --list`). Two reasons:

1. **Citty-native.** Colon-keyed subcommands are discrete entries in `subCommands`, each with their own `meta` and `args` block. Help text and arg validation stay tight per command.
2. **Discoverability.** Verbs are more discoverable in shell completion than flag combinations. `cascade migrate:` + Tab beats remembering which flags are valid on `migrate`.

The divergence from core's flag style is acceptable because they're different binaries with different conventions and different consumers. Every command provides a short-flag alias matching warlock-core conventions where they line up (`-f` = fresh, `-s` = sql, `-c` = compact, `-p` = path, `-a` = all).

## What's not in scope

- **`seed`.** Seeds are app-data, not schema. They stay fully in warlock-core where the dev-server's TS loader can resolve seed modules against the project's `src/app`.
- **`db:create` / `db:drop-tables` in the binary.** These need project context to know which DB to act on. A standalone Cascade user has no `db:create` use case without a config file naming the DB — and we chose env-only. Both remain in the Operations API for core to consume; both stay accessible via warlock's CLI.
- **Multi-connection in the binary.** Cascade-standalone registers one default DataSource from env. Multi-connection is a warlock-context feature where config can describe named sources.
- **A `cascade init` / scaffolding command.** Cascade-standalone users author their own `migrations/` folder.

## Verification (live `ai` PostgreSQL DB)

- `cascade migrate:list` reads `_migrations` and renders 36 entries (34 project + 2 warlock-auth from `@warlock.js/auth`'s config-registered migrations).
- `cascade migrate -p "src/app/**/migrations/*.ts" -f` rolls back 34/34 + runs 34/34 in a single batch transaction.
- `warlock migrate -f` unaffected — 36/36 round trip — proving the pass-through actions in `@warlock.js/core/src/database/*-action.ts` preserve behavior.
- `tsc --noEmit` clean monorepo-wide.

## Follow-ups (non-blocking)

1. **`removeMigrationRecord` persistence is suspect.** During cascade's `-f` failure-and-retry sequence in the iteration log, the rollback phase logged "Rolled back: X successfully" for all 34 migrations, but `_migrations` retained all 36 entries after the subsequent runAll failure. Likely a transaction-state propagation issue inside `migrationRunner.runMigration("down")`. Runner-side concern, not CLI.
2. **`freshMigrate` summary line** prints "68/68" (rollback 34 + run 34) because results are returned as one concatenated array. The printer should differentiate phases. Easy follow-up.
3. **`MigrationDefaults` env-var coverage incomplete.** `uuidExpression` (raw SQL override) not yet env-supported — would need `CASCADE_UUID_EXPRESSION`. Add when a user asks.

# 2026-05-22 — Operations API + Standalone CLI

**Status:** completed
**Started:** 2026-05-22
**Code committed:** 2026-05-23 (commit `f5419691`)
**Docs committed:** 2026-05-23 (follow-up — Section D)
**Context:** DB CLI commands (`migrate`/`create-database`/`drop-tables`) lived in `@warlock.js/core/src/cli/`, with action files in `core/src/database/*-action.ts` already reaching into Cascade's `migrationRunner`/`dataSourceRegistry`. Split was upside-down. Moved DB-op orchestration into Cascade as a named **Operations API**, added a Cascade-owned **citty-based CLI binary** (`cascade ...`) consuming that API, shrank core's actions to thin pass-throughs. Core's hand-rolled CLI runtime stays — only action bodies changed.

## Locked decisions

1. **Option 2** (Ops API + pass-throughs in core) over Option 1 (extract `@warlock.js/cli`). No new shared CLI package.
2. **Cascade ships its own `cascade` binary** on the Operations API; warlock-core's CLI consumes the same API.
3. **Citty** for Cascade CLI — types-first, ~5KB, clean subcommand nesting.
4. **Core's CLI stays hand-rolled** — `preload`/`persistent`/auto-discovery have no citty equivalent; migration would be pure churn.
5. **Two CLI patterns in monorepo** acceptable — different scopes, different tools.
6. **Operations API scope:** `runMigrations` / `rollbackMigrations` / `freshMigrate` / `exportMigrationsSQL` / `listExecutedMigrations` / `createDatabase` / `dropAllTables`. Core consumes all; Cascade's binary exposes migration ops only.
7. **Cascade binary surface = migrations only.** `cascade migrate` + `migrate:list` + `migrate:rollback` + `migrate:export-sql`. No `db:*` in binary.
8. **No `cascade.config.{js,ts}`** — env-only. Re-affirmed 2026-05-23 after env-var support fully solved the migrationDefaults case (see #17). Revisit trigger: cascade-specific env vars > 5–6, OR scope expands beyond migrations.
9. **Migration file discovery in binary:** convention `./migrations/**/*.{ts,js,mjs,cjs}` from cwd, override via `--path <glob>` flag.
10. **Colon-style** command nesting in Cascade CLI (`cascade migrate:list`). Core's flag-style stays.
11. **Single connection only** in Cascade binary.
12. **Operations API returns data; CLI prints.** `migrationRunner`'s existing `verbose: boolean` stays as-is.
13. **Registry-based input** — `runMigrations()` operates on whatever's already registered on `migrationRunner`. No `MigrationClass[]` parameter.
14. **`seed` stays fully in core** — app-data, not schema.
15. **`setLoggerConfig()` helper** registers `ConsoleLog` channel on `@warlock.js/logger`. Logger ships with zero channels by default; without this, every `log.*` call from the runner is a silent no-op in standalone mode. Optional `showContext` + `minLevel` overrides.
16. **`withCliConnection(handler)` wraps every command** — connect → run → disconnect. Disconnect errors swallowed so they can't mask the handler's real error.
17. **`migrationDefaults` configurable via env** — `CASCADE_PRIMARY_KEY` (`uuid` | `int` | `bigInt`) and `CASCADE_UUID_STRATEGY` (`v4` | `v7`). Unset → cascade library defaults (`int` / `v4`). Without this, `Migration.create()` generates wrong PK types vs warlock projects → FK type mismatch on fresh-from-zero runs (surfaced by live integration test — see F.3).
18. **Env-var aliases** — `DATABASE_URL` ↔ `DB_URL`, `DB_DIALECT` ↔ `DB_DRIVER`, `DB_USER` ↔ `DB_USERNAME`. Lets an existing warlock project `.env` work with the cascade binary unchanged.
19. **`.env` auto-load** via `@mongez/dotenv`'s `loadEnv()` at CLI start, wrapped in try/catch — missing `.env` is no-op, not crash.

## Tasks

### A. Cascade — Operations API ✓

- [x] `src/operations/migrations.ts` — `runMigrations`, `rollbackMigrations`, `freshMigrate`, `exportMigrationsSQL`, `listExecutedMigrations`. Returns structured data; no printing.
- [x] `src/operations/database.ts` — `createDatabase`, `dropAllTables`. Internal `DataSourceSelector` shape (anonymous) to avoid name collision with `utils/connect-to-database`'s `ConnectionOptions`.
- [x] `src/operations/index.ts` — barrel.
- [x] `src/index.ts` re-exports the `operations` block.

### B. Cascade — Standalone CLI ✓

- [x] `_package.json`: `citty ^0.2.2` + `fast-glob ^3.3.3` + `@mongez/dotenv ^1.1.9` added to deps; `commander` removed from devDeps; `bin: { cascade: "./bin/cascade.mjs" }`.
- [x] `bin/cascade.mjs` — one-line side-effect import of `../esm/cli.js` (matches `@warlock.js/core/bin/warlock.js`).
- [x] `src/cli.ts` — top-level entry; calls `setLoggerConfig()`, `loadEnv()` (try/catch), then `runMain(main)`.
- [x] `src/cli/index.ts` — citty root + colon-keyed subcommands.
- [x] `src/cli/commands/migrate.ts` — `cascade migrate` (`-f/--fresh`, `-s/--sql`, `--pending-only`, `-c/--compact`, `-p/--path`).
- [x] `src/cli/commands/migrate-list.ts` — `cascade migrate:list`.
- [x] `src/cli/commands/migrate-rollback.ts` — `cascade migrate:rollback` (`-a/--all`, `--batches`, `-p/--path`).
- [x] `src/cli/commands/migrate-export-sql.ts` — `cascade migrate:export-sql` (`--pending-only`, `-c/--compact`, `-p/--path`).
- [x] `src/cli/setup-logger.ts` — `setLoggerConfig(options?)` registering a `ConsoleLog` channel.
- [x] `src/cli/with-cli-connection.ts` — `withCliConnection(handler)` wrapping each command in connect → handler → disconnect.
- [x] `src/cli/connection-from-env.ts` — `detectDialect` + `connectFromEnv` (async, opens driver pool). Reads canonical + warlock-shaped alias names; also reads `CASCADE_PRIMARY_KEY` / `CASCADE_UUID_STRATEGY` and threads them through as `migrationDefaults`.
- [x] `src/cli/printers.ts` — colored output via `@mongez/copper`; inline `formatDate` (no `dayjs` dep in cascade).
- [x] `src/cli/load-migrations.ts` — `fast-glob` discovery + dynamic `import()` with helpful error pointing at `tsx cascade migrate` when a `.ts` file fails to load.
- [x] No TS loader bundled (no jiti). Cascade stays opinion-free about TS runtime.

### C. Core — slim action bodies ✓

- [x] `core/src/database/migrate-action.ts` — `listMigrationsAction` calls `listExecutedMigrations()`; main flow uses `runMigrations()` / `rollbackMigrations({ all: true })` / `freshMigrate()` / `exportMigrationsSQL()`. Project glue (file globs, `filesOrchestrator.load`, warlock-config migrations) unchanged; `migrationRunner.register()` still used for project migration registration.
- [x] `core/src/database/create-database-action.ts` — `createDatabase(name, { connection })`. Inline registry lookup removed.
- [x] `core/src/database/drop-tables-action.ts` — `dropAllTables()` for both `--force` and post-confirm paths. Preview phase (per-table row counts) keeps direct driver access since the Operations API surfaces actions, not introspection.
- [x] Command definition files (`*.command.ts`) — untouched.
- [x] `tsc --noEmit` clean monorepo-wide.

### D. Skills + docs lockstep ✓

- [x] `domains/cascade/skills/cascade-cli/SKILL.md` — skill for AI assistants (location corrected from the original plan's `@warlock.js/cascade/skills/SKILL.md`; convention is `domains/<domain>/skills/<feature>/SKILL.md` matching the existing `groupby-aggregates` skill).
- [x] `domains/cascade/docs/guides/cli.md` — user-facing guide on the standalone `cascade` binary.
- [x] `domains/cascade/docs/reference/operations-api.md` — method-by-method reference.
- [x] `domains/cascade/design/operations-api.md` (Status: Agreed) — internal spec.
- [x] Prepended decision #10 to `domains/cascade/design/decisions.md`: "Cascade owns DB operations API + standalone CLI; warlock-core's commands become pass-throughs."
- [n/a] `domains/cascade/README.md` update — no existing README and folder layout only gained `skills/cascade-cli/` + one design spec + two docs; no restructuring requiring a README touch.

### E. Verification ✓ (Hasan's project — live `ai` PostgreSQL DB)

- [x] `tsc --noEmit` clean across monorepo after every iteration.
- [x] `yarn cascade --help` renders subcommand list with descriptions.
- [x] `yarn cascade migrate --help` shows all flags with defaults.
- [x] `yarn cascade migrate:list` — reads `_migrations` (36 entries shown).
- [x] `yarn cascade migrate -p "src/app/**/migrations/*.ts" -f` — 34/34 rollback + 34/34 run, succeeded end-to-end after the migrationDefaults fix (F.3).
- [x] `yarn migrate -f` (warlock CLI) — 36/36 rolled back + 36/36 ran successfully → proves core's pass-throughs preserve behavior.
- [ ] Unit tests for Operations API (deferred — covered by integration in F).
- [ ] Smoke against a minimal external (non-warlock) app (deferred to docs phase).

### F. Iteration log — bugs found + fixed during live testing

1. **Driver not connected.** `dataSourceRegistry.register()` only stores the driver; doesn't open the pool. Standalone CLI never called `driver.connect()`. **Fix:** `connectFromEnv` made async, calls `await driver.connect()` after register. `withCliConnection` helper added so every command does connect → run → disconnect.
2. **Silent logging.** `@warlock.js/logger` ships with zero channels; without configuration, every `log.*` call is a no-op. Standalone CLI had no bootstrap step. **Fix:** `setLoggerConfig()` helper in `src/cli/setup-logger.ts`, called from `src/cli.ts` before `runMain`.
3. **FK constraint "cannot be implemented" on fresh-from-zero.** `connectFromEnv` registered DataSource without `migrationDefaults`, so `Migration.create()` fell back to library default `primaryKey: "int"`. Warlock-project migrations declare FK columns as `uuid` (warlock data source has `primaryKey: "uuid"` from `src/config/database.ts`), then reference a PK that cascade-CLI had built as `bigserial` → PostgreSQL rejected with "cannot be implemented." **Fix:** added `CASCADE_PRIMARY_KEY` / `CASCADE_UUID_STRATEGY` env vars, validated, fed into `MigrationDefaults` at registry registration. Same `cascade migrate -f` then succeeded 34/34.
4. **`-f` flag silently ignored.** Citty args defined `fresh` without `alias: "f"`, so `-f` was an unknown flag. **Fix:** added conventional short aliases on all commands (`-f`, `-s`, `-c`, `-p`, `-a`).
5. **Glob expansion under bash.** `yarn cascade migrate -p src/app/**/migrations/*.ts` works on Git Bash (Windows) because `**` doesn't expand by default; users on macOS/Linux must quote the pattern (`"..."`) to prevent shell expansion. Documentation note only.

## Resolved (open questions from initial planning)

1. **TS config runtime** → moot; no config file (decision #8).
2. **Command surface** → colon-style (decision #10).
3. **Operations API input** → registry-based (decision #13).
4. **Print/log semantics** → API returns data, CLI prints, existing `verbose` stays (decision #12).
5. **Multi-connection** → single connection in binary (decision #11).
6. **Binary scope** → migrations-only; `db:*` kept in Operations API for core (decisions #6/#7).
7. **Connection discovery** → env vars (decision #8).
8. **Migration file discovery** → convention + `--path` override (decision #9).

## Follow-ups / known issues (non-blocking)

1. **`removeMigrationRecord` persistence is suspect.** During the cascade `-f` failure-and-retry sequence, the rollback phase logged "Rolled back: X successfully" for all 34 migrations, but `_migrations` retained all 36 entries after the subsequent runAll failure. Hypothesis: `runMigration("down")`'s per-migration transaction wraps `removeMigrationRecord`, and somewhere connection-level transaction state propagated such that the deletions weren't committed when the batch failed. Needs a runner-side dive. Not a Cascade CLI bug.
2. **Summary line for `freshMigrate` prints "68/68"** (rollback 34 + run 34). Technically correct since `freshMigrate` concatenates results into one array, but the printer should differentiate phases. Easy follow-up.
3. **`MigrationDefaults` env-var coverage incomplete.** Currently exposes `primaryKey` + `uuidStrategy`. `uuidExpression` (raw SQL override) not yet env-supported — would need `CASCADE_UUID_EXPRESSION`. Add when a user asks.
4. **TS migration loading** — running `cascade migrate` against `.ts` files requires invoking through a TS runtime (tsx/ts-node/sucrase); cascade CLI deliberately ships no transpiler. Document in CLI guide.

## Summary

Cascade now owns the migration CLI surface. The Operations API (`runMigrations` / `rollbackMigrations` / `freshMigrate` / `exportMigrationsSQL` / `listExecutedMigrations` / `createDatabase` / `dropAllTables`) is the public seam; both warlock-core's CLI and Cascade's own `cascade` binary call into it. Single source of truth, two surfaces, identical behavior.

Standalone CLI configures itself entirely from `.env`: connection vars (canonical + warlock aliases), `CASCADE_PRIMARY_KEY` / `CASCADE_UUID_STRATEGY` for migration defaults. No config file (re-affirmed after env-only solution fully covered the live-DB integration case).

Verified end-to-end against Hasan's live PostgreSQL `ai` database (36 migrations including warlock-config-registered auth ones): `cascade migrate:list`, `cascade migrate`, `cascade migrate -f` all succeed; `warlock migrate -f` continues to pass too. Five iteration bugs surfaced and fixed during live testing (see F).

## Core

- [ ] Generate Swagger Docs from routes and its schema
- [ ] Generate Postman Collection from routes and its schema
- [ ] Generate OpenAPI Docs from routes and its schema

## Release-readiness findings (2026-06-01)

### Fixed (behavior-preserving)
- [x] `src/encryption/types.ts` — `EncryptionConfigurations` JSDoc example set `password: { saltRounds: 12 }`, but `password.ts` reads `encryption.password.salt`. The `saltRounds` form was silently ignored. Corrected the example to `salt: 12`.

### Behavior-change candidates (need sign-off — do NOT change silently)
- [ ] `src/encryption/password.ts` — `loadBcryptjs()` is fire-and-forget at import time; `hashPassword`/`verifyPassword` read a module-level `isModuleExists` flag that is `null` until the dynamic import resolves. A call made before resolution throws the "install bcryptjs" error spuriously even though bcryptjs IS installed. Recommend awaiting a memoized lazy loader inside each function instead. Security-critical path; left as backlog per the no-behavior-change rule.

### Test infrastructure
- [ ] `vitest.config.ts` includes only `tests/unit/**/*.test.ts`. The existing `tests/benchmark/**` and `tests/use-cases/**` suites do NOT run under a bare `npx vitest run`. Either relocate them under `tests/unit/**` or broaden the include to `tests/**/*.test.ts` (confirm they pass first). New unit tests are being added under `tests/unit/**` so they actually execute.

## Core hardening — agent findings (2026-06-01)

### Resource bugs (behavior-change — need sign-off, NOT changed)
- [ ] `arrayOf` sub-schemas silently drop string casts AND renames — `src/resource/resource.ts:358` (`transformArrayItem` → `transformValue`). A bare `"string"`/`"int"` or a `["sub_total","float"]` tuple inside an `arrayOf` schema is never normalized to a builder, so every item serializes to `{}`. Only a builder whose output key equals the item's property name works. Fix: normalize `arrayOf` schemas like top-level schemas. (Pinned as current behavior in tests.)
- [ ] `defineResource` `transform` hook return value is silently discarded — `src/resource/define-resource.ts:84-86` ignores the result, yet `DefineResourceOptions.transform` is typed to return `Record<string, any>`. Either honor the return or retype to `void`. Skill/docs now say "mutate in place".
- [ ] `router.restfulResource` doubles/empties the route-name base — `src/router/router.ts:350-353`. The wrapping `prefix(path)` derives a name segment AND `options.name` re-applies it → `/users` with `name:"users"` yields `users.users.list`; `/products` without a name yields `products..list` (double dot). (Pinned as current behavior in tests.)

### Source docblock drift (doc-only)
- [ ] `src/http/middleware/ip-filter.middleware.ts:40` `@example` uses the nonexistent `router.use(...)` — should be `router.group({ middleware: [...] })` (same fix already applied to the use-middleware skill).
- [ ] `getLocalized` with no `localeCode` outside a request returns `undefined` — behavior is fine but undocumented in source.

### Test infra
- [ ] `tests/unit/own-resolver.equivalence.test.ts` errored at COLLECTION (read a missing `.warlock/resolve-golden.jsonl` at describe-eval, bypassing its own `skipIf`) — guarded to skip cleanly when the golden file is absent (2026-06-01).

## Core deep-test pass findings (2026-06-01) — suite 314 → 865 green

### HIGH severity bug — `fileExistsAsync` used on directories (2 sites, both broken)
Root cause: `@warlock.js/fs` `fileExistsAsync` (`fs/src/exists.ts:28`) resolves `stat().isFile()`, which is **false for a directory**. Two core call sites pass a directory:
- [ ] **`src/cli/commands/generate/utils/path-resolver.ts:34`** — `moduleExists()` always returns false → every module-gated generator (`generate.controller`/`service`/`model`/`repository`/`resource`) hits "Module does not exist" → `process.exit(1)` and **can never scaffold into an existing module. The scaffolders are effectively broken.**
- [ ] **`src/storage/drivers/local-driver.ts:494`** — `LocalDriver.list()` always returns `[]` for a real directory (`ScopedStorage.list`/`Storage.list` inherit it).
- **Fix:** switch both to `directoryExistsAsync` (`fs/src/exists.ts:47`). Known-bug tests pin the current behavior (`tests/unit/cli/generators-module-gate.test.ts`, `tests/unit/storage/*`) — flip them when fixing.

### Source docblock drift (doc-only)
- [ ] `src/benchmark/benchmark.ts:41` — `measure()` JSDoc example calls a non-existent `isSuccessResult` guard (won't compile).
- [ ] `src/dev-server/parse-imports.ts:153` — docblock claims `export { type X } from "..."` is handled, but `isTypeOnlyFile` returns *runtime* for inline-`type` re-exports (only `export type { … }` is recognized).
- [ ] `src/cli/parse-cli-args.ts:13` — JSDoc says `migrate --rollback file.ts` → `{ rollback: true }`; actual behavior consumes the token → `{ rollback: "file.ts" }`.

### Behavior facts (not bugs — for awareness)
- Unknown HTTP method yields Fastify **404, not 405** (no method-not-allowed handler in `router.scan`).
- `environment()` reads `process.env.NODE_ENV` (`src/utils/environment.ts:4`), not any `app.*` config — that drives the error-`stack` toggle.

### Test infra
- vitest include broadened to `tests/{unit,integration}/**`; legacy `tests/use-cases/` deleted (dead — used removed `retries:{count}` API), `tests/benchmark/` relocated to `tests/unit/benchmark/`. Zero rotting test files remain.
- **DB tests are MOCK-level** — Docker is not installed on this machine (`docker: command not found`), so the real testcontainers (Mongo+PG) integration for `database`/`repositories` is still TODO for true execution coverage.

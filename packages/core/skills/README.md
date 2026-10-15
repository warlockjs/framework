# @warlock.js/core — skills index

Each folder holds one `SKILL.md` (an agent-facing how-to for a single task). The `llms.txt` / `llms-full.txt` at the package root are **generated projections** of this folder — run `node scripts/generate-llms.mjs` from the package root after any skill change; never hand-edit them.

## HTTP layer

- `register-route` — register single routes, prefix groups, middleware-guarded blocks, and RESTful resource chains.
- `build-restful` — generate standard CRUD endpoints via the `router.route(...)` chain or the `Restful` base class.
- `create-controller` — author HTTP controllers: `RequestHandler` signature, validated input, response helpers, middleware, `responseSchema` response types.
- `send-response` — `Response` helpers: success/error variants, status helpers, redirects, files, streams, SSE.
- `validate-input` — author seal schemas, attach them to controllers, infer types, layer DTOs.
- `use-middleware` — attach built-in HTTP middleware (rateLimit, concurrencyLimit, maxBodySize, …) via the `middleware` namespace.
- `write-middleware` — author HTTP middleware: the `({ request, response })` signature, short-circuit, request enrichment.
- `build-url` — HTTP URL helpers (`url`, `publicUrl`, `assetsUrl`, `uploadsUrl`) anchored at `app.baseUrl`.
- `upload-file` — handle multipart uploads: `request.file()`, `v.file()` validation, `UploadedFile.save()`.
- `health-checks` — built-in `/health` + `/ready` endpoints, the `health` registry, and graceful request draining.

## Data layer

- `use-repository` — subclass `RepositoryManager`: `source`/`filterBy`/`defaultOptions`, list/find/CRUD, cached/cursor variants, and the `filterBy`-aware aggregates (`sum`/`avg`/`min`/`max`/`groupBy`/`aggregate`).
- `use-model-transformers` — schema-side helpers: `useHashedPassword()`, `useComputedSlug()`, and friends.
- `define-resource` — map model fields to wire-shape via `defineResource()` / `Resource` subclasses (output-only); typed output with `ResourceOutput`, `Serialized<T, W>` and `ModelResourceRegistry`.
- `write-seeder` — author a seed file with `seeder()` — `name`/`dependsOn`/`once`/`order`/`batchSize`, `run({ track, now, batchSize })`, `warlock seed --drop`.

## Files, media, mail

- `store-file` — read/write/delete files via the `storage` singleton (local/S3/R2/DO Spaces), `StorageFile` handles, presigned URLs.
- `process-image` — transform images with the `Image` class (resize, crop, rotate, format, watermark, …) on a deferred pipeline.
- `send-mail` — send transactional email: the `Mail` fluent builder, `sendMail()`, React Email, test-mode capture.

## App, config, lifecycle

- `configure-app` — the two config layers (`warlock.config.ts` vs `src/config/*.ts`), `.env` + `env()`.
- `use-app-context` — read app-wide context via the `Application` static class and the `app` runtime accessor.
- `add-connector` — extend the lifecycle with a `BaseConnector` subclass (`start`/`shutdown`/`watchedFiles`).
- `wire-socket` — configure Socket.IO, reach the live server via `getSocketServer()` / `app.socket`.
- `use-localization` — multi-locale translations: `groupedTranslations`, `t()` (always, never `request.t()`), locale resolution.

## Use-cases & services

- `write-use-case` — author `useCase()` pipelines: guards, schema, before/after, retry, benchmark, broadcast, lifecycle.
- `create-module` — scaffold a feature module under `src/app/<name>/` via `warlock generate.module` + follow-up generators.

## CLI & operations

- `warlock-doctor` — `warlock doctor`: read-only diagnostics (routes/config/connectors/optional-peers/health/release-hygiene) with a pass/warn/fail report and non-zero exit on failure.
- `warlock-routes` — `warlock routes`: list the registered HTTP routes as a verb-colored table (method/path/name/action/middleware/source); filter by method/path/name or emit JSON. Read-only, no connectors.
- `write-cli-command` — author a custom `warlock <cmd>` via the `command()` factory, or inspect built-in `warlock add` feature scaffolding such as the Web starter.
- `generate-openapi` — `warlock generate.openapi`: an OpenAPI 3.1 document from the routes (validation, `responseSchema`, auth), plus the dev-only API docs page.
- `run-app` — `warlock dev` / `warlock build` / `warlock start` operational commands.
- `update-packages` — bump every `@warlock.js/*` dependency with `warlock update`.

## Testing

- `test-http` — integration tests against a real HTTP server (`startHttpTestServer()`, `testGet` / `testPost`).
- `test-service` — pure unit tests against services/repositories/models/use-cases via `setupTest({ connectors })`.

## Utilities

- `encrypt-data` — reversible AES-256-GCM `encrypt`/`decrypt`, plus one-way `hmacHash` fingerprints.
- `hash-password` — one-way bcrypt `hashPassword`/`verifyPassword` and the `useHashedPassword()` transformer.
- `resolve-path` — path helpers anchored at `process.cwd()` (`rootPath`, `srcPath`, `appPath`, …).
- `benchmark-code` — time a function with `measure(name, fn, options?)` and classify the latency.
- `retry-operation` — wrap a flaky operation with `retry(fn, options)` (now from `@mongez/reinforcements`).
- `lower-stage3-decorators` — the `lowerStage3Decorators()` Vite/Vitest plugin for native decorators.
- `warlock-conventions` — framework-wide invariants: module layout, canonical imports, layered flow, file naming.

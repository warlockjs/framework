# @warlock.js/core — skills index

Each folder holds one `SKILL.md` (an agent-facing how-to for a single task). The `llms.txt` / `llms-full.txt` at the package root are **generated projections** of this folder — run `node scripts/generate-llms.mjs` from the package root after any skill change; never hand-edit them.

## HTTP layer

- [register-route](register-route/SKILL.md) — register single routes, prefix groups, middleware-guarded blocks, and RESTful resource chains.
- [build-restful](build-restful/SKILL.md) — generate standard CRUD endpoints via the `router.route(...)` chain or the `Restful` base class.
- [create-controller](create-controller/SKILL.md) — author HTTP controllers: `RequestHandler` signature, validated input, response helpers, middleware.
- [send-response](send-response/SKILL.md) — `Response` helpers: success/error variants, status helpers, redirects, files, streams, SSE.
- [validate-input](validate-input/SKILL.md) — author seal schemas, attach them to controllers, infer types, layer DTOs.
- [use-middleware](use-middleware/SKILL.md) — attach built-in HTTP middleware (rateLimit, concurrencyLimit, maxBodySize, …) via the `middleware` namespace.
- [write-middleware](write-middleware/SKILL.md) — author HTTP middleware: the `(request, response)` signature, short-circuit, request enrichment.
- [build-url](build-url/SKILL.md) — HTTP URL helpers (`url`, `publicUrl`, `assetsUrl`, `uploadsUrl`) anchored at `app.baseUrl`.
- [upload-file](upload-file/SKILL.md) — handle multipart uploads: `request.file()`, `v.file()` validation, `UploadedFile.save()`.
- [health-checks](health-checks/SKILL.md) — built-in `/health` + `/ready` endpoints, the `health` registry, and graceful request draining.

## Data layer

- [use-repository](use-repository/SKILL.md) — subclass `RepositoryManager`: `source`/`filterBy`/`defaultOptions`, list/find/CRUD, cached/cursor variants, and the `filterBy`-aware aggregates (`sum`/`avg`/`min`/`max`/`groupBy`/`aggregate`).
- [use-model-transformers](use-model-transformers/SKILL.md) — schema-side helpers: `useHashedPassword()`, `useComputedSlug()`, and friends.
- [define-resource](define-resource/SKILL.md) — map model fields to wire-shape via `defineResource()` / `Resource` subclasses (output-only).
- [write-seeder](write-seeder/SKILL.md) — author a seed file with `seeder()` — `name`/`dependsOn`/`once`/`order`/`batchSize`, `run({ track, now, batchSize })`, `warlock seed --drop`.

## Files, media, mail

- [store-file](store-file/SKILL.md) — read/write/delete files via the `storage` singleton (local/S3/R2/DO Spaces), `StorageFile` handles, presigned URLs.
- [process-image](process-image/SKILL.md) — transform images with the `Image` class (resize, crop, rotate, format, watermark, …) on a deferred pipeline.
- [send-mail](send-mail/SKILL.md) — send transactional email: the `Mail` fluent builder, `sendMail()`, React Email, test-mode capture.

## App, config, lifecycle

- [configure-app](configure-app/SKILL.md) — the two config layers (`warlock.config.ts` vs `src/config/*.ts`), `.env` + `env()`.
- [use-app-context](use-app-context/SKILL.md) — read app-wide context via the `Application` static class and the `app` runtime accessor.
- [add-connector](add-connector/SKILL.md) — extend the lifecycle with a `BaseConnector` subclass (`start`/`shutdown`/`watchedFiles`).
- [wire-socket](wire-socket/SKILL.md) — configure Socket.IO, reach the live server via `getSocketServer()` / `app.socket`.
- [use-localization](use-localization/SKILL.md) — multi-locale translations: `groupedTranslations`, `t()` / `request.t()`, locale resolution.

## Use-cases & services

- [write-use-case](write-use-case/SKILL.md) — author `useCase()` pipelines: guards, schema, before/after, retry, benchmark, broadcast, lifecycle.
- [create-module](create-module/SKILL.md) — scaffold a feature module under `src/app/<name>/` via `warlock generate.module` + follow-up generators.

## CLI & operations

- [warlock-doctor](warlock-doctor/SKILL.md) — `warlock doctor`: read-only diagnostics (routes/config/connectors/optional-peers/health/release-hygiene) with a pass/warn/fail report and non-zero exit on failure.
- [warlock-routes](warlock-routes/SKILL.md) — `warlock routes`: list the registered HTTP routes as a verb-colored table (method/path/name/action/middleware/source); filter by method/path/name or emit JSON. Read-only, no connectors.
- [write-cli-command](write-cli-command/SKILL.md) — author a custom `warlock <cmd>` via the `command()` factory (name, action, options, preload).
- [run-app](run-app/SKILL.md) — `warlock dev` / `warlock build` / `warlock start` operational commands.
- [update-packages](update-packages/SKILL.md) — bump every `@warlock.js/*` dependency with `warlock update`.

## Testing

- [test-http](test-http/SKILL.md) — integration tests against a real HTTP server (`startHttpTestServer()`, `testGet` / `testPost`).
- [test-service](test-service/SKILL.md) — pure unit tests against services/repositories/models/use-cases via `setupTest({ connectors })`.

## Utilities

- [encrypt-data](encrypt-data/SKILL.md) — reversible AES-256-GCM `encrypt`/`decrypt`, plus one-way `hmacHash` fingerprints.
- [hash-password](hash-password/SKILL.md) — one-way bcrypt `hashPassword`/`verifyPassword` and the `useHashedPassword()` transformer.
- [resolve-path](resolve-path/SKILL.md) — path helpers anchored at `process.cwd()` (`rootPath`, `srcPath`, `appPath`, …).
- [benchmark-code](benchmark-code/SKILL.md) — time a function with `measure(name, fn, options?)` and classify the latency.
- [retry-operation](retry-operation/SKILL.md) — wrap a flaky operation with `retry(fn, options)` (now from `@mongez/reinforcements`).
- [lower-stage3-decorators](lower-stage3-decorators/SKILL.md) — the `lowerStage3Decorators()` Vite/Vitest plugin for native decorators.
- [warlock-conventions](warlock-conventions/SKILL.md) — framework-wide invariants: module layout, canonical imports, layered flow, file naming.

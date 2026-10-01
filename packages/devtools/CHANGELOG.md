# Changelog — @warlock.js/devtools

All notable changes to `@warlock.js/devtools` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.28.0 - 2026-10-01

### Added

- **Swagger UI.** `/__warlock/docs/swagger` renders the same OpenAPI document with [Swagger UI](https://github.com/swagger-api/swagger-ui) (Apache-2.0), and the dashboard's **API** tab has a **Scalar | Swagger UI** switch (Scalar stays the default; the choice is remembered in the browser). The prebuilt `swagger-ui-dist` 5.33.0 bundle and stylesheet are vendored in `ui/vendor/swagger-ui/` with their license and notice and served as `assets/swagger-ui-bundle.js` and `assets/swagger-ui.css`, so apps install no extra dependencies. The schema validator badge is off, so the page makes no outside request.
- **Downloads in the API tab.** `OpenAPI JSON` (`/__warlock/api/openapi.json`) and `Postman collection` links.
- **`GET /__warlock/api/postman.json`** returns the Postman collection for the registered routes, built by core's `getDevelopmentPostmanCollection()`. It answers 503 when the host's core cannot build one, with the same dev-only, loopback-only guard.

## 5.27.0 - 2026-10-01

### Added

- **API docs page.** `/__warlock/docs` renders the app's OpenAPI 3.1 document with Scalar, and the dashboard has a new **API** tab that shows it. The document comes from `GET /__warlock/api/openapi.json`, built in-process by core's `buildDevelopmentOpenApiDocument()` from the routes already registered (the same generator as `warlock generate.openapi`); it answers 503 when the host provides none. Everything stays behind the existing dev-only, loopback-only guard.
- The API docs page uses [Scalar](https://github.com/scalar/scalar) (MIT). Its prebuilt browser bundle (1.72.2) is vendored in `ui/vendor/scalar/` and served as `assets/scalar.js`, so apps install no extra dependencies. Nothing is fetched from a CDN, and the page turns off Scalar's web fonts, telemetry, AI agent and MCP so it makes no outside request.

## 5.26.0 - 2026-09-30

### Changed

- Dependencies: `fastify` ^5.12.5 (security fixes).

## 5.25.0 - 2026-09-28

### Added

- New package. A development-only dashboard served at `/__warlock`: request timeline, queries with EXPLAIN, N+1 detection, dev mailbox, logs, cache operations and the route map. It refuses to run outside development and answers only loopback clients.

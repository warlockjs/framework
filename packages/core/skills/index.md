---
description: 'Warlock application runtime: `router`, `Request`, `Response`, `config`, `env`, `sendMail` and `defineConfig`. Use for "add an API route", controllers, middleware, CLI commands, config, uploads, mail, sockets, OpenAPI, testing or upgrades. Not this package → @warlock.js/web for React SSR pages; @warlock.js/cascade for database queries; @warlock.js/seal for standalone schemas; @warlock.js/auth for login.'
---

# @warlock.js/core

Core is the application runtime: it boots the app, auto-loads each module's special files, serves HTTP, and provides the helpers every feature layer uses. Features live in `src/app/<module>/` and flow one way: `routes.ts → controllers → services → repositories → models`; resources map output at the edge. Start with `warlock-conventions.md`, which every other topic assumes.

## The 80% path

1. Scaffold a module (`create-module.md`), then declare routes in its `routes.ts` (`register-route.md`, `warlock-routes.md`).
2. Write a thin controller (`create-controller.md`); validate input with a schema attached to the handler (`validate-input.md`).
3. Put logic in a service or use case (`write-use-case.md`), and data access in a repository (`use-repository.md`).
4. Return via `response.*` (`send-response.md`) and shape output with a resource (`define-resource.md`); declare `responseSchema` for typed clients and docs (`create-controller.md`, `generate-openapi.md`).
5. Configure and run (`configure-app.md`, `run-app.md`); check setup with `warlock-doctor.md`, read the app with `warlock-inspect.md` (or serve it to an agent with `warlock-mcp.md`), verify a change with `warlock-check.md`, a request's runtime behaviour with `warlock-trace.md`, and what happened to a past request with `request-log.md`.

When the framework is wrong or missing a capability, follow the `report-framework-issue` topic to prepare a public report and ask the user before filing.

## Topics by area

- **Foundations:** warlock-conventions, create-module, make-endpoint, configure-app, build-budgets, use-app-context, resolve-path, build-url, update-packages, lower-stage3-decorators, upgrade-from-5-29
- **HTTP & routing:** register-route, warlock-routes, create-controller, use-middleware, write-middleware, validate-input, use-request-locals, build-restful, wire-socket
- **Responses & resources:** send-response, define-resource, use-model-transformers, use-localization
- **Domain layers:** write-use-case, use-repository, write-seeder
- **CLI & running the app:** generate-web-ui, run-app, deploy-release, write-cli-command, add-connector, health-checks, warlock-doctor, warlock-inspect, use-capabilities, warlock-check, generate-openapi
- **Agent tooling:** warlock-mcp, warlock-trace, warlock-agents-md, warlock-board
- **Storage, files & mail:** store-file, upload-file, process-image, send-mail
- **Security & utilities:** hash-password, encrypt-data, store-secrets, retry-operation, app-singletons, benchmark-code, request-memo, request-tracing, request-log
- **Testing:** test-browser, test-http, test-service, test-fakes, model-factories

## Conventions and pitfalls

- Several files are auto-loaded (`routes.ts`, `main.ts`, `events/*`, `utils/locales.ts`, `src/config/*`); never import them by hand.
- Core does NOT re-export `v`/`Infer` (import from `@warlock.js/seal`), or `Model`/`Migration` (from `@warlock.js/cascade`).
- Controllers stay thin: no business logic, transactions, or external API calls. Resources are output-only.
- No per-action `*.request.ts` files; schema files export the value and the inferred type together.
- Prefer typed model getters over scattered `.get<T>("field")` casts.

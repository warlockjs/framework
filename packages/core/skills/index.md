---
description: "The Warlock server framework: HTTP routes, controllers, responses, resources, repositories, CLI, mail, storage, security helpers. Exports `router`, `Request`, `Response`, `RequestHandler`, `useCase`, `RepositoryManager`, `defineResource`, `defineConfig`, `storage`, `sendMail`, `hashPassword`, `command`. Use for: add a route, write a controller, return a JSON response, hide a field from the response, upload a file, send an email, hash a password, add a CLI command, wire a socket, run or configure the app. Not this package: database models/queries → @warlock.js/cascade; input schemas → @warlock.js/seal; SSR pages → @warlock.js/web."
---
# @warlock.js/core

Core is the application runtime: it boots the app, auto-loads each module's special files, serves HTTP, and provides the helpers every feature layer uses. Features live in `src/app/<module>/` and flow one way: `routes.ts → controllers → services → repositories → models`; resources map output at the edge. Start with `warlock-conventions.md`, which every other topic assumes.

## The 80% path
1. Scaffold a module (`create-module.md`), then declare routes in its `routes.ts` (`register-route.md`, `warlock-routes.md`).
2. Write a thin controller (`create-controller.md`); validate input with a schema attached to the handler (`validate-input.md`).
3. Put logic in a service or use case (`write-use-case.md`), and data access in a repository (`use-repository.md`).
4. Return via `response.*` (`send-response.md`) and shape output with a resource (`define-resource.md`).
5. Configure and run (`configure-app.md`, `run-app.md`); check setup with `warlock-doctor.md`.

## Topics by area
- **Foundations:** warlock-conventions, create-module, configure-app, use-app-context, resolve-path, build-url, update-packages, lower-stage3-decorators
- **HTTP & routing:** register-route, warlock-routes, create-controller, use-middleware, write-middleware, validate-input, use-request-locals, build-restful, wire-socket
- **Responses & resources:** send-response, define-resource, use-model-transformers, use-localization
- **Domain layers:** write-use-case, use-repository, write-seeder
- **CLI & running the app:** run-app, write-cli-command, add-connector, health-checks, warlock-doctor
- **Storage, files & mail:** store-file, upload-file, process-image, send-mail
- **Security & utilities:** hash-password, encrypt-data, retry-operation, benchmark-code, request-memo, request-tracing
- **Testing:** test-http, test-service

## Conventions and pitfalls
- Several files are auto-loaded (`routes.ts`, `main.ts`, `events/*`, `utils/locales.ts`, `src/config/*`); never import them by hand.
- Core does NOT re-export `v`/`Infer` (import from `@warlock.js/seal`), or `Model`/`Migration` (from `@warlock.js/cascade`).
- Controllers stay thin: no business logic, transactions, or external API calls. Resources are output-only.
- No per-action `*.request.ts` files; schema files export the value and the inferred type together.
- Prefer typed model getters over scattered `.get<T>("field")` casts.

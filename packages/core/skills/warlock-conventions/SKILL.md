---
name: warlock-conventions
description: 'Framework-wide invariants for projects built on @warlock.js/core — module layout, canonical imports, layered flow, file naming, and the non-negotiable rules every other warlock skill assumes. Triggers: `src/app/<module>`, `routes.ts`, `main.ts`, `Request<TSchema>`, `RequestHandler`, `GuardedRequestHandler`, `app/<module>/...`; "where do files go in this project", "canonical Warlock imports", "module layout rules", "controller-service-repository layering"; typical import `import { router, type RequestHandler } from "@warlock.js/core"`. Skip: scaffold a new module — `@warlock.js/core/create-module/SKILL.md`; route shape — `@warlock.js/core/register-route/SKILL.md`; controller shape — `@warlock.js/core/create-controller/SKILL.md`; competing patterns: `express` ad-hoc layouts, `@nestjs/common` decorator-driven structure.'
---

# Warlock — framework-wide conventions

This skill is the foundation. Every other warlock skill (`register-route`, `create-controller`, `send-response`, …) assumes you know these rules. Don't repeat them in task skills — link here instead.

## Always-true facts

1. **Every feature lives in `src/app/<module>/`.** No exceptions. A module is a folder with the standard subfolders (`controllers/`, `services/`, `models/`, `repositories/`, `resources/`, `schema/`, `routes.ts`, `main.ts`). Generate with `warlock generate.module <name>`.
2. **Several files are auto-loaded — never `import` them.** The dev-server file watcher and the production builder categorize these as "special" and load them on boot.
   - `src/app/<module>/routes.ts` — route declarations
   - `src/app/<module>/main.ts` — per-module one-time setup
   - `src/app/main.ts` — **project-level** one-time setup (where `connectorsManager.register(...)`, global hooks, etc. live)
   - `src/app/<module>/events/*.ts(x)` — **any** `.ts(x)` file inside the `events/` folder (the `*.event.ts` suffix is convention, not a framework requirement)
   - `src/app/<module>/utils/locales.ts` — module translations via `groupedTranslations(...)`
   - `src/config/*.ts(x)` — subsystem config files
3. **Canonical imports — each package owns its surface.** `@warlock.js/core` does **NOT** re-export `v`/`Infer` or Cascade types. Import from the home package:
   - `v`, `Infer` → `@warlock.js/seal`
   - `Model`, `RegisterModel`, `Migration`, `onceConnected` → `@warlock.js/cascade`
   - `router`, `RequestHandler`, `Request`, `Response`, `useCase`, `RepositoryManager`, `Resource`, `defineResource`, `Restful`, `defineConfig`, `config`, `env`, `Application`, `BaseConnector`, `connectorsManager`, `storage`, `Mail`, `sendMail`, `hashPassword`, `verifyPassword`, `encrypt`, `decrypt`, `hmacHash`, `measure`, `retry`, `t`, `command`, `CLICommand` → `@warlock.js/core`
   - `cache` → `@warlock.js/cache`
   - `log` → `@warlock.js/logger`
   - `authMiddleware`, `authService` → `@warlock.js/auth`
   - `ai`, `OpenAISDK`, etc. → `@warlock.js/ai*`
4. **Layered flow is one-way.** `routes.ts → controllers → services → repositories → models`. Resources cut across as the wire mapper. Never invert — repositories don't call services, services don't call controllers.
5. **Controllers are thin.** Pull input from `request`, call a service or use-case, return via `response.<helper>()`. No business logic. No transactions. No external API calls.
6. **Resources are output-only.** Map model fields to wire fields and nothing else. Reconciliation, hydration, and computed side-effects belong in services or model accessors — never in resources.
7. **No per-action `*.request.ts` files.** Schema files export **both** the value and the inferred type from one place; controllers consume both directly and type themselves as `RequestHandler<Request<TSchema>>` (or `GuardedRequestHandler<TSchema>` for auth'd routes). Source pattern:

   ```ts title="src/app/<module>/schema/create-<thing>.schema.ts"
   import { v, type Infer } from "@warlock.js/seal";

   export const createThingSchema = v.object({ /* … */ });
   export type CreateThingSchema = Infer<typeof createThingSchema>;
   ```

   ```ts title="src/app/<module>/controllers/create-<thing>.controller.ts"
   import { type GuardedRequestHandler } from "app/auth/types/guarded-request.type";
   import { type CreateThingSchema, createThingSchema } from "../schema/create-thing.schema";
   import { createThingService } from "../services/create-thing.service";

   export const createThingController: GuardedRequestHandler<CreateThingSchema> = async (request, response) => {
     const thing = await createThingService(request.validated());
     return response.success({ thing });
   };

   createThingController.validation = { schema: createThingSchema };
   ```
8. **Model getters beat `.get<T>("field")`.** Add a typed getter on the model rather than scattering `.get<string>("name")` casts across call sites.

## Module layout (the standard subfolders)

```
src/app/<module>/
  controllers/              thin request handlers
  services/                 stateless business logic
  models/<entity>/          Cascade model + migrations
  repositories/             RepositoryManager subclasses
  resources/                Resource subclasses (output mapping)
  schema/                   seal schemas (`<action>.schema.ts`) — value + type from one file
  events/                   any `*.ts(x)` file here is auto-loaded
  types/                    `.type.ts` files for module-internal types
  utils/                    module-private helpers (`utils/locales.ts` is auto-loaded)
  seeds/                    seed data for `warlock seed`
  routes.ts                 ← auto-loaded
  main.ts                   ← auto-loaded once, one-time setup
```

Some older modules still have a `validation/` folder instead of `schema/` — historical drift. The framework treats them as plain folders either way; the generator emits to `schema/`.

## File naming (project-wide)

| Suffix              | Role                                  | Example                             |
| ------------------- | ------------------------------------- | ----------------------------------- |
| `.controller.ts`    | HTTP handler                          | `create-product.controller.ts`      |
| `.service.ts`       | Stateless business logic              | `create-product.service.ts`         |
| `.usecase.ts`       | `useCase()` pipeline                  | `login.usecase.ts`                  |
| `.model.ts`         | Cascade model class                   | `product.model.ts`                  |
| `.repository.ts`    | `RepositoryManager` subclass          | `products.repository.ts`            |
| `.resource.ts`      | `Resource` subclass                   | `product.resource.ts`               |
| `.schema.ts`        | seal validation schema + its inferred `<Name>Schema` type from the same file | `create-product.schema.ts`          |
| `.type.ts`          | data shape (TypeScript `type`)        | `cart-state.type.ts`                |
| `.contract.ts`      | interface (TypeScript `interface`)    | `model.contract.ts`                 |
| `.event.ts`         | event listener registrations (any `.ts(x)` inside `events/` works; the suffix is convention) | `audit.event.ts`                    |
| `.migration.ts`     | Cascade migration                     | `2026_05_22_120000_product.migration.ts` |
| `.seed.ts`          | seed data                             | `products.seed.ts`                  |

Filenames are kebab-case. Class names are PascalCase. Function names are camelCase. Table/collection names are snake_case (plural).

## Path aliases

The scaffolded `tsconfig.json` defines:

```jsonc
{
  "paths": {
    "app/*": ["./src/app/*"]
  }
}
```

Use `app/<module>/...` when crossing module boundaries:

```ts
// ✅ from src/app/orders/services/place-order.service.ts
import { Product } from "app/products/models/product";

// ❌ deep relative path
import { Product } from "../../../products/models/product";
```

Within the same module, use relative paths (`./`, `../`).

## Decorators

Cascade uses `@RegisterModel()` for the model registry and `@BelongsTo` / `@HasMany` / `@MorphTo` for relations. The scaffolded `tsconfig.json` has `"experimentalDecorators": true`. If you ever see "model not registered" errors at runtime, check that flag first.

## See also

- [`register-route/SKILL.md`](../register-route/SKILL.md) — how to wire URLs to controllers.
- [`create-controller/SKILL.md`](../create-controller/SKILL.md) — controller signature, validation, response shape.
- [`send-response/SKILL.md`](../send-response/SKILL.md) — the full Response helper surface.

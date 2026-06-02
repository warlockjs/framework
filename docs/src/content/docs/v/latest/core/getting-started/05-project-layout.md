---
title: "Project layout"
description: The Warlock module convention — src/app/<module>/ subfolders, the auto-loaded files, and what each layer is for.
sidebar:
  order: 5
  label: "Project layout"
---

Warlock's strongest opinion is about where things live. Every feature lives in `src/app/<module>/` with the same subfolders. Once you've read one module, you've read them all — that consistency is the point.

This page walks the convention top to bottom. By the end you'll know exactly where to put any new file and what shape it should take.

## The 30-second tour

```
src/
  app/                          features (one folder per module)
    products/
      controllers/              thin request handlers
      services/                 stateless business logic
      models/                   Cascade ORM models
      repositories/             data access for the models
      resources/                output shape for the wire
      schema/                   seal schemas (value + inferred type from one file)
      events/                   listeners (auto-loaded)
      types/                    types specific to this module
      utils/                    module-private helpers
      seeds/                    test data
      routes.ts                 ← auto-loaded
      main.ts                   ← auto-loaded, one-time setup
  config/                       subsystem config (one file each)
  connectors/                   custom lifecycle subsystems (rare)
  integrations/                 third-party adapters
public/                         static assets
warlock.config.ts               project-level config
tsconfig.json
package.json
```

`src/app/` is the only folder you'll touch every day. Everything else is configured once and forgotten.

## What goes where

| Folder           | What lives there                                            | Naming                              | Example                              |
| ---------------- | ----------------------------------------------------------- | ----------------------------------- | ------------------------------------ |
| `controllers/`   | HTTP request handlers — thin                                | `<action>.controller.ts`            | `list-products.controller.ts`        |
| `services/`      | Business logic, stateless functions                         | `<action>.service.ts`               | `create-product.service.ts`          |
| `models/`        | Cascade models + their migrations                           | `<entity>.model.ts` in `<entity>/`  | `models/product/product.model.ts`    |
| `repositories/`  | `RepositoryManager` subclasses                              | `<entity>.repository.ts`            | `products.repository.ts`             |
| `resources/`     | `Resource` subclasses — model → wire mapping                | `<entity>.resource.ts`              | `product.resource.ts`                |
| `schema/`        | seal schemas — value + inferred `<Name>Schema` type from one file | `<action>.schema.ts`                | `create-product.schema.ts`           |
| `events/`        | Listener registrations — **any** `.ts(x)` file inside is auto-loaded | `<topic>.event.ts` (convention)     | `audit.event.ts`                     |
| `types/`         | Module-internal TypeScript types                            | `<name>.type.ts`                    | `cart-state.type.ts`                 |
| `utils/`         | Module-private helpers                                      | `<name>.ts`                         | `format-price.ts`                    |
| `seeds/`         | Seed data (CLI: `warlock seed`)                             | `<entity>.seed.ts`                  | `products.seed.ts`                   |

A few of these are framework-magic:

- **`routes.ts`** — auto-loaded. Don't import it from anywhere. Put `router.get(...)` calls here and the framework picks them up.
- **`main.ts`** (per-module) — auto-loaded once, at boot, for one-time setup (event listener registration, scheduled jobs, side-effect imports). Don't import it from anywhere either.
- **`src/app/main.ts`** (project-level) — also auto-loaded. The natural home for global one-time setup that doesn't belong to any one module: `connectorsManager.register(...)`, global hooks, feature-flagged registrations.
- **`events/`** — auto-loaded. **Any** `.ts(x)` file in this folder runs its top-level side effects on boot. The `*.event.ts` suffix is convention, not a framework requirement.
- **`utils/locales.ts`** — auto-loaded. Holds `groupedTranslations(...)` so `t("module.key")` resolves at request time.

Everything else is plain TypeScript — imported wherever you need it.

## The layered flow

The folders aren't decoration; they enforce a one-way dependency flow:

```
routes.ts
   ↓
controllers/      thin: parse input, call work, shape response
   ↓
services/         stateless: business logic, orchestration
   ↓
repositories/     data access: filtering, pagination, caching
   ↓
models/           the schema + the ORM
```

`resources/` cuts across this — controllers (or services) hand a model through a resource to shape the wire response.

The arrows go one way. Repositories don't call services; services don't call controllers; resources don't fetch data. If you find yourself wanting to invert the direction, you've usually picked the wrong layer for the work.

## What lives in the project root, not in `src/app/`

- **`src/config/*.ts`** — subsystem config (one file each). See [Configuration](./03-configuration.md).
- **`src/connectors/`** — custom connectors that need to start/stop with the app lifecycle. Rare — most apps stay empty here.
- **`src/integrations/`** — third-party adapter code (e.g. wrapping an external API client) that's shared across modules.
- **`warlock.config.ts`** — project-level config. See [Configuration](./03-configuration.md).
- **`public/`** — static assets served as-is.

## A complete real module

Here's a real `products` module after a few `warlock generate.*` commands:

```
src/app/products/
  controllers/
    list-products.controller.ts
    get-product.controller.ts
    create-product.controller.ts
    update-product.controller.ts
    delete-product.controller.ts
  services/
    list-products.service.ts
    create-product.service.ts
    update-product.service.ts
    delete-product.service.ts
  models/
    product/
      product.model.ts
      migrations/
        2026_05_22_120000_product.migration.ts
      index.ts
  repositories/
    products.repository.ts
  resources/
    product.resource.ts
  schema/
    create-product.schema.ts
    update-product.schema.ts
  routes.ts
  main.ts
```

Read it left-to-right: a controller parses input, calls a service, the service uses the repository, the repository queries the model. The resource shapes the result on the way back. Every module reads the same way.

## Path aliases

The scaffolded `tsconfig.json` configures `app/*` as a path alias for `src/app/*`:

```ts
// ✅ from inside src/app/orders/services/place-order.service.ts:
import { Product } from "app/products/models/product";

// ❌ deep relative paths
import { Product } from "../../../products/models/product";
```

Use `app/<module>/...` when crossing module boundaries. Stay relative (`./..`, `../..`) for paths within the same module.

## Next

You've got the shape, the layout, and a working route. The Essentials section unpacks each layer:

- **[The request lifecycle](../architecture-concepts/01-the-request-lifecycle.md)** — what really happens between the network and your controller.
- **[Routing](../the-basics/02-routing.md)** — groups, prefixes, RESTful resources, middleware.
- **[Controllers](../the-basics/03-controllers.md)** — the full Request/Response surface.

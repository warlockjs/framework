---
name: create-module
description: 'Scaffold a new feature module under `src/app/<name>/` via `warlock generate.module` and the follow-up generators for controllers, models, repositories, resources, and validation schemas. Triggers: `warlock generate.module`, `generate.controller`, `generate.service`, `generate.model`, `generate.repository`, `generate.resource`, `generate.migration`, `--minimal`, `gen.m`; "scaffold a new module", "create CRUD bootstrap", "add a controller to a module", "generate a model"; typical CLI `yarn warlock generate.module <name>`. Skip: framework-wide layout rules — `@warlock.js/core/warlock-conventions/SKILL.md`; routes file shape — `@warlock.js/core/register-route/SKILL.md`; controller shape — `@warlock.js/core/create-controller/SKILL.md`; competing tooling: `@nestjs/cli`, `hygen`, hand-rolled folder layouts.'
---

# Warlock — create a module

A module is a self-contained feature folder under `src/app/<name>/`. The CLI scaffolds the standard subfolders; the framework auto-loads `routes.ts`, `main.ts`, every `.ts(x)` file inside `events/`, and `utils/locales.ts`. You never `import` those files. (`src/app/main.ts` at the project root is also auto-loaded — that's the home for global one-time setup like `connectorsManager.register(...)`.)

## The shape

```bash
yarn warlock generate.module products            # full CRUD bootstrap (default — controllers, model, services, repository, resource, schemas, routes, seed)
yarn warlock generate.module products --minimal  # bare bones (routes.ts + main.ts + utils/locales.ts + empty subfolders)
```

Full CRUD is the default — opt down to a bare skeleton with `--minimal` (`-m`) when you want to build the module piece by piece. `--force` (`-f`) overwrites existing files. The plural form is auto-derived: `generate.module product` and `generate.module products` produce the same `src/app/products/` folder.

## What the generator creates

For `generate.module products` (full CRUD by default):

```
src/app/products/
  controllers/
    create-product.controller.ts
    update-product.controller.ts
    list-products.controller.ts
    get-product.controller.ts
    delete-product.controller.ts
  services/
    create-product.service.ts
    update-product.service.ts
    list-products.service.ts
    get-product.service.ts
    delete-product.service.ts
  models/
    product/
      product.model.ts
      index.ts
      migrations/              ← migration file is created here by the default CRUD scaffold
  repositories/
    products.repository.ts
  resources/
    product.resource.ts
  schema/                       ← seal schemas live here; each file exports both the schema value and the inferred `<Name>Schema` type — no separate `requests/` folder needed
    create-product.schema.ts
    update-product.schema.ts
  events/                       ← auto-loaded by the framework
  types/
  utils/
    locales.ts                  ← `groupedTranslations("products", { ... })`
  seeds/
    products.seed.ts
  routes.ts                     ← auto-loaded; RESTful chain pre-wired with `guarded(...)`
  main.ts                       ← auto-loaded once on boot
```

With `--minimal`, only `routes.ts`, `main.ts`, `utils/locales.ts`, and the empty subfolders are created — fill them in manually with the per-component generators below.

## Auto-loaded files

The framework discovers these by convention — do not import them anywhere:

- `routes.ts` — runs `router.<verb>(...)` calls on boot
- `main.ts` — one-time setup (event listeners, custom registrations, boot-time hooks)
- `events/*.ts(x)` — **any** `.ts(x)` file inside this folder is auto-loaded (convention is `*.event.ts`; the framework doesn't enforce the suffix)
- `utils/locales.ts` — auto-loaded; holds `groupedTranslations(...)`

Branching at registration time breaks HMR. Conditional behavior belongs inside controllers/services, not around `router.get(...)`.

## Per-component generators

Run after `generate.module` to fill in gaps or add to an existing module.

| Command                                         | Alias     | Flags                                                             |
| ----------------------------------------------- | --------- | ----------------------------------------------------------------- |
| `warlock generate.module <name>`                | `gen.m`   | `--minimal` (`-m`), `--force`                                     |
| `warlock generate.controller <module>/<action>` | `gen.c`   | `--with-validation` (also generates the `schema/` file)            |
| `warlock generate.service <module>/<action>`    | `gen.s`   | `--force`                                                         |
| `warlock generate.model <module>/<entity>`      | `gen.md`  | `--with-resource`, `--table <name>`, `--timestamps`               |
| `warlock generate.repository <module>/<entity>` | `gen.r`   | `--force`                                                         |
| `warlock generate.resource <module>/<entity>`   | `gen.rs`  | `--force`                                                         |
| `warlock generate.migration <model-path>`       | `gen.mig` | `--add <dsl>`, `--drop <names>`, `--rename <dsl>`, `--timestamps` |

The DSL for `--add` is `name:type:modifier,…` — see `write-cli-command` and the column-DSL parser in `@warlock.js/core/src/cli/commands/generate/generators/column-dsl-parser.ts`.

Every `generate.*` command (and the master `generate`) also accepts **`--dry-run`** — it prints the files it *would* create and writes nothing. Run it before a full `generate.module` scaffold or any `--force` to preview the blast radius.

## Path alias

The scaffolded `tsconfig.json` defines:

```jsonc
{
  "paths": {
    "app/*": ["./src/app/*"],
  },
}
```

Cross-module imports go through `app/<module>/...` — never deep relative paths:

```ts
// ✅ from src/app/orders/services/place-order.service.ts
import { Product } from "app/products/models/product";
import { guarded } from "app/shared/utils/router";

// ❌ deep relative — fragile across moves
import { Product } from "../../../products/models/product";
```

Inside the same module, plain relative imports (`./`, `../`).

## Common patterns

### Full CRUD bootstrap

```bash
yarn warlock generate.module products
# edit schemas + model fields, then
yarn warlock migrate
```

The CRUD scaffold's `routes.ts` already chains the five controllers behind `guarded(...)`:

```ts title="src/app/products/routes.ts (generated)"
import { router } from "@warlock.js/core";
import { guarded } from "app/shared/utils/router";
import { createProductController } from "./controllers/create-product.controller";
import { deleteProductController } from "./controllers/delete-product.controller";
import { getProductController } from "./controllers/get-product.controller";
import { listProductsController } from "./controllers/list-products.controller";
import { updateProductController } from "./controllers/update-product.controller";

guarded(() => {
  router
    .route("/products")
    .list(listProductsController)
    .show(getProductController)
    .create(createProductController)
    .update(updateProductController)
    .destroy(deleteProductController);
});
```

### Skeleton module, add pieces piecemeal

```bash
yarn warlock generate.module orders --minimal
yarn warlock generate.model orders/order --with-resource
yarn warlock generate.repository orders/order
yarn warlock generate.controller orders/place-order --with-validation
yarn warlock generate.controller orders/list-orders
```

Then wire URLs by editing `src/app/orders/routes.ts` and the schema rules in `src/app/orders/schema/`.

### Adding a one-time boot hook

```ts title="src/app/products/main.ts"
import { warmupProductCache } from "./services/warmup-product-cache.service";

await warmupProductCache();
```

`main.ts` runs once per boot, **after** every connector has finished its bootstrap (DB, socket, HTTP). You can call DB-touching code and reach `app.socket` / `app.database` directly — no `onceConnected` wrapper needed.

## Gotchas

- **Subfolder is `schema/`, not `validation/`.** The CRUD scaffold and `generate.controller --with-validation` both write schema files to `schema/`. A few older modules in this codebase still have a `validation/` folder — that's historical drift, not the convention. New modules use `schema/`.
- **There's no standalone `generate.validation` command.** Validation is no longer scaffolded on its own — each controller carries its own schema (imported from `schema/` and bound via `controller.validation`). Generate the controller with `--with-validation` to get the paired schema file, or hand-write the `schema/*.schema.ts`.
- **No `requests/` folder.** Controllers import the schema's exported type + value directly from `schema/*.schema.ts`; there is no `*.request.ts` alias.
- **Subfolder is `seeds/` (plural), not `seed/`.** The seed file is `<module>.seed.ts`.
- **`generate.module` does not run the migration.** It only creates the migration file. Run `yarn warlock migrate` separately to apply it.
- **`models/<entity>/` is its own folder, not a flat file.** The generator puts `product.model.ts` inside `models/product/` so migrations can sit beside the model in `models/product/migrations/`.
- **Don't import `routes.ts`, `main.ts`, or anything in `events/`.** They're auto-loaded; double-loading errors out at boot.
- **`utils/locales.ts` is mandatory for translation keys.** Skip it and `t("products.notFound")` silently falls back to the key itself.
- **The CRUD list service uses `listCached`, not `list`.** Switch to `list(...)` if your data churns faster than the cache invalidates.

## See also

- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — module layout, file suffixes, path aliases.
- [`register-route/SKILL.md`](../register-route/SKILL.md) — what to put in `routes.ts`.
- [`create-controller/SKILL.md`](../create-controller/SKILL.md) — the handler shape, attaching validation.
- [`use-repository/SKILL.md`](../use-repository/SKILL.md) — what the generated `<module>.repository.ts` looks like and how to extend it.
- [`define-resource/SKILL.md`](../define-resource/SKILL.md) — the output mapper for the model.
- [`validate-input/SKILL.md`](../validate-input/SKILL.md) — wiring `schema/*.schema.ts` to controllers.
- [`write-seeder/SKILL.md`](../write-seeder/SKILL.md) — populating the generated `seeds/` folder.
- [`use-localization/SKILL.md`](../use-localization/SKILL.md) — populating the generated `utils/locales.ts`.

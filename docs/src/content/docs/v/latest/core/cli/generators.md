---
title: "Generators"
description: The scaffolding family — add, generate.module, generate.controller, generate.model and the rest. What each one produces, how naming works, and the workflows people actually use.
sidebar:
  order: 2
  label: "Generators"
---

Warlock's CLI ships a scaffolding suite that creates files in the layout the framework expects. The generators are the structure made executable — every module they produce reads the same as every other module, so your fifth feature works like your first.

This page is the deep dive on the `generate.*` family and the `add` installer. For the bare command reference, see [CLI commands](./cli-commands.md). Here we cover *what* each generator produces, *how* the naming pipeline transforms your input, and the two workflows you'll actually use day to day.

## The mental model

Every generator does the same three things:

1. **Parse the name.** Your input (`users/create-user`, `products`, etc.) becomes a `Name` object with `kebab`, `camel`, `pascal`, and `snake` variants. Identifiers in generated code use the appropriate variant for their context.
2. **Resolve the path.** Module-scoped generators expect `<module>/<name>` — the module must already exist. Top-level generators (like `generate.module`) create the module folder itself.
3. **Write the stub.** A template from `templates/stubs.ts` filled in with the parsed name, written to the resolved path. Existing files block the write unless you pass `--force`.

That uniformity is the value. Once you know the shape, every generator behaves the same.

## Naming transformations

Whatever you type, the generator normalizes it. Each `Name` object exposes four cases:

| Case      | Example                | Used for                                       |
| --------- | ---------------------- | ---------------------------------------------- |
| `kebab`   | `create-user`          | File names, folder names, route paths.         |
| `camel`   | `createUser`           | Function names, controller exports.            |
| `pascal`  | `CreateUser`           | Class names, type names, schema export names.  |
| `snake`   | `create_user`          | Database table/column names.                   |

The generators also pluralize and singularize. Module names go through `pluralName()` (so `product` becomes `products`); entity names inside modules go through `singularName()` (so `products/products` becomes `products/product` for the entity). You can type either form — the generator will figure it out.

Example: `warlock generate.module product`

- Module folder: `products/` (pluralized).
- Entity: `product` (singular).
- Model class: `Product` (pascal of singular).
- Controllers: `create-product.controller.ts`, `list-products.controller.ts`, `get-product.controller.ts` …
- Repository: `products.repository.ts` (plural, kebab).
- Table: defaults to `products` (snake plural of entity).

Type whatever feels natural — the generator handles the rest.

## The workflows

There's no single "right" way to use these. Two common ones:

### Workflow 1 — Full CRUD bootstrap

Most common. You know you want a complete RESTful resource — listing, get, create, update, delete — and you want it all wired together:

```bash
warlock generate.module products
```

Output — a complete, wired RESTful resource (this is what you get by default):

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
  models/product/
    product.model.ts
    index.ts
    migrations/
      MM-DD-YYYY_HH-MM-SS-product.migration.ts
  repositories/
    products.repository.ts
  resources/
    product.resource.ts
  schema/
    create-product.schema.ts          ← value + inferred type from one file
    update-product.schema.ts
  events/
  types/
  utils/
    locales.ts
  seeds/
    products.seed.ts
  routes.ts
  main.ts
```

The `routes.ts` is already wired — every controller is imported and registered. The model has a `schema` and `table` set. The migration has a starter column list (just `id` and timestamps; edit it). You can `warlock migrate && warlock dev` and hit the routes immediately.

What you'll edit next: the model schema (columns), the migration (matching the schema), and the validation rules in `schema/*.schema.ts`.

### Workflow 2 — Incremental — add to an existing module

You already have a `users/` module. You want to add a "verify email" feature.

```bash
warlock generate.controller users/verify-email --with-validation
warlock generate.service users/verify-email
```

That gives you:

```
src/app/users/
  controllers/verify-email.controller.ts     ← new (typed as `GuardedRequestHandler<VerifyEmailSchema>`)
  schema/verify-email.schema.ts              ← new (from --with-validation); exports value + inferred type
  services/verify-email.service.ts           ← new
```

The controller imports the schema and its inferred type from the schema file directly — no separate `*.request.ts` alias. The service is an empty function with the right signature. Wire the route by hand in `users/routes.ts` (the controller generator doesn't touch `routes.ts` — only `generate.module` pre-wires routes, and it does that by default).

This is the workflow you'll use most. Each generator does one job; combine them as needed.

## The generators in detail

### `generate.module <name>`

```bash
warlock generate.module products                 # full CRUD scaffold (default)
warlock generate.module products --minimal       # skeleton only — no CRUD
warlock generate.module products --force         # overwrite existing
```

Creates the module folder with the full CRUD scaffold described above. Pass `--minimal` (`-m`) when you want just the skeleton — the folder layout plus an empty `routes.ts` — and nothing else.

What you always get (either mode):

- The folder layout (`controllers/`, `services/`, `models/`, `repositories/`, `schema/`, `resources/`, `events/`, `types/`, `utils/`).
- `main.ts` — empty, comment explaining what it's for.
- `utils/locales.ts` — translation grouping stub.

What the default (full) scaffold adds on top: models, migrations, controllers, services, resource, repository, schema files (value + inferred type per file), a seed file — and a pre-wired `routes.ts`. `--minimal` leaves `routes.ts` empty and skips all of that.

Module names are pluralized automatically — `product` becomes `products/`.

### `generate.controller <module>/<name>`

```bash
warlock generate.controller products/list-products
warlock generate.controller products/create-product --with-validation
warlock generate.controller products/list-products --force
```

Creates `controllers/<name>.controller.ts` inside an existing module. With `--with-validation` (`-v`), also creates `schema/<name>.schema.ts` — one file exporting both the schema value and its inferred type — and wires it onto the controller.

The schema uses `@warlock.js/seal`:

```ts title="src/app/products/schema/create-product.schema.ts (generated)"
import { v, type Infer } from "@warlock.js/seal";

export const createProductSchema = v.object({
  // Add your validation rules here
});

export type CreateProductSchema = Infer<typeof createProductSchema>;
```

The module must already exist. The generator errors with "Module 'products' does not exist" otherwise — run `generate.module products` first.

### `generate.service <module>/<name>`

```bash
warlock generate.service products/create-product
warlock generate.service products/create-product --force
```

Creates `services/<name>.service.ts`. A service is a thin function with one job — the generator stub gives you the function signature; you fill in the body.

### `generate.model <module>/<name>`

```bash
warlock generate.model products/product
warlock generate.model products/product --with-resource
warlock generate.model products/product --table custom_products_table
warlock generate.model products/product --timestamps false
```

Creates `models/<name>/<name>.model.ts` plus an index file and an initial migration file. With `--with-resource`, also creates the resource.

| Flag                  | Description                                                                  |
| --------------------- | ---------------------------------------------------------------------------- |
| `--with-resource, -rs` | Also generate a resource at `resources/<name>.resource.ts`.                  |
| `--table <name>`      | Override the table name. Defaults to the snake-plural of the entity.         |
| `--timestamps [bool]` | Include `createdAt` / `updatedAt` columns in the migration. Default `true`.  |

The model name is singularized — `generate.model products/products` writes `product.model.ts` for the `Product` class.

### `generate.repository <module>/<name>`

```bash
warlock generate.repository products/products
```

Creates `repositories/<name>.repository.ts` — a `RepositoryManager` subclass scoped to the named model. The repository becomes the canonical place to put query-builder helpers for that entity.

### `generate.resource <module>/<name>`

```bash
warlock generate.resource products/product
```

Creates `resources/<name>.resource.ts` — a `Resource` subclass that defines how the model gets mapped to the wire. Resources are output-only: column-name to wire-key mapping, type-marshaling, no logic.

### `generate.migration <model-path>`

```bash
warlock generate.migration products/product
warlock generate.migration products/product --add "name:string,price:number:nullable"
warlock generate.migration products/product --drop "old_field,unused_column"
warlock generate.migration products/product --rename "old_name:new_name"
warlock generate.migration products/product --timestamps false
```

Creates a new migration file inside the model's `migrations/` folder. Without `--add`/`--drop`/`--rename`, generates a create-table migration. With any of those, generates an alter-table migration using the column DSL.

| Flag                  | Description                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `--add <columns>`     | DSL — `name:type:modifier,name:type:modifier,...`                                            |
| `--drop <columns>`    | Comma-separated column names to drop.                                                        |
| `--rename <columns>`  | DSL — `oldName:newName,oldName:newName,...`                                                  |
| `--timestamps [bool]` | Include timestamp columns (create migrations only). Default `true`.                          |

File name pattern: `MM-DD-YYYY_HH-MM-SS-<entity>.migration.ts`. Timestamp-prefixed so they sort in execution order.

### `generate <generator> [args...]` (master)

```bash
warlock generate module products
warlock generate controller products/list-products
warlock g module products --minimal
```

Dispatcher. Forwards to the named generator. Alias `g`. The longer form (`generate.<name>`) exists too and is what most projects use in their `package.json` scripts.

### `add <features...>`

Not a generator — an installer. Adds a Warlock feature package to the project and runs its setup:

```bash
warlock add auth
warlock add auth mail storage
warlock add --list
warlock add auth --no-install     # record deps + run setup, skip the install
```

The setup typically installs the npm package, registers commands in `warlock.config.ts > cli.commands`, and runs any package-specific configuration files. The `--list` flag shows available features. Pass `--no-install` (last, after the feature list) to record the dependencies and run setup without invoking the package manager — handy when a scaffolder runs a single install afterwards. Full flag reference lives in [CLI commands](./cli-commands.md#add-features).

Use this for major feature packages from the `@warlock.js/*` ecosystem. For project-local code, the `generate.*` family is what you want.

## Where the generators differ from the rest

Two conventions worth pulling out:

**Schemas live in `schema/`, not `validation/`.** Older modules in some codebases use `validation/`; the generator writes to `schema/`. If you have a mix in your project, that's historical — the new layout is `schema/`.

**Controllers wire their own validation.** When you generate a controller with `--with-validation`, the stub appends `controller.validation = { schema }` and imports the schema by name. The route registration doesn't change — the schema is metadata on the handler function, not part of the routing call.

## Best practices

A few naming conventions that pay off:

- **Use the verb-noun shape for action endpoints.** `create-product`, `update-user`, `cancel-order`. Cleaner than nouns-only and the generator produces matching names across all files.
- **Pluralize the module, singularize the entity.** `products/` module holds the `Product` model. The generators do this automatically — feed them either form and they'll figure it out.
- **Let the generators write the stubs; edit the logic.** Don't fight the layout. If a generator's output looks wrong, the right fix is usually to align your mental model, not customize the stub. The shape is the value.
- **Scaffold the full module early, prune later.** `generate.module` lays down the complete CRUD pattern by default — it's faster to delete what you don't need than to add files one at a time. The full scaffold also serves as a reference for what *should* exist.

## Customizing the stubs

The stubs are baked into the framework's generator templates. There's no project-level override hook today — if you need different stubs, the path is to fork or wrap the generator in a custom `command()` of your own (see [CLI commands](./cli-commands.md) for how to write one). The roadmap includes a stub-override hook; it's not shipped.

## Gotchas

- **There's no standalone validation generator.** Schemas are produced as a side effect of `generate.controller --with-validation` (`-v`), which writes `schema/<name>.schema.ts` and wires it onto the controller. There is no `generate.validation` command and no `--with-request` flag — the controller annotates its handler directly off the schema's inferred type.
- **The module must exist before module-scoped generators run.** Run `generate.module <name>` first, then `generate.controller <name>/...` and friends.
- **`--force` overwrites without diffing.** It doesn't merge changes back into your existing file — it replaces. If you've added custom logic to a generated file, `--force` deletes it. Use sparingly.
- **The model generator singularizes the name.** `warlock generate.model products/products` writes `product.model.ts` (with `Product` class) — not `products.model.ts`. The generator picks the right singular form; type the entity name however reads naturally to you.
- **Migration timestamps are local-time.** The migration filename uses your machine's local clock. In a team, two people generating migrations at exactly the same time on different timezones could collide. If that bites you, rename one before merging.

## Going further

- [`guides/cli-commands.md`](./cli-commands.md) — the full CLI surface, including all the generator flags in flat reference form.
- `@warlock.js/core/skills/create-module/SKILL.md` — the per-task skill for module scaffolding.
- [Getting started — First route](../getting-started/04-first-route.md) — the working hello-world that uses `generate.module` and `generate.controller`.
- [Project layout](../getting-started/05-project-layout.md) — the canonical structure the generators produce.

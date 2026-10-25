---
name: warlock-conventions
description: 'Framework-wide invariants for projects built on @warlock.js/core — module layout, canonical imports, layered flow, file naming, and the non-negotiable rules every other warlock skill assumes. Triggers: `src/app/<module>`, `routes.ts`, `main.ts`, `Request<TSchema>`, `RequestHandler`, `GuardedRequestHandler`, `app/<module>/...`; "where do files go in this project", "canonical Warlock imports", "module layout rules", "controller-service-repository layering"; typical import `import { router, type RequestHandler } from "@warlock.js/core"`. Skip: scaffold a new module — the `create-module` topic; route shape — the `register-route` topic; controller shape — the `create-controller` topic; competing patterns: `express` ad-hoc layouts, `@nestjs/common` decorator-driven structure.'
---

# Warlock — framework-wide conventions

This skill is the foundation. Every other warlock skill (`register-route`, `create-controller`, `send-response`, …) assumes you know these rules. Don't repeat them in task skills — link here instead.

## Always-true facts

1. **Every feature lives in `src/app/<module>/`.** No exceptions. A module is a folder with the standard subfolders (`controllers/`, `services/`, `models/`, `repositories/`, `resources/`, `schema/`, `routes.ts`, `main.ts`). Generate with `warlock generate.module <name>`.
2. **Several files are auto-loaded — never `import` them.** The dev-server file watcher and the production builder categorize these as "special" and load them on boot.
   - `src/app/<module>/routes.ts` — route declarations
   - `src/app/<module>/main.ts` — per-module one-time setup
   - `src/app/<module>/worker.ts` — worker-only setup (queue job definitions,
     `scheduler.addJob(...)`, `scheduler.start()`); loaded only for the
     `worker` role, and always loaded by `warlock dev`
   - `src/app/main.ts` — **project-level** one-time application setup (global hooks and other app initialization; connector instances belong in `warlock.config.ts > connectors`)
   - `src/app/<module>/events/*.ts(x)` — **any** `.ts(x)` file inside the `events/` folder (the `*.event.ts` suffix is convention, not a framework requirement)
   - `src/app/<module>/utils/locales.json` and `utils/locales/<feature>.json` — module translations (the old `utils/locales.ts` is deprecated; `warlock doctor --fix` converts it)
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

   export const createThingSchema = v.object({/* … */});
   export type CreateThingSchema = Infer<typeof createThingSchema>;
   ```

   ```ts title="src/app/<module>/controllers/create-<thing>.controller.ts"
   import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";
   import { type CreateThingSchema, createThingSchema } from "../schema/create-thing.schema";
   import { createThingService } from "../services/create-thing.service";

   export const createThingController: GuardedRequestHandler<CreateThingSchema> = async ({
     request,
     response,
   }) => {
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
  utils/                    module-private helpers (`utils/locales.json` and `utils/locales/*.json` are auto-loaded)
  seeds/                    seed data for `warlock seed`
  routes.ts                 ← auto-loaded
  main.ts                   ← auto-loaded once, one-time setup
  worker.ts                 ← auto-loaded for the worker role only
```

### Small files or fewer files

One export per file is the default for controllers, services and components, not a ban on small companions. A service, repository or controller file may export the small input and output types it is written around next to the function that uses them (`export type CreatePostInput`, `export type CreatePostResult`); `warlock check` raises nothing for that. Move a type to `types/` or `schema/` once another module or the browser needs it, or when the file grows past what reads in one screen. Web UI is unchanged: one component per file, logic in `*.setup.ts` and `use-*.ts`.

### Barrels are optional

`index.ts` barrels in `src/app/**` are not required, and a hand-maintained one is a file every feature edits. Import from the file that defines the export. To make that a rule, set `rules: { "WL9023": "warning" }` in `.warlock-check.json` (off by default). To stop generators writing them, set `generate: { barrels: false }` in `warlock.config.ts`; `warlock generate` and `warlock make` then write no model `index.ts` and import the model file directly.

### What the browser may import from a module

`src/app/<module>/` is server code. Browser code (anything the client build reaches from a page) may import from it only `*.client.ts(x)` files, schema files (`*.schema.ts`, `schema/`), type files (`*.types.ts`, `types/`) and the module's `web/` folder; anything else fails the build with the import chain. Type-only imports (`import type`) are erased and always allowed, which is how a page shares a service's input and output types. `web.moduleBoundary` (`"warn"` default, `"error"`, `"off"`) controls it.

### `.client.*` is a client-only boundary

A `*.client.ts(x)` module may be imported by pages, layouts and components, where it renders on the server too unless wrapped in `<ClientOnly>`. Server-only code (controllers, services, repositories, models, routes, connectors, `main.ts`, `events/`, `*.server.*`) must never import it: `warlock check` reports `WL9022` with the import chain, and development SSR refuses it.

Some older modules still have a `validation/` folder instead of `schema/` — historical drift. The framework treats them as plain folders either way; the generator emits to `schema/`.

## File naming (project-wide)

| Suffix           | Role                                                                                         | Example                                  |
| ---------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `.controller.ts` | HTTP handler                                                                                 | `create-product.controller.ts`           |
| `.service.ts`    | Stateless business logic                                                                     | `create-product.service.ts`              |
| `.usecase.ts`    | `useCase()` pipeline                                                                         | `login.usecase.ts`                       |
| `.model.ts`      | Cascade model class                                                                          | `product.model.ts`                       |
| `.repository.ts` | `RepositoryManager` subclass                                                                 | `products.repository.ts`                 |
| `.resource.ts`   | `Resource` subclass                                                                          | `product.resource.ts`                    |
| `.schema.ts`     | seal validation schema + its inferred `<Name>Schema` type from the same file                 | `create-product.schema.ts`               |
| `.type.ts`       | data shape (TypeScript `type`)                                                               | `cart-state.type.ts`                     |
| `.contract.ts`   | interface (TypeScript `interface`)                                                           | `model.contract.ts`                      |
| `.event.ts`      | event listener registrations (any `.ts(x)` inside `events/` works; the suffix is convention) | `audit.event.ts`                         |
| `.migration.ts`  | Cascade migration                                                                            | `2026_05_22_120000_product.migration.ts` |
| `.seed.ts`       | seed data                                                                                    | `products.seed.ts`                       |

Filenames are kebab-case. Class names are PascalCase. Function names are camelCase. Table/collection names are snake_case (plural).

## Path aliases

The scaffolded `tsconfig.json` defines:

```jsonc
{
  "paths": {
    "app/*": ["./src/app/*"],
  },
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

## Type augmentations

`src/typings.d.ts` is the project's module-augmentation file. It ships with the scaffold, is listed explicitly in `tsconfig.json`'s `include`, and is where application-wide `declare module "@warlock.js/core"` blocks live — `RequestLocals` and `RequestUser` are already there as empty interfaces. Keep its trailing `export {}` (without it the block declares an ambient module and erases the framework's real typings) and keep the augmented declarations as `interface`, the one sanctioned exception to this project's prefer-`type` rule, since declaration merging is interface-only. See the `use-request-locals` topic.

## Decorators

Cascade uses `@RegisterModel()` for the model registry and `@BelongsTo` / `@HasMany` / `@MorphTo` for relations. The scaffolded `tsconfig.json` has `"experimentalDecorators": false` — these are native Stage-3 decorators, not legacy. Never set that flag to `true`; see the `lower-stage3-decorators` topic.

## What `warlock check` enforces

`npx warlock check` (the `warlock-check` topic) reports these with a stable code. They run the same whatever linter the app uses.

| Code     | Rule                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------- |
| `WL9001` | never import an auto-loaded file (fact 2)                                                         |
| `WL9002` | no `.js` extension on a relative import                                                           |
| `WL9003` | cross-module imports use `app/<module>/...` (see Path aliases)                                    |
| `WL9004` | no `"experimentalDecorators": true`                                                               |
| `WL9005` | queries, services and `inApp()` get `request.validated()`, never `request.all()`                  |
| `WL9006` | every POST/PUT/PATCH/DELETE route is guarded or says `public: true`                               |
| `WL9007` | redirect and link targets from request input go through `safeRedirect()` / `safeRedirectTarget()` |
| `WL9008` | no raw email, credential or request body in a log call                                            |
| `WL9009` | regexes run on request input have bounded quantifiers                                             |
| `WL9010` | warning: no `await` on `log.info()` and its siblings                                              |
| `WL9011` | warning: one controller per file                                                                  |
| `WL9012` | warning: a tagged union's discriminator is `type`, not `kind`                                     |

### `WL9005` — validated input only

`request.all()` hands every client-sent field to whatever receives it (mass assignment). Declare a schema and pass what it accepted:

```ts
import { type RequestHandler } from "@warlock.js/core";
import { v } from "@warlock.js/seal";

const createPostSchema = v.object({ title: v.string(), body: v.string() });

async function createPostService(input: { title: string; body: string }) {
  return { id: 1, ...input };
}

export const createPostController: RequestHandler = async ({ request, response }) => {
  const post = await createPostService(request.validated());
  return response.successCreate({ post });
};

createPostController.validation = { schema: createPostSchema };
```

### `WL9006` — guarded or public

```ts
import { authMiddleware } from "@warlock.js/auth";
import { router, type RequestHandler } from "@warlock.js/core";

const createPostController: RequestHandler = async ({ response }) => response.successCreate({});
const contactController: RequestHandler = async ({ response }) => response.success({ sent: true });

router.post("/posts", createPostController, { middleware: [authMiddleware("user")] });

// Intentionally open: say so.
router.post("/contact", contactController, { public: true });
```

A route inside `guarded(() => …)` or `router.group({ middleware: [authMiddleware()] }, …)` is guarded. A middleware counts as a guard when its name contains `auth` or `guard`, or when it is a constant initialised with `markAuthGuard()` in the same file, or a local factory that returns `markAuthGuard(fn)` and is called in the `middleware` list. `warlock dev` warns about the same routes at runtime.

### `WL9007` — safe redirects

```ts
import { safeRedirect, type RequestHandler } from "@warlock.js/core";

export const afterLoginController: RequestHandler = async ({ request, response }) => {
  return response.redirect(
    safeRedirect(request.input("next"), { allowedOrigins: ["https://app.example.com"] }),
  );
};
```

In pages, `safeRedirectTarget(target) ?? "/"` from `@warlock.js/web` does the same for `navigateTo()` and `<Link to>`. A target checked by an enclosing `if (isSafeRedirect(target))` passes.

### `WL9008` — redacted logs

```ts
import type { Request } from "@warlock.js/core";
import { log, maskEmail } from "@warlock.js/logger";

export function logLogin(request: Request, user: { id: number; email: string }, token: string) {
  log.info("auth", "login", `Signed in ${maskEmail(user.email)}`, {
    userId: user.id,
    token, // `token` is a key the logger censors by default
    request: request.toLogSnapshot(),
  });
}
```

Keys the logger censors by default (`token`, `password`, `apiKey`, `authorization`, …) may carry secrets as structured data. Emails are not censored by default, so they always need `maskEmail()`. Free text from the client goes through `escapeLogValue()`.

### `WL9009` — bounded regexes on input

```ts
const SLUG = /^[a-z0-9-]{1,64}$/;

export function isSlug(value: string): boolean {
  return SLUG.test(value);
}
```

Bound each repetition (`{1,64}`, not `+`) or cap the input's length before matching.

### `WL9010`–`WL9012`

Drop the `await` from `log.info(…)` (`await log.flush()` waits for delivery); move each extra controller into its own `<name>.controller.ts`; rename a union's `kind` tag to `type` and update the `switch`.

### A deliberate exception

```ts
// warlock-check-ignore WL9006 -- authenticated by the provider's signature header
router.post("/webhooks/billing", billingWebhookController, { middleware: [verifySignature()] });
```

The comment covers the codes it names on its own line and the next; with no code it covers every code there.

## See also

- The `warlock-check` topic — running the checks and reading the report.
- The `register-route` topic — how to wire URLs to controllers.
- The `create-controller` topic — controller signature, validation, response shape.
- The `send-response` topic — the full Response helper surface.

---
title: "warlock inspect"
description: Print the facts of a running app from its registries — routes with middleware, guard, rate limit, logging and JSON Schemas; models; resources; config keys; event listeners; pages; queue jobs; scheduled tasks; installed @warlock.js versions — as a versioned JSON report (schemaVersion 1) with a published JSON Schema.
sidebar:
  order: 8
  label: "warlock inspect"
---

`warlock inspect` answers "what does this app actually have?" from the **booted registries**, not from source text: the router after every route module ran, the model classes after their modules loaded, the listeners app modules registered. It is the command to run before changing an app you do not know, and the data source agent tooling builds on.

```bash
warlock inspect                          # a short summary
warlock inspect --json                   # the full report, schemaVersion 1
warlock inspect --json --section routes  # only some sections
```

Except for `--section files`, which reads source without booting, it boots exactly like [`warlock doctor`](./doctor.md): every connector boots (that is where routes register) and **none starts**, so no database, cache or socket connection opens and no port binds. App modules are imported, so whatever they do at import time happens, as in `warlock dev`.

| Flag            | Type    | Description                                                                                     |
| --------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `--json, -j`    | boolean | Print the report as JSON. stdout carries only the JSON; boot output goes to stderr.             |
| `--section, -s` | string  | Comma-separated sections to include (default: all). An unknown name fails before the app boots. |

## Sections

| Section     | What it lists                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `routes`    | Every registered route: method, path, name, source file, handler, middleware names in run order, auth guard, CSRF, rate limit, logging, request schemas, declared responses.               |
| `models`    | Model classes from the loaded model modules and `@RegisterModel()`: table, primary key, columns (from the model's Seal `schema`), relations, resource, delete strategy, timestamp columns. |
| `resources` | Every resource reached from a route response or a model, with its output shape as JSON Schema and the models that use it.                                                                  |
| `config`    | Every loaded config key as a dotted path with its **type** — never its value — and the `src/config/*` file it came from.                                                                   |
| `events`    | Listeners app modules registered on `@mongez/events` while loading (`events/`, `main.ts`, `routes.ts`, models), grouped by event, with the file that registered each.                      |
| `pages`     | Pages `@warlock.js/web` installed: path, name, page file, layout chain (outermost first), which files on the chain export a `loader`, actions, guard. Empty without the web package.       |
| `jobs`      | Jobs defined with `defineJob()` from `@warlock.js/queue`: name, queue, attempts, backoff, retention. Empty without the queue package.                                                      |
| `schedules` | Tasks on the `@warlock.js/scheduler` scheduler: name, cron expression, intervals, next run. Empty without the scheduler.                                                                   |
| `files`     | Source files with module, convention role, exports and resolved imports/importedBy; no app boot for files-only requests.                                                                   |
| `packages`  | Installed `@warlock.js/*` packages and their versions.                                                                                                                                     |

### A route

```json
{
  "method": "PATCH",
  "path": "/posts/:id",
  "name": "posts.update",
  "sourceFile": "src/app/posts/routes.ts",
  "handler": "updatePostController",
  "description": null,
  "isPage": false,
  "middleware": ["authMiddleware", "auditTrail"],
  "auth": { "required": true, "sources": ["header"], "userTypes": ["user"] },
  "csrf": true,
  "rateLimit": { "source": "route", "max": 5, "timeWindow": 60000 },
  "logging": { "body": false, "query": true, "privateRules": false },
  "request": {
    "parameters": [
      { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
    ],
    "body": {
      "type": "object",
      "properties": { "title": { "type": "string" }, "draft": { "type": "boolean" } },
      "required": ["title"]
    },
    "customValidation": false
  },
  "responses": {
    "200": {
      "description": "Successful response",
      "schema": {
        "type": "object",
        "properties": { "post": { "$ref": "#/components/schemas/PostResource" } },
        "required": ["post"]
      }
    }
  }
}
```

- `auth` comes from the descriptor `authMiddleware()` attaches, the same one [`generate.openapi`](./openapi.md) documents security from.
- `rateLimit.source` is `route` for the route's own `rateLimit` option, `global` for the `http.rateLimit` limiter (with its defaults, 60 per minute), `none` when the global limiter is disabled. A limit configured as a function reads `"dynamic"`.
- `logging` is the route's `logging` option over `http.logging`. `privateRules: true` means `http.logging.private` rules exist and can remove more for some URLs.
- `request` and `responses` are built by the same code as the OpenAPI document, so the two never disagree. Request schemas are JSON Schema draft 2020-12, from Seal's `toJsonSchema()`.

`$ref`s point at `components.schemas` in the same report, so the report is a self-contained JSON document.

### Top-level fields

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-17T09:12:44.120Z",
  "app": {
    "name": "shop",
    "version": "2.1.0",
    "root": "/srv/shop",
    "node": "v22.15.0",
    "environment": "development",
    "runtimeStrategy": "development"
  },
  "sections": [
    "routes",
    "models",
    "resources",
    "config",
    "events",
    "pages",
    "jobs",
    "schedules",
    "packages"
  ],
  "routes": [],
  "components": { "schemas": {} },
  "warnings": [
    {
      "code": "WL2001",
      "message": "src/app/broken/routes.ts failed to load: boom",
      "source": "src/app/broken/routes.ts"
    }
  ]
}
```

`warnings` lists what could not be read — a module that failed to import (`WL2001`), a schema that has no JSON Schema form (`WL4001`), a model that could not be described. One broken item never stops the report. Look a code up with [`warlock explain`](./error-codes.md).

## The schema and its stability rules

The report shape is versioned by `schemaVersion` and published as JSON Schema (draft 2020-12):

- the file `node_modules/@warlock.js/core/schemas/inspect-report.schema.json`;
- the constant `INSPECT_REPORT_JSON_SCHEMA` from `@warlock.js/core/tooling`;
- the TypeScript type `InspectReport` from the same subpath.

Within `schemaVersion: 1`:

1. Fields are only **added**. No field is removed, renamed or changes type.
2. Consumers must **ignore keys they do not know**; the JSON Schema allows additional properties for that reason.
3. A section you did not request is **absent**, not empty.
4. Free text — warning messages, descriptions — is not part of the contract. Match on codes and field values.
5. A change that breaks rules 1–3 ships as `schemaVersion: 2` and is listed under **BREAKING** in the changelog.

## Programmatic use

```ts
import {
  inspectApp,
  INSPECT_REPORT_JSON_SCHEMA,
  type InspectReport,
} from "@warlock.js/core/tooling";

// Inside a process where the app is already booted (a dev-server plugin, a test):
const report: InspectReport = await inspectApp({ sections: ["routes"] });

const unguardedWrites = report.routes?.filter(
  (route) => route.method !== "GET" && !route.auth.required && !route.isPage,
);
```

`inspectApp()` reads what is already registered and boots nothing, so it is safe to call inside a running `warlock dev` process. To boot first, the way the command does, use `bootForInspect()`:

```ts
import { bootForInspect, inspectApp, inspectOptionsFromBoot } from "@warlock.js/core/tooling";

const boot = await bootForInspect();
const report = await inspectApp({
  ...inspectOptionsFromBoot(boot),
  sections: ["models", "resources"],
});
```

## Gotchas

- **Events are listeners registered while app modules load.** Listeners the framework registers itself, and listeners added later at runtime, are not listed. Model events registered through `Model.events()` are a separate bus and are not listed.
- **Resource names** come from the export name in a `*.resource.ts` module, as in the OpenAPI document. A resource defined elsewhere falls back to its class name.
- **Models** are listed when their module is a `*.model.ts` file or when they use `@RegisterModel()`.
- **Jobs and schedules** are read from the app's own copy of `@warlock.js/queue` / `@warlock.js/scheduler`, so they appear only when a loaded module (usually `worker.ts`) defined them.

## For coding agents

[`warlock mcp`](./mcp.md) serves this report as MCP tools — `inspect_app`, then one `inspect_<section>` tool per section with a `filter`, plus `db_schema` built from the `models` section — and `warlock dev --mcp` serves them from the running dev server. [`warlock agents-md`](./agents-md.md) writes a summary of the report into the project's `AGENTS.md`.

## Session middleware in groups

`sessionMiddleware({ userTypes: "user" })` publishes the same `warlock.auth`
descriptor as `authMiddleware()`. Group middleware is inherited by nested
routes, so `inspect` and the generated `agents-md` summary recognize these guards.
`{ optional: true }` reports `auth.required: false`, with sources and user types
retained. Such routes remain in the unguarded-write list. Legacy descriptors
without `required` still mean required authentication.

```ts
import { router } from "@warlock.js/core";
import { sessionMiddleware } from "@warlock.js/auth";

router.group({ middleware: [sessionMiddleware({ userTypes: "user" })] }, () => {
  router.post("/settings", async ({ response }) => response.success({ saved: true }));
});
```

## Source files and reachability

```bash
npx warlock inspect --section files --json
npx warlock explain src/app/posts/services/list.service.ts
npx warlock explain src/web/components/Post.tsx --json
npx warlock explain WL3001 --json
```

The `files` section reads every file under `src/`, without importing app modules or booting connectors. Each entry has `file`, `module`, `role`, `exports`, `imports` and `importedBy`. Paths are relative to the project root. Modules use `src/app/<module>` or the containing top-level `src` directory. Roles follow file names and directories: controller, service, repository, model, migration, schema, resource, routes, page, setup, layout, root, hook, component, util, type, config and spec; unmatched files use `source`. Non-code assets have empty exports and imports.

Each code file is parsed once with OXC per inspection. Export names include types, aliases, destructured bindings, `default` and `*` for star re-exports; star exports are recorded rather than expanded. Imports include type imports, side effects, re-exports and literal dynamic imports. Each import is `{ specifier, file }`: `file` is the resolved local path, or `null` for external/unresolved imports. Resolution follows inherited tsconfig path aliases, fallback targets, baseUrl, extensionless files and directory indexes within `src/`. Computed dynamic imports and CommonJS `require()` calls are not graph edges. Parse/config failures appear in `warnings`.

File explanations accept a project-relative or absolute path. They boot the app to read the existing routes/pages sections, then walk the static graph to find entry points reaching the file, including page layouts and loaders. Type-only edges participate; this is source reachability, not proof that runtime execution calls a function. Every route declared in a reaching route module is listed. Boot warnings remain in the JSON explanation and human output, so missing registrations are visible. `warlock explain <WLxxxx>` keeps its static error-code behavior.

```ts
import { inspectApp, explainFile } from "@warlock.js/core/tooling";

const report = await inspectApp({ sections: ["files"] });
const source = explainFile("src/app/posts/services/list.service.ts", report);
console.log(source.role, source.exports, source.importedBy);
```

For route/page reachability in code, call `inspectApp({ sections: ["files", "routes", "pages"] })` in an already booted app. `inspect_files` exposes the section through MCP with a case-insensitive `filter` on file, module or role.

## Custom guards in groups

A middleware you wrote counts as an auth guard when it is wrapped in `markAuthGuard()`
(or its function name contains `auth` or `guard`), even without a `warlock.auth`
descriptor. Registering it once on a group marks every route inside:

```ts
export const adminGuard = () => markAuthGuard(async ({ request, response }) => {
  if (!(await isAdmin(request))) return response.forbidden();
});

router.group({ prefix: "/api/admin", middleware: [adminGuard()] }, () => {
  router.post("/users", createUserController);
});
```

`POST /api/admin/users` reports `auth.required: true` and does not appear under
"Mutating routes without an auth guard". `markAuthGuard(fn, false)` declares the opposite.

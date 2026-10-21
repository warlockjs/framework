---
name: warlock-inspect
description: 'Ask the app instead of grepping it: `warlock inspect --json` prints the facts of the booted app — routes (middleware chain, auth guard, CSRF, rate limit, logging, request/response JSON Schema), models (table, columns, relations, resource), resources, config keys and types, event listeners, pages (layouts, loaders, actions), queue jobs, scheduled tasks and installed @warlock.js versions — as a versioned report (`schemaVersion: 1`) with a published JSON Schema; `inspectApp()` returns the same object. Triggers: `warlock inspect`, `--section`, `inspect_routes`, `inspectApp`, `bootForInspect`, `InspectReport`, `INSPECT_REPORT_JSON_SCHEMA`, `inspect-report.schema.json`, `@warlock.js/core/tooling`; "which routes are unguarded", "what does this app expose", "what models and columns exist", "which config keys are set", "list event listeners", "app facts as JSON for an agent". Skip: a route table for humans — the `warlock-routes` topic; health diagnostics — the `warlock-doctor` topic; verifying a change — the `warlock-check` topic; an OpenAPI file — the `generate-openapi` topic.'
---

# Warlock — `warlock inspect`

Read the app's facts from its **booted registries**, not from source text. Run it before changing an app you do not know, and when you need a fact the code only implies (the effective rate limit of a route, whether a guard runs, which resource a model uses).

```bash
npx warlock inspect                                  # counts + a route list
npx warlock inspect --json > app.json                # the full report
npx warlock inspect --json --section routes,models   # only some sections
```

Except for `--section files` (static source inspection without app boot), it boots like `warlock doctor`: connectors boot (routes register) but none starts — no database, cache or socket connection, no port. With `--json`, stdout is only the JSON.

Sections: `routes`, `models`, `resources`, `config`, `events`, `pages`, `jobs`, `schedules`, `packages`, `files`. An unknown section fails before the app boots.

## Answer questions with jq

```bash
# Mutating API routes without an auth guard
npx warlock inspect --json --section routes \
  | jq -r '.routes[] | select(.method != "GET" and .auth.required == false and .isPage == false) | "\(.method) \(.path)  \(.sourceFile)"'

# Routes that log request bodies
npx warlock inspect --json --section routes | jq -r '.routes[] | select(.logging.body) | .path'

# A model's columns and relations
npx warlock inspect --json --section models | jq '.models[] | select(.name == "User") | {columns: [.columns[].name], relations}'

# Config keys (types only — values are never printed)
npx warlock inspect --json --section config | jq -r '.config[] | "\(.key): \(.type)"'
```

## The route entry

```json
{
  "method": "PATCH",
  "path": "/posts/:id",
  "name": "posts.update",
  "sourceFile": "src/app/posts/routes.ts",
  "handler": "updatePostController",
  "middleware": ["authMiddleware"],
  "auth": { "required": true, "sources": ["header"], "userTypes": ["user"] },
  "csrf": true,
  "rateLimit": { "source": "global", "max": 60, "timeWindow": 60000 },
  "logging": { "body": true, "query": true, "privateRules": false },
  "request": {
    "parameters": [
      { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
    ],
    "body": {
      "type": "object",
      "properties": { "title": { "type": "string" } },
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

`$ref`s resolve against `components.schemas` in the same report. Request and response schemas come from the same code as `warlock generate.openapi`.

## From code

```ts
import { inspectApp, type InspectReport } from "@warlock.js/core/tooling";

// The app is already booted in this process (a dev-server hook, a test with setupTest()):
const report: InspectReport = await inspectApp({ sections: ["routes", "models"] });
const publicWrites = report.routes?.filter(
  (route) => route.method !== "GET" && !route.auth.required,
);
```

`inspectApp()` boots nothing. To boot first, the way the command does:

```ts
import { bootForInspect, inspectApp, inspectOptionsFromBoot } from "@warlock.js/core/tooling";

const boot = await bootForInspect();
const report = await inspectApp({ ...inspectOptionsFromBoot(boot) });
```

Validate a report with the published schema — `INSPECT_REPORT_JSON_SCHEMA` (draft 2020-12), also shipped as `node_modules/@warlock.js/core/schemas/inspect-report.schema.json`:

```ts
import Ajv2020 from "ajv/dist/2020";
import { INSPECT_REPORT_JSON_SCHEMA, inspectApp } from "@warlock.js/core/tooling";

const report = await inspectApp();
const valid = new Ajv2020({ strict: false }).validate(INSPECT_REPORT_JSON_SCHEMA, report);
```

## Stability (schemaVersion 1)

- Fields are only added; none is removed, renamed or retyped. Ignore keys you do not know.
- A section you did not request is absent, not empty.
- Warning and description text is not a contract; match on `code` fields.
- A breaking change ships as `schemaVersion: 2`, listed under BREAKING in the changelog.

## Agents: ask through MCP instead of shelling out

`npx warlock mcp` serves the same report as tools — `inspect_app` for the counts, then `inspect_routes` (`filter`, `method`, `unguardedWrites`), `inspect_models`, `inspect_config`, … one per section, plus `db_schema` built from the `models` section. `npx warlock dev --mcp` serves them from the dev server, so they reflect the last hot reload. See the `warlock-mcp` topic.

`warlock dev` also writes a summary of this report (modules, routes, unguarded writes, models, installed skills) into the generated section of `AGENTS.md` — see the `warlock-agents-md` topic.

## Gotchas

- `warnings` lists what could not be read — `WL2001` a module failed to import (its routes are missing from the report), `WL4001` a schema with no JSON Schema form. Run `npx warlock explain <code>`.
- `events` lists listeners app modules registered on `@mongez/events` while loading; listeners added later at runtime, and `Model.events()` listeners, are not included.
- `jobs` and `schedules` appear only when a loaded module (usually `worker.ts`) defined them through the app's `@warlock.js/queue` / `@warlock.js/scheduler`.
- App modules are imported, so their import-time side effects run, as in `warlock dev`.

## See also

- The `warlock-check` topic — verify a change: typecheck, lint, tests, conventions, error codes.
- The `warlock-mcp` topic — the same facts as MCP tools for a coding agent.
- The `warlock-agents-md` topic — the app summary `warlock dev` keeps in AGENTS.md.
- The `warlock-routes` topic — the human route table.
- The `generate-openapi` topic — the same route schemas as an OpenAPI document.

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

---
name: generate-openapi
description: 'Generate an OpenAPI 3.1 document from the registered routes with `warlock generate.openapi` (default `storage/openapi/openapi.json`) and read it live in the dev-only API docs page at `/__warlock/docs`. Documents paths, path/query parameters, request bodies from Seal validation, responses from `handler.responseSchema`, 401/422 and bearer/cookie security from `authMiddleware()`. Triggers: `generate.openapi`, `openApiGeneratorCommand`, `buildOpenApiDocument`, `getDevelopmentOpenApiDocument`, `responseSchema`, `--include-pages`, `/__warlock/docs`; "OpenAPI", "Swagger", "API docs", "import my API into Postman or Insomnia", "document my routes". Skip: declaring response types on a handler — `@warlock.js/core/create-controller/SKILL.md`; the devtools dashboard — `@warlock.js/devtools/devtools-overview/SKILL.md`; listing routes — `@warlock.js/core/warlock-routes/SKILL.md`.'
---

# Warlock — generate an OpenAPI document

`warlock generate.openapi` writes an OpenAPI 3.1 JSON document derived from the routes your app registers. Nothing is annotated by hand: the document reads the route table, each handler's `validation`, `description` and `responseSchema`, and the auth middleware on the route.

```bash
npx warlock generate.openapi
# OpenAPI 3.1.0 written to <root>/storage/openapi/openapi.json (12 paths, 17 operations).
```

Routes are read in the same isolated registration child process `warlock build` uses: your route modules are imported, **no connector starts** (no database, cache or socket), and the running dev server is untouched. If the app cannot be loaded the command fails; gaps in a single route never fail it, they are printed as warnings. The child honours `WARLOCK_ROUTE_REGISTRATION_TIMEOUT_MS`.

## Options

| Option            | Default                                        | Meaning                                                      |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| `--out`, `-o`     | `storage/openapi/openapi.json`                 | Output file, relative to the project root. Parent folders are created. |
| `--title`         | `name` in `package.json` (else `Warlock API`)  | `info.title`. `info.version` is the `package.json` version (else `0.0.0`); `info.description` is its `description`. |
| `--server`        | `http://<host>:<port>` from the `http` config  | `servers[0].url`. A wildcard host (`0.0.0.0`, `::`) becomes `localhost`. |
| `--include-pages` | off                                            | Also document page (SSR) routes; each is a `200` with `text/html`. |

```bash
npx warlock generate.openapi --out docs/openapi.json --title "Shop API" --server https://api.shop.test
```

## What is documented

| Part                    | Source                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| Paths                   | `:id` becomes `{id}`. An `all` route expands into one operation per verb (get, post, put, patch, delete, options, head). |
| `operationId`           | The route `name` (`name.<verb>` when an `all` route expands), else `<verb>_<path_slug>`. Duplicates are renamed with a warning. |
| Tag                     | The first static path segment (`/users/:id` is tagged `users`).                                  |
| Summary / description   | The route `label`; the route or handler `description`, plus a line about required user types and the cookie CSRF rule when the route is guarded. |
| Path parameters         | `validation.params` gives typed ones; a path segment with no schema is a required `string`.       |
| Request body / query    | `validation.schema`, converted with the Seal schema's JSON Schema output. It is the JSON request body for POST/PUT/PATCH and query parameters for GET/HEAD/DELETE, following `validating` the way validation reads the request. |
| Responses               | `handler.responseSchema`, one response per declared status (see below). A route with no 2xx declared gets a `200` description only. |
| `422`                   | Added when the route has `validation.schema`, shaped by `validation.response` (`errors`, `inputKey`, `inputError`, `status`; `Response.failedSchema` defaults to 422). Stored once as `components.schemas.ValidationFailed`. A route with only `validation.params` gets none. |
| `401`                   | Added when the route is guarded, as `{ error: string }` (`components.schemas.Unauthorized`). A status you declare yourself is kept. |
| Security                | `authMiddleware()` tags the middleware it returns with a `Symbol.for("warlock.auth")` descriptor (`{ sources, userTypes }`); core reads it without importing auth. A header source is `bearerAuth` (HTTP bearer), a cookie source is `cookieAuth` (API key in that cookie); header plus cookie is an OR. Only the schemes a route uses are emitted. Middleware without a descriptor adds nothing. |

### Responses from `responseSchema`

The grammar is the one described in [`create-controller`](../create-controller/SKILL.md#declaring-response-types-with-responseschema): cast strings with suffixes, a resource, `[Resource]`, nested objects.

```ts
loginController.responseSchema = {
  200: { body: { user: UserResource, token: "string" } },
  400: { body: { error: "string" } },
};
```

becomes

```json
"200": {
  "description": "Successful response",
  "content": {
    "application/json": {
      "schema": {
        "type": "object",
        "properties": {
          "user": { "$ref": "#/components/schemas/UserResource" },
          "token": { "type": "string" }
        },
        "required": ["user", "token"]
      }
    }
  }
}
```

- A cast maps to JSON Schema: `string` and `localized` to `string`, `url`/`uploadsUrl`/`storageUrl` to `string` with `format: uri`, `number`/`float` to `number`, `int` to `integer`, `boolean`, `object`, `array`, and `date` to the default date object (`iso`, `format`, `timestamp`, `humanTime`). `x[]` is an array; `x?` is `type: [T, "null"]`.
- A resource becomes a `components.schemas` entry named after its export (`UserResource`) and every use is a `$ref`. Nested, lazy and `"self"` fields reference the same entry. A resource that is not exported from a `*.resource.ts(x)` file gets a generic name.
- Every listed key is marked `required`.

## Warnings

What cannot be described statically is documented as `{}` and listed after the run. Common ones: a field builder or resolver function in a resource, an unknown cast, a `validation.validate` hook (custom middleware is not documented), a `validation.schema` that is not an object schema, an already-documented method+path, and a malformed auth descriptor. Fix them by declaring the field with a cast string.

## Live in development

With `@warlock.js/devtools` installed (`warlock add devtools`), `warlock dev` serves the same document:

- `http://localhost:<port>/__warlock/docs` renders it with Scalar. The dashboard has an **API** tab that embeds the same page.
- `GET /__warlock/api/openapi.json` returns the raw document, rebuilt from the routes registered in the running process on every request; it answers `503` when the host provides no generator.
- It is built in-process by `getDevelopmentOpenApiDocument()` (exported from `@warlock.js/core`; it throws outside `warlock dev`), so it follows your edits with no CLI run. Page routes are not included; each distinct warning is logged once per process.
- Devtools is dev-only and loopback-only, and the page makes no outside request (Scalar is vendored, no CDN).

## Use the file in a client

The output is plain OpenAPI 3.1 JSON, so any tool that reads an OpenAPI file can use it: import `storage/openapi/openapi.json` into Postman or Insomnia (their Import action), or feed it to a client generator. Support for 3.1 is the tool's; if an old version refuses it, update the tool. Regenerate the file whenever routes change, or commit it if you publish it.

## Programmatic use

`buildOpenApiDocument(routes, context)` is exported from `@warlock.js/core`: a pure function from `router.list()` routes to `{ document, warnings }`. `context` carries `info`, `servers`, `includePages`, `resolveResourceName` and `validationResponse`. Use it to build the document inside your own tooling; the CLI uses the same function inside the registration child.

```ts
import { buildOpenApiDocument, router } from "@warlock.js/core";

const { document, warnings } = buildOpenApiDocument(router.list(), {
  info: { title: "Shop API", version: "1.0.0" },
});
```

## Gotchas

- **The document describes what you declare.** A route with no `responseSchema` documents only a `200` description; nothing is inferred from the controller body.
- **Export each resource from its own `*.resource.ts` file** so the schema component is named after it.
- **Seal validators are converted in the child process**, so the document always reflects the schema the app actually registers.
- **The 401 body is `{ error: string }`.** The auth middleware's real rejection also carries an `errorCode`; the document does not list it.

## See also

- [`create-controller/SKILL.md`](../create-controller/SKILL.md) — `validation`, `description` and `responseSchema` on a handler.
- [`define-resource/SKILL.md`](../define-resource/SKILL.md) — resources, which become `components.schemas`.
- [`warlock-routes/SKILL.md`](../warlock-routes/SKILL.md) — list the routes the document is built from.

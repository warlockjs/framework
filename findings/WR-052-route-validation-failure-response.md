# WR-052: Route validation cannot answer with an app's own stable error code

- **Package:** `@warlock.js/core` 5.30.0 (HTTP route `validation` and `ValidationConfiguration`)
- **Classification:** feature request
- **Found:** 2026-10-17, during Bureau's standards audit of its M5 owner routes.

## What happens

`ValidationConfiguration` controls the translation groups, `firstErrorOnly`, the translators and (in Bureau's
config) `response.status`. It cannot control the **failure body**. A route that validates through
`router.post(path, handler, { validation: { schema } })` always answers with the framework's validation body.

Bureau's API contract is a stable, closed `{ error: "<DOMAIN>_<REASON>" }` per route, for example
`OPERATIONS_IMPORT_REQUEST_INVALID` or `WJS_PRICES_INVALID`. The UI maps those codes to plain-language
messages. To keep that contract, Bureau's controllers skip route-level validation and run `validate(schema, body)`
inside the handler, then throw their own `HttpError`. That works, but it repeats the same boilerplate in each
controller and loses the declarative route schema, including for the OpenAPI output.

## Request

Let a route, or the global config, shape the failure response. For example:

```ts
router.post("/workspace-import", handler, {
  validation: {
    schema: importWorkspaceRequestSchema,
    onFailure: (result) => ({ status: 400, body: { error: "OPERATIONS_IMPORT_REQUEST_INVALID" } }),
  },
});
```

A global `validation.response.body(result, route)` hook would also work. The framework's default body should stay
unchanged when neither is set.

---
name: observe-page-requests
description: 'Observe SSR page request phases through core `TracingHooks`: page middleware, cache lookup, loader/render streaming, and deferred-value settlement. Triggers: `page.middleware`, `page.cache`, `defer.settle`, `render.shell`, `TracingHooks`, `http.tracing`; "trace a page request", "page cache telemetry", "deferred stream observability", "page returns 500", "SSR page throws", "find which page file failed".'
---

# Observe page requests

Web emits page spans through core's `TracingHooks.onPhase`; there is no
web-specific tracing API. Configure or register the hook as documented in
the `request-tracing` topic of the `warlock-js-core` skill.

```ts
import { registerTracingHooks } from "@warlock.js/core";

registerTracingHooks({
  onPhase(_ctx, phase) {
    if (phase.name === "page.cache") {
      console.log(phase.attrs?.status); // hit | miss | bypass
    }
  },
});
```

## Page-specific phases

| Phase             | Attributes                   | Meaning                                            |
| ----------------- | ---------------------------- | -------------------------------------------------- |
| `page.middleware` | `count`, `outcome` (`next`   | `response`                                         | `error`)                           | All page middleware settling |
| `page.cache`      | `status` (`hit`              | `miss`                                             | `bypass`)                          | Page-cache lookup settling   |
| `loader`          | `level`, `layoutPath?`       | An app, layout, or page loader                     |
| `render.shell`    | —                            | Rendering until React's shell is ready to stream   |
| `stream.end`      | —                            | Whole streamed response, including deferred values |
| `defer.settle`    | `key`, `status` (`fulfilled` | `rejected`)                                        | One deferred loader value settling |

Every phase has `name`, `durationMs`, and `startedAt` (epoch milliseconds).
Use `key` only to identify a deferred value; do not put sensitive loader data
in tracing attributes.

## Debug a page that answers 5xx

Tracing shows timing; the error log shows why. Every `5xx` page response writes
one `error`-level logger record (`module: "web"`, `action: "page.<phase>"`),
once per failure, with this context: `name`, `message`, `stack` (source-mapped
in development; run Node with `--enable-source-maps` in production), `phase`,
`level`, `file` (the matched page file), `routePath`, `site`, `method`,
`pathname`, `requestId`.

Read the phase first:

- `translations`: the route's translation snapshot could not be bound (a locale the page has no table for, or a source file missing from the route-locale manifest).
- `module-load`: the app, layout or page module failed to import or register.
- `middleware`, `session`, `loader`: the pipeline stage threw; `level` names app, layout or page.
- `metadata`: `metadata` or document slots threw.
- `render`: a component threw; an `ErrorBoundary` or `error.page.tsx` swallowing it still logs here.
- `stream`: React's shell or stream failed after render.
- `defer`: a deferred value rejected.
- `unknown`: the status is 5xx but nothing threw (a `setStatusCode(500)`).

A `4xx` (not found, redirect, validation, a thrown `HttpError` below 500) is
not logged as an error. Outside production the error page and the framework
fallback show the same facts in a panel (`data-warlock-dev-error`), and
`error.page.tsx` receives them as `props.debug`; production responses stay
generic, so use the log and the `errorCode` to find the record.

A 5xx from an API route, a controller or a route middleware writes the same
kind of record from `@warlock.js/core` (`module: "http"`,
`action: "request.<phase>"`, phases `csrf`, `middleware`, `validation`,
`handler`), once per request, with the same `method`, `pathname`, `routeName`,
`routePath`, `requestId` and `stack`, plus the `handler` and the `middleware`
that threw. A 401 or 403 on a page route is not an error record: it renders the
app's `forbidden.page.tsx` (see the `create-a-page` topic).

## Inline payload budget

Each rendered document is checked against `build.budgets.payload` (default `64kb`). An over-budget route logs one line per process with the size of each section (page, layout, app, translations, routes, session, other) and its largest data keys. The check is advisory: it never fails a request. Raise the limit for a route with a `pages` glob, or reduce the data the page loads. The e2e kit records the same measurement with `page.measurePayload({ limit })`.

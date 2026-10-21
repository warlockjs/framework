---
name: observe-page-requests
description: 'Observe SSR page request phases through core `TracingHooks`: page middleware, cache lookup, loader/render streaming, and deferred-value settlement. Triggers: `page.middleware`, `page.cache`, `defer.settle`, `render.shell`, `TracingHooks`, `http.tracing`; "trace a page request", "page cache telemetry", "deferred stream observability".'
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

## Inline payload budget

Each rendered document is checked against `build.budgets.payload` (default `64kb`). An over-budget route logs one line per process with the size of each section (page, layout, app, translations, routes, session, other) and its largest data keys. The check is advisory: it never fails a request. Raise the limit for a route with a `pages` glob, or reduce the data the page loads. The e2e kit records the same measurement with `page.measurePayload({ limit })`.

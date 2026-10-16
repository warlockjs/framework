---
name: upgrade-from-5-29
description: "Upgrade a Warlock application from 5.29 to 5.30 or 5.31: synchronous logger calls, concurrent AI tools, request log snapshots, fresh rate-limit counters, image derivative caches and the Head viewport. Use for this migration or when diagnosing changed behavior after that upgrade."
---

# Upgrade an application from 5.29

Read the installed packages' changelogs and keep the `@warlock.js/*` family on the
same release. Apply only the changes used by the application, then run its type
check and targeted tests. These minors can contain breaking changes; do not rely
on a major version boundary to find them.

For a target of 5.31, use Node.js 22.15 or newer in development, CI and production.
The minimum is required before the CLI can load the app. See the `run-app` topic
for runtime and package-manager troubleshooting.

## Logger calls are synchronous; delivery can still be asynchronous

In 5.30, `log.info/warn/error/debug/success/fatal/log/assert` and timer callbacks
return the logger, rather than a promise. Remove `.then()` chains and unnecessary
`await` from these calls. To wait for channel delivery, drain explicitly on a
graceful path:

```ts
import { log } from "@warlock.js/logger";

log.onChannelError((error, channel) => console.error(channel.name, error));
log.info("app", "shutdown", "Stopping");
await log.flush({ timeout: 3_000 });
```

`flush()` is bounded and reports channel failures/timeouts through the handler.
It resolves so shutdown can continue. Do not log through this logger from its own
error handler. A signal handler that re-raises the signal still needs a synchronous
flush; see `flush-logs-on-shutdown` in the Logger skills.

## A model trip's tools now run concurrently

5.30 defaults to concurrent dispatch with a cap of four. Independent tools can
keep the default. Tools that depend on previous tool side effects or inspect
previous same-trip results should explicitly retain sequential dispatch:

```ts
import { ai, type ModelContract, type ToolContract } from "@warlock.js/ai";

export function createOrderedAgent(model: ModelContract, tools: ToolContract[]) {
  return ai.agent({ name: "ordered", model, tools, toolDispatch: "sequential" });
}

export function createParallelAgent(model: ModelContract, tools: ToolContract[]) {
  return ai.agent({ name: "parallel", model, tools, maxConcurrentTools: 2 });
}
```

The cap is per trip, not global. Results still reach the model in request order.
Audit custom tool middleware for shared mutable state. If storing multi-trip
conversation history, use captured messages and provider blocks; a final text
plus blocks alone cannot replay an entire tool conversation.

## Request logs contain snapshots

Custom channels and redaction censors that read `context.request` or
`context.response` must handle plain snapshots in 5.30. Replace reads such as
`request.baseRequest.url` and `request.route.path` with snapshot `url` and
`route` fields. Keep the framework's bounded snapshot rather than serializing the
Request/Response objects yourself:

```ts
import type { Request } from "@warlock.js/core";
import { log } from "@warlock.js/logger";

export function logCompletedRequest(request: Request) {
  const snapshot = request.toLogSnapshot();
  log.info("http", "request", snapshot.url, { request: snapshot });
}
```

Audit body/query policies on sensitive routes. In 5.31, `http.logging.private`
can suppress input for URL families even before a route matches; it takes
precedence over per-route logging settings. See `configure-app`.

## Counters start fresh under the new keys

Throttle and rate-limit key hashing changed. Existing counters do not carry into
new windows after upgrading: account for that temporary reset when rolling out a
security-sensitive limit. Let old TTL keys expire; avoid flushing unrelated
application cache data. Servers sharing limits should use the same release and
Redis/Postgres cache configuration (`http.rateLimit.store: "cache"`). A memory
driver shares nothing across replicas.

## Image derivatives are re-rendered

5.30 no longer reads the old two-level
`<cacheDirectory>/<2 hex>/<hash>.<ext>` layout. Originals stay intact; the first
request recreates each derivative in its source-specific layout. Plan for that
initial render load. Reclaim old cache files once the rollout is complete, or
use `purgeImageVariants()` for a configured disk when intentionally clearing its
whole derivative cache. Purging is an operational action, not a prerequisite for
successful requests.

For 5.31, derivatives also support configured object-storage disks and bounded
cache age/size. See `store-file` before adapting a private media route.

## Head now emits a viewport

5.30's `<Head />` emits `width=device-width, initial-scale=1` by default. Remove a
manual duplicate viewport tag from `root.tsx`. Override through
`metadata.viewport`, or set it to `false` if the app intentionally emits none.
Verify responsive layout on a narrow viewport; no hand-written tag is needed in
a new scaffold.

## Additional 5.31 Seal behavior

Refinements run after successful type/child validation and receive parsed output.
A container's `catch()` does not replace its own failed rules. Union validation
returns the matched branch's parsed output, including trimming, Date coercion,
defaults, stripped keys and explicit `undefined`. Read raw request input before
validation if the app needs both forms. Audit callbacks that previously assumed
unparsed input or side effects after validation failure; see Seal's `seal-basics`
and `compose-schemas` topics for the exact typing and output-transform caveats.

## Verify the application paths that changed

Run the app's type check, its logger channel tests, any tools with ordered side
effects, shared-counter tests, one cold derivative request and one mobile page
render. For workspaces, update custom read results with the new window/byte fields
and custom shell results with required `cancelled`. An aborted command resolves
with `cancelled: true`; it does not throw solely because it was cancelled.

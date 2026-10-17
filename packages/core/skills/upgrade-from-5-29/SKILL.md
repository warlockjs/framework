---
name: upgrade-from-5-29
description: "Upgrade a Warlock application from 5.29 to 5.30 or 5.31: synchronous logger calls, concurrent AI tools, request log snapshots, cut-off AI agent answers, auth throttle resets, image derivative caches and the Head viewport. Use for this migration or when diagnosing changed behavior after that upgrade."
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

export function runOrderedSubAgent(model: ModelContract, tools: ToolContract[], task: string) {
  return ai.spawnSubAgent({
    name: "ordered-child",
    model,
    tools,
    task,
    toolDispatch: "sequential",
  });
}
```

Sub-agents also default to concurrent tool dispatch; pass
`spawnSubAgent({ toolDispatch: "sequential", … })` for ordered side effects.
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

## Auth login counters and locks reset

In 5.30, auth login throttle keys hash account and IP identifiers. Both counters
and locks written under 5.29 are forgotten: previously locked accounts/IPs are
unlocked on upgrade. Changing `auth.accessToken.secret` resets them again because
it keys the hash. Account for this temporary reset in a security-sensitive rollout;
let old TTL keys expire and avoid flushing unrelated application data.
This key change applies to the built-in email/IP identifiers; keys produced by a
custom `identify` carry over.

Separately, 5.30 adds `http.rateLimit.store: "cache"`. Moving from the memory store
starts new windows. Servers sharing limits need the same release and Redis/Postgres
cache configuration. A memory driver shares nothing across replicas.

## Seal validation results narrow on success

The 5.30 type change makes `validate()` results discriminate on `isValid`: read
typed `data` after checking success; on failure it is `undefined`. A validator
typed as bare `BaseValidator` (or bare `ObjectValidator`) retains `data: any`.
Audit code that used failure data or assigned output to an unrelated type.
5.30 also validates a present `""` through the members of `v.union()` instead of
accepting it unchecked. A `null` default no longer satisfies required on a
non-nullable field, and `v.int().default("")` now fails its type rule. Check forms
that depended on those defaults or blank values.

## Image derivatives are re-rendered

5.30 no longer reads the old two-level
`<cacheDirectory>/<2 hex>/<hash>.<ext>` layout. Originals stay intact; the first
request recreates each derivative in its source-specific layout. Plan for that
initial render load. Reclaim old cache files manually from their dedicated
folder once the rollout is complete. In 5.31, `purgeImageVariants()` removes only
recognized files in the current shard/source/generation layout and retains the
cache root, unrelated files and symlinks. Purging is an operational action, not a
prerequisite for successful requests. When `uploads.images.cacheDirectory` is set,
every local disk shares it, so a path-less `purgeImageVariants()` clears every
local disk's derivatives, not only the default disk's.
In particular, 5.31 `purgeImageVariants()` does not remove those legacy two-level
files; the suggestion to use it in the 5.30 changelog does not apply in 5.31.

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
They skip absent, null and invalid values; input checks belong in `.addRule()`.
They also run on successful empty defaults such as `.default("")`, so a rejecting
refinement now rejects that default. A container's `.catch()` is a no-op,
including failures in the container's own rules; use child catches or handle a
failed container result explicitly. Union validation
returns the matched branch's parsed output, including trimming, Date coercion,
defaults, stripped keys and explicit `undefined`. Read raw request input before
validation if the app needs both forms. Audit callbacks that previously assumed
unparsed input or side effects after validation failure; see Seal's `seal-basics`
and `compose-schemas` topics for the exact typing and output-transform caveats.

`v.union(...)` now tries every member whose type matches, so a union of object
schemas accepts a value matching a later member. When every member fails, the
closest member's errors are reported at their own paths (`actor.id`, not `actor`)
with type `union`; `firstErrorOnly: false` lists each of them instead of one
`;`-joined message. Update code that maps union errors by path or splits that
message; a custom `v.union([...], "message")` still reports one error at the
union's path.

## AI finish reasons, provider bodies and resumed output

5.30 adds `context_exceeded`, `pause_turn` and `refusal` to `FinishReason`; update
exhaustive switches. The Anthropic adapter maps context-window exhaustion to
`context_exceeded` instead of `length`, and pause/refusal to their own values
instead of `error`. Handle each as an explicit application decision.

`providerOptions.anthropic.body` cannot replace `model`, `messages`, `system`,
`tools`, `mcp_servers` or `stream`; these keys throw `InvalidRequestError`.
Move conversation/model/tool settings to the normal API fields. After a resumed
`pause_turn`, `result.text` joins the accumulated text. `result.blocks` is only
provided for single-trip runs; retain captured messages for multi-trip replay.

In 5.31, `AgentConfig.compaction` is opt-in: set required `afterTokens` and a
`summarize` callback, with optional `keep` and `countTokens`. For example, inject
the application's summarizer instead of relying on a hidden model call:

```ts
import { ai, type AgentCompactionConfig, type ModelContract } from "@warlock.js/ai";

export function createCompactingAgent(
  model: ModelContract,
  summarize: AgentCompactionConfig["summarize"],
) {
  return ai.agent({
    name: "compact-history",
    model,
    compaction: { afterTokens: 16_000, keep: 8, summarize },
  });
}
```

Test tool-result grouping and durable resume before enabling it. Compaction
preserves the original run input and skips unsafe ranges. When it applies,
`result.blocks` stays absent; persist `captureMessages` history plus the last
trip's output/blocks for replay. It does not replace application retention policy.

## 5.30 to 5.31 production rate limits

5.31 makes global and per-route rate limits apply to production and development application
routes, including web page routes. The default global limit is 60 requests per
minute per IP, in one bucket shared by pages and API routes. Check `max` before
deployment; configure `trustProxy` or `keyGenerator` behind a proxy so clients do
not share the proxy's single key. Set `http.rateLimit.global: false` to retain the
previous global behaviour and enable individual route limits deliberately.

Static files are exempt by default, so a page load's assets do not spend that
quota: the public folder, `router.directory()` mounts, `router.file()` routes and
the web build's `/assets/*` and public files. `http.rateLimit.staticFiles: true`
counts them again; `router.directory(options, { rateLimit: true })` counts one
mount. Built-in `/health` and `/ready` routes are exempt by default too; set
`http.health.rateLimit: true` to opt them into the limiter (see `health-checks`).

To exempt one route, pass `rateLimit: false` in its options (or the
`serverOptions: { config: { rateLimit: false } }` pass-through). Development's
wildcard dispatcher now honours both, the same as production:

```ts title="src/app/status/routes.ts"
import { router } from "@warlock.js/core";

router.get("/status", ({ response }) => response.success({ status: "ok" }), {
  rateLimit: false,
});
```

## 5.30 to 5.31 daily log file names

`FileLog` and `JSONFileLog` now name dated files by sortable ISO date: a daily
chunk writes `2026-10-17.log` instead of `17-10-2026.log`, an hourly chunk
`2026-10-17-14.log`, and rotated archives use `YYYY-MM-DD` in the middle. Update
log shippers, cron cleanups or scripts that look for the old names. To keep them:

```ts
new FileLog({
  chunk: "daily",
  fileName: "{DD}-{MM}-{YYYY}", // 17-10-2026.log, as before 5.31
  rotateFileName: "{DD}-{MM}-{YYYY}",
});
```

`rotateFileName` is a `{YYYY}`-style pattern or a function, not a Day.js format.
To replace a custom pruning job, use `retention: { maxFiles, maxAgeDays }` (see the
Logger `pick-log-channel` topic); it never removes files with another name pattern,
such as files written under the old names.

## 5.30 to 5.31 cut-off agent answers

In 5.31 an agent run whose final response hit the output cap (`length`) or the
context window (`context_exceeded`) no longer succeeds with empty or partial
text: `result.error` is an `AgentIncompleteError` (`AGENT_INCOMPLETE`,
`reason: "output_limit" | "context_window"`, `tripIndex`) and
`report.status` is `"incomplete"`. A tool call cut off mid-input is never run.
Remove `trips.at(-1).finishReason === "length"` checks that treated it as a
success, handle the error, or let the agent continue cut-off output:

```ts
import { ai, AgentIncompleteError, type ModelContract, type ToolContract } from "@warlock.js/ai";

export async function runWorker(model: ModelContract, tools: ToolContract[], task: string) {
  const worker = ai.agent({ name: "worker", model, tools, continueOnOutputLimit: 2 });
  const result = await worker.execute(task);

  if (result.error instanceof AgentIncompleteError) {
    throw new Error(`worker answer cut off (${result.error.reason})`, { cause: result.error });
  }

  return result.text;
}
```

Dashboards that switch on `report.status` need the `incomplete` case. The
Anthropic adapter's default `max_tokens` rose from 4096 to the model's max
output when streaming and 16384 otherwise; set `maxTokens` to keep a lower cap.
`agent.execute/stream(input, { modelOptions })` now applies per-run model options.
## 5.30 to 5.31 MCP serving

`ai.mcp.serve()` now throws `McpServeError` (`type: "collision"`) when two
exposed tools share a name; before, both were listed and calls reached only one.
Rename one tool, or serve `{ groups: { a: toolsA, b: toolsB } }` with
`prefixToolNames: true`. `{ type: "http" }` now binds a real endpoint
(`127.0.0.1` by default) and `start()` resolves `{ url, close }`; a
non-loopback `host` needs `auth`. Code implementing `McpServer` itself must
return that handle from `start()`.

## 5.30 to 5.31 AI workspace

`ws.tools.all()` now also vends `multi_edit`, `list_dir`, `todo_write` and
`todo_read` (and `shell_output` / `shell_kill` with `shell.background`); use
`ws.tools.pick(...)` to keep the old set. Custom `WorkspaceOps` / `Workspace`
implementations must add `multiEdit`, `listDir`, `startShell`, `shellOutput`,
`shellKill`, `listShells`, `dispose` (and `readTodos` / `writeTodos`). With deny
rules and no allowlist entry, `bash -c`, `eval`, `xargs`, `sudo` and similar
runners are refused (`reason: "nested-command"`); `shell.deny` is
case-insensitive. Branch on `WorkspacePolicyError.reason`, not the message text.
Call `ws.dispose()` when a workspace with background commands is done.

## Verify the application paths that changed

Run the app's type check, its logger channel tests, any tools with ordered side
effects, shared-counter tests, one cold derivative request and one mobile page
render. For workspaces, update custom read results with the new window/byte fields
and custom shell results with required `cancelled`. `read.maxBytes` now really
caps returned content, including line-number prefixes (`bytesCapped: true`);
a window starting past EOF returns empty content. An aborted command resolves
with `cancelled: true`; it does not throw solely because it was cancelled.

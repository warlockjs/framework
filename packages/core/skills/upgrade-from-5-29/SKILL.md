---
name: upgrade-from-5-29
description: "Upgrade a Warlock application from 5.29 to 5.30 or 5.31: synchronous logger calls, concurrent AI tools, request log snapshots, cut-off AI agent answers, auth throttle resets, image derivative caches, the Head viewport, production rate limits and test fakes on by default. Use for this migration or when diagnosing changed behavior after that upgrade."
---

# Upgrade an application from 5.29

Read the installed packages' changelogs and keep the `@warlock.js/*` family on the
same release. Apply only the changes used by the application, then run its type
check and targeted tests. These minors can contain breaking changes; do not rely
on a major version boundary to find them.

## Start with `warlock upgrade`

Run the codemods first; they make the mechanical edits below and list every
other place to review with `file:line`:

```bash
warlock upgrade --from 5.30 --to 5.31.0 --dry-run   # diff + review list, nothing written
warlock upgrade --from 5.30 --to 5.31.0             # apply; then install, type-check, test
warlock upgrade --from 5.30 --to 5.31.0 --json      # same result as JSON
```

Pass `--from`. The command ships in 5.31, so it runs after the new
`@warlock.js/core` is installed, and without `--from` it reads that installed
version, the target itself, as the starting point and stops. An app still on
5.29 passes `--from 5.29` so the 5.30 codemods run too.

It removes `await` before log calls, rewrites custom log channels' snapshot
reads, drops a duplicate default viewport tag, raises `engines.node`/`.nvmrc`
and moves every `@warlock.js/*` dependency to the target. It lists, without
editing, `.then()` on log calls, non-snapshot channel reads, `validate()` data
read without `isValid`, agents with tools and no `toolDispatch`, reserved
`providerOptions.anthropic.body` keys, `finishReason` switches, a missing
`http.rateLimit`, `.refine()`, container `.catch()`, `v.union()` and incomplete
`compaction`. It needs `ts-morph` (it prints the install command when missing).
Work through the review list with the sections below.

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
Files served by a route handler, such as
`router.get("/uploads/*", createUploadedFileController())`, are not static mounts
and count against the limit; pass `rateLimit: false` (or a route limit) there if
pages embed many of them.

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

## 5.30 to 5.31 test fakes are on by default

In 5.31 `setupTest()` and `startHttpTestServer()` install the test fakes once
their connectors are up: mail is captured instead of sent, `@warlock.js/queue`
dispatches are recorded instead of pushed to Redis, the cache uses a fresh
in-memory driver, every storage driver writes to a temp directory, and the
framework `clock` / `ids` are deterministic. A suite that relied on a real SMTP
sink, a Redis cache shared between the HTTP test server and the workers, a real
bucket or jobs actually processed by a worker opts out in `src/config/tests.ts`:

```ts title="src/config/tests.ts"
const testsConfigurations = {
  fakes: false, // or only some: { cache: false, queue: false }
};

export default testsConfigurations;
```

Then use the assertions instead of probing real services (`mailFake.assertSent`,
`queueFake.assertPushed`; see `test-fakes`). `startHttpTestServer({ port: 0 })`
is now supported and is what `warlock add test` generates; an existing
`src/test-global-setup.ts` keeps its port until you change it.

## 5.30 to 5.31 AI cost, prices and provider errors

5.31 bills prompt caching per provider. Anthropic and Bedrock usage is marked
`inputIncludesCache: false`, cache writes are charged (in the new
`cost.cacheWrite` channel, 1-hour writes at `cacheWrite1h`), so their reported
costs rise to the correct figure. Replace hand-summed cost totals with
`totalCost`, and set `cacheWrite` instead of the deprecated `cachedOutput` rate:

```ts
import { totalCost, type Usage } from "@warlock.js/ai";

export function runCostUsd(usage: Usage): number | undefined {
  return totalCost(usage.cost);
}
```

Anthropic, OpenAI, Gemini and Claude-on-Bedrock models now ship verified list
prices, so `usage.cost` appears and USD budgets enforce without configuration.
Some old defaults were removed because the vendor no longer publishes a flat
price: Groq's Llama models, DeepSeek's `deepseek-chat` / `deepseek-reasoner`,
and Mistral's Pixtral / Magistral. A USD budget on those now rejects the run as
unpriced; pass `pricing`. DeepSeek defaults to its peak rates.

Provider overloads now throw `ProviderOverloadedError` (`PROVIDER_OVERLOADED`)
instead of a plain `ProviderError`; update exhaustive `AIErrorCode` switches and
custom `fallbackModel({ retryOn })` lists. Bedrock calls with a `cacheControl`
breakpoint now also cache the system prompt and (Claude) tool definitions.

## 5.31 to 5.32 notifications with the herald queue

Apps that call `.queue()` with `heraldQueue()` must now install `@warlock.js/herald` themselves (it became an
optional peer of `@warlock.js/notifications`; 5.31.0 bundled a private copy of it). Install it at the same version
as the rest of the family.

## Verify the application paths that changed

Run the app's type check, its logger channel tests, any tools with ordered side
effects, shared-counter tests, one cold derivative request and one mobile page
render. For workspaces, update custom read results with the new window/byte fields
and custom shell results with required `cancelled`. `read.maxBytes` now really
caps returned content, including line-number prefixes (`bytesCapped: true`);
a window starting past EOF returns empty content. An aborted command resolves
with `cancelled: true`; it does not throw solely because it was cancelled.

## 5.30 to 5.31: `warlock dev` keeps a section of AGENTS.md

5.31's `warlock dev` writes an app summary for coding agents into `AGENTS.md`
at the project root — creating the file when it is missing, otherwise only
between `<!-- warlock:generated:start -->` and `<!-- warlock:generated:end -->`
(appended at the end the first time). Commit the file like any other agent
guide, or turn the refresh off:

```ts title="warlock.config.ts"
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  devServer: { agentsMd: false },
});
```

It also writes `.warlock/dev-server.json` (the server's address, for
`warlock trace` and `warlock mcp`); `.warlock/` is already git-ignored by the
starter. See the `warlock-agents-md` topic.

## 5.31 to 5.32 TypeScript 7

With the default Oxlint/Oxfmt toolchain, pin the app's development dependency to
`typescript@7.0.2`. The regular `tsc`
command is now the native Go compiler; no native-preview package is needed.
Remove `baseUrl` from every app tsconfig and resolve each `paths` target relative
to the config. For example, `baseUrl: "src"` with `"app/*": ["app/*"]` becomes
`"app/*": ["./src/app/*"]`. Replace `moduleResolution: "node"` / `"node10"` with
`"bundler"` and use `module: "ESNext"` for Warlock's build pipeline. Explicitly
include Node ambient types with `"types": ["node"]`; set `rootDir` if sources
sit outside the config folder. Keep strict checking enabled.

```bash
npm install --save-dev --save-exact typescript@7.0.2
npx tsc --noEmit
npx warlock typecheck
npx warlock typecheck --changed
```

The CLI preserves incremental state and changed-file filtering. Development
health checks keep one native compiler session and update its snapshots. Syntax
analysis uses OXC. `warlock upgrade` still parses/transforms with ts-morph's own
bundled TypeScript, without using it as the app's compiler. New scaffolds default
to Oxlint/Oxfmt (`--lint=oxc`) with TypeScript 7.0.2. ESLint support was
removed in 5.34.0; migrate legacy apps using the steps below.

## 5.32 to 5.33

The original `oxc-toolchain` codemod remains available:

```bash
npx warlock upgrade --from 5.32 --to 5.33.0 --dry-run
npx warlock upgrade --from 5.32 --to 5.33.0
```

## 5.33 to 5.34 toolchain removal

**BREAKING:** ESLint and Prettier support was removed in **5.34.0**. Oxlint/Oxfmt is the only
supported toolchain. `--lint eslint` and `healthCheckers.eslint` are removed.
Install the new core release and `ts-morph`, then migrate an existing app:

```bash
npm install --save-dev ts-morph
npx warlock upgrade --from 5.33 --to 5.34.0 --dry-run
npx warlock upgrade --from 5.33 --to 5.34.0
npm install
npm run format
npm run lint:check
npx warlock check
```

The `oxc-toolchain-removal` step reapplies the preserved 5.33 `oxc-toolchain`
migration when legacy configs, scripts or dependencies remain. Apps upgrading
from 5.32 can still use `npx warlock upgrade --from 5.32 --to 5.33.0` first.
It replaces standard scripts/dependencies, pins TypeScript 7.0.2, updates generated
editor settings, removes `healthCheckers.eslint` and selects Oxlint. A generated
`.prettierignore` becomes `.oxfmtignore`; Oxfmt scripts read it explicitly.

Generated migration configs enable `typescript/no-explicit-any`, `curly`, and
`no-console` as errors, matching new apps. Fix those diagnostics before running
`npm run lint:check` and `npx warlock check` again.

The `oxc-toolchain` codemod also updates generated VS Code settings and literal
ESLint/Oxlint health-check switches. Custom editor settings, checker arrays,
computed options and nonstandard scripts require review. Oxc diagnostics keep
framework conventions in `warlock check`. Re-run the migration after addressing
manual findings if needed; an app with only Oxc tooling is a no-op for this codemod.

## 5.33 to 5.34 plain object validation

**BREAKING:** Seal `v.object()` rejects arrays, dates, maps, sets, class instances
and objects with custom prototypes, including under `.allowUnknown()` and
`.stripUnknown()`. Plain and null-prototype dictionaries remain accepted. There
is no permissive opt-in: choose an array/instance validator or construct a plain
DTO explicitly before validation.

```ts
import { v } from "@warlock.js/seal";

class User {
  name = "Ada";
}
const instance = new User();
const user = v.object({ name: v.string() });
await v.validate(user, { name: instance.name });
const names = v.array(v.string());
await v.validate(names, ["Ada"]);
```

`v.record(valueValidator)` remains supported. To validate dictionary keys, use
`v.record(keyValidator, valueValidator)`; malformed arguments now fail while
defining the schema. Literal-key records infer partial dictionaries because
only present keys are checked.
Literal custom rules are translated without executing the config. Per-folder
`no-restricted-imports` and `no-restricted-exports` become Oxlint overrides with
file/exclusion patterns. Supported `@typescript-eslint/*` rules become native
`typescript/*` rules (or native base rules). Options are checked against the
pinned Oxlint 1.88.0 schema. Type-aware equivalents enable `options.typeAware`
and add `oxlint-tsgolint@7.0.2004` to the app's dev dependencies.
`unused-imports/no-unused-imports` uses `no-unused-vars` with safe import fixes;
Oxlint shares the severity for imports and variables, so differing active
severities are reported for review.

Only unsupported rules/options, computed or imported settings, selectors such
as `no-restricted-syntax`, and conflicting existing Oxc rules need manual review.
Each finding names its source `file:line`, rule and affected file patterns.
Fully ported lint configs are removed; configs with findings remain for reference
until those findings are addressed. Existing Oxc rules are kept on conflict.
`--dry-run --json` reports the same plan without writes. Customized formatting,
editor settings and nonstandard scripts can also require review.

**Upgrading:** new and migrated template configs enable
`"categories": { "correctness": "error" }`. Address the additional diagnostics;
existing Oxc configs retain their categories. A real lockfile beside a workspace
marker determines the installer: `package-lock.json` plus `pnpm-workspace.yaml`
without `pnpm-lock.yaml` now produces `npm install`.

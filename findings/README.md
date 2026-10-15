# Warlock.js framework findings

Framework bugs and requests found while building Bureau 0.30 (its `apps/bureau` app) on Warlock.js 5.29.0. One file per finding; the table below is the summary. Evidence paths such as `.tmp/...` and `/tmp/...` refer to the Bureau workspace where each finding was reproduced.

This is the single report for framework work discovered during the Bureau v2
rebuild. Application defects belong to their domain handoffs. A reproduced
behavior is not automatically a framework bug: the entries below distinguish
contract failures from feature and performance requests. WR-004 has a retained,
lockfile-pinned application patch. WR-007 has a reproduced optional-validator
failure and a schema wrapper workaround. WR-008 independently confirms the documented empty-literal regression; WR-009
confirms an ignored workspace read byte cap. Other entries distinguish implemented
application workarounds from investigations still awaiting runtime qualification.

Last updated: 2026-10-16, Asia/Riyadh (5.30.0 status added).

The current inventory contains 27 entries: 8 confirmed bugs and 19 requests or
contract clarifications. Keep all framework findings from both sessions in this
file. For each new entry, record the affected package/version, expected and
observed behavior, reproduction steps, evidence, application impact and any
workaround. Check existing entries before adding one, and keep unconfirmed
suspicions distinct from reproduced bugs. Status emails include a short summary
of new findings and point back to this report.

| ID     | Classification                                      | Request                                                                    | Current impact                                                                                   |
| ------ | --------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| WR-001 | Performance / feature request                       | Compact public Seal schema typing and compiler-memory benchmarks           | Large composed schemas exceed the default compiler heap                                          |
| WR-002 | Web feature / contract clarification                | Form completion that includes redirect navigation commit                   | A second edit can start before fresh loader revisions arrive                                     |
| WR-003 | Core/logger feature request                         | Sensitive-route logging controls and safe request snapshots                | Request lifecycle logs can contain rejected arbitrary values and credential-bearing URLs         |
| WR-004 | Confirmed Core bug                                  | Local TypeScript configuration import graph does not load on Node 22.13    | Canonical local connector imports prevent configuration and build startup                        |
| WR-005 | Core typing feature request                         | Expose native HTTP server options in HttpConfigurations                    | Runtime forwarding exists but the public config type omits it                                    |
| WR-006 | SSE performance / feature request                   | Bounded event retention and writable backpressure for long-lived streams   | Actual loopback stream retains all events and continues after writable backpressure              |
| WR-007 | Confirmed Seal bug                                  | Optional discriminated unions reject omitted fields                        | Valid optional directory/authority fields fail validation without a union wrapper                |
| WR-008 | Confirmed Seal bug                                  | Empty string literals are treated as missing                               | Required empty values fail; optional empty/null values lose their data                           |
| WR-009 | Confirmed AI Workspace bug                          | Enforce configured read.maxBytes                                           | Direct reads and read_file return beyond the documented byte ceiling                             |
| WR-010 | AI Workspace feature request                        | Per-invocation cancellation through tool/ops/backend execution             | Backend exec has timeout but no AbortSignal contract                                             |
| WR-011 | Confirmed Web native-fallback bug / feature request | Preserve submitter formAction and named value; expose form query targeting | Recovery controls need a public adapter to keep their purpose out of the retained body           |
| WR-012 | Core HTTP feature request                           | Expose a request-lifetime AbortSignal                                      | Long-running owner actions need a native adapter for disconnect cancellation                     |
| WR-013 | Web concurrency feature request                     | Independent simultaneous form actions                                      | An active Start suppresses a separate Cancel submission through the shared navigation submitter  |
| WR-014 | Confirmed Core / Node compatibility bug             | Drain keep-alive connections that become idle after shutdown begins        | Completed requests can consume the shutdown budget and prevent workspace custody release         |
| WR-015 | FS feature request                                  | Atomic directory moves that refuse an occupied destination                 | Whole-feature archive needs stronger custody than a path check followed by ordinary rename       |
| WR-016 | Confirmed Web cancellation bug                      | Discard disconnected page requests before SSR                              | Interrupted inspection can render without layout loader data and log HTTP 500                    |
| WR-017 | Core packaging feature request                      | Side-effect-free subpath exports (e.g. `@warlock.js/core/errors`)          | A standalone helper importing one error class pulls Cascade, Cache and the MongoDB driver        |
| WR-018 | Core HTTP feature request                           | Public error-to-status mapping hook                                        | Only `instanceof HttpError` reaches a 4xx; domain errors outside Core need HttpError subclasses  |
| WR-019 | Logger API / DX request                             | Synchronous `void` log methods (or documented fire-and-forget)             | Every `log.*` call returns `Promise<this>` and trips `no-floating-promises` (about 60 sites)     |
| WR-020 | Confirmed Seal typing bug                           | Typed `validate()` output and preserved validator types                    | `data: any`, `unknown` from `~standard.validate` on unions, and `v.file().maxSize()` loses type  |
| WR-021 | Web typing request                                  | Distributive `LinkProps` and typed runtime route names                     | `Omit<LinkProps, …>` collapses destination forms; data-driven route names need casts             |
| WR-022 | AI feature request                                  | Round-trip provider content blocks in `ModelResponse`/`Message`            | Thinking, redacted-thinking and compaction blocks are dropped by the agent loop                  |
| WR-023 | AI feature request                                  | Distinct finish reasons (`pause_turn`, `refusal`, context exceeded)        | They collapse into `stop`/`length`/`error`, so callers cannot continue or fall back correctly    |
| WR-024 | AI feature request                                  | Concurrent dispatch of parallel tool calls                                 | `runTrip` awaits each tool call sequentially and emits one tool message per result               |
| WR-025 | AI / Anthropic feature request                      | `context_management`, compaction, fallbacks, cache TTL, `count_tokens`     | Not expressible through `ModelCallOptions`; Bureau serializes its own Anthropic body             |
| WR-026 | Anthropic adapter clarification                     | Thinking configuration for Opus 5.5 / Sonnet 5.5 / Fable 5.1 rules         | Adapter infers enabled/budget forms that these models reject; not verified against the new rules |
| WR-027 | Web performance request                             | Load Vite only in development                                              | Production cold start spends ~0.55 s in Vite/rollup loading that a built app never uses         |

## Status in 5.30.0

Each package's `CHANGELOG.md` (`## 5.30.0`) has the exact entries. **Fixed** means the
finding's request is met; **partial** names what is left.

| ID     | Status  | What 5.30.0 ships                                                                                                                                                                   |
| ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WR-001 | Partial | `pnpm bench:types` in seal: a generated composed-schema project measured with `tsc --extendedDiagnostics`, a committed baseline and a 5% `--check` budget. No inference rewrite. |
| WR-002 | Fixed   | A redirecting action stays submitting until the redirected page has loaded and committed.                                                                                         |
| WR-003 | Fixed   | Route `logging: { body, query }` and `http.logging`; lifecycle logs record a bounded request snapshot; credential query parameters are masked in logged URLs. BREAKING for custom channels reading `context.request`. |
| WR-004 | Fixed   | `warlock.config.ts` fallback bundles its local graph (extensionless imports, `paths` aliases) with packages kept external.                                                         |
| WR-005 | Fixed   | Typed `http.serverOptions`, including `serverOptions.http.maxHeaderSize`.                                                                                                          |
| WR-006 | Fixed   | `response.sse()` and `response.stream()` retain nothing by default (`retainEvents` / `retainChunks`), with awaitable `write()`, `drain()`, `backpressured` and a disconnect `signal`. |
| WR-007 | Fixed   | An optional discriminated union accepts an absent or `undefined` field; `null` still needs `.nullable()`.                                                                          |
| WR-008 | Fixed   | `v.literal("")` keeps `""` under required, `.present()`, `.optional()` and `.nullable()`; `.default("")` no longer fails "is required".                                           |
| WR-009 | Fixed   | `read.maxBytes` bounds direct and tool reads (UTF-8 safe, `truncated` metadata); `hash` stays the whole-file hash.                                                                |
| WR-010 | Fixed   | `ctx.signal` reaches `WorkspaceBackend.exec()`; pre-aborted calls never spawn; abort kills the process tree; results separate `cancelled` from `timedOut`.                        |
| WR-011 | Fixed   | `<Form>` honours the submitter's `formAction` and name/value in both paths; new `query` prop.                                                                                      |
| WR-012 | Fixed   | `request.signal` aborts only on a client disconnect before the response finishes.                                                                                                 |
| WR-013 | Fixed   | `<Form independent>` submits without sharing or aborting the pending submission.                                                                                                   |
| WR-014 | Fixed   | Graceful drain closes connections that go idle and sends `Connection: close` on responses during drain; active sockets are never force-closed.                                     |
| WR-015 | Partial | `moveDirectoryNoReplaceAsync()` refuses an occupied destination with `not-moved` / `moved` / `uncertain` outcomes and no copy fallback. Node has no `renameat2`, so two short swap windows remain and are documented. |
| WR-016 | Fixed   | An abandoned page request throws `ClientDisconnectedError` before render; a connected loader timeout still answers 504.                                                           |
| WR-017 | Fixed   | `@warlock.js/core/errors` (published entry plus a workspace shim) imports nothing else. No `sideEffects` flag: the root entry has real side effects.                              |
| WR-018 | Fixed   | `http.errorMapper` maps non-`HttpError` errors to a status, message or payload.                                                                                                     |
| WR-019 | Fixed   | Log methods return the logger synchronously; `await log.flush()` waits for async channels; channel failures go to `log.onChannelError()`. BREAKING.                               |
| WR-020 | Partial | Typed `validate()` result, typed discriminated-union Standard Schema output, `v.file()` keeps `UploadedFile`. `.refine()` stays `value: any`: rules run before children validate, so a typed value would be wrong. |
| WR-021 | Fixed   | `DistributiveOmit`, `LinkPropsWithout` and `isRouteName()`.                                                                                                                        |
| WR-022 | Fixed   | Provider content blocks round-trip through responses, messages and the agent loop.                                                                                                 |
| WR-023 | Fixed   | `FinishReason` adds `context_exceeded`, `pause_turn` and `refusal`; the agent resumes paused turns.                                                                                |
| WR-024 | Fixed   | Tool calls in one trip run concurrently by default (`toolDispatch: "sequential"` restores the old behaviour); results stay in request order.                                      |
| WR-025 | Fixed   | `providerOptions` (Anthropic `betas`, `body`, `thinkingDisplay`), `cacheControl.ttl`, `AnthropicModel.countTokens()`; recordings hash `providerOptions` when set.                 |
| WR-026 | Fixed   | Claude 5-family models only receive adaptive thinking; Sonnet 5.5 maps `effort: "none"` to `between_tools`.                                                                        |
| WR-027 | Partial | Production start loads no Vite, Rollup, Babel or other build tooling; `@fastify/static` loads only when something is served. An app with a public folder still loads it at boot. |

## Entries

- [WR-001](WR-001-composed-schema-compiler-cost.md) — Composed schema compiler cost
- [WR-002](WR-002-redirect-action-completion-versus-loader-commit.md) — Redirect action completion versus loader commit
- [WR-003](WR-003-sensitive-route-lifecycle-logging.md) — Sensitive-route lifecycle logging
- [WR-004](WR-004-local-typescript-configuration-imports-fail-to-load.md) — Local TypeScript configuration imports fail to load
- [WR-005](WR-005-public-typing-for-native-http-server-options.md) — Public typing for native HTTP server options
- [WR-006](WR-006-bounded-long-lived-sse-transport.md) — Bounded long-lived SSE transport
- [WR-007](WR-007-optional-discriminated-unions-reject-omitted-fields.md) — Optional discriminated unions reject omitted fields
- [WR-008](WR-008-empty-string-literals-regress-against-the-documented-contrac.md) — Empty string literals regress against the documented contract
- [WR-009](WR-009-ai-workspace-ignores-the-configured-read-byte-ceiling.md) — AI Workspace ignores the configured read byte ceiling
- [WR-010](WR-010-per-invocation-workspace-command-cancellation.md) — Per-invocation workspace command cancellation
- [WR-011](WR-011-native-form-fallback-loses-the-submitter-target-and-value.md) — Native Form fallback loses the submitter target and value
- [WR-012](WR-012-public-http-request-cancellation-signal.md) — Public HTTP request cancellation signal
- [WR-013](WR-013-independent-concurrent-form-actions.md) — Independent concurrent form actions
- [WR-014](WR-014-completed-keep-alive-requests-prevent-graceful-shutdown.md) — Completed keep-alive requests prevent graceful shutdown
- [WR-015](WR-015-atomic-no-replace-directory-moves.md) — Atomic no-replace directory moves
- [WR-016](WR-016-disconnected-page-actions-render-without-loader-data.md) — Disconnected page actions render without loader data
- [WR-017](WR-017-core-root-import-reaches-optional-subsystems.md) — Core root import reaches optional subsystems
- [WR-018](WR-018-no-public-error-to-status-mapping.md) — No public error-to-status mapping
- [WR-019](WR-019-logger-methods-return-promises.md) — Logger methods return promises
- [WR-020](WR-020-seal-output-typing-loses-information.md) — Seal output typing loses information
- [WR-021](WR-021-web-link-typing.md) — Web link typing
- [WR-022-to-WR-026](WR-022-to-WR-026-warlock-ai-gaps-found-while-enriching-the-wjs-harness.md) — Warlock AI gaps found while enriching the WJS harness
- [WR-027](WR-027-vite-loaded-in-production.md) — Vite loaded in production

## Investigations awaiting independent confirmation

None open.

## Reporting rules

Every new entry needs exact versions, expected/actual behavior, an owned
reproducer, impact, evidence, workaround and an honest classification. Record
unproven suspicions as investigations. Keep sentinels and report artifacts free
of real secrets. Primary includes new findings and requests in consolidated
status email. The current `mailme --help` exposes `--attach`; attach this single
report when sending framework findings, and include a short business summary
in the email body.

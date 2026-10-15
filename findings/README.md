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

Last updated: 2026-10-15, Asia/Riyadh.

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

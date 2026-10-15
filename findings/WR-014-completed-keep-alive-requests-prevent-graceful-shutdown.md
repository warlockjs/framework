# WR-014: Completed keep-alive requests prevent graceful shutdown

Package: `@warlock.js/core` 5.29.0; Node 22.13.0. This is a reproduced
shutdown compatibility bug on this exact runtime. Other Node versions have
not been qualified. The underlying behavior also reproduces without Warlock.

Expected: a request active when graceful shutdown starts finishes its response,
then HTTP drain completes and remaining connectors release their custody.
Actual: with a normal keep-alive client, the completed request's connection
remains open. Core's unchanged ten-second shutdown budget expires at the HTTP
connector, the process exits with code 1, and API/turn shutdown never runs.

The owned copied-production reproduction uses real Core signal handling,
the configured owner API, one synthetic slow upstream and the actual shared
turn ledger. The response finishes after roughly 3.7 seconds. The durable run
is `recovery_required`, its claim is held, and no staff message is published;
both runtime lock files remain after Core exits. A separate post-engine V5
publication gate is included in the qualification. Explicit client
`Connection: close` makes both shutdown windows pass, but that diagnostic
does not qualify ordinary browser connections.

Installed Core `esm/http/server.mjs` implements `closeServerWithTimeout`
by awaiting `server.close()` against a timer. `esm/connectors/connectors-manager.mjs`
explicitly closes HTTP first, irrespective of connector priorities. Neither
ordering a later application connector nor extending a timeout solves the
observed completed-connection behavior.

The minimal Node-only reproducer starts `server.close()` during an active
request, releases the complete response, consumes it with a normal fetch,
and observes that close remains pending. A subsequent
`server.closeIdleConnections()` completes it immediately. Run the independent
primary reproduction from this project:
`node .tmp/coordinator/framework-http-drain/reproduce.mjs`.
Its result is retained beside it as `independent-node-evidence.json`.

Actual Core evidence, source/bundle/dependency hashes and failed attempts are
frozen at `/tmp/bureau-2-core-lifecycle-qa-_f8wqywu/.tmp/manifest.json`, SHA-256
`567c465c7d82cdd1883fd2eb754024d660013169e415c5a1ca41859d34caef47`.
The adjacent `default-keep-alive-persisted-failure-facts.json` records the
durable accounting and unreleased locks. All roots, processes and credentials
are disposable; no paid requests or owner workspace data are involved.

Qualified application workaround: a supported native
`onSend` hook sets `Connection: close` only after the real application shutdown
latch is set, preserving the response payload and allowing active accounting
and publication to finish. It does not force-close active sockets or change
shutdown budgets. The final typed four-file application repair is integrated.
Independent ordinary copied-production builds and both actual Core shutdown
windows pass with default client keep-alive, unchanged ten-second budgets,
complete response bodies and HTTP → API → actual turn-store close ordering.
Restart preserves the incomplete run's hold and refuses another dispatch.
Final evidence: `/tmp/bureau-2-core-drain-repair-qa-6757826_/.tmp/manifest.json`,
SHA-256 `0ca1e9f1a4da55228d0dddae2e9814b3cc82524d671c84d4d0cd8d1e2dc17f29`.
This qualifies finite owned three-second partial-response and gated-publication
cases; it does not claim arbitrarily long executions fit the shutdown budget.

A separate application lifecycle repair now starts API cancellation synchronously
when shutdown begins, before Core starts draining HTTP. The hook retains failures
for connector shutdown and does not delay or extend Core's budget. Independent
current-source copied-production checks confirm cancellation of an owned
sixty-second never-ending upstream, preserved accounting holds, complete recovery
responses, restart refusal and actual turn-store custody release. The gated
publication case still waits for the real staff reply before releasing custody.
Evidence: `/tmp/bureau-2-core-early-drain-independent-ready-_tzf47tl/manifest.json`,
SHA-256 `df71c16469e3b9c99983591451bbb1e5123e4fbbd011f419184e19d90e052ac5`.
This sequencing repair is an application defect fix, not another framework bug.

The owner terminal's raw SSE response reproduces this same drain failure: its
writer bypasses the normal `onSend` response path. The terminal repair marks the
long-lived response `Connection: close` when it starts, then ends it only after
the actual PTY closes. A synchronous tracked shutdown hook starts terminal
cleanup before HTTP drain; it retains failures for connector shutdown and does
not extend the default ten-second budget or force-close active sockets.
The repaired ordinary copied-production process exits with code 0 with an
active SSE stream and real owned Bash PTY. Evidence and exact source hashes:
`/tmp/bureau-2-owner-terminal-repair-v2-w_81d1g2/manifest.json`, SHA-256
`f8d8fce329018dca4231ee02f9221c762145171555e08b312ab88c9873f45e63`.
The associated three-theme desktop/mobile proof is frozen at
`/tmp/bureau-2-owner-terminal-visual-v2-jcrmgafl/manifest.json`, SHA-256
`d10a099e23aba66d616f8243b6b03163f416344ab9799a8d407c03d82e1405cb`.
This is additional evidence for WR-014, not an additional framework finding.

Request: handle connections that become idle during graceful HTTP drain on
supported runtimes. Cover keep-alive, active successful and error responses,
publication completion, idle retirement and subsequent connector shutdown.
Do not use forced active-connection closure as the drain strategy.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.

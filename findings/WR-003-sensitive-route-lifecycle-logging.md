# WR-003: Sensitive-route lifecycle logging

Packages: `@warlock.js/core` and `@warlock.js/logger` 5.29.0.

Installed source: `core/esm/router/router.mjs` around lines 675–690 and
`core/esm/http/request.mjs` around lines 452–459. The account API worker enabled
a capturing LogChannel with default redaction and submitted synthetic sentinels
through real isolated HTTP requests. No real credential was used.

Known `secret` and `apiKey` fields were censored. A sentinel submitted in rejected
unknown or immutable fields such as `providerId`, `endpoint`, `credentialId`,
`actorId` and `status` appeared before the controller in lifecycle log request
body/all snapshots. A `?secret=...` sentinel also appeared through the native
response/request URL graph. Controller-level cleanup happens too late for these
records. The installed route options expose no per-route sensitive logging
control; the logger's key denylist otherwise behaves as documented.

Request: per-route body/query omission or sensitivity policy applied before
lifecycle logging, a bounded public request log snapshot without raw native
request/response graphs, and credential-query redaction. Add regression coverage
for schema rejection, middleware rejection, nested fields and URL strings.
This is a feature request; default known-secret key redaction was not shown to
be broken.

Application workaround: an account-only early hook captures bounded raw input
transiently, redacts the framework-visible body, rejects sensitive query transport
and clears temporary capture on every exit. The merged API passed eight isolated
HTTP groups with 58 requests and active-logger sentinel checks on 2026-10-14.
The separate account page-action adapter also passed native and three-theme
browser qualification with an inert injected secret store and active logger
sentinel checks; actual OS keychain/provider qualification remains separate.

Evidence: provider API worktree
`.tmp/provider-account-http/log-baseline.json` and its
`scripts/check-provider-account-http.mjs` runner. The first active-logger run
failed with `Captured logger saw a fixture secret`.

Additional owner API production baseline on 2026-10-14: ordinary configured
console stdout/stderr contains none of five generated harmless sentinels.
Adding the official `JSONFileLog` channel with its default redaction exposes
rejected prompt text, a credential-bearing body URL and a `?secret` URL value
through Core lifecycle request/native request graphs. Each appears in eleven
lifecycle entries before controller rejection. The known `apiKey` sentinel is
correctly censored. Genuine source-event text is present in the executed source
journal and absent from every tested logging sink. This establishes configured
context-sink exposure, not a default-console leak or a failure of known-key
redaction. Both owned process runs complete genuine V5 publication with one
synthetic model request each, exit cleanly and make zero paid calls.

Immutable baseline:
`/tmp/bureau-2-owner-api-log-privacy-baseline-77a6wrbt/manifest.json`, SHA-256
`fa87ae78a86c99d8288b1e2ed3507b83fb67b49dd317b0babf3d1d1945e758c9`.
The five-file application context-censor extension for native owner API and
`/api-run` page actions is integrated and independently verified. Primary
rebuilt separate current-source before/after copies, restoring only the original
connector and removing the four new privacy files for the before case. The
before process reproduces the three file-sink exposures; the after process
records zero sentinel matches in either sink. Native and page rejection statuses,
genuine V5 execution/publication, source-text privacy, transport-error logging
and clean process exit are preserved. Each side makes four synthetic requests
and zero paid calls. Controller bodies and earlier redaction policies remain
intact. This is scoped protection for these routes, not global request-log
privacy. Evidence: `.tmp/coordinator/stage17/api-log-privacy-root-independent.json`.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.

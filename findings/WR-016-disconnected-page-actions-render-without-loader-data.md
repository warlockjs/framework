# WR-016: Disconnected page actions render without loader data

Package: `@warlock.js/web` 5.29.0 on Node 22.13.0.
Classification: confirmed cancellation/rendering bug, reproduced independently
by the author and coordinator with owned production fixtures and Chrome profiles.

Expected: a disconnected request whose loader results were discarded must not
render components that require those results or attempt to send a response.
Actual: deliberately begin the read-only saved-operation Inspect POST, then
navigate before it settles. The new GET succeeds, while the abandoned POST
reaches `BureauLayout` with absent loader data and logs HTTP 500 with
`Cannot read properties of undefined (reading 'activePage')`. The application
error page also fails when wrapped in that same unloaded layout. No repair or
write request is involved in the reproduction.

Installed `execute-page-request.mjs` stops loading on request abort and discards
committed levels. Its finish callback still enters `finishRender`, which wraps
the page with the unloaded layout. Existing React stream cancellation handles
a later disconnect but does not guard this earlier render entry.

Author evidence: `/tmp/bureau-2-web-abandoned-request-evidence-wn6oxb_z/manifest.json`,
SHA-256 `694301dd9e4ed03b1c3a3c4015d7944ddb9763a9037ee9985284abb25f164389`.
It includes the bounded Chrome reproducer, redacted request timeline, server
stack, installed source hashes and a negative native-abort attempt. Coordinator
confirmation: `.tmp/coordinator/stage21/web-abort-independent-result.json`,
using production bundle
`3184c9283a20d6b26a05ac942a1289e34db7e33a17d28e58d4f08932982568bc`.
The independent invocation exited zero and reproduced the same SSR exception;
its separate new GET returned 200. Ordinary recovery evidence remains separate.

A retained package correction is implemented in
`patches/@warlock.js__web@5.29.0.patch`. It checks the actual disconnected raw
transport before rendering, uses the existing `ClientDisconnectedError`, and
lets the page handler stop before response/cache effects. It does not replace
missing layout data or remove cancellation. Loader timeouts on a connected
transport must still use the ordinary error path. The corrected production bundle
`3bd445d4f2b12ceee0ae6c33362c98c84e3ba6b04fa74a0a3a35d68e41b5a42c`
completed 35 bounded overlapping-navigation attempts with two observed canceled
requests and no SSR exception or logged HTTP 500. Separate ordinary recovery
flows passed five native and three browser groups across three themes. Evidence:
`.tmp/coordinator/stage21/web-abort-correction-evidence.json`. The connected
loader-timeout distinction is source-reviewed; consolidated regression execution
is deferred by the owner. This proves the owned workaround scope, not whole
release readiness.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.

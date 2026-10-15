# WR-018: No public error-to-status mapping

Package: `@warlock.js/core` 5.29.0.
Classification: HTTP feature request; behavior confirmed in
`esm/http/middleware/inject-request-context.mjs` (`resolveRequestErrorStatus`,
`handleRequestError`).

Only `instanceof HttpError` (and `DatabaseWriterValidationError`) receive a
non-500 status. Domain errors that must also exist in a non-HTTP process
cannot carry a status without subclassing Core, which reintroduces WR-017.
Request: a registry or config hook (`http.errorMapper`) or a documented
duck-typed `status`/`code` contract.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.

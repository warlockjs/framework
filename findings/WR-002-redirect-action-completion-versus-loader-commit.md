# WR-002: Redirect action completion versus loader commit

Package: `@warlock.js/web` 5.29.0.

Installed source: `esm/client/navigation/action-submitter.mjs`,
`createActionSubmitter`, redirect branch. It calls `runtime.navigate(result.url)`
without awaiting navigation, returns `redirected`, and ends the submission phase.
That establishes action-response completion before the redirected page's fresh
loader state has committed.

Reproduction: save a revision-guarded document and immediately submit another
edit while only `useIsSubmitting()` controls the form. The second edit can reuse
the old revision and correctly fail CAS. Bureau reproduced this in the real
browser; a focused regression failed before the application guard was changed.

Request: document this ordering explicitly and provide a supported completion/
pending primitive spanning action and redirect commit, or await the commit when
that matches the intended Form contract. The existing contract has not been
shown to promise commit completion, so this is a feature/clarification request.

Workaround: Bureau combines `useIsSubmitting()` and `useIsNavigating()` before
allowing another write. The resulting browser flow verifies repeated saves.

Evidence: `src/web/shared/hooks/use-pending-operation.spec.tsx`,
`/tmp/bureau-2-validation/editor-navigation-red.log`,
`/tmp/bureau-2-validation/editor-navigation-green.log`, and archived feature
browser receipts under `.tmp/coordinator/`.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.

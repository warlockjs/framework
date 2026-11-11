# Open tasks

Open work for the framework repository. Finished entries move to `tasks.completed.md` (newest first).

## Owner decisions waiting

None.

## Tasks

### T-001 [bug] Multi-site: a `locales.json` above the site folders reaches no page

- Source: owner, app field report of 2026-11-11 (private Artifact), reproduced against 5.47.2 and 5.51.0 source.
- What and why: with `web.sites` set, `src/web/locales.json` is discovered, typed and counted for key ownership, but no
  page receives it; pages render raw keys with no warning. Pages get `webRoot` = the site folder, and the manifest only
  pairs a dictionary with a page when the two `webRoot` values are equal.
- Evidence: `packages/web/src/build/build-route-locale-manifest.ts:145-148`, `packages/web/src/build/discover-pages.ts:1024`
  and `:1318-1325`, `packages/web/src/build/route-locale-key-ownership.ts`.
- Acceptance: a dictionary above the site folders reaches every page under it in dev, production and SSR, matching the
  browser payload; a dictionary that reaches no page logs a build warning; single-site apps unchanged; specs and docs.
- Status: in progress for 5.52.0.

### T-002 [bug] Email sign-in is case-sensitive

- Source: owner, app field report of 2026-11-11 (first seen in production 2026-11-04).
- What and why: `attemptLogin` looks the user up with the credentials as typed, so `Sara@x.io` does not find
  `sara@x.io`; the login throttle already folds case, so mis-cased attempts also lock out the right spelling.
- Evidence: `packages/auth/src/services/auth.service.ts:598-606`, `packages/auth/src/middleware/login-throttle.middleware.ts:129`.
- Acceptance: identifiers trimmed and the email lower-cased by one helper shared with the throttle; legacy rows stored
  with capitals still sign in; configurable; specs and docs.
- Status: in progress for 5.52.0.

### T-003 [bug] Repository default `orderBy` is dropped with the caller's

- Source: owner, app field report of 2026-11-11.
- What and why: `list()` merges config and repository defaults with the caller's options, then sanitizes the merged
  result as client input, so a default order on a non-sortable column is deleted (and warned on every call).
- Evidence: `packages/core/src/repositories/repository.manager.ts:599`, `:790-840`.
- Acceptance: only caller options are sanitized; trusted defaults always apply; warning once per repository; specs, docs.
- Status: in progress for 5.52.0.

### T-004 [feature] `config.translations` cannot cover a computed lookup

- Source: owner, app field report of 2026-11-11 (a signed-out page shipped 2,117 keys, 97 KB inline).
- What and why: a declaration is merged as one more usage and the page stays dynamic, so it still ships every key.
- Evidence: `packages/core/src/localization/translation-usage-graph.ts:50-57`, `translation-usage.ts` `mergeTranslationUsage`.
- Acceptance: an exhaustive declaration form (`{ keys, exhaustive: true }`) limits the page to static plus declared keys.
- Status: in progress for 5.52.0.

### T-005 [bug] A string equal to a group name ships the whole group

- Source: owner, app field report of 2026-11-11.
- What and why: any key-shaped literal reaches its subtree, so a site name `"client"` ships every `client.*` key.
- Evidence: `packages/core/src/localization/translation-usage.ts:381`, `reaches`.
- Acceptance: a free-standing literal reaches only an exact key; translator arguments and declarations unchanged.
- Status: in progress for 5.52.0.

### T-006 [bug] An unrelated import aliased as `t` counts as a translator

- Source: owner, app field report of 2026-11-11.
- What and why: translators are matched by bare name, so `import { translateCopy as t }` marks the page dynamic.
- Evidence: `packages/core/src/localization/translation-usage.ts:51-56`, `:300-310`.
- Acceptance: an import whose imported name is not a translator does not bind a translator; `trans as t` still does.
- Status: in progress for 5.52.0.

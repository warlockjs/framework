# Changelog — @warlock.js/eslint-plugin

All notable changes to `@warlock.js/eslint-plugin` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.31.0

### Added

- New package: ESLint rules for Warlock.js applications, with `recommended` and `strict` flat-config presets (`warlock.configs.recommended`). Every rule links to its page under `warlock.js.org/v/latest/eslint-plugin/rules/`.
- Security rules: `no-request-all` (no `request.all()` passed to queries, services or `inApp()`; suggests `request.validated()`), `require-route-guard` (a POST/PUT/PATCH/DELETE route needs auth middleware, a guarded group or an explicit `public: true`), `safe-redirect` (a redirect, `navigateTo()` or `<Link to>` target taken from request input must go through `safeRedirect()` / `safeRedirectTarget()`; the suggestion adds the call and its import), `no-sensitive-log` (no raw emails, credentials or whole request bodies in log calls outside `maskEmail()`, `redact()`, `escapeLogValue()` and `request.toLogSnapshot()`; keys the logger censors by default are allowed), and `no-unbounded-regex-on-input` (no `*`, `+` or `{n,}` in a regex applied to request input).
- Convention rules: `no-await-log` (autofix removes `await` before synchronous `log.*` calls), `no-js-import-extension` (autofix drops `.js`/`.jsx` from relative imports), and, in `strict`, `one-controller-per-file` and `prefer-type-discriminator` (`type`, not `kind`).
- Supports ESLint 8.57+ flat config and ESLint 9. Oxlint's JS plugins are still alpha in the pinned Oxlint 1.88, so the plugin is documented and tested with ESLint only.

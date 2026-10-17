---
description: 'ESLint rules for Warlock.js apps: validated request input, guarded mutating routes, safe redirects, redacted logs, bounded regexes on input, and the framework conventions (synchronous log calls, one controller per file, `type` discriminators, no `.js` import extensions). Exports the plugin with `recommended` and `strict` flat configs. Use for: "why does lint flag request.all()", "mark a route public", "fix a no-sensitive-log error", "set up the Warlock ESLint plugin". Not this package: runtime guards → @warlock.js/auth; redaction helpers → @warlock.js/logger.'
---

# @warlock.js/eslint-plugin

Lint rules that catch, at edit time, the mistakes a review would otherwise have to catch.

## The 80% path

1. Enable it: `warlock.configs.recommended` in `eslint.config.js` (new ESLint-mode apps already do): `lint-warlock-app.md`.
2. Fix a reported problem with the rule's page: every message links to `warlock.js.org/v/latest/eslint-plugin/rules/<rule>/`, and `lint-warlock-app.md` lists the right fix per rule.

## Conventions and pitfalls

- A suggestion is not an autofix: `public: true` and `safeRedirect()` are decisions, so they are offered, not applied by `--fix`.
- `require-route-guard` reads guards syntactically: auth middleware on the route, on `router.route(…)`, on an enclosing `router.group({ middleware })`, or a call to a guard wrapper (`guarded(() => …)` by default; configure `guardFunctions`).
- Oxlint `jsPlugins` are alpha in the pinned Oxlint; use the plugin through ESLint.

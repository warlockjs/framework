# 5.35.1 plan — slimmer page payloads (owner-approved 2026-10-21)

Measured on a real admin page: 56.7 KB HTML, of which translations 22 KB and the named API route table 6.5 KB
(all 86 routes, embedded on every page including guest pages); page data 2 KB.

- Embedded payload budget: warn (dev and production log, e2e evidence) when a page's inline payload exceeds a
  configurable size, with a per-section breakdown (page/layout/app data, translations, routes, session).
- Named API routes: embed only the routes a page's client code references (build-time extraction), drop routes
  requiring authentication for guests, `config.apiRoutes` for dynamic references, `warlock check` warning for
  undeclared dynamic use. Never ship the full table.
- Translations: shared groups (app-wide, common) as hashed immutable per-locale assets fetched once and cached;
  page/module groups pruned to the keys the page uses (literal keys, static-prefix template keys include their
  subtree, `config.translations` declarations, full fallback for unresolvable keys), `warlock check` warning for
  fully dynamic keys, and a development detector for used-but-missing keys.
- Page data stays inline (required for hydration).

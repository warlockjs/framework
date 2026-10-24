# 5.37.0 plan — application field reports (owner-approved 2026-10-24)

Fixes and features requested by a production multi-site application running 5.35.0. One release, everything in it.

- **Validation messages (core, seal):** server-side seal translation must never pick up the browser form library's
  `validation.*` defaults (`:length` left unfilled). Map placeholder names between the two, and warn in development
  when an interpolated message still contains a `:placeholder`.
- **Route table and guards (web, core):** a `web.namedApiRoutes` option (`false`, an allowlist, or a filter
  function), private path prefixes that are never embedded, per-site scoping, and guarded routes dropped for guests.
  Route inspection treats group middleware as part of every route's chain, and middleware can declare itself an
  auth guard, so `agents-md`, `inspect` and WL9006 stop reporting group-guarded routes as unguarded.
- **Test processes exit (core test kit):** Vitest runs must exit on their own after green runs (HTTP test server,
  isolated projects and a plain Vite config).
- **Re-verified behaviours (web, core):** regression tests for sitemap discovery of pages whose components import
  CSS, and for the global `http.rateLimit` covering API and page routes. Fix whichever still fails.
- **Document-store migrations (cascade):** rolling back an add-only `alter` on MongoDB must not unset the field on
  every document. Auto-derived reversible adds, an explicit destructive drop, and a destructive-operation summary
  with confirmation for `migrate:rollback` outside development. Skill notes on the asymmetry.
- **Eval variance (ai):** `repeat: n`, per-case pass counts, mean and confidence interval per metric and category,
  tolerance against the interval, and stable-failure detection.
- **Release workflow (core CLI):** a `warlock release` command family: candidate, gate, migrations --prove, stage,
  activate --preflight, verify, rollback; refuses to activate a version not greater than the deployed one.
- **Hydration and `Intl` (web docs):** guidance on `Intl`-derived labels during SSR, and a development hint naming
  the first mismatching text node.

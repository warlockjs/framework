---
name: sitemap-overview
description: 'Front-door orientation for `@warlock.js/sitemap` — runtime sitemap.xml generation: exclusion rules (not-found, error page, `metadata.robots: noindex`, `sitemap: false`), the page-level `sitemap` export for dynamic routes, and the dev-mode diagnostic for a dynamic route with no `sitemap` export. TRIGGER when: code imports anything from `@warlock.js/sitemap`; user asks "what does @warlock.js/sitemap do", "how do I add a page to the sitemap", "why is my dynamic route missing from sitemap.xml", "sitemap changefreq/priority"; package.json adds `@warlock.js/sitemap`; user is scaffolding `warlock add sitemap`. Skip: user wants to PARSE or fetch a remote sitemap — this package only generates one, in this release.'
---

# `@warlock.js/sitemap` — overview

Builds `sitemap.xml` at RUNTIME, against the application's live page registry
and each page's `metadata`/`sitemap` exports — a build-time walk can read
neither. Generation only; no remote sitemap parser in this release.

## Server-only package

`@warlock.js/sitemap`'s entire runtime surface is server-only — its
`package.json` declares `"warlock": { "environment": "server" }`. It reads
the page registry and mounts a route; it has no reason to reach the client
bundle.

## The exclusion rules — read these once and you know the shape

| case | behaviour |
| --- | --- |
| static route | included |
| not-found route | excluded |
| error page | excluded — it isn't a routable page at all |
| page whose `metadata.robots` says `noindex` | excluded |
| page exporting `sitemap: false` | excluded |
| dynamic route (`[id]`, `[...slug]`) **with** a `sitemap` export | the entries that export returns |
| dynamic route **without** a `sitemap` export | **omitted, and named in a dev-mode diagnostic** |

That last row is the whole reason this package exists: a dynamic route cannot
be enumerated without application data, so silence there would mean a
sitemap that looks complete while it quietly omits every product page on the
site. `describeUnresolvedDynamicRoutes` (`src/diagnostic.ts`) is the message a
developer sees when that happens.

## The page-level `sitemap` export

```ts
// any *.page.tsx — only needed for a dynamic route
export const sitemap: SitemapEntries = async () => [
  { path: "/posts/hello-world", lastmod: "2026-09-17", priority: 0.8 },
];

// or, to keep a page out of the sitemap deliberately
export const sitemap = false;
```

`changefreq` and `priority` are per-entry and optional, falling back to the
config's `defaults`. They are not part of `PageMetadata` — they mean nothing
outside a sitemap.

## Building blocks

- `collectSitemapEntries(pages, options)` (`src/collect-entries.ts`) — applies
  every exclusion rule above and returns `{ entries, unresolvedDynamicRoutes }`.
  Takes a `RoutablePage[]` — a minimal shape the runtime wiring adapts from
  `@warlock.js/web`'s page registry, not that package's own discovery type.
- `buildSitemapXml(entries, origin)` (`src/xml.ts`) — serialises entries into
  the sitemaps.org `urlset` document: correct namespace, element order
  (`loc`/`lastmod`/`changefreq`/`priority`), and XML escaping of `&`, `<`,
  `>`, `"`, `'` in every URL (a URL with a query string contains `&`).
- `resolveOrigin(options)` / `joinOrigin(origin, path)` (`src/url.ts`) — the
  configured public origin (`app.publicUrl`, env fallback `PUBLIC_APP_URL`),
  and joining it to a route path with exactly one slash regardless of
  trailing slashes on either side. Throws `MissingPublicUrlError` when the
  sitemap is enabled and no origin is configured — a boot-time failure, not a
  request-time fallback.
- `describeUnresolvedDynamicRoutes(routeNames)` (`src/diagnostic.ts`) — the
  dev-mode message for the row above.

## See also

- [`@warlock.js/core/warlock-conventions/SKILL.md`](@warlock.js/core/warlock-conventions/SKILL.md) — the parent framework's conventions.
- `mongez-agent-kit-authoring-skills` (load via agent-kit sync) — how this `sitemap-overview/SKILL.md` becomes the front-door skill in `.claude/skills/warlock-js-sitemap-overview/`.

# @warlock.js/sitemap

Runtime `sitemap.xml` generation for Warlock.js. Walks the application's page
registry at runtime — not at build time, which can read neither the registry
nor each page's `metadata` — applies the framework's exclusion rules, and
tells you, loudly, when a dynamic route can't be enumerated.

Generation only in this release. No remote sitemap parser — emitting XML
needs no dependency; parsing one does, and nothing needs it yet.

## Install

```bash
warlock add sitemap
```

## Config

`warlock add sitemap` writes `src/config/sitemap.ts`:

```ts
export const sitemapConfig: SitemapConfig = {
  enabled: true,
  path: "/sitemap.xml",
  defaults: { changefreq: "weekly", priority: 0.5 },
};
```

The public origin the sitemap is served from is **not** configured here — it
lives in `app.publicUrl` (or the `PUBLIC_APP_URL` environment variable), one
level up in `@warlock.js/core`, because canonical links, OG tags and absolute
mail URLs need the same value. If the sitemap is `enabled` and no origin is
configured, the app refuses to boot rather than guess — a sitemap served with
the wrong host is worse than one that never started.

## What goes in the sitemap

| case | behaviour |
| --- | --- |
| static route | included |
| not-found route | excluded |
| error page | excluded — it isn't a routable page at all |
| page whose `metadata.robots` says `noindex` | excluded |
| page exporting `sitemap: false` | excluded |
| dynamic route (`[id]`, `[...slug]`) **with** a `sitemap` export | the entries that export returns |
| dynamic route **without** a `sitemap` export | **omitted, and named in a dev-mode diagnostic** |

## Page-level `sitemap` export

Only needed for a dynamic route — a static route is included automatically at
its own path.

```ts
// any *.page.tsx
export const sitemap: SitemapEntries = async () => [
  { path: "/posts/hello-world", lastmod: "2026-09-17", priority: 0.8 },
];

// or, to keep a page out of the sitemap deliberately
export const sitemap = false;
```

`changefreq` and `priority` are per-entry and optional — they fall back to
the config's `defaults`. They are not part of `PageMetadata`; they mean
nothing outside a sitemap.

**A dynamic route with no `sitemap` export is silently omitted from the
generated XML if nobody is watching.** In development this package reports it
instead: a dynamic route cannot be enumerated without application data, and
the framework's whole job here is to make sure you find out, rather than
shipping a sitemap that looks complete while it quietly drops every product
page on the site.

## Full documentation

The complete guide lives at
**[warlock.js.org](https://warlock.js.org/v/latest/sitemap/)**.

## Tests

This package uses Vitest:

```bash
yarn test
```

## License

MIT

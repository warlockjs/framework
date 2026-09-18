# @warlock.js/sitemap

A `sitemap.xml` generator: exclusion rules (`noindex`, `sitemap: false`),
per-entry `changefreq`/`priority` defaults, and a loud diagnostic when a
dynamic route can't be enumerated. `@warlock.js/core` and `@warlock.js/web`
are **optional peers** — everything except `sitemapConnector()` imports
nothing from either, and `sitemapConnector()` itself only reaches them
through a lazy `import()` at boot. Three ways to use it, below.

Generation only in this release. No remote sitemap parser — emitting XML
needs no dependency; parsing one does, and nothing needs it yet.

## Install

```bash
npm install @warlock.js/sitemap
```

## Mode 1 — Standalone, any Node app

No Warlock at all. Build the `RoutablePage[]` array yourself — from a route
table, a database, wherever your app already knows its own URLs — and call
`collectSitemapEntries` + `buildSitemapXml` directly. Nothing on this path
resolves `@warlock.js/core` or `@warlock.js/web`.

```ts
import express from "express";
import { buildSitemapXml, collectSitemapEntries, type RoutablePage } from "@warlock.js/sitemap";

const app = express();

app.get("/sitemap.xml", async (_req, res) => {
  const pages: RoutablePage[] = [
    { routeName: "home", routePath: "/" },
    { routeName: "about", routePath: "/about" },
    {
      routeName: "post-details",
      routePath: "/posts/:id",
      sitemap: async () => (await db.posts.find()).map((post) => ({ path: `/posts/${post.slug}` })),
    },
  ];

  const { entries } = await collectSitemapEntries(pages, {
    defaults: { changefreq: "weekly", priority: 0.5 },
  });

  const xml = buildSitemapXml(entries, "https://example.com");

  res.type("application/xml").send(xml);
});
```

## Mode 2 — Warlock, API-only (no `@warlock.js/web`)

An API-only Warlock app has no page registry — `listRoutablePages()` would
have nothing to list. Pass `entries` and `sitemapConnector()` uses it instead;
`@warlock.js/web` is not required on this path.

```ts
// warlock.config.ts
import { sitemapConnector } from "@warlock.js/sitemap";

export default defineConfig({
  connectors: [
    sitemapConnector({
      entries: async () => {
        const products = await db.products.find();

        return products.map((product) => ({ path: `/products/${product.slug}` }));
      },
    }),
  ],
});
```

If neither `entries` nor `@warlock.js/web` is available, the connector
refuses to boot rather than serving an empty `<urlset>` — see
[`NoPageRegistryError`](#no-page-registry-no-entries) below.

## Mode 3 — Warlock web

```bash
warlock add sitemap
```

writes `src/config/sitemap.ts`:

```ts
export const sitemapConfig: SitemapConfig = {
  enabled: true,
  path: "/sitemap.xml",
  defaults: { changefreq: "weekly", priority: 0.5 },
};
```

`sitemapConnector()` reads the page registry from `@warlock.js/web`'s
`listRoutablePages()` on every request — not once at boot — so it reflects
the app's current shape under `warlock dev` too.

Only a dynamic route needs a page-level `sitemap` export; a static route is
included automatically at its own path.

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

If a project has both a page registry **and** `entries`, they are combined —
`entries` are added to the page-derived entries, not a replacement for them.
Where the same `path` appears in both, the `entries` version wins.

## Config reference (`src/config/sitemap.ts`)

| key | meaning |
| --- | --- |
| `enabled` | no-op when not `true` — the connector registers no route |
| `path` | defaults to `/sitemap.xml` |
| `defaults.changefreq` / `defaults.priority` | applied to any entry that omits them, page-derived or app-supplied |

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
| `sitemapConnector({ entries })` result | added to the above, `entries` wins on a `path` collision |

## No page registry, no `entries`

If `@warlock.js/web` is not installed and no `entries` option is supplied,
`sitemapConnector()` throws `NoPageRegistryError` at `boot()` — before the
route is even registered — rather than serving an empty sitemap that looks
correct. Fix it either way:

```
Sitemap is enabled but has no source of entries: `@warlock.js/web` is not installed,
so there is no page registry to read, and no `entries` option was supplied either.
Fix this by installing `@warlock.js/web`, or by passing
`sitemapConnector({ entries: async () => [...] })` with your own supplier.
```

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

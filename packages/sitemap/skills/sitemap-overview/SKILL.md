---
name: sitemap-overview
description: 'Front-door orientation for `@warlock.js/sitemap`: framework-blind `Sitemap` and streaming `SitemapIndex` builders, URL metadata, hreflang, Google image entries, sharding, diagnostics, and atomic publication. Use when adding or debugging sitemap output; Warlock page discovery and `/sitemap.xml` routing belong to `@warlock.js/web`.'
---

# `@warlock.js/sitemap` — overview

A sitemap builder that knows nothing about any framework. Entries in, a valid
sitemaps.org document out. **Zero runtime dependencies.** Generation only; no
remote sitemap parser.

## It does not import Warlock

There is no connector, no config module, no lifecycle and no page registry in
this package. It owns the sitemap PROTOCOL and every byte it emits, and
nothing else. `@warlock.js/web` is a CALLER of it, exactly like an Express app
or a cron script is — which is what makes the same three lines work everywhere.

If you are looking for page discovery, `sitemap: false` exclusion, locale
expansion, the `/sitemap.xml` route or `robots.txt`, those belong to
`@warlock.js/web`, not here.

## The whole common case

```ts
import { Sitemap } from "@warlock.js/sitemap";

const sitemap = new Sitemap({
  baseUrl: "https://example.com",
  changefreq: "weekly",
  priority: 0.5,
});

sitemap.add({ path: "/" });

declare const posts: { slug: string; updatedAt: Date }[];

for (const post of posts) {
  sitemap.add({
    name: "post-details",
    route: "/posts/:id",
    path: `/posts/${post.slug}`,
    lastmod: post.updatedAt,
    priority: 0.8,
  });
}

const xml = sitemap.toXML();

await sitemap.saveTo("public/sitemap.xml");
```

## `baseUrl` is validated in the CONSTRUCTOR

A `Sitemap` that cannot produce a valid URL should not exist. Anything that is
not an absolute `http(s)` URL throws `InvalidBaseUrlError` at construction, so
a typo surfaces at the line that wrote it rather than at the first request.
`new URL()` accepts `mailto:` and `file:` happily, so the protocol is checked
explicitly.

This replaces the 5.15.0 config key, its `PUBLIC_APP_URL` env fallback and its
boot refusal entirely: the origin is an argument now, so it cannot be missing.

## The entry

Only `path` is required, and it must be a **concrete path** — `/posts/123`,
never `/posts/:id`. A pattern is not a URL.

| Field | Meaning |
| --- | --- |
| `path` | Required. Resolved against `baseUrl`; an absolute URL is used as given. |
| `name` | Optional route label, for your own diagnostics. Never serialised. |
| `route` | Optional pattern this URL came from. Feeds `routes()` and `duplicates()`. |
| `lastmod` | `Date` → W3C datetime. A string is passed through UNTOUCHED, never re-parsed. |
| `changefreq` | One of the seven protocol values; anything else throws. |
| `priority` | `0.0`–`1.0`; anything else throws. |
| `alternates` | `{ hreflang, path }[]` — language versions of this page. |
| `images` | `{ loc }[]` — absolute HTTP(S) image URLs, including verified external CDNs. |

Invalid entries throw `InvalidSitemapEntryError` from `add()`. Paths are
normalised to carry a leading slash, so `a` and `/a` are ONE entry.

## Duplicates: silent, but not hidden

Entries are stored keyed by `path`. Adding the same path twice keeps the later
one, silently — a duplicate `<loc>` makes the document invalid, and two loops
legitimately covering an overlapping set is the normal cause.

`duplicates()` reports every collision with its count and the `route` of each
contributing add, so a caller who cares can fail their own build:

```ts
sitemap.duplicates();
// [ { path: "/posts/1", count: 2, routes: ["/posts/:id", "/:slug"] } ]
```

## `routes()` and why `declareRoute()` exists

```ts
sitemap.declareRoute("/products/:slug");

sitemap.routes();
// [ { route: "/posts/:id", count: 400 }, { route: "/products/:slug", count: 0 } ]
```

**The zero is the interesting row.** It means a route you expected to
contribute URLs contributed none, and a whole section of the site is missing
from a document that otherwise looks perfect.

Without `declareRoute()` a route only becomes known by appearing on an entry,
so every route has at least one URL, `count: 0` can never occur and the
diagnostic is decorative. Declaring the pattern is what turns a silent loss
into a visible one.

**This package reports; it never prints.** Whether a zero is a warning or a
build failure is the caller's decision.

## Alternates

`alternates` emits `<xhtml:link rel="alternate" hreflang="…">` inside each
`<url>`. Two rules:

1. **Every language version is also its own `<url>`, carrying the complete
   alternate set including itself.** Listing alternates on only one of them is
   the usual way this ships broken.
2. **The package does not know what a locale is.** `hreflang` is any string —
   `en`, `en-GB`, `x-default` — and it never derives `/{locale}/…` for you.
   Each path is supplied explicitly, which is the only thing that works when
   slugs diverge between languages.

The `xhtml` namespace is declared only when something uses it. `SitemapIndex`
applies the same rule PER SHARD — a shard declares `xmlns:xhtml` only when its
own entries carry alternates — and an alternate's `<xhtml:link>` bytes count
toward that shard's byte ceiling exactly like the rest of its `<url>` block.

## Images

Use `images` when a page has image assets to expose:

```ts
sitemap.add({
  path: "/products/widget",
  images: [{ loc: "https://cdn.example.com/widget.jpg" }],
});
```

Each image `loc` must be an absolute HTTP(S) URL. The builder emits Google's
`<image:image><image:loc>…</image:loc></image:image>` extension and declares
`xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"` only in
documents that need it. An external CDN URL is valid when that host is verified
for the site.

Google permits at most 1,000 images for one `<url>`. Extra images are dropped.
Pass `onImageLimitExceeded({ route, dropped })` in `SitemapOptions` to receive
the one diagnostic for that route; without it, the builder issues one
`console.warn` per route. Image XML and its namespace count toward the shard byte
ceiling.

## `toXML()` is pure, repeatable and synchronous

Calling it twice returns the same string; it mutates nothing and drains
nothing. It has no I/O and stays synchronous.

## The ceiling

The protocol caps one file at **50,000 URLs or 50MB uncompressed**. `Sitemap`
retains every entry — that is what makes `entries()` and a repeatable
`toXML()` possible — so it is right up to that ceiling and wrong above it. A
site past it needs the streaming writer, which retains nothing and emits shards
plus an index.

`maxBytesPerFile` is enforced at shard boundaries, not within an entry: a
single entry too large for the ceiling is written alone in its own shard
rather than split — an entry can't be split.

For `SitemapIndex`, `shardPathPrefix` changes the URL directory used for shard
links in the index without changing where `saveTo(outDir)` writes those files.
Use it when a proxy serves generated shards from a different public path.

## `SitemapIndex.saveTo(outDir)` owns the whole directory

It publishes atomically by swapping `outDir` for a freshly written temp
directory in one `rename` — which means `outDir` must be a directory
dedicated to this sitemap set, never an app's `public/` or anything else
something else writes to. Every publish marks `outDir` with
`.sitemap-set.json`; a later call only swaps a directory that is absent,
empty, or already carries that marker. A non-empty, unmarked `outDir` gets
`UnownedOutputDirectoryError` instead, and is left completely untouched.

## Errors

| Error | When |
| --- | --- |
| `InvalidBaseUrlError` | `baseUrl` missing, relative, or not `http(s)`. From the constructor. |
| `InvalidSitemapEntryError` | No path, priority outside `0.0`–`1.0`, unknown `changefreq`, invalid `Date`, alternate with no `hreflang`. From `add()`. |
| `UnownedOutputDirectoryError` | `SitemapIndex.saveTo(outDir)`: `outDir` is non-empty with no `.sitemap-set.json` marker. From `saveTo()`, before anything is written. |

## Also exported

`buildSitemapXml(entries, baseUrl)`, `escapeXml(value)`, `joinOrigin(origin,
path)`, `SitemapImage`, and `SitemapImageLimitExceeded` — the pieces the class
is built from, for a caller who wants the serialiser or image diagnostics
without the builder.

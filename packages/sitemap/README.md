# @warlock.js/sitemap

A sitemap builder that knows nothing about any framework. Entries in, a valid
[sitemaps.org](https://www.sitemaps.org/protocol.html) document out.

**Zero runtime dependencies.** Generation only — emitting XML needs no
dependency; parsing one does, and nothing here needs it yet.

## Install

```bash
npm install @warlock.js/sitemap
```

## Use it

```ts
import { Sitemap } from "@warlock.js/sitemap";

const sitemap = new Sitemap({
  baseUrl: "https://example.com",
  changefreq: "weekly",
  priority: 0.5,
});

sitemap.add({ path: "/" });

for (const post of await Post.all()) {
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

That is the whole common case. It is the same three lines from an Express
handler, a cron script, a Warlock app, or a `node build-sitemap.mjs` you wrote
in five minutes.

## The API

### `new Sitemap(options)`

| Option | Meaning |
| --- | --- |
| `baseUrl` | **Required.** Absolute origin, e.g. `https://example.com` or `https://example.com/docs`. |
| `changefreq` | Applied to any entry that does not set its own. |
| `priority` | Same. |
| `lastmod` | Same. |

`baseUrl` is validated **in the constructor**. A `Sitemap` that cannot produce
a valid URL should not exist, and you should learn about a typo at the line
that wrote it rather than at the first request. Anything that is not an
absolute `http(s)` URL throws `InvalidBaseUrlError`.

### `add(entry)` / `addMany(entries)`

Only `path` is required, and it must be a **concrete path** — `/posts/123`, not
`/posts/:id`. A pattern is not a URL.

| Field | Meaning |
| --- | --- |
| `path` | **Required.** Resolved against `baseUrl`. An absolute URL is used as given. |
| `name` | Optional label for the route, for your own diagnostics. |
| `route` | Optional pattern this URL came from, e.g. `/posts/:id`. |
| `lastmod` | `Date` (serialised as W3C datetime) or a string (passed through untouched). |
| `changefreq` | One of the seven protocol values. |
| `priority` | `0.0`–`1.0`. Anything else throws. |
| `alternates` | Language versions of this page — see below. |

Both return `this`, so they chain.

**Adding the same path twice keeps the later entry, silently.** Entries are
stored keyed by path, because a duplicate `<loc>` makes the document invalid
and two loops legitimately covering an overlapping set is the normal cause. It
is silent, not hidden — see `duplicates()`.

### `entries()` / `size`

What will actually be emitted, with defaults already folded in. `entries()`
hands back a copy.

### `routes()` — the diagnostic

```ts
sitemap.routes();
// [ { route: "/posts/:id", count: 400 }, { route: "/products/:slug", count: 0 } ]
```

**The interesting row is the zero.** It means a route you expected to
contribute URLs contributed none, and a whole section of your site is missing
from a document that otherwise looks perfect. Use `declareRoute()` to name a
pattern you expect to produce URLs:

```ts
sitemap.declareRoute("/products/:slug");

const empty = sitemap.routes().filter((route) => route.count === 0);

if (empty.length > 0) {
  throw new Error(`empty sitemap routes: ${empty.map((route) => route.route).join(", ")}`);
}
```

**This package reports; it never prints.** Whether a zero is a warning or a
build failure is your decision, not ours.

### `duplicates()`

```ts
sitemap.duplicates();
// [ { path: "/posts/1", count: 2, routes: ["/posts/:id", "/:slug"] } ]
```

Every path that was added more than once, and the `route` of each add — so a
collision between two sources is nameable. Never throws.

### `toXML()`

Pure and repeatable: calling it twice returns the same string, and it mutates
nothing. It is **synchronous and stays synchronous** — there is no I/O in it.

### `saveTo(filePath)`

Writes the document, creating parent directories. Works on a clean checkout
with no `dist/`.

## Language alternates

`alternates` emits `<xhtml:link rel="alternate" hreflang="…">` inside each
`<url>` — the thing search engines actually consume to learn that two URLs are
one page in two languages.

```ts
const alternates = [
  { hreflang: "en", path: "/en/about" },
  { hreflang: "ar", path: "/ar/about-us" },
  { hreflang: "x-default", path: "/en/about" },
];

sitemap.add({ path: "/en/about", alternates });
sitemap.add({ path: "/ar/about-us", alternates });
```

Two rules worth knowing:

1. **Every language version is also its own `<url>`, carrying the complete
   alternate set including itself.** Listing alternates on only one of them is
   the usual way this gets shipped broken.
2. **This package does not know what a locale is.** `hreflang` is any string —
   `en`, `en-GB`, `x-default` — and it never derives `/{locale}/…` for you. You
   supply each path explicitly, which is the only thing that works when slugs
   diverge between languages.

The `xhtml` namespace is declared only when something actually uses it.

## Very large sites

The protocol caps one file at **50,000 URLs or 50MB uncompressed**. `Sitemap`
retains every entry — that is what makes `entries()` and a repeatable
`toXML()` possible — so it is the right tool up to that ceiling and the wrong
one above it. A streaming writer that emits shards plus an index and retains
nothing is the companion for sites past it.

## Errors

| Error | When |
| --- | --- |
| `InvalidBaseUrlError` | `baseUrl` is missing, relative, or not `http(s)`. Thrown from the constructor. |
| `InvalidSitemapEntryError` | An entry the protocol cannot represent: no path, a priority outside `0.0`–`1.0`, an unknown `changefreq`, an invalid `Date`, an alternate with no `hreflang`. |

## Also exported

`buildSitemapXml(entries, baseUrl)`, `escapeXml(value)` and
`joinOrigin(origin, path)` — the pieces `Sitemap` is built from, for when you
want the serialiser without the builder.

# Changelog — @warlock.js/sitemap

All notable changes to `@warlock.js/sitemap` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.20.1 - 2026-09-24

### Changed

- Lockstep release maintenance and dependency refresh.
## 5.20.0 - 2026-09-24

### Added

- `SitemapEntry.images` emits the Google image sitemap extension, validates
  absolute HTTP(S) image URLs, and limits each URL to 1,000 images with a
  caller-visible diagnostic.
- `SitemapIndexOptions.shardPathPrefix` controls public shard links in an
  index without changing the files written by `saveTo()`.

### Changed

- Refined grouped skill discovery guidance and regenerated package llms
  projections.

## 5.19.0 - 2026-09-23

### Changed

- Refined package skill-discovery descriptions and regenerated the llms projections.

## 5.16.0 - 2026-09-18

### Upgrading

- The 5.15 connector API is gone. In a Warlock app, remove `sitemapConnector()` from `warlock.config.ts` and `src/config/sitemap.ts`, then configure `web.sitemap` in `src/config/web.ts` (`warlock add sitemap` writes this section). Outside Warlock, build the sitemap with `new Sitemap({ baseUrl })`.

### Added

- `SitemapIndex`: streams entries into size-capped shards plus a master index, and optionally writes `.xml.gz` files. It publishes the whole output directory atomically and marks it with `.sitemap-set.json`.
- `Sitemap.publishTo(outDir, fileName?)`, and `saveTo()` now writes atomically (temp file, then rename, with retries on Windows `EPERM`/`EBUSY`).
- `UnownedOutputDirectoryError`: publishing refuses to replace a non-empty directory that lacks the ownership marker.

### Changed

- **BREAKING:** the package no longer depends on any framework. The connector API is removed: `sitemapConnector()`, `collectSitemapEntries()`, the `SitemapConfig` config module, `MissingPublicUrlError`, `NoPageRegistryError` and `RoutablePage`. Use the `Sitemap` builder class instead (`new Sitemap({ baseUrl })`, `add` / `addMany` / `declareRoute`, `toXML` / `saveTo`). Warlock apps configure `web.sitemap` in `@warlock.js/web` instead.
- `baseUrl` is validated in the constructor (`InvalidBaseUrlError`). Entries are keyed by path, and `duplicates()` reports every collision.
- Dropped the `@warlock.js/core` and `@warlock.js/web` dependencies.

## 5.15.0 - 2026-09-18

### Added

- New package: runtime `sitemap.xml` generation. Walks the page registry at runtime, applies the framework's exclusion rules (not-found route, error page, `metadata.robots: noindex`, `sitemap: false`), collects the entries a page's `sitemap` export returns, and reports — in development — any dynamic route left with no `sitemap` export so it is never silently dropped from the generated XML.
- Zero runtime dependencies, in the same spirit as `@warlock.js/fs`: XML serialization is string-building plus escaping, and needs no library.
- Usable in three ways: standalone in any Node app (`collectSitemapEntries` + `buildSitemapXml`, no Warlock at all), in an API-only Warlock app via `sitemapConnector({ entries })`, and in a Warlock web app from the page registry. `@warlock.js/core` and `@warlock.js/web` are **optional** peers — everything except `sitemapConnector()` imports nothing from either, and the connector reaches them only through a lazy `import()`.
- `sitemapConnector({ entries })` merges app-supplied entries with page-derived ones, deduplicated by path with the app-supplied entry winning. With neither source available the connector refuses to boot (`NoPageRegistryError`) instead of serving an empty `<urlset>` that looks correct.

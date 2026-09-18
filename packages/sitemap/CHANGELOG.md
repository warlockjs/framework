# Changelog — @warlock.js/sitemap

All notable changes to `@warlock.js/sitemap` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.15.0 - 2026-09-18

### Added

- New package: runtime `sitemap.xml` generation. Walks the page registry at runtime, applies the framework's exclusion rules (not-found route, error page, `metadata.robots: noindex`, `sitemap: false`), collects the entries a page's `sitemap` export returns, and reports — in development — any dynamic route left with no `sitemap` export so it is never silently dropped from the generated XML.
- Zero runtime dependencies, in the same spirit as `@warlock.js/fs`: XML serialization is string-building plus escaping, and needs no library.
- Usable in three ways: standalone in any Node app (`collectSitemapEntries` + `buildSitemapXml`, no Warlock at all), in an API-only Warlock app via `sitemapConnector({ entries })`, and in a Warlock web app from the page registry. `@warlock.js/core` and `@warlock.js/web` are **optional** peers — everything except `sitemapConnector()` imports nothing from either, and the connector reaches them only through a lazy `import()`.
- `sitemapConnector({ entries })` merges app-supplied entries with page-derived ones, deduplicated by path with the app-supplied entry winning. With neither source available the connector refuses to boot (`NoPageRegistryError`) instead of serving an empty `<urlset>` that looks correct.

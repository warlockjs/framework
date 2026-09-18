# Changelog — @warlock.js/sitemap

All notable changes to `@warlock.js/sitemap` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.15.0 - 2026-09-18

### Added

- New package: runtime `sitemap.xml` generation. Walks the page registry at runtime, applies the framework's exclusion rules (not-found route, error page, `metadata.robots: noindex`, `sitemap: false`), collects the entries a page's `sitemap` export returns, and reports — in development — any dynamic route left with no `sitemap` export so it is never silently dropped from the generated XML.
- Zero runtime dependencies, in the same spirit as `@warlock.js/fs`: XML serialization is string-building plus escaping, and needs no library.

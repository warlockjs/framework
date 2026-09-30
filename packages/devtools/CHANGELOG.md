# Changelog — @warlock.js/devtools

All notable changes to `@warlock.js/devtools` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.26.1 - 2026-09-30

### Fixed

- Republish of 5.26.0 with no code changes. npm accepted `@warlock.js/ai@5.26.0` but held it in a staged state that never became visible (npm/cli#9889), so 5.26.0 cannot be installed together with the AI packages. Use 5.26.1; 5.26.0 is deprecated.

## 5.26.0 - 2026-09-30

### Changed

- Dependencies: `fastify` ^5.12.5 (security fixes).

## 5.25.0 - 2026-09-28

### Added

- New package. A development-only dashboard served at `/__warlock`: request timeline, queries with EXPLAIN, N+1 detection, dev mailbox, logs, cache operations and the route map. It refuses to run outside development and answers only loopback clients.

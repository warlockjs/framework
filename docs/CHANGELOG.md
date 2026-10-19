# Changelog

## 5.34.0

### Added

- Document browser end-to-end specs, owned fixtures, direct CDP interactions, responsive assertions, evidence and process cleanup, with complete runnable examples.
### Changed

- Document the 5.34 ESLint/Prettier removal, Oxlint-only checkers and scaffolds, the retained 5.33 migration and new 5.34 upgrade step, native custom-rule porting, correctness diagnostics and lockfile precedence.

## 5.33.0

### Fixed

- Keep the measure-call recipe in the latest sidebar so frozen documentation versions build without a missing page; render Caddy configuration as labeled plain text instead of requesting an unavailable highlighter.

### Added

- Document process supervision, platform enforcement, safe ownership, terminal support and `warlock add process`; add the package sidebar, catalogue and LLM package order.

## 5.32.0

### Security

- Require esbuild ^0.28.2 in standalone site installs as well as the workspace, past the Windows development-server advisory [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) (patched in 0.28.1).

### Changed

- Pin the native TypeScript compiler to 7.0.2 and typecheck with supported configuration options.

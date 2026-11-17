# Changelog

## 5.56.0 - 2026-11-17

### Added

- New devtools pages: "Devtools in production" (setup, environment variables, accounts, two-factor sign-in, the disable switch, sampling, redaction, several instances, error codes) and "Devtools security" (how the dashboard path is protected and what each control does).
- The core encryption page documents the TOTP helpers, and the request log page documents `excludeFromRequestLog()`.

### Changed

- The devtools pages describe the React dashboard, the new Resources, Health, Errors and Jobs tabs, and the `production` flag for package panels.

## 5.55.0 - 2026-11-17

### Added

- A new Grimoire section with pages for the project book, `warlock grimoire` and `warlock scry`, the `GR` codes, the Vitest reporter, the devtools tab and the agent skills.
- The MCP pages document `withMcpTools()` and `mcp.tools`.
- The devtools pages document registering a dashboard tab with `panels` in `src/config/devtools.ts`.

### Changed

- The inspect pages document the new file roles, the file and route fields, and the page `setupFile` and `site` fields.
- The CLI pages document `warlock explain` for package codes through `withExplainCodes()`, and `cli.commands` arrays.

## 5.34.0 - 2026-10-19

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
